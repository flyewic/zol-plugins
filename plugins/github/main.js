// github — a GitHub integration for zol.
//
// Layout:
//   - The docked panel (`github.panel`) is a compact overview only: repo,
//     branch, `gh` status, counts, and buttons that open views.
//   - "Pull requests" and "Issues" open as editor tabs (`registerView`).
//   - Selecting a row opens a rendered-markdown tab (`openMarkdown`) with the
//     body and comments; a PR's "Diff" button opens the patch as a diff tab
//     (`openDiff`).
//
// Local repository facts come from `zol.git.*`; everything GitHub-specific goes
// through the `gh` CLI via `zol.exec`. The plugin never sees a token:
// `gh auth login` owns credentials.

const PANEL = "github.panel";
const PRS_VIEW = "github.prs";
const ISSUES_VIEW = "github.issues";

const state = {
  phase: "idle", // idle | loading | ready | error
  repo: null,
  branch: null,
  gh: "unknown", // unknown | ok | unauth | missing
  error: "",
  counts: { prs: null, issues: null },
  last_branch: null,
  inflight: 0,
  timer: 0,
};

const prs = { loading: false, items: [], error: "", filter: "open" };
const issues = {
  loading: false,
  items: [],
  error: "",
  state: "open",
  search: "",
  show_form: false,
  form: { title: "", body: "", labels: "" },
  submitting: false,
  submit_error: "",
  created: "",
};

function settings() {
  return {
    gh_path: zol.setting("gh_path") || "gh",
    host: zol.setting("host") || "github.com",
    override: String(zol.setting("repo_override") || "").trim(),
    refresh_seconds: Math.max(5, zol.setting("refresh_seconds") | 0 || 60),
  };
}

function workdir() {
  return zol.git.root() || zol.projectRoot() || undefined;
}

function gh(args, opts) {
  const resolved = Object.assign({ cwd: workdir() }, opts || {});
  return zol.exec([settings().gh_path].concat(args), resolved);
}

function repoArg() {
  const r = state.repo;
  if (!r) return null;
  return r.host === "github.com" ? r.full : r.host + "/" + r.full;
}

function firstLine(s) {
  const lines = String(s || "").trim().split("\n");
  return lines.length ? lines[0].trim() : "";
}

function truncate(s, n) {
  s = String(s || "");
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function repoUrl() {
  return state.repo ? "https://" + state.repo.host + "/" + state.repo.full : "";
}

// GitHub returns comment authors as objects (`{ login }` / `{ name }`); render a
// plain "## Comments" markdown section below the body.
function commentAuthor(c) {
  const a = c && c.author;
  if (!a) return "?";
  return a.login || a.name || "?";
}

function renderComments(comments) {
  if (!comments || !comments.length) return "";
  let s = "## Comments\n\n";
  for (const c of comments) {
    s += "**" + commentAuthor(c) + "**\n\n" + (c.body || "") + "\n\n";
  }
  return s;
}

// ---- identity ----

function parseRemote(url) {
  if (!url) return null;
  let m = /^ssh:\/\/git@([^:\/]+)[:\/]([^\/\s]+)\/([^\/\s]+?)(?:\.git)?$/.exec(url);
  if (!m) m = /^git@([^:\/]+):([^\/\s]+)\/([^\/\s]+?)(?:\.git)?$/.exec(url);
  if (!m) m = /^(?:https?|git):\/\/([^\/]+)\/([^\/\s]+)\/([^\/\s]+?)(?:\.git)?$/.exec(url);
  if (!m) return null;
  const host = m[1];
  const owner = m[2];
  const name = m[3];
  if (!host || !owner || !name) return null;
  return { host: host, owner: owner, name: name, full: owner + "/" + name };
}

function overrideRepo(value) {
  const m = /^([^\/\s]+)\/([^\/\s]+)$/.exec(value);
  if (!m) return null;
  return { host: settings().host, owner: m[1], name: m[2], full: m[1] + "/" + m[2] };
}

function resolveRepo() {
  const s = settings();
  const over = overrideRepo(s.override);
  if (over) return Promise.resolve(over);

  const fromRemote = parseRemote(zol.git.remote());
  if (fromRemote && fromRemote.host === s.host) return Promise.resolve(fromRemote);

  if (state.gh !== "ok") return Promise.resolve(null);
  return gh(["repo", "view", "--json", "nameWithOwner"]).then(function (r) {
    if (r.code !== 0) return null;
    let j;
    try {
      j = JSON.parse(r.stdout);
    } catch (e) {
      return null;
    }
    const parts = String((j && j.nameWithOwner) || "").split("/");
    if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
    return { host: s.host, owner: parts[0], name: parts[1], full: j.nameWithOwner };
  }).catch(function () {
    return null;
  });
}

function probeGh() {
  return gh(["auth", "status"]).then(function (r) {
    state.gh = r.code === 0 ? "ok" : "unauth";
  }).catch(function () {
    state.gh = "missing";
  });
}

function loadCounts() {
  if (!state.repo || state.gh !== "ok") return;
  gh(["pr", "list", "--repo", repoArg(), "--state", "open", "--limit", "100", "--json", "number"]).then(function (r) {
    if (r.code === 0) {
      try {
        state.counts.prs = JSON.parse(r.stdout).length;
      } catch (e) {}
    }
  }).catch(function () {});
  gh(["issue", "list", "--repo", repoArg(), "--state", "open", "--limit", "100", "--json", "number"]).then(function (r) {
    if (r.code === 0) {
      try {
        state.counts.issues = JSON.parse(r.stdout).length;
      } catch (e) {}
    }
  }).catch(function () {});
}

// Re-resolve identity and refresh whatever is open.
function refresh() {
  if (state.inflight > 0) return;
  state.inflight++;
  state.phase = "loading";
  state.error = "";
  probeGh()
    .then(resolveRepo)
    .then(function (repo) {
      const changed = !state.repo || !repo || state.repo.full !== repo.full;
      state.repo = repo;
      state.branch = zol.git.branch();
      state.last_branch = state.branch;
      state.phase = repo ? "ready" : "error";
      if (!repo) {
        state.error = zol.git.remote()
          ? "origin is not a " + settings().host + " repository"
          : "no GitHub remote found";
      } else if (changed) {
        prs.items = [];
        prs.error = "";
        issues.items = [];
        issues.error = "";
        state.counts = { prs: null, issues: null };
      }
      if (repo) {
        loadCounts();
        loadPrs();
        loadIssues();
      }
    })
    .catch(function (e) {
      state.phase = "error";
      state.error = String((e && e.message) || e);
    })
    .then(function () {
      state.inflight--;
    });
}

function schedule() {
  if (state.timer) zol.clearTimeout(state.timer);
  state.timer = zol.setTimeout(function () {
    refresh();
    schedule();
  }, settings().refresh_seconds * 1000);
}

function ghHint(ui) {
  if (state.gh === "missing") {
    ui.label("gh CLI not found (https://cli.github.com)", { tone: "danger" });
  } else if (state.gh === "unauth") {
    ui.label("Run `gh auth login` to connect.", { tone: "warning" });
  }
}

// ---- pull requests ----

function checkState(c) {
  if (c.__typename === "StatusContext" || c.context) {
    const st = String(c.state || "").toUpperCase();
    if (st === "SUCCESS") return "pass";
    if (st === "FAILURE" || st === "ERROR") return "fail";
    return "pending";
  }
  const status = String(c.status || "").toUpperCase();
  if (status && status !== "COMPLETED") return "pending";
  const concl = String(c.conclusion || "").toUpperCase();
  if (concl === "SUCCESS" || concl === "NEUTRAL" || concl === "SKIPPED") return "pass";
  if (concl) return "fail";
  return "pending";
}

function ciRollup(checks) {
  if (!checks || !checks.length) return "none";
  let pending = false;
  for (const c of checks) {
    const s = checkState(c);
    if (s === "fail") return "failing";
    if (s === "pending") pending = true;
  }
  return pending ? "pending" : "passing";
}

function ciLabel(roll) {
  if (roll === "failing") return { text: "✗ failing", tone: "danger" };
  if (roll === "pending") return { text: "● pending", tone: "warning" };
  if (roll === "passing") return { text: "✓ passing", tone: "success" };
  return { text: "– no checks", tone: "faint" };
}

function checkName(c) {
  return c.name || c.context || "check";
}

function parsePr(p) {
  return {
    number: p.number,
    title: p.title || "",
    author: p.author ? (p.author.login || p.author.name || "") : "",
    branch: p.headRefName || "",
    isDraft: !!p.isDraft,
    review: p.reviewDecision || "",
    url: p.url || "",
    checks: p.statusCheckRollup || [],
    ci: ciRollup(p.statusCheckRollup),
  };
}

function loadPrs() {
  if (!state.repo || state.gh !== "ok" || prs.loading) return;
  prs.loading = true;
  prs.error = "";
  const args = [
    "pr", "list",
    "--repo", repoArg(),
    "--state", "open",
    "--limit", "50",
    "--json", "number,title,author,headRefName,isDraft,reviewDecision,updatedAt,url,statusCheckRollup",
  ];
  if (prs.filter === "mine") args.push("--author", "@me");
  gh(args).then(function (r) {
    prs.loading = false;
    if (r.code !== 0) {
      prs.error = firstLine(r.stderr) || ("gh pr list failed (" + r.code + ")");
      return;
    }
    let j;
    try {
      j = JSON.parse(r.stdout);
    } catch (e) {
      prs.error = "could not parse gh output";
      return;
    }
    prs.items = (j || []).map(parsePr);
  }).catch(function (e) {
    prs.loading = false;
    prs.error = String((e && e.message) || e);
  });
}

function visiblePrs() {
  if (prs.filter === "drafts") return prs.items.filter(function (p) { return p.isDraft; });
  return prs.items;
}

function setPrFilter(key) {
  if (prs.filter === key) return;
  prs.filter = key;
  loadPrs();
}

function prMarkdown(p, detail) {
  const ci = ciLabel(p.ci);
  let s = "# #" + p.number + " " + p.title + "\n\n";
  s += "**" + (p.author || "?") + "** · `" + p.branch + "` · CI: " + ci.text + (p.isDraft ? " · draft" : "") + "\n\n";
  s += "[Open on GitHub](" + p.url + ")\n\n";
  if (!detail) {
    s += "_Loading…_\n";
    return s;
  }
  s += "**" + detail.files + " file(s) changed**\n\n";
  if (p.checks.length) {
    s += "## Checks\n\n";
    for (const c of p.checks) s += "- " + checkName(c) + " — " + String(c.conclusion || c.state || c.status || "") + "\n";
    s += "\n";
  }
  if (detail.body) s += "## Description\n\n" + detail.body + "\n";
  s += renderComments(detail.comments);
  return s;
}

function openPr(p) {
  const key = "pr:" + p.number;
  zol.openMarkdown("#" + p.number + " " + truncate(p.title, 30), prMarkdown(p, null), { key: key });
  gh(["pr", "view", String(p.number), "--repo", repoArg(), "--json", "body,files,mergeable,comments"]).then(function (r) {
    if (r.code !== 0) return;
    let j;
    try {
      j = JSON.parse(r.stdout);
    } catch (e) {
      return;
    }
    p.detail = {
      body: j.body || "",
      files: (j.files || []).length,
      mergeable: j.mergeable || "",
      comments: j.comments || [],
    };
    zol.setMarkdown(key, prMarkdown(p, p.detail));
  }).catch(function () {});
}

// Fetch the PR patch with `gh pr diff` and open it as a built-in diff tab. The
// diff is text from GitHub, not a local git state, so it goes through
// `zol.openDiff` (rendered by the `diff` view provider).
function openPrDiff(p) {
  const key = "prdiff:" + p.number;
  gh(["pr", "diff", String(p.number), "--repo", repoArg()]).then(function (r) {
    if (r.code !== 0) {
      prs.error = "Could not load PR #" + p.number + " diff: " + (firstLine(r.stderr) || ("gh pr diff failed (" + r.code + ")"));
      return;
    }
    const text = String(r.stdout || "");
    if (!text.trim()) {
      prs.error = "PR #" + p.number + " has no diff";
      return;
    }
    prs.error = "";
    zol.openDiff("diff: PR #" + p.number, text, { key: key });
  }).catch(function (e) {
    prs.error = "Could not load PR #" + p.number + " diff: " + String((e && e.message) || e);
  });
}

function drawPrs(ui) {
  ui.row(function () {
    ui.heading("Pull requests");
    ui.spacer(0, 0);
    if (prs.loading) ui.label("loading…", { tone: "faint" });
  });
  ui.row(function () {
    prFilterButton(ui, "open", "Open");
    prFilterButton(ui, "mine", "Mine");
    prFilterButton(ui, "drafts", "Drafts");
    ui.spacer(0, 0);
    if (ui.button("Refresh")) loadPrs();
  });
  ui.separator();

  if (prs.error) {
    ui.label(prs.error, { tone: "danger" });
    return;
  }
  const rows = visiblePrs();
  if (rows.length === 0) {
    ui.label(prs.loading ? "Loading…" : "No pull requests", { tone: "faint" });
    return;
  }
  for (const p of rows) {
    ui.row(function () {
      if (ui.button("#" + p.number + "  " + truncate(p.title, 60))) openPr(p);
      ui.spacer(0, 0);
      if (ui.button("Diff")) openPrDiff(p);
      const ci = ciLabel(p.ci);
      ui.label(ci.text, { tone: ci.tone });
    });
    ui.row(function () {
      ui.label((p.author || "?") + "  ·  " + p.branch + (p.isDraft ? "  ·  draft" : ""), { tone: "faint" });
    });
  }
}

function prFilterButton(ui, key, label) {
  const active = prs.filter === key;
  if (ui.button((active ? "● " : "○ ") + label)) setPrFilter(key);
}

// ---- issues ----

function parseIssue(i) {
  return {
    number: i.number,
    title: i.title || "",
    author: i.author ? (i.author.login || i.author.name || "") : "",
    labels: (i.labels || []).map(function (l) { return l.name || l; }),
    state: i.state || "",
    url: i.url || "",
  };
}

function loadIssues() {
  if (!state.repo || state.gh !== "ok" || issues.loading) return;
  issues.loading = true;
  issues.error = "";
  const args = [
    "issue", "list",
    "--repo", repoArg(),
    "--state", issues.state,
    "--limit", "50",
    "--json", "number,title,author,labels,state,updatedAt,url",
  ];
  if (issues.search) args.push("--search", issues.search);
  gh(args).then(function (r) {
    issues.loading = false;
    if (r.code !== 0) {
      issues.error = firstLine(r.stderr) || ("gh issue list failed (" + r.code + ")");
      return;
    }
    let j;
    try {
      j = JSON.parse(r.stdout);
    } catch (e) {
      issues.error = "could not parse gh output";
      return;
    }
    issues.items = (j || []).map(parseIssue);
  }).catch(function (e) {
    issues.loading = false;
    issues.error = String((e && e.message) || e);
  });
}

function setIssueState(s) {
  if (issues.state === s) return;
  issues.state = s;
  loadIssues();
}

function issueStateButton(ui, key, label) {
  const active = issues.state === key;
  if (ui.button((active ? "● " : "○ ") + label)) setIssueState(key);
}

function issueMarkdown(p, detail) {
  let s = "# #" + p.number + " " + p.title + "\n\n";
  s += "**" + (p.author || "?") + "** · " + p.state.toLowerCase();
  if (p.labels.length) s += " · " + p.labels.join(", ");
  s += "\n\n[Open on GitHub](" + p.url + ")\n\n";
  if (!detail) {
    s += "_Loading…_\n";
    return s;
  }
  if (detail.body) s += detail.body + "\n\n";
  const comments = renderComments(detail.comments);
  s += comments.length ? comments : "---\n\n_No comments_\n";
  return s;
}

function openIssue(p) {
  const key = "issue:" + p.number;
  zol.openMarkdown("#" + p.number + " " + truncate(p.title, 30), issueMarkdown(p, null), { key: key });
  gh(["issue", "view", String(p.number), "--repo", repoArg(), "--json", "body,comments"]).then(function (r) {
    if (r.code !== 0) return;
    let j;
    try {
      j = JSON.parse(r.stdout);
    } catch (e) {
      return;
    }
    p.detail = { body: j.body || "", comments: j.comments || [] };
    zol.setMarkdown(key, issueMarkdown(p, p.detail));
  }).catch(function () {});
}

// `gh issue create` prompts interactively when the title or body is missing, so
// both are always supplied; the body goes on stdin (never argv).
function createIssue() {
  const title = String(issues.form.title || "").trim();
  if (!title || issues.submitting) return;
  issues.submitting = true;
  issues.submit_error = "";
  issues.created = "";
  const args = ["issue", "create", "--repo", repoArg(), "--title", title, "--body-file", "-"];
  const labels = String(issues.form.labels || "").split(",").map(function (s) { return s.trim(); });
  for (const l of labels) if (l) args.push("--label", l);
  gh(args, { stdin: String(issues.form.body || "") }).then(function (r) {
    issues.submitting = false;
    if (r.code !== 0) {
      issues.submit_error = firstLine(r.stderr) || ("gh issue create failed (" + r.code + ")");
      return;
    }
    issues.created = firstLine(r.stdout) || "issue created";
    issues.form = { title: "", body: "", labels: "" };
    issues.show_form = false;
    loadIssues();
    loadCounts();
  }).catch(function (e) {
    issues.submitting = false;
    issues.submit_error = String((e && e.message) || e);
  });
}

function drawCreateIssue(ui) {
  ui.input({
    placeholder: "Title — press Enter to stage",
    onSubmit: function (t) { issues.form.title = t; },
  });
  ui.input({
    multiline: true,
    height: 96,
    placeholder: "Body — press Enter to stage",
    onSubmit: function (t) { issues.form.body = t; },
  });
  ui.input({
    placeholder: "labels, comma-separated — Enter to stage",
    onSubmit: function (t) { issues.form.labels = t; },
  });
  ui.row(function () {
    ui.label(
      "staged: " + (issues.form.title ? "title ✓" : "title —") +
      "  " + (issues.form.body ? "body ✓" : "body —") +
      "  " + (issues.form.labels ? "labels ✓" : "labels —"),
      { tone: "faint" },
    );
    ui.spacer(0, 0);
    if (issues.submitting) {
      ui.label("Creating…", { tone: "faint" });
    } else if (ui.button("Create")) {
      createIssue();
    }
  });
  if (issues.submit_error) ui.label(issues.submit_error, { tone: "danger" });
  if (issues.created) ui.label("Created: " + issues.created, { tone: "success" });
}

function drawIssues(ui) {
  ui.row(function () {
    ui.heading("Issues");
    ui.spacer(0, 0);
    if (issues.loading) ui.label("loading…", { tone: "faint" });
  });
  ui.row(function () {
    issueStateButton(ui, "open", "Open");
    issueStateButton(ui, "closed", "Closed");
    issueStateButton(ui, "all", "All");
    ui.spacer(0, 0);
    if (ui.button(issues.show_form ? "Cancel" : "New issue")) issues.show_form = !issues.show_form;
  });
  ui.input({
    placeholder: "Search issues — Enter",
    onSubmit: function (t) { issues.search = t; loadIssues(); },
  });

  if (issues.show_form) {
    drawCreateIssue(ui);
    ui.separator();
  }

  if (issues.error) {
    ui.label(issues.error, { tone: "danger" });
    return;
  }
  const rows = issues.items;
  if (rows.length === 0) {
    ui.label(issues.loading ? "Loading…" : "No issues", { tone: "faint" });
    return;
  }
  for (const p of rows) {
    ui.row(function () {
      if (ui.button("#" + p.number + "  " + truncate(p.title, 60))) openIssue(p);
      ui.spacer(0, 0);
      ui.label(p.state.toLowerCase(), { tone: p.state === "OPEN" ? "success" : "faint" });
    });
    if (p.labels.length) ui.label(p.labels.join("  ·  "), { tone: "faint" });
  }
}

// ---- overview panel ----

function drawOverview(ui) {
  ui.row(function () {
    ui.heading("GitHub");
    ui.spacer(0, 0);
    if (ui.button("Refresh")) refresh();
  });
  ui.separator();

  if (!state.repo) {
    const msg = state.phase === "loading"
      ? "Resolving repository…"
      : (state.error || "No repository");
    ui.label(msg, { tone: "muted" });
    ghHint(ui);
    return;
  }

  ui.label(state.repo.full, { tone: "accent" });
  if (state.branch) ui.label(state.branch, { tone: "muted" });
  ghHint(ui);
  ui.separator();

  const pc = state.counts.prs;
  const ic = state.counts.issues;
  ui.label((pc === null ? "—" : pc) + " open pull requests", { tone: "muted" });
  ui.label((ic === null ? "—" : ic) + " open issues", { tone: "muted" });
  ui.separator();

  if (ui.button("Pull requests")) zol.openView(PRS_VIEW, "open", {});
  if (ui.button("Issues")) zol.openView(ISSUES_VIEW, "open", {});
  if (ui.button("Open on GitHub")) zol.openUrl(repoUrl());
}

function draw(ui) {
  const branch = zol.git.branch();
  if (branch !== state.last_branch) {
    state.last_branch = branch;
    refresh();
  }
  drawOverview(ui);
}

// ---- registration ----

zol.registerPanel(PANEL, {
  title: "GitHub",
  icon: "github",
  dock: true,
  visible: false,
  width: 300,
  // The rail button opens a menu (into the window) rather than toggling the
  // cramped sidebar: each entry opens a view tab or refreshes.
  menu: [
    { label: "Pull requests", command: "github.open-prs" },
    { label: "Issues", command: "github.open-issues" },
    { label: "Refresh", command: "github.refresh" },
  ],
  draw: draw,
});

zol.registerView(PRS_VIEW, { title: "Pull requests", draw: drawPrs });
zol.registerView(ISSUES_VIEW, { title: "Issues", draw: drawIssues });

zol.registerCommand("github.refresh", "GitHub: Refresh", function () { refresh(); });
zol.registerCommand("github.open-prs", "GitHub: Pull requests", function () { zol.openView(PRS_VIEW, "open", {}); });
zol.registerCommand("github.open-issues", "GitHub: Issues", function () { zol.openView(ISSUES_VIEW, "open", {}); });
zol.registerCommand("github.toggle", "GitHub: Overview", function () { zol.togglePanel(PANEL); });

zol.registerKeybind("ctrl+shift+h", "github.toggle");

zol.setTimeout(function () {
  refresh();
  schedule();
}, 0);

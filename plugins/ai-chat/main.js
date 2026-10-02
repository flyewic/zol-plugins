// ai-chat: a streaming chat panel with an approval-gated agent loop.
//
// All provider logic lives in the ai-kit library; this plugin owns the
// transcript, context packing, tool execution, and the panel. Tool calls are
// model output in a fenced ```tool block; nothing is applied without the user
// clicking Approve, and applied edits carry the revision captured when the
// request was sent (so a stale batch is rejected, not silently applied).

import { run } from "ai-kit";

const messages = []; // { role: "user" | "assistant", text }
let streaming = false;
let job = null;
let baseRevision = null; // document revision the current turn was built from
let pendingTool = null; // { tool, edits, raw }

function settings() {
  return {
    provider: zol.setting("provider"),
    model: zol.setting("model"),
    endpoint: zol.setting("endpoint"),
    api_key_env: zol.setting("api_key_env"),
    api_key: zol.secret("api_key") || "",
    temperature: zol.setting("temperature"),
    system: zol.setting("system"),
  };
}

const TOOL_PROTOCOL =
  "\n\nYou may propose file edits. To do so, end your reply with a fenced " +
  "block:\n```tool\n" +
  '{"tool":"apply_edits","edits":[{"start":0,"end":0,"text":"..."}]}\n' +
  "```\nThe user reviews and approves it; do not claim an edit is applied.";

function packContext(text) {
  let prompt = text;
  if (text.indexOf("@file") >= 0) {
    const body = zol.activeText() || "";
    prompt = prompt.replace("@file", "\n\n```\n" + body + "\n```\n");
  }
  return prompt;
}

function parseTool(text) {
  const m = text.match(/```tool\s*([\s\S]*?)```/);
  if (!m) return null;
  try {
    const obj = JSON.parse(m[1]);
    return obj && typeof obj.tool === "string" ? obj : null;
  } catch (_) {
    return null;
  }
}

function startTurn(prompt) {
  const assistant = { role: "assistant", text: "" };
  messages.push(assistant);
  streaming = true;
  baseRevision = zol.revision();
  const sys = settings();
  job = run(sys, packContext(prompt) + TOOL_PROTOCOL, function (delta) {
    assistant.text += delta;
  });
  job.then(
    function () {
      streaming = false;
      job = null;
      pendingTool = parseTool(assistant.text);
    },
    function (err) {
      streaming = false;
      job = null;
      assistant.text += "\n\n_(" + (err && err.message ? err.message : String(err)) + ")_";
    },
  );
}

function send(text) {
  if (streaming || text.trim() === "") return;
  messages.push({ role: "user", text: text });
  startTurn(text);
}

function toolResult() {
  if (!pendingTool) return;
  const t = pendingTool;
  pendingTool = null;
  if (t.tool === "apply_edits" && Array.isArray(t.edits)) {
    try {
      zol.applyEdits(t.edits, baseRevision);
      messages.push({ role: "user", text: "Tool result: " + t.edits.length + " edit(s) applied." });
    } catch (e) {
      messages.push({ role: "user", text: "Tool result: rejected (" + e.message + ")." });
    }
  } else if (t.tool === "read_file") {
    messages.push({ role: "user", text: "Tool result:\n```\n" + (zol.activeText() || "") + "\n```" });
  } else {
    messages.push({ role: "user", text: "Tool result: unknown tool '" + t.tool + "'." });
  }
  startTurn("Continue. Do not repeat the tool call unless needed.");
}

function rejectTool() {
  pendingTool = null;
  messages.push({ role: "user", text: "Tool rejected by the user. Continue without it." });
  startTurn("Continue.");
}

function stop() {
  if (job && job.cancel) job.cancel();
  streaming = false;
}

const COLLAPSE_AT = 700;

// Long messages collapse to a preview with a "Show full message" toggle. A
// message that is still streaming always renders in full, otherwise the new
// tokens would be hidden behind the collapsed preview.
function renderMessage(ui, m, live) {
  const text = m.text || "";
  const long = text.length > COLLAPSE_AT;
  if (long && !m.expanded && !live) {
    ui.md(text.slice(0, COLLAPSE_AT) + "\n\n…");
    if (ui.button("Show full message")) m.expanded = true;
  } else {
    ui.md(text);
    if (long && !live && ui.button("Show less")) m.expanded = false;
  }
}

zol.registerPanel("ai-chat.panel", {
  title: "AI Chat",
  icon: "message-square",
  dock: true,
  width: 380,
  draw(ui) {
    // Stick to the newest message until the user scrolls up. Reserve room for
    // the input + footer so they stay visible when the transcript is long.
    ui.scroll({ follow: true, reserve: 200 }, function () {
      for (let i = 0; i < messages.length; i++) {
        const m = messages[i];
        ui.label(m.role === "user" ? "You" : "Assistant", { tone: "muted" });
        renderMessage(ui, m, streaming && i === messages.length - 1 && m.role === "assistant");
        ui.separator();
      }
    });
    if (pendingTool) {
      ui.spacer(0, 6);
      ui.label("Proposed tool: " + pendingTool.tool, { tone: "normal" });
      ui.row(function () {
        if (ui.button("Approve")) toolResult();
        if (ui.button("Reject")) rejectTool();
      });
    }
    ui.spacer(0, 8);
    ui.input({
      value: "",
      placeholder: "Ask… (Enter to send, Shift+Enter for a new line, @file for the buffer)",
      multiline: true,
      height: 72,
      onSubmit: send,
    });
    ui.spacer(0, 6);
    ui.row(function () {
      ui.label(messages.length + " message(s)", { tone: "muted" });
      if (streaming) {
        ui.spacer(12, 0);
        if (ui.button("Stop")) stop();
      }
      ui.spacer(12, 0);
      const last = messages.length ? messages[messages.length - 1].text : "";
      ui.copyButton(last);
    });
  },
});

// Command palette entry: same toggle as the activity-rail dock button.
zol.registerCommand("ai-chat.toggle", "Toggle AI Chat", function () {
  zol.togglePanel("ai-chat.panel");
});

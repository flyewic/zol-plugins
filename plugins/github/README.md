# github

A GitHub integration panel: repository identity, pull requests with CI status,
and issues — with "Open on GitHub". The editor core stays GitHub-free; all of
this is plugin JS.

Opening a PR or issue renders its body plus the review/issue comments as a
markdown tab. A PR row's **Diff** button fetches the patch with `gh pr diff` and
opens it in a built-in diff view (`zol.openDiff`), so you can read the change
without leaving the editor.

## Authentication and transport

The plugin calls the [`gh`](https://cli.github.com) CLI through `zol.exec`, so
it uses whatever account `gh` is already logged into:

```sh
gh auth login
```

There is no token setting and no network stack in the editor. With `gh` missing
or unauthenticated the panel says so; it never throws.

## Install

```sh
just install-plugin github
# enable it in the install prompt / Plugin Manager on next launch
```

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `gh_path` | `gh` | Path/name of the `gh` binary. Point it at `fake-gh.sh` from the zol examples for a no-network demo. |
| `host` | `github.com` | Expected remote host; also used for `repo_override`. |
| `repo_override` | *(empty)* | `owner/name`; skips parsing the git remote. |
| `refresh_seconds` | `60` | Poll interval. |

## Demo without a repository or network

The zol source tree ships `examples/plugins/github/fake-gh.sh`, which answers
the subcommands the plugin uses with canned JSON (`octo/demo`). It is not part
of this catalog (catalog files are scripts and manifests only). Point the
plugin at a local copy and give it a repo name:

| Setting | Value |
|---|---|
| `gh_path` | `/absolute/path/to/examples/plugins/github/fake-gh.sh` |
| `repo_override` | `octo/demo` |

No remote, token, or network is involved.

## Status

The docked panel is a compact **overview** (repo, branch, `gh` status, open
counts, and buttons). **Pull requests** and **Issues** open as editor tabs;
selecting a row opens a rendered-markdown tab with the details, and issues can
be created from the Issues tab. See
[issue #106](https://github.com/flyewic/zol/issues/106).

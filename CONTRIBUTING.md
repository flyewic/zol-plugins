# Contributing

Plugins are added by pull request to this repository. The editor does not publish plugins.

Edit `index.kdl` in the same change as the plugin. One directory, `plugins/<id>/`, holds the same `plugin.kdl` the editor loads, plus the files that manifest names.

## Review bar

- `plugins/<id>/plugin.kdl` parses. `id` equals the directory name. `version` is semver without a `v` prefix and matches the `index.kdl` row byte for byte. `path` is exactly `plugins/<id>`.
- `kind` is `script`, `library`, or `language`. A `language` pack is a WASM grammar (`grammar.wasm` + `.scm` queries) — never a native `.so`/`.dylib`/`.dll`; no archives and no symlinks in any kind.
- `entry` exists. `permissions` are the minimum the script needs. `network` without a tight `network_hosts` list is a reject. `eval_js` and `subprocess` need a reason in the pull request text.
- `license` is a permissive SPDX id — `MIT`, `Apache-2.0`, `MPL-2.0`, `BSD-2-Clause`/`BSD-3-Clause`, `ISC` — and matches the plugin's real upstream (a grammar pack declares its grammar's license, e.g. `nim` is MPL-2.0). This repository ships an MIT `LICENSE`. Do not copy the editor's license. No secrets, no tokens, and no vendored `node_modules`.
- `description` contains no web address. Comments in `index.kdl` do not either. Links belong in the plugin README.
- `format` is the integer `1`. A duplicate `plugin "<id>"` is a reject, not last-wins.
- File names end in `.js`, `.kdl`, `.md`, or `.scm`, or are exactly `LICENSE`, `README`, `README.md`, or `grammar.wasm`.
- No file larger than 256 KiB, except a `language` pack's `grammar.wasm` (up to 16 MiB). At most 32 files in one plugin, nested at most 8 levels.
- Mode `100755` in git is still a normal file. Do not ask CI or the installer to preserve the executable bit, and do not add a symlink to keep a mode.

CI runs `.github/workflows/check.py` on this repository only. It checks out this repo and does not need a token. Permissions, network hosts, and `eval_js` stay a human review.

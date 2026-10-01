# Contributing

Plugins are added by pull request to this repository. The editor does not publish plugins.

Edit `index.kdl` in the same change as the plugin. One directory, `plugins/<id>/`, holds the same `plugin.kdl` the editor loads, plus the files that manifest names.

## Review bar

- `plugins/<id>/plugin.kdl` parses. `id` equals the directory name. `version` is semver without a `v` prefix and matches the `index.kdl` row byte for byte. `path` is exactly `plugins/<id>`.
- `kind` is `script` or `library`. No language packs, no binaries, no shared libraries, no symlinks, and no archives.
- `entry` exists. `permissions` are the minimum the script needs. `network` without a tight `network_hosts` list is a reject. `eval_js` and `subprocess` need a reason in the pull request text.
- `license` is `MIT`. This repository ships a `LICENSE` file. Do not copy the editor's license. No secrets, no tokens, and no vendored `node_modules`.
- `description` contains no web address. Comments in `index.kdl` do not either. Links belong in the plugin README.
- `format` is the integer `1`. A duplicate `plugin "<id>"` is a reject, not last-wins.
- File names end in `.js`, `.kdl`, or `.md`, or are exactly `LICENSE`, `README`, or `README.md`.
- No file larger than 256 KiB. At most 32 files in one plugin, nested at most 8 levels.
- Mode `100755` in git is still a normal file. Do not ask CI or the installer to preserve the executable bit, and do not add a symlink to keep a mode.

CI runs `.github/workflows/check.py` on this repository only. It checks out this repo and does not need a token. Permissions, network hosts, and `eval_js` stay a human review.

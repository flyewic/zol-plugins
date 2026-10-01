# Contributing

Plugins are added by pull request to this repository. The editor does not publish plugins.

- One folder, `plugins/<id>/`, with `plugin.kdl` and the files it names.
- `id` is a single path segment. `index.kdl` `path` is exactly `plugins/<id>`.
- `index.kdl` `version` matches `plugin.kdl` `version`. `license` is `MIT`.
- `format` is the integer `1`.
- Kind is `script` or `library`. Do not ship language packs, themes, or icon packs here.
- No symlinks. No file larger than 256 KiB. At most 32 files in one plugin, nested at most 8 levels.
- File names end in `.js`, `.kdl`, or `.md`, or are exactly `LICENSE`, `README`, or `README.md`.
- Do not put a web address (`://`) in `index.kdl`.

CI runs `.github/workflows/check.py` on this repository only.

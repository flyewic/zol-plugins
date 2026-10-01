# zol-plugins

Official catalog of plugins for [zol](https://github.com/flyewic/zol).

Each plugin is a folder under `plugins/<id>/` with a `plugin.kdl` manifest and its script. `index.kdl` lists them. The editor installs a chosen plugin into the user plugin directory and still asks before a script runs.

This repository is MIT. Plugin manifests use `license "MIT"`.

## Add a plugin

Open a pull request. Give the folder the same name as the manifest `id`, set `path "plugins/<id>"` in `index.kdl`, and keep the index `version` equal to the manifest `version`. Paths stay inside the folder: no symlinks, and no web addresses in `index.kdl`.

See `CONTRIBUTING.md`.

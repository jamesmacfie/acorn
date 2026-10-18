# Acorn Node

A headless acorn Node for this platform. The desktop app and the `acorn` terminal client pair with it
over TLS and drive it like their own Node. The folder carries its own Node.js runtime and every
installed dependency, so the machine needs no Node.js, npm, or compiler. `BUILD` names the version,
commit, and platform.

Claude Code agents need the `claude` command installed on this machine and on its `PATH`. The Node
never downloads it.

## Check and extract the download

Compare the archive with the `.sha256` file that came beside it, then extract it:

```sh
shasum -a 256 -c acorn-node-*.tar.gz.sha256   # or sha256sum -c on Linux
tar -xzf acorn-node-*.tar.gz
```

On Windows, compare `(Get-FileHash acorn-node-*.zip).Hash` with the file's first word in PowerShell,
then extract the zip.

A browser download on macOS marks the files as quarantined, and Gatekeeper can then refuse to load the
unsigned terminal module. Clear the mark on the extracted folder:

```sh
xattr -dr com.apple.quarantine acorn-node-<version>-<platform>
```

`gh run download` and `curl` add no quarantine mark. On Windows, unblock the files of a zip a browser
downloaded with `Get-ChildItem -Recurse <folder> | Unblock-File`.

On Linux, the archive needs glibc 2.31 or later: Ubuntu 22.04, Debian 11, Raspberry Pi OS 11, or a
later release. Alpine and other musl distributions can't run it.

## Start a Node

`ACORN_DATA_DIR` names the folder for the Node's data. Use the same value for every `acorn` command
that talks to this Node.

```sh
export ACORN_DATA_DIR="$HOME/.acorn-node"
bin/acorn node start --background
bin/acorn node reach my-host.example.com   # answer other machines on this name
bin/acorn node pair                         # print a pairing code and the six identity words
bin/acorn node stop
```

On Windows, run `bin\acorn.cmd` with `set ACORN_DATA_DIR=...` instead.

On its first start the Node makes its keys and keeps them in its data folder. Pair a client on
another machine with the code from `acorn node pair`, and compare the six words with the ones the
client shows. Under a service manager, run `bin/acorn node start --foreground`, and add
`--log FILE` for launchd or Windows, which don't rotate logs.

Setup, operations, and the security notes for exposing a Node beyond loopback are in the acorn
repository at `docs/node-distribution.md`.

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
unsigned terminal module. The installer clears the mark from its copy. To run the folder without
installing it, clear the mark yourself:

```sh
xattr -dr com.apple.quarantine acorn-node-<version>-<platform>
```

`gh run download` and `curl` add no quarantine mark. On Windows, the installer unblocks its copy. To
run the folder in place, unblock it with `Get-ChildItem -Recurse <folder> | Unblock-File`.

On Linux, the archive needs glibc 2.31 or later: Ubuntu 22.04, Debian 11, Raspberry Pi OS 11, or a
later release. Alpine and other musl distributions can't run it.

## Install it

Run the installer from the extracted folder, as the person who will use the Node, not as root:

```sh
acorn-node-<version>-<platform>/install.sh
```

On Windows, in a PowerShell window that isn't elevated, run the script through a bypass, because
Windows blocks a downloaded script:

```powershell
powershell -ExecutionPolicy Bypass -File acorn-node-<version>-<platform>\install.ps1
```

The installer copies the folder into `acorn-node` in your user's application data, puts an `acorn`
command on the `PATH`, gives the Node a private data folder there, and asks whether to start the Node
when you log in. `--service` or `--no-service` answers for a script, and `-Service` or `-NoService` on
Windows. Then:

```sh
acorn node start --background          # unless the Node already starts at login
acorn node reach my-host.example.com   # answer other machines on this name
acorn node pair                        # print a pairing code and the six identity words
acorn agent providers                  # check that the Node finds claude or codex
```

On its first start the Node makes its keys and keeps them in its data folder. Pair a client on
another machine with the code from `acorn node pair`, and compare the six words with the ones the
client shows.

To upgrade, extract the newer archive and run its installer. The Node keeps its data and paired
devices. `install.sh --uninstall` or `install.ps1 -Uninstall` removes acorn and keeps the data, and
`--purge` or `-Purge` deletes the data too.

To run the folder without installing it, set `ACORN_DATA_DIR` to a folder for the Node's data and run
`bin/acorn`, or `bin\acorn.cmd` on Windows.

Setup, operations, and the security notes for exposing a Node beyond loopback are in the acorn
repository at `docs/node-distribution.md`.

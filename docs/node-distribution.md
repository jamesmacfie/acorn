# Running a standalone Acorn Node

An acorn node is an ordinary Node.js process. The desktop app bundles and supervises one, and it can
pair with others over TLS and drive them identically — same protocol, same plugins, same routes. This
is how you run one of those others: on a build box, a beefy dev machine, or anything with your repos
on it.

There is deliberately no `npx acorn-node`. Two of the dependencies are native (`better-sqlite3`,
`node-pty`), so a published package would need prebuilt binaries for every platform/arch/ABI triple —
a release pipeline rather than a script. A tarball you unpack and `npm install` in compiles them
against *your* Node, which needs no infrastructure and no trust in ours.

## Build the tarball

From a checkout:

```sh
node scripts/pack-node.mjs
# → apps/node/release/acorn-node-<version>.tar.gz
```

It builds the artifact, verifies that every package the bundle imports is in the generated manifest
(including the ones loaded through `createRequire`, which is not a footnote — that check exists
because the first version of the tarball installed cleanly and then died at boot on a missing
`@xterm/headless`), stages all nine Drizzle migration chains, and packs it.

## Install and run

```sh
tar -xzf acorn-node-<version>.tar.gz
cd acorn-node
npm install --omit=dev          # compiles better-sqlite3 and node-pty against THIS Node

SESSION_ENC_KEY=$(openssl rand -hex 32) \
GITHUB_CLIENT_ID=<your GitHub OAuth app's client id> \
ACORN_DATA_DIR=/var/lib/acorn \
node dist/standalone.js
```

> If your npm has `ignore-scripts=true` (some hardened setups do, and it is a reasonable default),
> the native modules are downloaded but never built, and the node dies with "Could not locate the
> bindings file". Fix it with `npm rebuild better-sqlite3 node-pty --ignore-scripts=false`.

### Environment

| Variable | Required | Meaning |
| --- | --- | --- |
| `SESSION_ENC_KEY` | **yes** | Exactly 64 hex characters (`openssl rand -hex 32`). Encrypts integration credentials and HTTP-client fields at rest. The name is a misnomer — there is no session — but it is what the key has always been called. **Keep it with the data root**: without it, an existing root fails to start rather than silently losing its secrets. |
| `GITHUB_CLIENT_ID` | **yes** | Your GitHub OAuth app. The node runs the device authorization grant, so it needs no client secret and no callback URL — the one setting the app does need is **Enable Device Flow**. |
| `ACORN_DATA_DIR` | no | Where this node keeps everything. Defaults to a repo-local dev root, which is not what you want on a server. |
| `ACORN_PORT` | no | Pin the port. Otherwise ephemeral, remembered in `node.json`, and re-picked if taken. |
| `ACORN_DEVICE_TOKEN` | no | Reuse a device token across restarts instead of minting one per launch. |

### The handshake line

Once listening, the node prints **one line of JSON** on stdout:

```json
{"nodeId":"…","endpoint":"https://127.0.0.1:56998","fingerprint":"…","certPem":"…","deviceToken":"…"}
```

That line is the contract, not a convenience. The port is ephemeral, so nothing can guess the
endpoint; the certificate is self-signed, so there is no CA to vouch for it; and the fingerprint is
what the client pins. Everything else the process logs is free-form.

## Pairing a desktop client with it

1. On the node: `POST /v2/core/pair/start` opens a 10-minute, 5-attempt, single-use window. (There is
   no CLI for this yet — see "Not done" below.)
2. In the desktop app: **Settings → Nodes → Add node**, paste the endpoint, confirm the fingerprint
   (it is shown as six words as well as hex — compare the words, paste the hex), enter the code.
3. The client stores a device token in its keychain and pins the certificate.

Every paired device has full owner authority. That is a product decision, disclosed at pairing, and
the reason `Settings → Nodes` can revoke one from anywhere.

## Keeping it running

### launchd (macOS)

`~/Library/LaunchAgents/io.acorn.node.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>io.acorn.node</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/opt/acorn-node/dist/standalone.js</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>ACORN_DATA_DIR</key><string>/Users/you/Library/Application Support/acorn-node</string>
    <key>SESSION_ENC_KEY</key><string>…64 hex…</string>
    <key>GITHUB_CLIENT_ID</key><string>…</string>
    <!-- A login shell's PATH is not inherited by a launchd agent. Agents, git and your dev tooling
         all run as child processes of the node, so give it a PATH that can find them. -->
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/acorn-node.log</string>
  <key>StandardErrorPath</key><string>/tmp/acorn-node.err</string>
</dict>
</plist>
```

`launchctl load ~/Library/LaunchAgents/io.acorn.node.plist`. A **user agent**, not a system daemon:
the node runs your dev tooling, reads your repos and needs your SSH agent, so running it as root
would be both wrong and less useful.

### systemd (Linux)

`~/.config/systemd/user/acorn-node.service`:

```ini
[Unit]
Description=Acorn Node
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/acorn-node
ExecStart=/usr/bin/node /opt/acorn-node/dist/standalone.js
Environment=ACORN_DATA_DIR=%h/.local/share/acorn-node
EnvironmentFile=%h/.config/acorn-node.env
Restart=on-failure
RestartSec=5
# The drain is bounded at 30s and closes the listener first, so the default 90s is more than enough.
TimeoutStopSec=45

[Install]
WantedBy=default.target
```

`systemctl --user enable --now acorn-node`. Put `SESSION_ENC_KEY` and `GITHUB_CLIENT_ID` in
`~/.config/acorn-node.env` (mode 0600) rather than in the unit file, which is world-readable.

A **user** service, for the same reason as the launchd agent — and `loginctl enable-linger $USER` if
you want it up without being logged in.

## Security notes

- **The node binds loopback only.** Exposing it beyond that is not a setting today, and the
  recommended remote path is your own VPN or tailnet rather than a public bind. Point the client at
  the node's tailnet address; the pinned certificate travels with the pairing, so nothing else has to
  change.
- **Full-disk encryption matters here more than on a laptop.** Acorn encrypts credentials and backup
  archives only; worktrees, the blob cache, agent transcripts and terminal scrollback rely on the
  operating system. Settings → Security reports what the node can tell about this (`fdesetup` on
  macOS; on Linux it honestly reports "cannot tell" rather than guessing at LUKS).
- **The data root is 0700 with an exclusive lock**, so two nodes cannot share one. If a node refuses
  to start with "already holds", check for a stale `node.lock` after a hard kill — the error names
  the file.
- **`SESSION_ENC_KEY` is not recoverable.** Back it up with the data root, separately from any backup
  archive that travels (`POST /v2/core/backup` deliberately excludes it, along with credentials and
  device tokens).

## The ABI, and why a node from one machine will not run on another

`better-sqlite3` and `node-pty` compile against one Node ABI at a time. The tarball ships no
binaries, which is the point: `npm install` builds them for whatever Node you have. Consequences:

- Upgrading Node on the box means `npm rebuild better-sqlite3 node-pty`.
- Copying an installed `acorn-node/` directory to a different machine or a different Node version
  will fail at the first database open, with an error naming the rebuild.
- Inside this repo the same rule applies in the other direction: `pnpm dev` needs Electron's ABI,
  `pnpm test` and `pnpm dev:node` need plain Node's. `pnpm rebuild:node` and `pnpm run rebuild`
  switch between them.

## Not done

Stated rather than implied, so nobody goes looking:

- **No CLI for opening a pairing window.** `POST /v2/core/pair/start` needs an existing device token,
  which is a chicken-and-egg for a node you have never paired with. In practice the launch handshake
  prints a device token, which is what the two-node e2e uses — but that is a token in a log file, not
  a pairing ceremony. A `--pair` flag printing a code and a QR is the obvious shape.
- **No auto-update.** Rebuild the tarball, unpack it over the old one, `npm install`, restart.
- **No supervision of its children beyond the process broker.** If the node dies, launchd/systemd
  restart it; the tmux sessions it was managing survive and are reattached at boot, but an
  ephemeral PTY does not.

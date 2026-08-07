# acorn vNext — release notes

acorn is now two products that speak one protocol: an **Acorn Node**, which owns everything real
(workspaces, repos, worktrees, tasks, agents, terminals, Git, processes, SQLite, secrets), and **Acorn
Desktop**, which bundles and supervises one and can pair with others. One window shows the whole fleet.

Everything you already do works the same way. What follows is what is genuinely different.

## Your V1 install is not touched

vNext uses a **new data root**, so V1 and vNext do not share a byte:

| | Data root |
| --- | --- |
| V1 | `~/Library/Application Support/@acorn/desktop` |
| vNext | `~/Library/Application Support/acorn` |

Rolling back is running the old build. vNext refuses to open a V1 root outright rather than migrating
it, and the importer below reads a **copy** of your V1 database rather than the file itself — verified
by hashing every file in the root before and after.

### Importing your configuration

First run offers it, and Settings → Workspaces offers it again later. It appears only if you have a V1
install; on a new machine you will never see it.

**Copied**: workspace names, colours and order; which repo is in which workspace; hidden repos; where
each repo is checked out; and each repo's build/run/preview settings, including its branch prefix.

**Not copied**, each for a reason:

- **Credentials.** Reconnect GitHub, Linear and Rollbar in Settings → Integrations. A credential in a
  file that might travel is the risk vNext is built to avoid.
- **Tasks, notes, memories, terminal history and preferences.** vNext's tasks own worktrees on this
  machine and its terminals own live processes; importing records of ones that no longer exist would
  produce a workspace full of dead links.
- **Repo-config trust acknowledgements.** Any repo with a committed `.acorn/config.toml` or workflow
  will ask you to review and trust it once more. That is deliberate: the whole point of the gate is
  that trusting executable content is a decision you make on *this* machine.

It is safe to run twice — a second import changes nothing.

## Three behaviours changed on purpose

- **The editor surfaces autosave conflicts** instead of unconditionally overwriting. If a file changed
  under you, you are asked rather than told.
- **The `/api/v1` automation surface and its tokens are gone.** No bearer tokens, no token settings
  page, no `/api/v1` routes. Headless automation returns later as its own decision rather than as a
  surface nobody was maintaining.
- **Preview's raw shell URL-script mode is removed.** Preview resolves a URL from a declared port or a
  configured URL. Running a shell command to answer a page load made executing repo config incidental,
  which is what the config-trust gate exists to prevent.

## No login

There is no session, no login screen and no cookie. Your client authenticates to each node with a
revocable **device token** held in the OS keychain, and pins that node's TLS certificate. GitHub is now
an ordinary connected integration rather than the thing you log in with.

Consequences worth knowing:

- Connecting GitHub uses the **device flow** — you read a code and type it at github.com/login/device.
  There is no callback URL to register; the OAuth app needs only "Enable Device Flow" turned on.
- Every paired device has full owner authority. That is disclosed at pairing, and Settings → Nodes can
  revoke any of them from anywhere.
- A changed node fingerprint is a hard stop, never an auto-retrust.

## New: more than one machine

Additive, and invisible until you pair a second node — first run never mentions any of it.

- **Fleet home**, a card per node with connection state, health, active agents and attention count.
- **Settings → Nodes**: add, rename, reconnect, revoke, unpair. Fingerprints are shown as six words as
  well as hex — compare the words, paste the hex.
- **Settings → Plugins**: which plugins each node runs. Per node, because it decides which routes exist
  and which databases open on *that* machine.
- **Aggregated surfaces**: Agent Center, the attention inbox and the ⌘K palette go fleet-wide, every
  row carrying a node badge. A slow or offline node yields a partial result and a banner, never a
  failed page.
- **Remote tasks work fully**: terminals, agents and the preview pane, the last through an
  authenticated tunnel to a port that task's config declares.
- Offline reads come from cache with a badge; offline writes fail fast and **keep what you typed**.

Running a node on another machine: `docs/node-distribution.md`.

## New: Settings → Security

- **An audit trail.** Pairing, device revocation, credential changes, repo-config trust decisions,
  plugin changes, backups and imports. Append-only, kept 90 days, owner-readable, per node.
- **A disk-encryption check.** acorn encrypts credentials and backup archives; worktrees, caches,
  scrollback and agent transcripts rely on your operating system. If FileVault is off you are told
  once, per machine. On Linux it honestly says it cannot tell rather than guessing.
- **Backup.** One archive of a node's databases, written on that node's machine. Credentials, device
  tokens and the TLS key are excluded by design — restoring means re-entering them and re-pairing.
  Worktrees and the blob cache are excluded too; both come back from git and GitHub.

Restore is deliberately manual: unpack the archive into a fresh data root, re-pair, re-enter
credentials. Automating the restoration of credentials from a file that might travel is exactly what
the exclusions are for.

## Known limitations

- **The app is ad-hoc signed and not notarized.** macOS will warn on first open until there is an
  Apple Developer ID. There is no auto-update; install a new build over the old one.
- **A node binds loopback only.** Reaching one on another machine means a VPN or tailnet of your own.
- **The preview tunnel's local listener is authenticated but local.** Its per-tunnel secret keeps
  another process on your machine from using it; it is not a defence against a machine that is already
  compromised, which acorn's threat model puts out of scope.
- **Some credential reads are still ungated for agents.** An agent-spawned process cannot spend your
  GitHub token, and cannot pair, revoke devices, read the audit trail or change which plugins run — but
  Linear, Rollbar, database and model-provider credentials are not yet behind the same gate.
- **macOS only.** The node itself is platform-agnostic and runs on Linux; the desktop app is not built
  for anything else.

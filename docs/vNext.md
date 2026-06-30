# vNext — Terminal & agent sessions (Electron)

> Status: **design / RFC. Not yet implemented.** This supersedes and unifies two earlier terminal
> RFCs (the former `v2.md` "remote-agent terminal sessions" and `v3.md` "local agent terminal
> sessions", now removed), rewritten for the runtime acorn actually ships on now: a **local macOS
> Electron app** (see [electron.md](./electron.md)). The product vision is unchanged; the
> architecture is much smaller because Electron already gives us a local process model.

acorn is a GitHub PR review tool that now runs as an Electron app: a SolidJS renderer talking to an
in-process Hono server (`@hono/node-server`) on `http://127.0.0.1:4317`, backed by local SQLite. This
doc adds a **terminal side panel** that drives local shells and coding agents (Claude Code, Codex,
aider, …) in the context of the PR you're reviewing.

---

## 1. What we want

A contextual terminal drawer in the acorn UI that lets you:

- Open one or more **persistent** terminal sessions on this machine.
- Run `claude` (or any command) and interact live — type, see ANSI output, scroll back, resize.
- **Survive a window reload** (the process keeps running) and ideally an **app restart**.
- Tie a session to a PR/repo: open it already `cd`'d into the local checkout, titled from PR context.
- Later: activity indicators ("agent is waiting for input"), disposable PR worktrees, structured
  agent transports.

Three user jobs (from v3), unchanged:

1. Open a shell in the local checkout for the current repository.
2. Start an agent CLI (Claude Code, Codex, aider) in the right working directory.
3. Keep that shell/agent alive while navigating acorn, reloading, or closing/reopening the drawer.

Three traps to avoid (from v3):

1. Don't turn acorn into a full IDE — the terminal is a side panel, the three-pane review model stays.
2. Don't send terminal transcripts or local filesystem state anywhere off-machine.
3. Don't make writeable terminals casual — local execution is an explicit, first-class capability.

---

## 2. The Electron lens — what changed from v2/v3

v2 and v3 were both written against the **Cloudflare Worker** runtime, where the central fact was:
*a Worker cannot spawn a PTY*. That forced a **separate local process** — v2's `acorn-term` daemon
behind a Vite WebSocket proxy, v3's `apps/local-host` service on `:7331` with its own REST/WS API,
pairing token, CORS, and a "Worker vs Local Host" two-plane split.

**Electron erases that whole problem.** The acorn backend is *already* a Node process (the Electron
main process). It can spawn `node-pty` directly. So everything built to work *around* the Worker's
lack of a process model collapses:

| v2 / v3 construct | Why it existed | vNext (Electron) |
|---|---|---|
| Separate daemon (`acorn-term` / `apps/local-host`) | Worker can't spawn PTYs | **Gone.** PTYs live in the Electron **main process**, next to the Hono server. |
| Vite WebSocket proxy (`/term` → `:5174`) | Same-origin bridge to the daemon in dev | **Gone.** Renderer ↔ main over **Electron IPC** (no network hop). |
| Local Host REST/WS API on `:7331` | Browser had to reach a foreign process | **Gone.** A narrow preload bridge replaces the HTTP/WS control plane. |
| Pairing token + `Origin`/`Host`/CORS checks | Browser and daemon were different trust domains | **Gone.** Renderer and main are one app; the boundary is the **preload contract** (electron.md §4g). |
| "Cloud ships terminal disabled" / hostname feature-detect | Two deploy targets (cloud vs local) | **Gone.** There is no cloud; acorn is always local. The panel always exists. |
| Separate `~/.acorn/local.db` for metadata | Worker owned the app DB (D1); daemon needed its own | **Reuse the app's SQLite** (`apps/web/.acorn/acorn.sqlite`) via the existing Drizzle pipeline. |
| Native-module packaging as a fresh problem | New daemon process | **Already solved.** `@electron/rebuild` rebuilds `node-pty` exactly as it does `better-sqlite3` (electron.md §4c) — "solve once." |

What **carries over unchanged** from v2/v3: xterm.js + node-pty as the stack; tmux as the durability
layer; a per-session output ring buffer replayed on attach; the session-as-resource model
(attach/detach, not throwaway connections); agent profiles; repo-path mapping; worktrees; and the
phasing discipline (ship the lazy version first).

---

## 3. Architecture

Two pieces inside the one Electron app — a renderer module and a main-process terminal service —
talking over IPC. No new process, no network surface.

```
┌──────────────────────── Electron app (one process tree) ────────────────────────┐
│                                                                                  │
│  renderer (Chromium)  — SolidJS SPA loaded from http://127.0.0.1:4317            │
│    ├─ existing panes (PullList / PullDetail / DiffView)                          │
│    └─ NEW TerminalPanel — xterm.js                                               │
│              │  window.acorn.terminal.*  (contextBridge, narrow API)             │
│              ▼                                                                    │
│   preload (sandboxed)  — exposes only terminal channels, validates nothing-extra │
│              │  ipcRenderer.invoke / .on  (validated at the main boundary)       │
│              ▼                                                                    │
│  main process (Node)                                                             │
│    ├─ Hono server (@hono/node-server)  — /api, /auth, SPA   (unchanged)          │
│    ├─ better-sqlite3 + Drizzle          — GitHub mirror + NEW terminal tables    │
│    └─ NEW TerminalService                                                        │
│          sessions: Map<id, { pty, ring, meta }>                                  │
│              │ spawns                                                            │
│              ▼                                                                    │
│        tmux session  →  claude / bash / codex / aider / anything                 │
└──────────────────────────────────────────────────────────────────────────────────┘
```

- **PTYs live in the main process.** Because the PTY is owned by main, **surviving a window reload is
  automatic** — the renderer reattaches and the service replays the ring buffer. tmux adds survival
  across a full **app restart** (electron.md §8).
- **Transport is Electron IPC**, not a WebSocket. The renderer never opens a socket; it calls a
  narrow `window.acorn.terminal` API exposed by the preload (see §5). This is the same shape VS Code
  uses between its renderer and its pty host, and it means there is no port, no origin, and no CORS
  to reason about. *(Alternative: a localhost WS on the existing node-server at `:4317`, guarded by
  the Host-header check already in `server.ts`. Prefer IPC; keep WS in pocket if we ever want the
  exact browser-portable transport for tests — see §5.)*
- **Metadata reuses the app's SQLite.** Terminal session/repo-path/profile rows are new Drizzle
  tables in `apps/web/.acorn/acorn.sqlite`, applied through the existing migration pipeline
  (`db:generate` / startup `migrate`). They are **app-state** (acorn owns them), like `prefs` and
  `pinned_repos` — not GitHub mirror data. Terminal **output is never persisted** (see §8).

### Where the code lives

```
apps/web/src/main/terminal/
  service.ts        TerminalService — spawn/attach/resize/kill, ring buffers, tmux
  ipc.ts            registers ipcMain handlers; validates every payload at the boundary
  profiles.ts       built-in + user agent profiles, PATH detection
  repoPaths.ts      github repo ↔ local checkout mapping + validation
apps/web/src/main/preload.ts        + terminal channels on the existing contextBridge surface
apps/web/src/server/db/schema.ts    + terminal tables (Drizzle)
apps/web/src/shared/terminal.ts     shared message/DTO types  (the src/shared/api.ts pattern — electron.md §4g)
apps/web/src/client/features/terminal/
  TerminalPanel.tsx TerminalTabs.tsx TerminalSessionList.tsx TerminalSurface.tsx
  terminalClient.ts model.ts terminal.css
```

No `apps/local-host` package and no `packages/terminal-protocol` (v3): there's no separate
deployable, so the terminal service is just main-process code, and the shared types sit in the
existing `src/shared/`. node-pty is a native module — it must only be imported by **main**, never by
the renderer bundle (electron-vite externalizes it for main exactly like better-sqlite3).

---

## 4. Prior art (merged from v2 + v3)

Everyone converges on **xterm.js (render) + node-pty (PTY) + tmux (durability)**; they differ in
transport and session management.

| Project | PTY / backend | Transport | Lesson for acorn |
|---|---|---|---|
| [xterm.js](https://xtermjs.org/) | — (it *is* the emulator) | — | Use it for render/selection/resize/fit/search/links/a11y. Don't make it own process state. |
| [node-pty](https://github.com/microsoft/node-pty) | PTY bindings; runs with parent permissions | — | Main-process only. Every session is local code execution. |
| [wetty](https://github.com/butlerx/wetty) | node-pty | WebSocket | Validates the Node + browser-terminal stack; closest to our pieces. |
| [gotty](https://github.com/yudai/gotty) / [ttyd](https://tsl0922.github.io/ttyd/) | Go/C PTY | WebSocket | Don't make writeable terminals casual; ttyd's reconnect/resize/read-only options are good precedent. |
| [terminado](https://github.com/jupyter/terminado) | Tornado ↔ PTY | WebSocket | Model sessions as **named local resources with attach/detach**, not throwaway connections. |
| [VibeTunnel](https://github.com/amantus-ai/vibetunnel) | node-pty | WebSocket | The closest analog: local daemon aimed at watching AI agents. We get its "local" property for free in Electron. |
| [claudecodeui](https://github.com/siteboon/claudecodeui) | Node | WebSocket | Claude Code writes session transcripts under `~/.claude`; read those for idle/activity **without** scraping the PTY. Disables agent tools by default. |
| [code-server](https://github.com/coder/code-server) | Node, integrated terminals | WebSocket | Solves the *whole* remote-IDE problem — the line acorn should **not** cross. |
| [OpenHands / Agent Canvas](https://github.com/All-Hands-AI/OpenHands) | agent runtime + sandbox | structured | Leave room for **structured** agent transports later, not only terminal scraping (phase 5). |
| [tmux](https://github.com/tmux/tmux) | multiplexer | — | Durability layer: attach/detach, scrollback (`capture-pane`), survives our process. Don't reinvent it. |
| [Ghostty](https://github.com/ghostty-org/ghostty) | native GUI terminal | — | **Not** for an embedded panel — no web/embed protocol. (Even as an Electron app, the panel is a web view; xterm.js is right.) |

Takeaways we copy: xterm.js + node-pty; **lean on tmux** for persistence rather than a session store;
**ring-buffer replay** on attach; eventually read `~/.claude` transcripts for activity indicators.

---

## 5. Transport & protocol (IPC)

The preload exposes one narrow object; nothing else (no raw `ipcRenderer`, per electron.md §4g):

```ts
// src/shared/terminal.ts — the contract, shared by main, preload, renderer
export type ClientMsg =
  | { type: 'input'; data: string }
  | { type: 'resize'; cols: number; rows: number }
export type ServerMsg =
  | { type: 'ready'; session: TerminalSession; replayed: boolean }
  | { type: 'output'; data: string }
  | { type: 'exit'; exitCode: number | null; signal: string | null }
  | { type: 'error'; code: string; message: string }
```

```ts
// preload.ts — added to the existing contextBridge.exposeInMainWorld('acorn', { … })
terminal: {
  list:    ()                       => ipcRenderer.invoke('term:list'),
  create:  (opts: CreateOpts)       => ipcRenderer.invoke('term:create', opts),
  kill:    (id: string)             => ipcRenderer.invoke('term:kill', id),
  resize:  (id: string, c: number, r: number) => ipcRenderer.invoke('term:resize', { id, cols: c, rows: r }),
  write:   (id: string, data: string)         => ipcRenderer.send('term:input', { id, data }),
  // attach: subscribe to output for one session; returns an unsubscribe
  attach:  (id: string, on: (m: ServerMsg) => void) => { /* ipcRenderer.on(`term:out:${id}`, …) */ },
}
```

`main/terminal/ipc.ts` registers the `ipcMain` handlers and **validates every payload at the
boundary** — session id is a known uuid, `cwd` is an allowed path, `cols`/`rows` are sane integers,
input is a string, lifecycle commands map to a fixed set (electron.md §4g). The renderer treats its
subscription as an *attachment* to a session, not the session itself: closing the drawer or reloading
the window unsubscribes; the PTY keeps running.

The xterm wiring mirrors v2 (just IPC instead of a WebSocket):

```tsx
onMount(() => {
  const term = new Terminal({ convertEol: true, fontFamily: 'monospace' })
  const fit = new FitAddon(); term.loadAddon(fit); term.open(el); fit.fit()
  const detach = window.acorn.terminal.attach(sessionId(), (m) => { if (m.type === 'output') term.write(m.data) })
  term.onData((d) => window.acorn.terminal.write(sessionId(), d))
  term.onResize(({ cols, rows }) => window.acorn.terminal.resize(sessionId(), cols, rows))
  onCleanup(() => { detach(); term.dispose() })   // PTY/tmux keeps running
})
```

> **Do not reuse the Shiki ANSI pipeline** (`shiki.ts` → `tokenizeAnsiWithTheme`). That renders
> *static, finished* logs (CI step output). A live terminal needs a real emulator (cursor movement,
> clears, alternate-screen for TUIs like `claude`) — that is exactly xterm.js. Keep them separate.

**WS alternative.** If we ever want the transport to be identical to a plain browser (e.g. to run the
panel against `dev:node` without Electron, or for easier integration tests), host a WebSocket on the
existing node-server (`@hono/node-server`'s `upgradeWebSocket`) at `ws://127.0.0.1:4317/term/:id`,
reusing the loopback **Host-header guard** already in `server.ts`. Same protocol envelope; no pairing
token needed since it's the same same-origin app. IPC is the default; WS is the escape hatch.

---

## 6. Session model

Each session is an acorn-owned local resource (from v3, unchanged):

```ts
type TerminalSession = {
  id: string
  title: string
  kind: 'shell' | 'agent'
  profileId: string
  backend: 'node-pty' | 'tmux'
  status: 'starting' | 'running' | 'exited' | 'failed'
  cwd: string
  repo?: { owner: string; name: string; githubId?: number }
  pull?: { number: number; headRef?: string; baseRef?: string; headSha?: string }
  command: string
  argv: string[]
  createdAt: number
  lastAttachedAt: number | null
  exitedAt: number | null
  exitCode: number | null
  cols: number
  rows: number
}
```

### Backends

- **Direct node-pty** — spawn the command directly. Fast MVP; survives window reload (PTY is in main)
  but **not** an app/main restart. Good where tmux isn't installed.
- **tmux-backed** — `tmux new-session -Ad -s acorn-<id> -c <cwd> <command>` then attach through a PTY.
  Survives app restart and renderer reload; scrollback via `capture-pane`; the user can attach from a
  normal terminal as an escape hatch. Requires tmux.

Recommendation (from v2/v3): node-pty first to prove UI/protocol; add tmux before calling agent
sessions production-ready; **default agent profiles to tmux when available**, fall back to node-pty.

### Output buffering

- In-memory **ring buffer** per live session (sized by bytes/lines), replayed on attach.
- For tmux, `capture-pane` recovers scrollback when the service reconnects to an existing session.
- **Never persist full transcripts by default** — terminal output contains secrets (see §8). Opt-in
  debug persistence can come later.

---

## 7. Local data model

Terminal metadata is app-state — add it to the existing Drizzle schema in
`apps/web/.acorn/acorn.sqlite` (not a separate `~/.acorn/local.db` as v3 proposed; there's no Worker
owning the app DB anymore, so reuse it). New tables:

```text
repo_paths            owner, repo (PK), github_repo_id?, path, created_at, updated_at
terminal_sessions     id (PK), title, kind, profile_id, backend, status, cwd,
                      repo_owner?, repo_name?, pull_number?, command, argv_json,
                      tmux_session?, pid?, cols, rows, created_at, last_attached_at?,
                      exited_at?, exit_code?
agent_profiles        id (PK), label, command, argv_template_json, backend_preference,
                      env_json, enabled, created_at, updated_at
```

These are **not** user-scoped by GitHub login the way the mirror tables are — they describe *this
machine*. **No terminal output column.** Drawer open/closed state and size live in the existing
`prefs` table.

---

## 8. Agent profiles

An "agent terminal" is a session with a profile + PR context attached. Profiles are configurable
because users have different CLIs installed. Built-ins (from v3):

```text
shell        command: $SHELL                 backend: node-pty
claude-code  command: claude                 backend: tmux
codex        command: codex                  backend: tmux
aider        command: aider                  backend: tmux
```

The service detects whether a command exists on `PATH` (it does **not** install it); unavailable
profiles render disabled with the resolved-path failure. **Prompt injection is conservative**: start
the agent in the right cwd and, optionally, put a prepared prompt on the clipboard or in a non-executed
draft — don't auto-type a large prompt unless the user explicitly chooses "start with PR context".

Context available to pass (avoid full diff text — the agent can read the checkout and acorn already
has a strong diff UI): PR URL, `owner/repo`, PR number, title, base/head branch, head SHA, changed-file
list, local checkout path.

---

## 9. Repository path mapping & worktrees

acorn knows GitHub repos; the machine knows local paths. The bridge is the `repo_paths` table:

1. User opens the terminal on a repo/PR → main looks up the mapping.
2. Missing → UI asks the user to choose/paste a local checkout path.
3. Main validates: directory exists, has `.git`, `git remote -v` includes a GitHub remote matching
   `owner/repo` (unless overridden); store it.
4. Future sessions for that repo use the mapped path.

**Worktrees** (later phase) let agents edit without dirtying the main checkout and give acorn a clean
cleanup affordance:

```text
fetch the PR ref → create/reuse .acorn/worktrees/<owner>-<repo>-pr-<number> → start agent there
```

---

## 10. Frontend integration

A feature-owned module mirroring the existing panel patterns (`ChecksPanel` / `LinearIssuePanel`):
a `Portal`-based drawer, `Escape` to close, state lifted into `PullDetail`/top bar, open/size persisted
in `prefs`. Dependencies: `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-search`,
`@xterm/addon-web-links` (and `@xterm/addon-serialize` later).

UI shape (from v3): a **drawer**, not a fourth permanent pane. Bottom drawer (240px–70vh, resizable)
spanning the main area works well for terminal width; a right drawer is better for watching an agent
while reading a diff — pick one in §13. Tabs per session (Shell / Claude / Codex / …), a compact
session-list menu, and kill / interrupt / rename / detach controls. Show a clear status when the
terminal service is healthy vs. unavailable. No instructional prose inside the surface — controls and
tooltips only.

---

## 11. Security model

The network/pairing machinery from v2/v3 is gone, but **the core risk is unchanged and arguably
sharper: a terminal makes acorn a local-code-execution UI.** Treat that as a product fact.

- **No network surface (IPC default).** With IPC there's no port, origin, or CORS to defend. The only
  path into the terminal is the preload's `window.acorn.terminal` API. Keep the main app window
  `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false` (already true — electron.md §4g),
  and **expose no raw `ipcRenderer`**.
- **Validate every IPC payload at the main boundary** — session id, cwd, cols/rows, input bytes,
  lifecycle command. Untrusted-by-default; the renderer is the less-trusted side.
- **XSS → RCE is the headline threat.** With a terminal, an XSS bug in the renderer can drive local
  execution through the exposed API. So this raises the bar on every HTML path: `innerHTML`, markdown
  / PR-body rendering, terminal link handling, OAuth callback state. Ship a tight **CSP** (electron.md
  §4g) and run a focused XSS pass on all rendering paths before enabling the terminal broadly.
- **Controlled child environment.** Don't pass the full parent env into agents. Preserve `HOME`,
  `PATH`, `SHELL`, `TERM`, `LANG` and common tool vars; let users opt into more; **never** copy
  `SESSION_ENC_KEY` or `GITHUB_CLIENT_SECRET` into a child; redact secret-looking values from logs.
- **Filesystem scope.** Default sessions start only in validated repo paths or user-chosen dirs. A
  shell can't be truly sandboxed without containers, but we can prevent launches from surprising paths.
  Later, profile sandbox modes: `none` / `worktree` (disposable git worktree) / `container`
  (devcontainer).
- **Logs** include session lifecycle, profile/cwd-resolution failures, startup/shutdown — **never**
  terminal output and never tokens.

(If the WS escape hatch is used instead of IPC: bind `127.0.0.1` only, keep the existing Host-header
guard, and reject non-same-origin upgrades. Still no pairing token — it's the same app on one origin.)

### Remote hosts — explicitly out of scope

"Drive my home machine's agents from my phone" is the sshx/VibeTunnel/Omnara relay model: a different,
much bigger project (a relay, auth, e2e encryption, mTLS, short-lived pairing, audit/revocation). Not
vNext. If it ever happens it's a separate mode with explicit remote-host labeling — never binding the
local service to a LAN/public interface.

---

## 12. Phasing — build the lazy version first

Stop at the rung that holds; don't scaffold later phases into earlier ones.

**Phase 0 — spike.** TerminalService in main with node-pty (no tmux), a single shell, IPC channels,
an xterm `TerminalPanel` behind a flag. Acceptance: start `$SHELL`; window reload reattaches while
main stays alive; resize works; kill updates UI; **node-pty is imported only by main**.

**Phase 1 — product-shaped local sessions.** SQLite metadata tables; `list` / `kill`; repo-path
mapping UI + validation; drawer tabs + session switcher; `prefs` for drawer open/size. Acceptance: map
`owner/repo` → checkout; open a shell from a PR and return to it later; session list survives reload;
exited sessions stay visible until dismissed.

**Phase 2 — tmux durability + agent profiles.** tmux backend (create/attach/detach/capture-pane/
interrupt/terminate); profiles for shell/Claude/Codex/aider with PATH detection; titles from PR
context; optional "start with PR context". Acceptance: start an agent in a mapped repo; closing the
**app** doesn't kill a tmux agent; restarting the app rediscovers tmux sessions; user can attach from
an external terminal.

**Phase 3 — agent-aware niceties.** Read `~/.claude` transcripts for idle/"waiting for input"
indicators (à la claudecodeui); optional desktop notification when an agent goes idle (Electron
`Notification` — native now).

**Phase 4 — worktrees.** PR worktree create/reuse, fetch PR refs, dirty-state detection, cleanup UI,
optional "open diff from worktree" into acorn's diff UI.

**Phase 5 — structured agent protocols.** Add `transport: 'pty' | 'structured'` to profiles; support
JSON-RPC / ACP-like / MCP-like / SDK-native agent backends; keep PTY as the universal fallback.

> Note vs v3: there is **no separate "local supervisor" phase**. v3 needed `acorn local` to start the
> web app + daemon together and inject a pairing token. Electron already *is* that supervisor — one
> app, one process tree, started by launching acorn.

---

## 13. Open questions

1. **IPC vs WS** as the shipped transport. IPC is recommended (no network surface, VS Code precedent);
   WS-on-node-server is more portable/testable. Decide before phase 0; the shared protocol envelope
   makes switching cheap.
2. **Drawer placement** — bottom (terminal width) vs right (watch agent while reviewing diffs).
3. **Default backend** — node-pty for all MVP sessions, or tmux for agent profiles as soon as available.
4. **tmux as a hard dependency** — ubiquitous but not guaranteed; degrade to bare PTY when absent
   (lose only app-restart survival).
5. **Repo checkout management** — only map existing checkouts, or also offer to clone missing repos?
6. **Transcript policy** — no persistence by default is safest; some users will want searchable agent
   transcripts (opt-in).
7. **Multiple attachments** — disallow >1 renderer attach per session unless explicitly shareable.

---

## 14. Testing

- **Main / TerminalService:** create validates cwd/profile; input reaches the PTY; output reaches
  subscribers; resize updates dimensions; interrupt/terminate send correct signals; a dropped
  attachment doesn't kill the session; IPC handlers reject malformed payloads. Deterministic test
  commands: `printf 'ready\n'`, `cat`, `node -e "process.stdin.pipe(process.stdout)"`.
- **Renderer:** panel shows unavailable when the service is down; session list renders running/exited;
  resize emits correct messages; closing the drawer does **not** terminate; delete calls the explicit
  terminate path. Mock the terminal client; fake the IPC channel for component tests.
- **End-to-end:** launch the app, open the drawer, create a shell, type `echo acorn-terminal-smoke`,
  assert output, reload the window, reattach, assert the session still exists.

---

## 15. Operational

- **Native module:** `node-pty` is native, like `better-sqlite3`. The **same `@electron/rebuild`
  step** (electron.md §4c) covers it — `electron:rebuild` builds both against Electron's ABI;
  `asarUnpack` in `electron-builder.yml` already unpacks `**/*.node`. No new packaging mechanism.
- **macOS first** (acorn is macOS-only). Windows would need ConPTY + a different tmux story — a later
  milestone if ever.
- **Failure modes** (drive UI states): service not running → disconnected + how-to; session exited →
  keep tab with exit code + restart; PTY backend missing → disable affected profiles; tmux missing →
  fall back to bare PTY, mark durable mode unavailable; cwd gone → offer to update the repo path.

---

## 16. Dependencies

**Add:** `node-pty` (main only; native, rebuilt via `@electron/rebuild`), `@xterm/xterm` +
`@xterm/addon-fit` (+ `addon-search`, `addon-web-links`; `addon-serialize` later) for the renderer
(~100KB gzipped).

**No longer needed** (vs v2/v3): `ws` (IPC, unless the WS escape hatch is chosen), `concurrently` /
a separate daemon script, a `packages/terminal-protocol` package, a pairing/token mechanism.

The Hono server, SQLite mirror, session crypto, and existing panels are untouched — the terminal is
additive main-process code plus a renderer drawer.

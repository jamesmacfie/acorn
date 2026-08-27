# Security review, 2026-08-27

An adversarial read of the tree at commit `0aa2372e`, with the working tree's uncommitted rail-marker
work in place. I attacked the app rather than surveying it: I picked the trust boundary I thought was
weakest, tried to cross it, and kept going until the attempt failed or produced a finding. Where a
comment or `docs/security.md` made a claim, I treated the claim as a hypothesis and went to the code.

Findings are split by owner, core first, then plugins. Read "What held" before the findings if you
want the shape of the defence, because most of what I tried did not work, and the two findings that
matter are only reachable because of how narrow the rest of the surface is.

`docs/security.md` records earlier adversarial passes and the escalations they closed. That is why
this review found nothing in the classes those passes covered, and why the findings below sit in the
gaps between them.

## What held

Attempts that failed, so you can see what I ruled out.

- **Task-scope enforcement by mount.** The gate rests on Hono populating `:id` inside
  `app.use('/v2/p/:plugin/tasks/:id/*', requireTaskScope)` even when the handler underneath names the
  parameter something else, which `plugins/github/src/server/routes/taskPulls.ts` does. I ran that
  against the repo's own Hono rather than assuming: the middleware sees `T1` for
  `/v2/p/github/tasks/T1/pulls`. The gate is real for every plugin route under a `tasks/:id` path.
- **Spending the owner's provider credential from an agent.** No GitHub write route carries a
  principal check, so `POST /v2/p/github/repos/:owner/:repo/pulls/:number/merge` looked reachable from
  any task-scoped token. It is, but `providerCredential`
  (`packages/node-core/src/server/integrations/credential.ts:8`) checks `canUseProviderCredential`
  itself and hands back `''`, so the call reaches GitHub unauthenticated and fails. The defence is in
  the credential accessor, not the route table. That is the more durable place for it.
- **HTML injection through the Markdown renderer.** `packages/client-core/src/ui/markdown.ts` escapes
  first and builds tags afterwards. I tried attribute breakout through a link target, which fails
  because `&quot;` inside an attribute value is decoded after the delimiter is chosen, and I tried
  forging the internal sentinel to smuggle raw text past `esc`. Neither yields markup. The only
  unescaped output is a href that already matched `^https?://`.
- **Reaching a privileged route from a plugin frame.** `packages/client-core/src/plugins/frames/scopes.ts`
  is an allowlist of exact path shapes with an exhaustive test behind it, and the project config `PUT`
  that writes shell scripts is listed as permanently unmappable rather than omitted. `PATCH
  /v2/core/projects/:id` accepts no script fields, so `core.projects:write` does not reach code
  execution by the back door.
- **Escaping the plugin frame sandbox.** Frames are served from `plugin://<bundle-sha256>` with
  `default-src 'none'; script-src 'self'; connect-src 'none'`, asserted by a Rust test in
  `apps/desktop/src-tauri/src/plugin_scheme.rs:134`. `allow-same-origin` is safe here because the host
  part is the bundle hash, so each plugin gets its own origin.
- **Command injection into `docker exec`.** `docker:exec:open` puts a caller-supplied ref into argv,
  but `REF_RE` in `plugins/docker/src/shared/model.ts:92` forbids a leading dash, and the WS hub
  refuses every non-`term:` channel to a task-confined socket.
- **Reaching another task through the preview tunnel.** `main/tunnel.ts` authenticates the upgrade,
  compares the token's task against the requested one, requires the port to be in `declaredPorts`, and
  dials `127.0.0.1` only.
- **Guessing a pairing code.** 128 bits, five attempts per window, one window at a time, uniform
  failures, plus a 20-per-minute ceiling across reopened windows.
- **Path traversal into or out of a worktree.** `resolveInRoot` is lexical and symlink-aware, and
  `confineExistingFile` re-checks the leaf. Both are used at every caller I found.
- **Inheriting a secret into a child process.** `childEnv` in `packages/node-core/src/main/taskEnv.ts:8`
  is a nine-name allowlist. Nothing falls through.
- **Reading a credential out of the API.** Every stored secret goes through `SecretService`, and the
  three plugin call sites use `use()` or the named `reveal()` escape hatch.

## Core

### 1. The privileged webview has no Content-Security-Policy

`apps/desktop/src-tauri/tauri.conf.json:22` sets `"csp": null`. The `main` webview is the one webview
holding a capability (`core:default`, so `invoke` works), and it renders text this app does not
author: agent transcripts, GitHub `bodyHTML`, Linear descriptions, Rollbar payloads, notes an agent
wrote.

The asymmetry is the finding. Plugin frames, which run third-party code, get a nine-directive policy
enforced by a test. The webview that renders third-party *data* and can call into Rust gets nothing.
Every dangerous-sink audit in the renderer is therefore load-bearing on its own, with no second layer
behind it. Today those sinks are the Markdown renderer, which I could not break, and four
`innerHTML={...}` bindings that pass GitHub's `bodyHTML` through verbatim
(`plugins/github/src/client/PullDetail.tsx:232`, `pullDetail/Conversation.tsx:66` and `:138`,
`packages/client-core/src/ui/diff/DiffRows.tsx:419`). Those four trust GitHub's sanitizer to be
correct forever, for a webview with `invoke`.

I am not claiming a live cross-site scripting bug. I am claiming that if one ever lands, nothing
between it and `invoke` slows it down, and that a policy of roughly `default-src 'self'; script-src
'self'; object-src 'none'; base-uri 'none'` costs one line and would have to be earned back by
whatever needs an exception.

### 2. `renderMarkdown` throws on attacker-controlled input

`packages/client-core/src/ui/markdown.ts:32` reserves U+E000 as a sentinel for protecting code spans
and images across the escaping pass, on the stated grounds that "real text never contains" it. The
input is untrusted, so an attacker supplies one.

Three of four probes crash. I ran them against the real module:

| Input | Result |
| --- | --- |
| `\uE000i0\uE000` | `TypeError: Cannot read properties of undefined (reading 'alt')` at `markdown.ts:52` |
| `\uE000i0\uE000` with `images: 'placeholder'` | same |
| `\uE0007\uE000` | `TypeError: Cannot read properties of undefined (reading 'replace')` at `markdown.ts:7` |

The restore passes at lines 48 and 50 index into `codes` and `images` with a number the input chose,
and neither checks that the entry exists.

Reachable from anything rendered through `Markdown`: a model's own output, a tool result echoing a
file, a Linear issue body, a note. `Markdown.tsx` sets `rendered = text` before the throw, so the
effect's early-return guard fires on every later run and that block stays permanently blank. There is
no `ErrorBoundary` in the owner chain either, so the throw escapes the effect and aborts the rest of
Solid's queued batch. One character in a ticket description blanks a pane and takes whatever else was
queued with it.

Two lines fix it: return the escaped literal when the lookup misses, or strip U+E000 from `src` on the
way in. The second is better, because it also kills the class rather than one instance of it.

### 3. `GET /v2/core/task-statuses` is unfiltered

`packages/node-core/src/server/routes/worktree.ts:127` returns every active task's id, absolute
`worktreePath`, and dirty-file count. It sits at `/v2/core`, not under `tasks/:id`, so
`requireTaskScope` never matches it and any task-scoped credential reads the lot. Every PTY and agent
session on the node holds one.

Worktree paths encode owner, repo, and branch, so this hands an agent in task A the roster of every
other task on the machine and which of them have uncommitted work. That is the same shape of leak
`docs/security.md` describes fixing for terminal's session roster, where the answer was to filter
rather than gate, because a caller may legitimately ask about its own. The same answer applies here:
filter to `mayActOnTask` when `isTaskConfined`. Worth noting the route is also grantable to a plugin
frame under `core.tasks:read` in `scopes.ts:62`, so the fix closes two callers.

### 4. The npm integrity value is recorded but never checked

`packages/node-core/src/main/pluginInstaller.ts:135` reads `dist.integrity` off the packument and puts
it in `provenance`. Nothing ever compares it against the bytes that arrive. The lockfile's
`archiveSha256` is the node's own hash of what it received, which answers "are these the bytes that
were reviewed" but cannot answer "are these the bytes npm published".

The registry hands over a checkable value and the installer files it as a note. Comparing it is a few
lines in `download`, and it is the difference between provenance you can act on and provenance you can
only read after the fact. This matters more than the usual supply-chain hand-wringing because a plugin
package is code that runs unsandboxed inside the node at next start.

### 5. Agent tool permissions default to allow, including the execute tier

`packages/node-core/src/server/agentTools/registry.ts:55` falls back to `true` for a read tool with no
recorded preference, and line 56 does the same for write and execute. So a tool is granted unless the
owner has turned it off, and a tool added in a later release is granted to every existing installation
with no prompt.

There are eight `execute`-tier tools today, all of them terminal's run-target controls, and `run_start`
sits behind the repo-config trust gate, so the present exposure is "start a script the owner wrote".
The default is the finding, not the current roster. For a product whose main adversary is prompt
injection, a new high-risk tool should have to be granted rather than merely not-yet-revoked. Flipping
`execute` to default-deny is a one-line change and a settings row people will actually see.

### 6. GitHub's device-flow routes are reachable from an agent, and the comment says otherwise

`plugins/github/src/server/routes/deviceAuth.ts:37` reads:

```ts
ownerId(c) // owner-gated: only the owner may begin connecting an account
```

`ownerId` returns `principal.userId`. It gates nothing, and an internal principal has the same
`userId` as a device. Both `/auth/device/start` and `/auth/device/poll` are registered with `prefix:
''` under `/v2/p/github`, so no mount gate reaches them either. A task-scoped token can open a device
flow, read the `userCode` out of the response, and poll it to completion.

The exploit needs the attacker to authorize that code with a GitHub account they control, so it is a
confused deputy rather than a credential theft: the node ends up storing an attacker's token as the
owner's GitHub connection. `connectProvider` enforces `maxConnections`, so it only lands when GitHub
is not already connected. Narrow, but the payoff is that every later GitHub action the owner takes runs
against an account the attacker owns.

Two things to fix, and the comment is the more important one. A comment asserting a gate that does not
exist is worse than no comment, because the next reader stops looking. Put `requireProviderAccess`, or
the plugin-local equivalent the HTTP panel uses, in front of both routes and delete the line.

### 7. Smaller things

- **`requireTaskScope` fails open by construction.** `requireUser.ts:71` reads `c.req.param('id')` and
  allows the request when it is absent. I verified Hono always populates it under the four mount
  patterns in use, so there is no live bug, but the shape is inverted relative to the rule the file
  itself argues for. `respondError(c, 404)` on a missing id costs nothing and cannot rot.
- **`resolveInRoot` is check-then-use.** Nothing re-validates between the containment check and the
  open, so an agent that can write in its own worktree can swap a path component for a symlink in the
  window between them. Real, hard to hit, and the honest fix is an `O_NOFOLLOW`-style open rather than
  a tighter check.
- **The pairing attempt ceiling is one global counter.** Deliberate, and documented as such. On a node
  with `advertiseHost` set, it also means a LAN peer can spend 20 attempts a minute forever and keep
  the owner from pairing a real device. Availability only.
- **`[scripts]` in `.acorn/config.toml` is parsed and never read.** `runConfig.ts:240` merges
  `repo?.setup` over the database value, but the only consumer, `maybeRunSetup` in
  `plugins/terminal/src/main/terminal.ts:329`, reads the project config row instead. No risk, since the
  file is in the trust snapshot either way. It is drift: a repo can declare a setup script that
  silently does nothing.

## Plugins

### 8. Notes: workspace-scoped notes are readable and writable by any task

`plugins/notes/src/server/routes/notes.ts:22` through `:44` serve `/workspaces/:wsId/notes` for list,
read, create, update, retitle, include, and delete. The plugin registers with `prefix: ''`, so those
paths sit at `/v2/p/notes/workspaces/:wsId/...`, which no mount gate matches, and notes does not
self-check the way terminal, agents, workflows, memory, and github's `taskPulls` all do. Its
`/tasks/:id/notes` half is covered; the workspace half is not.

So an agent in one task reads and writes every workspace's notes, across every workspace on the node.
The read is a disclosure. The write is worse: notes feed the assembled task context, so writing another
workspace's notes plants text that a different agent will later be handed as instructions. That turns a
missing scope check into a cross-workspace prompt-injection primitive, which is a sharper outcome than
the cross-task reads this codebase has already gone after.

Workspace notes are not task-addressed, so there is nothing for `mayActOnTask` to compare. That makes
this the same situation as workflows' node-wide trigger poll, and `workflow.ts:78` already shows the
answer: refuse a task-confined caller outright. Filtering is not available, so denial is the only
honest option.

### 9. Terminal: the repo-config trust gate is two optional fields

`plugins/terminal/src/main/runtime.ts:85` and `:113`:

```ts
if (cfg.repoTargetIds?.includes(targetId)) await this.deps.authorizeRepoConfig?.(taskId)
```

This is the guard that stops a cloned repository from executing its committed `.acorn/config.toml`. It
disappears silently if `loadTargets` returns no `repoTargetIds`, or if a caller constructs
`RuntimeService` without `authorizeRepoConfig`. Both are optional in `RuntimeDeps` at line 25.

Both are wired today. `plugins/terminal/src/main/runIpc.ts:51` passes the gate and
`packages/node-core/src/main/runConfig.ts:254` populates the ids, and I checked that `stop`, `status`,
and `defaultUrl` cannot run a repo-authored script without an instance that `start` already gated. So
this is not a live bypass.

It is the wrong shape for the job. Core spent a whole section of `docs/security.md` arguing that a gate
should be mounted rather than remembered, so that a route added later inherits it. This gate is
remembered, twice, on the one path in the app where the threat is a repository the owner merely cloned.
Make both fields required and let the type system carry it.

### 10. Docker: the repo-config override is safe for a reason its comment does not give

`plugins/docker/src/main/dockerConfig.ts:1` says the `[docker]` table is "Non-executable configuration
only, label keys and project names, so unlike `[scripts.*]` it needs no repo-config trust gate". But
`compose_project` changes which containers `containerMatchesTask` links to a task
(`plugins/docker/src/main/matcher.ts:27`), and the docker pane offers an interactive shell in a linked
container.

The override turns out not to grant anything, because `docker:exec:open` takes its `ref` straight from
the WS frame and never consults the matcher, and the hub refuses that channel to task-confined sockets.
So exec is owner-only and ref-addressed, and the matcher only decides what the pane lists.

Worth recording because the justification in the comment is not the thing keeping it safe. If exec ever
becomes matcher-addressed, or a task-scoped caller is ever allowed a docker channel, a committed repo
file starts choosing which containers a task can shell into, and this comment will read as though the
question was already settled. Say what actually holds the line.

### 11. Agents: the webhook sender is built but unreachable

`plugins/agents/src/main/webhookService.ts` is a complete outbound webhook delivery service with a
better server-side request forgery guard than most production code I have read: it resolves DNS, denies
the private and link-local ranges including `169.254.0.0/16`, rejects credentials in the URL, requires
HTTPS for anything that is not loopback, and then dials the resolved address with the hostname in
`servername` and `host`, which closes DNS rebinding.

No route reaches it. The `create` method that validates a URL has no caller, and the only live entry
points are `reconcile`, `stop`, and `accept` from `runtimeEngine.ts`. So there is no live forgery
surface, and nothing to fix.

Two notes for whoever wires it up. Loopback with plain HTTP is deliberately allowed, so once a route
exists, whoever may create a webhook gains a POST primitive against any port on the machine. Make that
route device-only. And line 352 uses `reveal()` for the signing secret, which `docs/security.md` marks
as sitting outside the scrub-on-throw guarantee, so a delivery error must not carry the request that
produced it.

## What I would do, in order

1. Set a CSP on the `main` webview. One line, and it is the only item here that changes the ceiling on
   every future renderer bug rather than fixing one.
2. Guard the two sentinel lookups in `markdown.ts`, or strip U+E000 from the input. Confirmed crash,
   untrusted input, two lines.
3. Refuse task-confined callers on notes' workspace routes. Confirmed cross-workspace write into agent
   context.
4. Filter `task-statuses` by `mayActOnTask`, and delete the `// owner-gated` comment in `deviceAuth.ts`
   while putting a real gate in front of both device-flow routes.
5. Verify `dist.integrity` in the installer, and flip the `execute` tier to default-deny.
6. Make `authorizeRepoConfig` and `repoTargetIds` required in `RuntimeDeps`, and make
   `requireTaskScope` deny on a missing id. Neither fixes a live bug. Both remove a way for one to
   arrive quietly.

Items 1 through 4 are worth doing this week. Items 5 and 6 are the ones that keep this review from
needing to be repeated.

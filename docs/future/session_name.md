# Generate managed session titles

Status: **proposal, 2026-09-12. Not started.**

This plan replaces a managed agent session's prompt-derived label with a short generated title after
its first prompt is accepted. The generation runs as contained one-shot work. It does not create a
second managed session, delay the submitted turn, rename the owning task, or change a Git branch.

The implementation also makes session rename events explicit. Generated and user-authored renames
use one write path, publish the same updated session to clients, and identify the rename source to
node-side consumers without placing the title in an event payload.

## Outcome

After this work ships, a first interactive prompt has this behavior:

```text
client sends the first prompt
  -> agents runtime validates and applies the before-send hook
  -> agents store persists the turn
  -> session gets an immediate prompt-derived fallback title
  -> enqueue returns and the managed agent starts normally
  -> runtime starts one contained title-generation call in the background
  -> generated result conditionally replaces the fallback title
  -> clients receive the updated session
  -> node-side consumers receive a sessions-changed event marked as a generated rename
```

The fallback remains when generation is unavailable, times out, or returns an invalid title. A user
rename wins if it lands before or after generation.

Completion means all of the following are true:

- Only a newly accepted first interactive turn can start automatic title generation.
- An idempotent replay of the turn request does not start another generation call.
- The hidden call uses the session's agent profile through Acorn's contained one-shot model path.
- No hidden managed session, transcript, task, worktree, or branch is created.
- The accepted turn does not wait for title generation.
- A generated result replaces only the exact fallback title that caused the request.
- A user-authored title is not overwritten.
- Every actual rename publishes a client session update and one node-side lifecycle event.
- The lifecycle event identifies a rename and its source but carries no title text.
- Runtime shutdown aborts or joins title generation before the plugin database closes.
- Failure leaves the session usable and keeps the fallback title.

## The two names that must stay separate

Acorn has a core task title and an agents-plugin session title. They have different owners and
lifetimes.

The task title is supplied when the task is created. Core stores it on `tasks`, uses it throughout
the task rail, and may derive the task branch from it. This work does not read or write that title.

The session title belongs to one managed run inside a task. `AgentStore.createSession()` seeds it as
`New agent session` when the caller supplies no title. On the first turn, `AgentStore.enqueueTurn()`
replaces that default with the first text part or the first attachment filename, collapses
whitespace, and limits the result to 96 characters.

That deterministic replacement is the behavior this plan keeps as the immediate fallback. The
model-written title is a later refinement of the session label only.

## Existing ownership and data flow

The agents plugin owns the complete path:

1. `plugins/agents/src/client/composer/AgentComposer.tsx` submits an `EnqueueAgentTurnInput` through
   `managedAgentApi.enqueue()`.
2. `plugins/agents/src/server/routes/managed.ts` validates the body and requires an idempotency key.
3. `ManagedAgentRuntime.enqueueTurn()` resolves the session and task checkout, validates input files,
   applies the `before-send` hook, and calls the store.
4. `AgentStore.enqueueTurn()` detects an idempotent replay, assigns the turn ordinal, persists the
   turn, writes the prompt-derived title for ordinal zero, and announces changed turn and session
   state.
5. `ManagedAgentRuntime` starts or reconnects the real provider after the turn is durable.
6. Clients consume `agent:turn` and `agent:session` frames. Node-side plugins consume
   `plugin:agents:turn-changed` and `plugin:agents:sessions-changed`, then rebuild through the agents
   capabilities when they need state.

Two details constrain the implementation.

First, the store returns the existing turn when the idempotency key has already been accepted. A
caller cannot use `turn.ordinal === 0` alone as the generation gate, because a replay of the first
turn also has ordinal zero. The store must tell the runtime whether this call inserted the turn.

Second, `AgentStore.enqueueTurn()` publishes the node-side session lifecycle event after its direct
fallback-title update, but the runtime does not publish an `agent:session` client frame for that
write. Provider activity normally sends a later session frame, which hides the difference. The
rename refactor must make immediate, generated, and user-authored title changes publish through the
same post-commit path.

## Reference applications

The repository contains four useful approaches.

### bb

`references/bb/apps/server/src/services/threads/title-generation.ts` generates only for prompts with
at least five words, limits the answer to five words, gives the request 5 seconds, and retries once
through a fallback model. Its non-worktree path starts inference without blocking thread startup.
The generated write lands only while the thread still has its replaceable title state.

Take the short-input gate, the bounded timeout, the compact result, and best-effort failure behavior.
Do not copy its branch-title coupling. Acorn has already created the task and may have materialized
its worktree before a session receives its first prompt.

### T3 Code

`references/t3code/apps/server/src/textGeneration/TextGenerationPrompts.ts` asks the model to find
the durable subject and intended outcome, then discard instructions about models, tools, plans,
reports, branches, pull requests, and other execution details. It asks for 3-8 words under 40
characters.

`references/t3code/apps/server/src/orchestration/Layers/ProviderCommandReactor.ts` starts generation
from the first turn, retries transient failures, rereads the thread before applying the result, and
replaces only the default or exact seed title. Its tests cover a user rename while generation is
queued and while it is running.

Take the editorial prompt, first-turn timing, and exact-seed race rule.

### Proliferate

`references/proliferate/apps/packages/product-client/src/hooks/sessions/workflows/use-session-title-actions.ts`
starts best-effort generation after prompt acceptance. It keeps a bounded in-memory set of sessions
already requested and swallows failures so chat continues.

Take the rule that generation follows acceptance and does not block the turn. Do not put the trigger
or deduplication in the client. A second client, a process restart, and an idempotent HTTP replay must
observe the same Node-owned decision.

### cmux

`references/cmux/docs/workspace-auto-naming.md` runs a detached, tool-disabled naming pass through the
same agent family as the conversation. It records whether a title came from the user or automation,
and user-authored titles take precedence.

Take the same-profile execution and user-precedence rules. Do not copy its repeated topic-shift
renaming. This plan generates once from the first prompt.

## Architectural decisions

### Use one-shot text generation, not a managed session

Call `CoreServices.models.generateText()` with `harness:<profileId>` for the session profile. The
harness path in `packages/node-core/src/server/modelProviders/harnessRuntime.ts` already provides the
required containment:

- The profile's `aiArgv` disables tools.
- The child runs in an empty temporary directory, so repository instructions do not leak into the
  title prompt.
- The environment contains no Acorn API URL, token, or tool ceiling.
- The process uses the CLI's own authenticated account.
- The request runs behind the provider request scheduler and accepts a timeout and abort signal.
- The temporary directory is removed in a `finally` block.

Do not call `agents.sessionExecute`. That path requires a task, creates a durable managed session,
and adds a transcript that would appear in the Agent pane and Agent Center. A title-generation call
is implementation work, not a run the owner should manage.

Do not add a general HTTP generation route. The agents runtime already holds `CoreServices`, the
active user identity, the session profile, and the accepted prompt.

### Use the session profile, not the device Generate preference

The shared `models.generatePick` preference belongs to the device. The Node cannot read it, and
moving it would change the ownership of every explicit Generate control.

Build the backend id from the session profile instead. Claude Code sessions use the Claude Code
one-shot command, and Codex sessions use the Codex one-shot command. Omit `modelId` so the profile
uses its own one-shot default. Automatic metadata should not inherit a costly or specialized model
that the user selected for the managed turn.

If the profile has no `aiArgv`, as with the built-in Aider profile, skip generation and keep the
fallback. Do not fall back to the first API connection. That would spend a different credential
without a user selection and make session naming depend on connection ordering.

### Generate only for a newly inserted first interactive turn

The durable turn insertion is the authority. Generate when all of these conditions hold:

- The store inserted the turn during this call.
- The turn ordinal is zero.
- The turn source is `interactive`.
- The session title was still `New agent session` when the fallback write was attempted.
- The effective text prompt contains at least five words after whitespace normalization.
- The active user id and a one-shot backend for the session profile are available.

Do not generate for workflow, delegation, automation, or import turns. Those paths already have an
authored title or operate under another durable definition. Do not generate again for a second
managed session turn.

The store must return an internal enqueue outcome, not expose new wire fields. A suitable shape is:

```ts
type EnqueueTurnOutcome = {
  turn: AgentTurn
  inserted: boolean
  firstTurnFallback: string | null
  sessionAfterRename: AgentSession | null
}
```

`inserted` is false for an idempotency hit. `firstTurnFallback` is non-null only when the conditional
fallback rename landed. `sessionAfterRename` lets the runtime publish the changed session to clients
without rereading it again.

The route and capability continue returning `AgentTurn`. `ManagedAgentRuntime.enqueueTurn()` unwraps
the internal outcome before it crosses the bridge.

### Generate from the effective user text

Build the title input from text parts after the `before-send` hook has run. This preserves any
redaction or policy transformation that the accepted agent prompt received. Ignore file, image,
attachment, and context parts for this version.

Do not send captured task context to the title model. It may contain private notes or large source
material, and the title describes the user's request rather than the complete context snapshot.

Bound the prompt before generation. Keep at most 8,000 characters. Preserve the first 6,000 and last
2,000 characters with an explicit `[middle omitted]` marker when truncation is required. The opening
usually names the subject, while the ending often contains the requested outcome or constraints.

### Keep a deterministic fallback

Write the prompt-derived fallback before starting the background call. It gives every session a
useful label even when no one-shot backend is available.

Keep the present fallback rules unless implementation testing exposes a reason to change them:

- Use the first non-empty text part, or the first attachment filename when no text exists.
- Collapse whitespace.
- Limit the stored fallback to 96 characters.
- Replace only `New agent session`.

An attachment-only first turn gets the filename fallback and no model call because this version has
no image input on `GenerateTextInput`.

### Make user titles win through compare-and-set

Capture the exact fallback string that caused generation. When the result returns, update the row
only where both the session id and title still match that fallback.

The generated write therefore behaves like:

```sql
UPDATE agent_sessions
SET title = :generated_title, updated_at = :now
WHERE id = :session_id
  AND title = :expected_fallback
  AND title <> :generated_title;
```

Use `RETURNING` or the database change count to decide whether the rename landed. Do not implement
this as a read followed by an unconditional update. A user can rename the session between those two
operations.

The same conditional operation handles two generated calls that somehow overlap. The first result
may replace the fallback. Later results find a different title and do nothing.

No persistent title-provenance column is required for one-shot behavior. Automatic generation compares
against its prompt fallback; an explicit manual regeneration compares against the title that was
current when the request started. Both protect a user rename made while generation is running. Add
persistent provenance only if a later design introduces an automatic naming mode or repeated
topic-shift naming.

### Keep background work under runtime custody

The enqueue response must not await title generation, but the promise must still have an owner.
Add a runtime map keyed by session id that holds each title-generation operation and its abort
controller.

The runtime must:

- Refuse to start a second in-flight generation for the same session.
- Remove a completed or failed operation from the map.
- Abort operations when their session is deleted, if the deletion path can reach the runtime.
- Abort or join every operation from `ManagedAgentRuntime.stop()` before the plugin store closes.
- Catch and classify every failure inside the owned operation so no rejected promise escapes.

This follows the existing `sessionInitializations` ownership pattern in
`plugins/agents/src/server/sessions/runtime.ts`. It is background work, but it is not process-global
fire-and-forget work.

## Title prompt and normalization

Put pure title behavior in a small `sessionTitle.ts` module beside the session runtime. Keep
generation orchestration out of this
module so prompt and normalization tests need no database or provider fixture.

Use a system prompt with these requirements:

```text
Generate a title that helps the user recognize this coding session later.

Identify the durable subject and the outcome the user wants. Ignore instructions about how the
agent should work, including models, tools, subagents, plans, reports, tests, commits, branches,
pull requests, monitoring, and output formats unless one of those is the subject.

Return one plain-text title and nothing else.
- Use 3-8 words.
- Use fewer than 50 characters.
- Prefer a compact noun phrase or a clear action phrase.
- Do not claim the work is complete.
- Do not copy and truncate the prompt.
- Do not add quotes, Markdown, labels, or trailing punctuation.
```

The user prompt names the accepted text explicitly:

```text
First user request:
<effective text>
```

Normalize the result defensively:

1. Trim outer whitespace.
2. Take the first non-empty line.
3. Remove surrounding quotes, backticks, Markdown headings, list markers, and labels such as
   `Title:`.
4. Collapse internal whitespace.
5. Keep at most eight words.
6. Limit the result to 50 characters at a word boundary where possible.
7. Remove trailing sentence punctuation.
8. Reject an empty result, `New agent session`, or a value equal to the fallback.

Set `maxOutputTokens` to 64 and the request timeout to 30 seconds. One retry is acceptable only for a
transient provider failure and must remain inside an overall bounded operation. Do not retry invalid
content. The fallback is already a valid answer.

## Rename ownership and event contract

Every session-title mutation must pass through one store operation. The operation takes the title,
an optional expected title, and a source:

```ts
type SessionRenameSource = 'generated' | 'user'

type RenameSessionInput = {
  title: string
  expectedTitle?: string
  source: SessionRenameSource
}
```

The operation validates and normalizes the stored title at the same boundary as the manual PATCH,
performs the conditional write, and returns `{ session, changed }`. It announces lifecycle state
only when `changed` is true.

Use `source: 'generated'` for both the deterministic prompt fallback and the model result. They are
automatic labels from the same first-turn flow. Use `source: 'user'` for the authenticated PATCH
route. If a future automation API can rename sessions, design its source when that API exists rather
than treating it as a user action.

### Extend the existing lifecycle event

`plugin:agents:sessions-changed` already fires after creation, title changes, archive changes, and
deletion. Keep this channel instead of adding a second `session-renamed` channel that would fire
beside it for the same row change.

Add explicit change metadata:

```ts
export type AgentSessionChange =
  | 'created'
  | 'renamed'
  | 'archived'
  | 'restored'
  | 'deleted'

export type AgentSessionsChangedEvent = {
  taskId: string
  sessionId: string
  present: boolean
  archived: boolean
  changes: AgentSessionChange[]
  renameSource?: SessionRenameSource
}
```

Use an array because the PATCH schema permits a title and archive state in one request. Emit one
post-commit event containing both changes instead of two events for one write. Sort changes in a
fixed order so tests and consumers receive a stable payload.

`renameSource` is present only when `changes` contains `renamed`. The event carries no previous or
new title. This preserves the existing rule that lifecycle events contain identifiers and state
edges but no prompt-derived content. A consumer that needs the title calls `AGENTS_SESSIONS.list()`
for the task.

Update the agents plugin's declared event description and the lifecycle contract documentation.
Treat the new required `changes` field as a contract change. Update every publisher and fixture in
the same change rather than making it optional and leaving producers with ambiguous payloads.

### Publish client state from the same result

After any runtime-owned rename lands, emit:

```ts
{ channel: 'agent:session', session }
```

Manual PATCH already does this after `runtime.patchSession()`. The prompt fallback does not. Refactor
the paths so the immediate fallback, model result, and manual rename all publish the returned session
the same way.

Do not add a second client-only rename frame. The full session frame is the cache update contract and
already carries every field a client needs.

## Failure behavior and telemetry

Automatic naming is best-effort. These outcomes keep the fallback and do not change the turn or
session runtime state:

- The profile has no one-shot mode or is no longer installed.
- The owner identity is unavailable.
- The prompt is empty or shorter than five words.
- The generation request times out, is aborted, or the CLI account needs authentication.
- The model returns empty or invalid content.
- The compare-and-set fails because the title changed.
- The Node begins shutdown before generation completes.

Use the existing telemetry logger with one bounded operation name, such as
`agents.session-title.generate`. Record fields that have a fixed or bounded vocabulary:

- `profileId`.
- `outcome`: `generated`, `skipped`, `timeout`, `unavailable`, `invalid`, `superseded`, or `aborted`.
- `durationMs`.
- `promptChars`.

Do not log the prompt, fallback title, generated title, provider stderr, task path, or attachment
filename. `generateTextForHarness()` already owns bounded stderr logging for the process failure.

A failed automatic title must not create a diagnostic transcript row. The hidden call is not part of
the managed conversation, and a warning inside that conversation would make the naming helper look
like agent work.

## Implementation sequence

### Phase 1: isolate title rules

1. Add the pure prompt, eligibility, truncation, and normalization functions.
2. Move the deterministic fallback calculation out of the middle of `AgentStore.enqueueTurn()` into
   the same module without changing its behavior.
3. Add table-driven tests for short prompts, multiline prompts, whitespace, Markdown wrappers,
   quoted output, word and character limits, equality with the fallback, and prompt truncation.

### Phase 2: make rename one operation

1. Add the conditional session rename method to the store or repository layer that owns
   `agent_sessions`.
2. Route the first-turn fallback through it.
3. Route manual title PATCH through it while preserving combined title, archive, read-state, and
   configuration patches.
4. Return the changed session and whether the write landed.
5. Publish lifecycle state only after the database write succeeds and only when public state changed.

If preserving one database update for a combined PATCH becomes awkward, add a transaction-scoped
private helper. Do not emit between the title and archive writes, because a subscriber must not read
half of one requested mutation.

### Phase 3: expose the enqueue outcome inside the plugin

1. Change the store's internal enqueue result to distinguish insertion from idempotent replay.
2. Return the exact fallback only when its conditional rename landed.
3. Keep the runtime bridge and HTTP response as `AgentTurn`.
4. Emit the fallback's `agent:session` frame from the runtime before scheduling generation.

### Phase 4: add runtime-owned generation

1. Add the in-flight operation map and abort controllers to `ManagedAgentRuntime`.
2. Schedule generation after the store returns a newly inserted first interactive turn and fallback.
3. Resolve `harness:<profileId>`, the active user id, and the bounded prompt.
4. Call `core.models.generateText()` with the title system prompt, 64 output tokens, and a 5-second
   timeout.
5. Normalize the answer and conditionally rename from the captured fallback.
6. Publish `agent:session` only when the result lands.
7. Join or abort title operations during runtime shutdown.

### Phase 5: make rename semantics visible to node-side consumers

1. Add `changes` and `renameSource` to `AgentSessionsChangedEvent`.
2. Update create, rename, archive, restore, and delete publishers.
3. Update the agents plugin event declaration.
4. Update lifecycle fixtures and any consumer exhaustiveness checks.
5. Keep title text out of the event and verify that `AGENTS_SESSIONS` returns the renamed row.

### Phase 6: update owning documentation

When the behavior ships:

1. Document first-turn fallback and generated naming in `docs/managed-agents.md` under the session
   model and operations sections.
2. Document the contained one-shot consumer in `docs/integrations.md` under model providers.
3. Update the lifecycle event description and payload in `docs/managed-agents.md`.
4. Add the behavior to `docs/features.md` if that page names automatic session titles.
5. Add a manual check to `docs/testing.md`.
6. Remove this file and its row from `docs/future/README.md`. Use the owning documents and Git history
   as the shipped record.

## Expected code locations

The implementation is expected to touch these files. Treat paths as orientation, not a requirement
to put unrelated behavior into them:

- A proposed `sessionTitle.ts` beside the session runtime, for pure title rules.
- A colocated `sessionTitle.test.ts`, for pure tests.
- `plugins/agents/src/server/sessions/store.ts`, first-turn outcome and fallback rename.
- `plugins/agents/src/server/sessions/sessionRepository.ts`, conditional rename if this remains the
  row-mutation owner.
- `plugins/agents/src/server/sessions/runtime.ts`, scheduling, generation, client publication, and
  shutdown custody.
- `plugins/agents/src/server/sessions/runtime.test.ts`, orchestration, failures, races, and shutdown.
- `plugins/agents/src/server/sessions/lifecycle.ts`, event change metadata.
- `plugins/agents/src/server/sessions/lifecycle.test.ts`, exact event edges and payloads.
- `plugins/agents/src/contract/lifecycle.ts`, public event and rename-source types.
- `plugins/agents/src/node/index.ts`, event declaration text.
- `plugins/agents/src/shared/schemas.ts`, only if manual rename validation moves to a shared title
  schema.
- `plugins/agents/src/server/routes/managed.test.ts`, PATCH behavior and wire compatibility.
- `plugins/agents/src/client/sessions/managedStore.test.tsx`, immediate session-frame cache updates if
  the existing frame tests do not cover them.
- `docs/managed-agents.md`, `docs/integrations.md`, `docs/features.md`, and `docs/testing.md` when the
  work ships.

No core task route, task schema, branch helper, worktree service, client preference, or database
migration should change for this version.

## Test requirements

### Pure title tests

Cover these cases without starting a provider:

- Fewer than five words skips generation.
- Five or more words are eligible after whitespace normalization.
- Only text parts contribute to the generation prompt.
- The prompt uses the text after a `before-send` transform.
- An 8,000-character prompt remains unchanged.
- A longer prompt preserves the configured head and tail with the omission marker.
- Plain, quoted, fenced, headed, labelled, numbered, and multiline answers normalize correctly.
- Empty output and `New agent session` are rejected.
- More than eight words and more than 50 characters are bounded.
- A normalized answer equal to the fallback is a no-op.

### Store and lifecycle tests

Cover the persistence and event invariants:

- The first inserted turn returns `inserted: true`; its idempotent replay returns `false`.
- Only ordinal zero can return a fallback.
- A session titled before its first turn keeps that title and starts no automatic naming.
- The fallback conditional update changes only `New agent session`.
- A conditional generated rename changes only the exact expected fallback.
- A mismatched expected title returns unchanged and emits no event.
- An equal requested title emits no event and does not move `updatedAt`.
- A manual rename emits `changes: ['renamed']` with `renameSource: 'user'`.
- Both automatic title writes emit `renameSource: 'generated'`.
- A combined rename and archive PATCH emits one event with both sorted changes.
- Create, archive, restore, and delete events carry the correct `changes` value.
- Event payloads contain no title, prompt, path, or model output.
- `AGENTS_SESSIONS.list()` returns the title after each successful rename.

### Runtime tests

Use an injected or mocked `core.models.generateText` and controlled promises to cover:

- Enqueue returns before generation resolves.
- The real provider pump starts while title generation remains pending.
- The backend id is `harness:<session.profileId>`.
- The request has the title system prompt, bounded effective user text, 64 output tokens, and a
  30-second timeout.
- Workflow, delegation, automation, import, attachment-only, short, and second turns do not call the
  model.
- An idempotent replay of the first turn does not call the model twice.
- A generated title replaces the fallback and emits `agent:session`.
- A manual rename while generation is queued or running is preserved.
- Two attempted generated completions cannot overwrite each other.
- Empty, malformed, equal, timed-out, unavailable, and rejected answers retain the fallback.
- A profile without `aiArgv` retains the fallback without calling another backend.
- Runtime shutdown aborts or joins pending generation and produces no write after database disposal.
- No generation failure creates a transcript diagnostic or changes session attention or runtime
  state.

### Client tests

Verify that an `agent:session` frame updates the title in the task sidebar, Agent Center data, and the
open session snapshot without a task-list invalidation or page reload. Existing managed-store frame
tests may already prove this. Add only the missing assertion.

## Manual verification

Run these checks with Claude Code and Codex profiles:

1. Create a session, send a detailed first prompt, and confirm that the prompt fallback appears
   immediately and changes to a short title without interrupting the turn.
2. Rename a session before sending its first prompt and confirm that automatic naming does not run.
3. Send a first prompt, rename the session while generation is pending, and confirm that the user
   title remains.
4. Disconnect or sign out of the one-shot CLI, send a first prompt, and confirm that the session keeps
   the fallback with no transcript warning.
5. Start an Aider session and confirm that it keeps the fallback without spending a configured API
   connection.
6. Open the same Node from two clients and confirm that both receive the fallback and generated title.
7. Restart the Node after the first turn and confirm that it does not regenerate the title.
8. Confirm that Agent Center search finds the generated title.

## Out of scope and refused alternatives

- Do not rename the core task, task branch, or worktree. They belong to another entity and may already
  be in use.
- Do not create a visible managed session for title generation. It would pollute the session roster,
  transcript ledger, usage views, and attention state.
- Do not run generation in the renderer. The Node owns prompt acceptance, idempotency, provider
  execution, and session persistence.
- Do not use an in-memory requested-session set as the insertion authority. It does not survive a
  restart and disagrees across clients.
- Do not use the first available model connection as an automatic fallback. Connection order is not
  consent to spend a credential.
- Do not add a second `session-renamed` lifecycle channel beside `sessions-changed`. Add semantic
  change metadata to the event that already announces the row.
- Do not place old or new titles in lifecycle event payloads. Consumers can use the task-scoped
  session capability.
- Do not write title-generation details into the managed transcript.
- Do not add automatic repeated or topic-shift regeneration. It requires persistent title provenance,
  a user control to return to automatic naming, context selection, and throttling. An explicit one-shot
  regeneration from the first durable prompt does not create that automatic state.
- Do not add image understanding. `GenerateTextInput` is text-only, and an attachment filename is an
  adequate fallback for this version.
- Do not add a database column for title provenance until behavior needs to survive beyond the
  compare-and-set operation.

## Verify before building

Before implementation, confirm that the referenced paths and contracts have not moved:

```sh
rg -n "async enqueueTurn|New agent session|deterministicTitle" \
  plugins/agents/src/server/sessions
rg -n "sessions-changed|announceSession|AgentSessionsChangedEvent" \
  plugins/agents/src docs/managed-agents.md
rg -n "generateTextForHarness|HARNESS_BACKEND_PREFIX|aiArgv" \
  packages/node-core/src plugins/agents/src/server/profiles
```

After implementation, run focused tests first:

```sh
pnpm --filter @acorn/plugin-agents test \
  src/server/sessions/sessionTitle.test.ts \
  src/server/sessions/lifecycle.test.ts \
  src/server/sessions/runtime.test.ts
```

Use the package name reported by `plugins/agents/package.json` if it differs from the command above.
Then run the repository gates required by the engineering guide:

```sh
pnpm lint
pnpm test
```

The work is complete only when the focused suites, repository lint, full test suite, and manual
checks pass, and the shipped behavior has moved into the owning documents.

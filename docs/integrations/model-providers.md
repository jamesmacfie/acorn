# Model providers

A Generate control, such as **Generate SQL** or a commit message, spends a model backend. This page
covers what a backend is, how core lists and calls one, how a CLI call is contained, and which routes
use it. The code is in `packages/node-core/src/server/modelProviders/`, and the type is in
`packages/protocol/src/integrations/modelProviders.ts`.

## Model providers

A backend is a model-provider connection you stored a key for, or an agent CLI installed on this
machine. `ModelBackend` is one flat read model over both: an ID, a kind of `connection` or `harness`,
a label, an optional glyph, a model catalog that may be empty, a default model ID that may be `''`,
and a flag for a failed CLI catalog read. Connection auth kind, scopes, account, and timestamps don't
cross it.

A CLI isn't a synthesized connection. `generateTextForConnection` reads a database row, checks its
status, reveals its secret, and marks it `needs-auth` on failure, and a CLI has none of those.

The model-providers plugin (`plugins/model-providers/`) registers OpenAI and Anthropic. It has no
database and no routes. It turns a stored credential into an HTTP call. Prompts and responses aren't
stored, and an ambiguous failure isn't retried. There's no generic generate endpoint: a consumer calls
`CoreServices.models.generateText` and owns its route, because a shared endpoint would be an
unbudgeted proxy. Each connection provider registers before its model adapter, and the registry
refuses an adapter for an unregistered provider or one without `textGeneration`. A loaded plugin can
register an adapter through `ctx.providers.model` for a connection provider it owns. Cancellation
reaches an adapter call already running in a worker.

## Backend IDs

Core mints and parses the IDs. `connection:<uuid>` is an integrations row you hold, and
`harness:<profileId>` is a profile that declares a one-shot text mode
([headless and one-shot modes](../managed-agents/harnesses.md#headless-and-one-shot-modes)). Both need
a non-empty ID, and core rejects bare IDs and unknown prefixes with a 400. `parseBackendId` is the one
reader. An ID reaches saved workflow steps and device preferences, so renaming a profile breaks them.

## Listing backends

`models.available(userId)` returns every connected model provider with text generation, in the order
`/v1/core/integrations` serves them, then every one-shot profile whose command is on this machine.
Connections come first because two paths take `available()[0]` without asking: the database plugin's
palette route and the changes plugin's fallback. A CLI is chosen for you only when you hold no key.

CLI availability is probed with `which` on every read, because a cache would need invalidating when
you install a CLI. The read first waits on `spawnsReady()`, the login-shell `PATH` probe in
`packages/node-core/src/server/core/loginShellPath.ts`, so a packaged macOS build doesn't report an
installed CLI as missing. `runHeadless` waits on the same gate. A profile that disappears between the
list and the call fails with `provider_not_connected`.

Codex's catalog is a bounded read through its app-server, cached for a minute on success, and a failure
can be retried. Claude's catalog is the CLI's stable aliases. An empty model ID omits the model flag.

`GET /v1/core/models/backends` is device-only and returns `backends` in list order, plus `missing`:
one-shot profiles whose command isn't here. It's an ID and label projection, not a generate endpoint.
The onboarding wizard, Settings > AI models, Settings > Agents > Harnesses and defaults, and the AI
SQL schema editor's gate read it. The wizard and AI models page read `missing`. A plugin frame uses
its own plugin's route, because `/v1/core/*` has no bridge scope.

## Calling a backend

`generateText` dispatches on the prefix: `connection:` to `generateTextForConnection` in `runtime.ts`,
and `harness:` to `generateTextForHarness` in `harnessRuntime.ts`. Both return the same result, whose
`backendId` says which was spent. Both run `validateInput` first: a three-minute ceiling, 100,000
system characters, 1,000,000 prompt characters, and 128,000 output tokens. A harness ignores
`maxOutputTokens` after validation, because neither CLI has a flag for it.

A CLI generate is contained:

- Tools are off, through the profile's `aiArgv`.
- The working folder is an empty temporary folder, removed afterward. Claude Code reads `CLAUDE.md`
  and Codex reads `AGENTS.md` from it, so a worktree would add a repository's house rules.
- The environment is the broker's base allowlist plus `AGENT_TOOL_PASSTHROUGH`
  (`packages/node-core/src/server/agentProfiles/toolEnv.ts`): no `ACORN_API_URL`, `ACORN_API_TOKEN`,
  `ACORN_TOOL_CEILING`, MCP server, or acorn-held key. The CLI uses its own login
  ([credential handling](../security/credentials.md)).
- The run goes through `providerRequestScheduler` in a lane per profile, two at once.
- A failure logs the stderr tail, profile, status, and duration, and the client gets
  `provider_unavailable`.

A generate isn't `agents.sessionExecute`, which needs a task and writes a durable session. A commit
message isn't a session. Managed-session naming is an internal consumer with no route or picker. It
spends `harness:<session.profileId>` only, and a profile without `aiArgv`, such as Aider, keeps the
fallback title.

## Consumers

Three routes use the seam, each with its own prompt:

| Consumer | Route | Prompt | Answer |
| --- | --- | --- | --- |
| database | `POST /v1/p/database/tasks/:taskId/generate` | The live schema, the repository's schema notes, and saved queries picked as examples | SQL, with fences stripped |
| changes | `POST /v1/p/changes/tasks/:id/local/commit-message` | The branch and the diff the next commit would take, capped at 12,000 characters, smallest files first | A commit message, into the draft |
| workflows | `POST /v1/p/workflows/defs/generate` | The step kinds from the Node's catalog and the workspace's valid definitions, capped at 90,000 characters | A definition, into the editor as one undo step |

All three take a `backendId` from your pick or the plugin's fallback, and all three refuse any caller
but a device or the Node's service scope. A task-scoped token has no editor for the answer, and a
generate spends your key or your CLI login. Each offers `models.available(userId)` through a route of
its own. Workflows asks twice: when the first definition fails the checker, the messages go back once,
which is why its route has a longer timeout
([generating and editing with AI](../workflows/authoring.md#generating-and-editing-with-ai)).

A `ProviderOperationError` reaches the client with the status you act on, 401 to reconnect and 429 to
wait. Anything else is flattened to `provider_unavailable`
([provider boundaries](./provider-boundaries.md)). Each consumer's failure text has one branch on the
backend kind: a harness failure names the CLI and says to run it once in a terminal.

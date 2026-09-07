# Phase 4: a generated commit message

Status: not started. Waits on phase 2.

## Goal

A wand button at the left of the commit toolbar asks a connected model provider for a commit message
from the diff about to be committed, and puts the answer in the editor. The provider and model are
picked the way the database plugin's SQL generator picks them, the key never leaves the node, and the
last pick is remembered per device.

## Why this phase, and why now

The message is the part of landing work that people put off, and the diff that would inform it is
already on the node. The seam exists: `core.models.generateText` and `core.models.available`
(`packages/node-core/src/server/core/models.ts`), consumed today by
`plugins/database/src/server/routes/database.ts` for SQL. This phase is a second consumer of the
same seam, with a route of its own, which is the rule the model providers foundation set.

## Scope

In:

- `POST /:id/local/commit-message` with `{ connectionId, modelId? }`, answering `{ message,
  providerId, modelId }`. The prompt is built on the node from the diff `commitMode()` would commit:
  `git diff --staged` when something is staged, `git diff` over tracked files otherwise. The diff is
  capped at a character budget and the system prompt says to write a conventional subject under 72
  characters and an optional body.
- `GET /:id/local/model-connections`, answering `core.models.available(owner)`, on the database
  plugin's pattern and for the same reason: `/v2/core/integrations` has no bridge scope.
- The wand: a `Button iconOnly` with a `wand-sparkles` glyph. When no model connection exists it is
  hidden. When the draft is empty it generates. When the draft is not empty it is a `ConfirmButton`
  reading **Replace?** on first press, because the text it would overwrite is the person's.
- The picker: `ModelConnectionPicker` in a `Popover` off the wand when more than one connection
  exists; the pick is stored as a device pref `changes:generate-connection` and re-used silently
  when it still exists.
- Busy state on the wand while the request runs; the error mapping from the database plugin's modal
  (`provider_needs_auth`, `provider_rate_limited`, else the message) in the footer `Alert`.

Out: streaming into the editor, a per-repo prompt template, generating from a commit range. A
template is a project setting and a later ask; streaming is a UI nicety over a call that takes a few
seconds.

## Design detail

**The prompt is the diff, and the diff is bounded.** A task's diff can be megabytes. The route reads
the numstat first and includes files smallest-first until the budget is spent, then lists the rest by
path with their counts, so the model knows they exist. The budget is a constant in
`plugins/changes/src/shared/api.ts` beside the route builders, sized like the database plugin's
`GENERATE_MAX_PROMPT_CHARS`.

**The generated text goes through the same door.** It lands in `draft` like typed text, and commit
runs `before-commit` over it like any other message. A commit-lint plugin sees no difference, and
should not.

**Interactive owner only.** The route checks `isInteractiveOwner` as the database one does. A
bearer-token automation caller has no editor to put the text in and no business spending a
provider's tokens on one.

## Code touched

- `plugins/changes/src/server/commitMessage.ts` (new): the prompt builder, pure over `(changes,
  diffs)`, and the budget rule.
- `plugins/changes/src/server/routes/localGit.ts`: the two routes; `core.models` reaches them
  through the plugin context.
- `plugins/changes/src/shared/api.ts`: the builders and the budget constant.
- `plugins/changes/src/client/changesClient.ts`, `changesModel.tsx`.
- `plugins/changes/src/client/GenerateButton.tsx` (new): the wand, the picker, the confirm.
- `packages/client-core/src/infra/persistence/devicePrefs.ts`: `changes:generate-connection`.

## Tests

- `commitMessage.test.ts` (new): the budget rule includes small files whole and lists the rest;
  the prompt names the branch; an empty diff produces a refusal before any provider call.
- `localGit.test.ts` (routes): a missing `connectionId` is 400; a non-interactive owner is 403; a
  `ProviderOperationError` maps to its status and code.
- `GenerateButton.test.tsx` (new, jsdom): hidden with no connections; one press fills an empty
  draft; a non-empty draft needs the arm; the remembered connection is used without the popover.

## Docs owed

Per [docs-migration.md](./docs-migration.md), phase 4 rows: `docs/first-party-plugins.md` the
`changes` row, and the model providers section that lists `generateText` consumers.

## Doors left open

- A per-project prompt template on the project row, beside the branch prefix.
- Generating a PR description from the same prompt builder is the GitHub plugin's ask, and the
  builder is pure so it can move to protocol if a second consumer appears.

## Done when

- With two staged files and one Anthropic connection, one press fills the editor with a subject and
  body in under ten seconds, and commit lands it through the hook chain.
- With two connections, the first press shows the picker and later presses do not.
- Disconnecting the provider hides the wand.
- `pnpm lint`, the changes plugin's tests, and the arch suite are green.

## Verify before building

- Phase 2 has shipped: `draft` is on the model.
- `packages/node-core/src/server/core/index.ts` still exposes `models: ModelService` on core services
  and the plugin context still hands it to route factories.
- `plugins/database/src/server/routes/database.ts` still has the `generate` and `model-connections`
  routes to copy the error mapping and owner check from.
- `packages/client-core/src/features/settings/models/ModelConnectionPicker.tsx` still exists and is exported to
  plugins.

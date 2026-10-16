# Context references with `#`

Date: October 16, 2026. Status: proposed. Implementation not started.

Use this plan to give the agent composer one Acorn-specific way to attach Acorn context: a
`#category:name` token typed in the message field, with the **Context** button as a second way into
the same list. It covers the token syntax, search, the button's popover, delivery to every harness,
the plugin contract, and the terminal client. The browser extension is out of scope, but it reuses
the same module later.

## Problem

The composer completes `@file`, `/command`, and `$skill` in the message field. Acorn's own context
(another agent thread, a terminal, a container, the task's context, a plugin's saved items) is
reachable only through the **Context** button. That flow has four problems:

- It takes two steps through two different controls. The button lists sources, then a modal lists
  one source's items as checkboxes.
- You can pick from one source at a time, and the modal has no search.
- The result is a chip above the field, not text in the message. You can't write "compare this with
  #agent:refactor-login" and have the reference sit in the sentence.
- A terminal snapshot carries the title and status only. The agent gets almost nothing.

## Goal

One registry of context sources, reached two ways:

1. Type `#` in the message field, pick a category, then pick an item.
2. Press **Context**, which opens the same two-step list in a popover.

Both insert the same token at the caret. The token in the text is the selection. Delete it and the
context goes with it.

## Starting point

Recheck these against the checkout before you start.

| Piece | Where |
| --- | --- |
| Composer, its mention sources, the **Context** `Picker`, and the chip row | `plugins/agents/src/client/composer/AgentComposer.tsx` |
| The per-source checkbox modal | `plugins/agents/src/client/composer/AgentContextPickerModal.tsx` |
| Capture, automatic task context, and draft state | `contextOperations.ts`, `automaticTaskContext.ts`, `composerState.ts`, and `composerDraftStorage.ts` in the same folder |
| Building the turn at send | `plugins/agents/src/client/composer/submitOperation.ts` |
| Token colouring and file-mention parsing | `composerTokens.ts` and `fileMentions.ts` in the same folder |
| The field, DOM host | `packages/client-core/src/kit/components/inputs/MentionTextarea.tsx` and `packages/client-core/src/kit/lib/controls/mentions.ts` |
| The field, terminal host | `apps/tui/src/kit/asking/composition.tsx` |
| The contract and the 512 KiB budget | `packages/protocol/src/agents/agentContext.ts` |
| The registry | `packages/client-core/src/host/registries/sources/agentContexts.ts` |
| Manifest descriptor and its binding | `packages/protocol/src/plugin/manifest/displayDescriptors.ts` (`agentContextDescriptor`) and `packages/client-core/src/host/chrome/chromeRegister.ts` |
| In-process sources | `plugins/agents/src/client/sessionContextContribution.ts`, `plugins/terminal/src/client/agentContextContribution.ts`, `plugins/docker/src/client/agentContextContribution.ts`, and `plugins/context/src/client/agentContextContribution.ts` |
| Loaded sources | `plugins/http/src/server/agentContext.ts` and `plugins/database/src/server/agentContext.ts` |
| How a context part reaches a harness | `plugins/agents/src/server/drivers/contextBlock.ts` |
| Terminal history on the Node | `plugins/terminal/src/server/terminalDisplay.ts` (a headless xterm with 1,000 lines of scrollback) |

Every harness already receives a context part the same way. `contextBlock` wraps it in an
`<acorn-context>` tag, and the Codex driver and the Agent Client Protocol (ACP) session both call it.
That covers Claude Code, OpenCode, and contributed harnesses. So delivery needs one small change, not
a change per harness.

## Decisions

James chose these on October 16, 2026:

| Question | Decision |
| --- | --- |
| What holds the selection | The token in the text. Chips remain only for file attachments and the automatic task context. |
| When a token is captured | At send. |
| What a terminal reference carries | The last 200 lines of output as plain text, with secret-shaped values redacted. |
| How search works | Category first. `#` lists categories, and item names are searched only after `#agent:`. |
| What **Context** opens | The same two-step list in a popover, with several items tickable. The modal is removed. |
| Which sessions `#agent:` lists | Every top-level session in the task except the one being written to. Subagent and workflow-step sessions are left out. |
| Whether plugins can reach outside the task | Yes. The source receives the typed query and searches itself. |
| Bare tokens | Only for sources with no items, such as `#task`. `#terminal` alone means nothing. |

The rest of this page makes further calls. Each one is marked **Changeable** where another answer
would work as well.

## Syntax

A reference is `#<keyword>:<slug>`, or `#<keyword>` for a source with no items.

- The keyword names the source: `agent`, `terminal`, `docker`, `task`, or a plugin's keyword.
  Lowercase letters, digits, and hyphens, starting with a letter.
- The slug comes from the item's label: lowercased, with runs of anything other than letters and
  digits turned into one hyphen, and trimmed. "Refactor login (v2)" becomes `refactor-login-v2`.
- A `#` counts only at a word boundary, the same rule `activeMention` applies to `@`.

These stay prose: `#123`, `# Heading`, `C#`, `a#b`, and a `#word` whose keyword matches no source.
GitHub-style issue numbers and markdown headings are common in messages, so this matters.

**Changeable.** Slugs instead of quoted labels like `@"docs/product brief.md"`. Slugs are easier to
type and read in a sentence. The cost is that two labels can produce the same slug. The next section
handles that.

## Resolution

The draft keeps a map from token text to item id. Completing a token, from the field or the
popover, writes its entry. The map is stored with the draft text in `composerState.ts` and
`composerDraftStorage.ts`, so it survives navigation and a reload like the rest of the draft.

A token resolves in this order:

1. An entry in the draft's map.
2. Otherwise, exactly one item in that category whose slug matches. Hand-typed tokens take this path.
3. Otherwise, it doesn't resolve.

The colouring follows resolution. A coloured token attaches, and an uncoloured one is plain prose.
`@file` already works this way, and `composerTokens` must use the same resolver for colour and for
send, so the two never disagree.

Two sessions with the same title both get the same slug. Completion keeps them apart through the
map. To keep the text unambiguous for the model, completing the second one appends `-2`, and so on.
Only completion appends the suffix. A hand-typed token that matches two items doesn't resolve.

The same token twice in one message produces one snapshot.

## Search

Typing `#` opens the list with every category: its keyword, its label, and its description. Typing
filters categories by keyword and label.

Choosing a category writes `#agent:` and keeps the list open. Typing after the colon searches that
category's items.

- A task-scoped source (`agent`, `terminal`, `docker`) is listed in full and filtered on the client
  with `fuzzyScore`. `advertisedSuggestions` in `composerTokens.ts` already does this.
- A source that declares search gets the query, debounced, and answers its own matches. This is how
  `#linear:` could reach any issue, not only the ones linked to the task.

The list shows a loading row while a source answers and the source's own empty text when nothing
matches. It closes once the query matches no category and has no colon, so `#123` closes it on the
first digit.

Choosing an item writes the token and a trailing space, as `@` does.

## Send

`submitTurn` resolves every coloured token, groups them by source, and calls each source's
`capture(scope, optionIds)` once. The snapshots join the turn's other context parts, and the existing
`agentContextBudget` check applies to the total.

- Send shows its busy state while capture runs.
- If any capture fails or comes back empty, the send stops. The draft stays as it was, and the error
  names the token: "Couldn't capture #terminal:dev-server. The session has ended."
- Over 512 KiB, the send stops with the existing message.

The automatic task context keeps its own path in `refreshAutomaticContext`. It stays a chip, because
nobody typed it.

**Changeable.** You can't see a reference's size before sending. The chips and the **Preview sent
context** popover showed that, because the content was captured up front. They keep working for the
automatic task context only. A later change could ask a source for an estimate on hover, but capture
at send is what keeps the content fresh.

## The Context button

**Context** opens a popover above the button, anchored where the `Picker` is now. It shows the same
two steps as `#`:

1. A filter field and the category list.
2. After you choose a category, its items, each with a checkbox, searched the same way.

Arrow keys move, Space ticks, Enter confirms, and Escape steps back from items to categories, then
closes. Confirming inserts one token per ticked item at the caret, separated by spaces, and returns
focus to the field. Items already referenced in the draft show ticked, and unticking one removes its
token.

`AgentContextPickerModal.tsx` is deleted, and so is the `setTimeout` workaround around it in
`AgentComposer.tsx`. `AgentContextOption.defaultSelected` goes too, because nothing reads it once the
modal goes.

## Categories

### `#agent:`

Lists every top-level managed session in the task except the receiving one, ordered by last activity.
A session with a `parentSessionId` is left out, and so is a workflow-step session. The label is the
title, and the description is the provider and the last activity time. Capture uses
`managedAgentApi.referenceContext` as it does now. Its 200-event, 100,000-character limits stay.

### `#terminal:`

Lists the task's terminal sessions by title, as now. Capture changes. It asks a terminal Node route
for the last 200 lines of the session's scrollback as plain text, taken from the headless xterm
buffer in `terminalDisplay.ts`, not from `SerializeAddon`, which emits escape codes. The route
redacts secret-shaped values before the text leaves the Node.

Don't write another redaction copy. `packages/node-core/src/server/telemetry/scrub.ts` and the
agents plugin's `safeProviderMessage` hold the same patterns already. Expose core's through
`@acorn/plugin-api/node` and use that.

**Changeable.** 200 lines. That's enough for a failing build or a stack trace, and about 16 KB at 80
columns.

### `#docker:`

Unchanged apart from the keyword: the task's containers, state, and ports. No environment values and
no logs.

### `#task`

Itemless. Captures the task's selected Context-pane sections, the same snapshot the automatic first
turn gets. If the automatic chip is also in the draft, the token wins and the chip is dropped.

### Loaded plugin sources

`http` and `database` take the keywords `http` and `db`. Their routes don't change, apart from
accepting the optional query.

## Plugin contract

`AgentContextContribution` gains three things:

```ts
export type AgentContextContribution = {
  id: string
  source: string
  /** What follows `#`. The host checks it and may qualify it. */
  keyword: string
  label: string
  description?: string
  /** No items: referenced as a bare `#keyword`. */
  itemless?: boolean
  /** The source answers the query itself, instead of listing everything for the client to filter. */
  search?: boolean
  revision?(scope: AgentContextCaptureScope): number
  options(scope: AgentContextCaptureScope, query?: string): Promise<AgentContextOption[]>
  capture(scope: AgentContextCaptureScope, optionIds?: readonly string[]): Promise<AgentContextSnapshot[]>
}
```

The manifest's `agentContextDescriptor` gains `keyword`, `itemless`, and `search`. The host sends
the options route `query` as a parameter alongside `taskId` when `search` is set. Its answer keeps
the existing parser and its 200-item cap.

The host binds keywords. It binds `source` the same way already:

- `agent`, `terminal`, `docker`, `task`, `file`, and `skill` are reserved for first-party sources.
- A loaded plugin whose keyword is reserved or taken gets `<pluginId>-<keyword>`. The host logs it.
  The manifest check doesn't reject it, because two independent plugins can't coordinate names.

A new manifest key touches places the type checker doesn't find: the builder and testkit lists, the
loaded binding, the schema regeneration, and the `plugin_authoring` vocabulary. Update all of them.

The six existing sources each gain a keyword in the same change. Any third-party source without one
gets its manifest `id` as the keyword until it declares one. That keeps old packages working.

## Harness delivery

A token in the text and its context block need to be linked for the model. `contextBlock` gains a
`ref` attribute with the token, escaped like the other attributes:

```text
<acorn-context source="terminal" label="Terminal · dev server" ref="#terminal:dev-server">
…
</acorn-context>
```

`AgentContextSnapshot` gains an optional `ref`, which the composer sets at send. Nothing else changes
per harness. Claude Code doesn't treat `#` specially over ACP, and neither does Codex. Check both
once in phase 1 anyway, with a real message.

## Rendering

In the composer, a resolved token is coloured through the existing `composerSegments` mirror, in a
fourth tone after `accent`, `warn`, and `ok`. Its tooltip is the item's label and source, the same
`data-tip` the command tokens use.

In the transcript, the user message colours the same tokens, and pressing one follows its
snapshot's `deepLink`: the terminal pane for a terminal, the session for an agent. A token whose
source has gone stays coloured but does nothing when pressed.

## Terminal client

The terminal client has never been checked against the **Context** flow, and its field differs from
the DOM one in ways that matter here:

| Gap | What to do |
| --- | --- |
| It completes only the last word, because it has no caret position. | Acceptable. `@`, `/`, and `$` work the same way there. |
| It draws no inline colour, because a terminal has no layer for a mirror. | Acceptable. The suggestions list is the feedback. |
| `complete` always appends a space. | Fix. Choosing a category must write `#agent:` and keep the list open. |
| It ignores a source's `loading` and `emptyText`. | Fix. Show both as a muted row under the field. |
| Enter completes the first suggestion. | Keep, but for a category it must step in, not finish. |

`MentionSuggestion` gains a `continue` flag that both hosts honour: no trailing space, list stays
open. `completeMention` in `mentions.ts` and `complete` in `composition.tsx` both read it.

The popover uses the terminal `Picker`, which is a `Menu`. It supports `keepOpen` already. It needs
a second step for items and checkbox rows. Check that Escape steps back before it closes, and that
focus returns to the field.

## Out of scope

- The browser extension's composer. Put the parser, the resolver, and the suggestion logic in one
  pure module next to `fileMentions.ts`, with no Solid and no fetches, so `apps/extension` can
  import it later.
- `#` for files. `@` stays the file sigil, because harnesses read file parts natively.
- Previewing a snapshot before send.

## Phases

### Phase 1: the contract and the desktop composer

Add `keyword`, `itemless`, `search`, and `ref` to the contract. Build the shared token module.
Wire `#` into the composer for `agent`, `docker`, `task`, `http`, and `db`. Capture at send. Replace
the button with the popover, and delete the modal. Add `ref` to `contextBlock`.

Acceptance:

- Unit tests cover the parser, including the prose cases in [Syntax](#syntax), and the resolver,
  including duplicate slugs.
- One test proves `composerTokens` and `submitTurn` agree on what's attached.
- A real Claude Code session and a real Codex session each answer a question that needs a
  referenced agent thread.

### Phase 2: terminal output

Add the scrollback route with redaction, and switch the terminal source to it.

Acceptance:

- A test with a fake token in the scrollback shows it redacted in the snapshot.
- The 200-line cap holds against a session with 1,000 lines of history.

### Phase 3: plugin search

Send the query to sources that declare `search`, and add the manifest fields and keyword binding.

Acceptance:

- A loaded test plugin with a colliding keyword gets the qualified one.
- An old manifest with no keyword still lists and captures.

### Phase 4: terminal client

Fix the gaps in [Terminal client](#terminal-client).

Acceptance:

- In a real `dev:tui:agent` session, reference an agent thread and a terminal through `#` and
  through the popover, send the message, and read the snapshot in the transcript.
- Record the walk in `docs/testing/`.

### Phase 5: transcript

Colour sent tokens and make them follow their deep link.

## Docs to update when this ships

- `docs/managed-agents/composer.md`, the field and the "Reference another session" section.
- `docs/managed-agents/attachments.md`, "Context and artifacts".
- `docs/plugins/descriptors.md` and `docs/plugin-authoring/contributions.md`, for the new fields.
- `docs/tui/typing.md`, for the two-step completion.

## Risks

- **Slow capture blocks Send.** A loaded plugin's capture route has no deadline in the composer.
  Give capture at send a 10-second limit per source, and name the source that ran out.
- **Secrets in terminal output.** Pattern redaction catches common token shapes, not every secret.
  Nothing shows you the output before it's sent. Say so in the docs.
- **Slug drift.** A session renamed after completion keeps resolving through the map, but the text
  shows the old slug. That's acceptable, because the `ref` and the label travel together.
- **`#` habits.** Someone typing a markdown heading or an issue number sees the list open for one
  keystroke at most.

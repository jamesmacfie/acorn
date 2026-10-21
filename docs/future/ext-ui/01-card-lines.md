# Phase 1: name the cards

Date: October 21, 2026. Status: done. Needs nothing.

## Completion note

Landed on October 21, 2026, on the `phase-1-name-the-cards` branch.

What landed:

- `BridgeToolCard` and the tool event's optional `card`, in
  `packages/protocol/src/transport/extensionBridge.ts`, as requirement 1 gives them.
- `toolCard` in `apps/cli/src/browser/agents.ts` adds `card` to a call named `panel_show` or
  `app_show`, with the caps from requirement 2.
- The shared readers. `readPanelShowCall` and its result schema are in
  `packages/protocol/src/dashboards/panelShowCall.ts`. The MCP envelope unwrapping is `toolCallJson` in
  `packages/protocol/src/agents/toolCallJson.ts`, which both readers use, so trellis lost its own copy.
  Trellis has `plugins/trellis/src/contract/appShowCall.ts`, with `appIdSchema`, `appShowInput`, the
  result schema, `AppShowResult`, and `readAppShowCall`. Its `shared/api.ts` imports `appIdSchema` from
  there. The desktop's panel card, the terminal's panel line, the app card, and the host import them.
- The sidebar. `conversationItems` gives a named call a `card` item, with its fields merged by tool ID,
  and `CardLineItem` in `Conversation.tsx` draws it. `appLink` in `apps/extension/src/acornLinks.ts`
  builds the Apps pane link.
- Docs: native messaging, the conversation view, agent conversations, the extension's limits,
  dashboards, agent-built apps, and first-party plugins. The site page "Talk to an agent from the
  browser" too, marked checked.
- Tests: checkpoints 1 and 2 as written, plus the caps, the app link, and the fallbacks below.

Decisions and deviations:

- `failed` is set for every settled status except completed with a result. A cancelled or interrupted
  call reads as failed, as the desktop's and the terminal's cards already read it.
- Requirement 9 reads "neither a title nor a name". An app's name arrives only with its result, so an
  app that's still checking would never say "Checking the app…". The sidebar counts an app ID as a
  name. A card with `failed` always gets its line, so a refused call whose input didn't parse can't
  read as a finished tool line with a green mark.
- A failed app reads "This app didn't pass its checks", because a refused call has no name.
- `toolCallJson` is its own protocol entry point, so the app reader doesn't import a panel module.
  The protocol's entry point cap in `tools/arch/boundaries.test.ts` went from 90 to 92, and
  client-core's from 205 to 204.
- Checkpoint 3 ran without a live agent. A seed script wrote a finished `panel_show`, a finished
  `app_show`, and a refused `panel_show` into a `pnpm dev:extension` session's Node through
  `AgentStore`. The sidebar, through this checkout's native host, drew all three lines. Their links
  were `acorn://<node>/t/<task>?pane=agents&item=<session>` and `?pane=apps&item=<app>`. A development
  build copies the link instead of opening it, so following it into the desktop wasn't checked. The
  desktop's task deep link calls `openPane(taskId, pane, { kind: 'plugin:select', item })`, the call
  the app card's **Open** makes.
- Verify before building: Claude's ACP normalizer sets `name` from `mcp__<server>__<tool>`, and
  Codex's from the item's tool. The ledger's latest row is the merged call, so it keeps `name`,
  `input`, and `output`. OpenCode isn't a harness: [opencode.md](../opencode.md) is postponed.
- Sizes. The Node service measured 1,915,121 B before and 1,915,111 B after, under the 1,917,500 B
  ceiling. The CLI's `dist/native-host.js` went from 54.78 kB to 99.71 kB, because
  `panelShowInputSchema` brings `panels.ts` and the data schemas it imports. `cli.js` shrank by 4.4 kB
  and the shared chunk grew by 7 kB.

For later phases:

- The trellis contract folder exists, exported as `./contract/*`. An app imports from it only through
  an edge listed in `tools/arch/boundaries.test.ts`. Keep lang-core out of `appShowCall.ts`, because
  the CLI bundles it.
- A `card` item keeps its call's merged status and the key of the call's first record, as a tool line
  does. Phase 3 can draw a panel card in place of the line by switching on `card.kind`.
- `card` carries no plan and no panel ID. Phase 3's `panel.run` names the session and tool call, as
  the programme's README decides.

## Goal

The sidebar shows what an agent made with `panel_show` or `app_show` as a named line, the way the
terminal client does, instead of "panel_show · completed". The line links to the desktop, where the
card draws in full.

## What the person gets

- A panel call reads as the panel's title, then the run's plain-language description from the
  `panel_show` result, such as "Pull requests by author, last 30 days." **Open in Acorn** opens the
  conversation in the desktop.
- An app call reads as "Migration checklist · v3", then the revision's note. **Open in Acorn** opens
  the task's Apps pane on that app.
- A call that is still checking reads "Checking the plan for <title>…" or "Checking the app…".
- A call that failed its checks reads "<title> didn't pass its checks, so nothing was drawn," in the
  warning tone.
- These lines never fold into "N tool calls", so a card is never hidden behind a count.

## Starting point

- The host narrows each agent event in `conversationEvent`, in `apps/cli/src/browser/agents.ts`. A
  tool event keeps `toolId`, `title`, and `status`.
- `AgentToolCall` in `plugins/agents/src/contract/wire.ts` carries `name`, the stable MCP tool name,
  separate from the provider's `title`. The desktop's card slot matches on it, as `panel_show` and
  `app_show`.
- `session.read` asks for `fold=1`. The fold stays inside one page, so a call that spans two pages
  arrives as two records: the opener, with the input, and a later one, with the output.
  `foldToolEvents` in `plugins/agents/src/shared/toolFold.ts` says so. The sidebar already merges a
  call's records by tool ID, keeping the last title and status reported.
- A harness records a refused MCP call as completed, with the error as its output. Both desktop cards
  treat "completed with no result" as "failed its checks."
- The desktop reads a `panel_show` call with `readPanelShowCall`, in client-core before this phase
  and in `packages/protocol/src/dashboards/panelShowCall.ts` after it, which unwraps the MCP content
  envelope. The trellis plugin reads an `app_show` call with its own `json` helper in
  `plugins/trellis/src/client/AppToolCard.tsx`, and its schemas are in
  `plugins/trellis/src/shared/api.ts`.
- The terminal client already draws both as lines (`apps/tui/src/kit/dashboards.tsx`).
- The extension builds `acorn://` links in `apps/extension/src/acornLinks.ts`, including
  `conversationLink`.

## Requirements

### The contract

1. `BridgeConversationEvent`'s `tool` variant gains an optional `card`, in
   `packages/protocol/src/transport/extensionBridge.ts`:

   ```ts
   type BridgeToolCard =
     | { kind: 'panel'; title?: string; description?: string[]; failed?: true }
     | { kind: 'app'; appId?: string; name?: string; revision?: number; note?: string; failed?: true }
   ```

   Every field is optional, because a call's input and result can arrive in different records. The
   sidebar merges a call's `card` fields by tool ID, as it merges `title` and `status`.
2. The host caps what it sends: a title or name at 200 characters, a note at 200, and a description
   at eight lines of 300 characters each. Nothing else from the input or output crosses the bridge.

### The host

3. `conversationEvent` adds `card` for a call whose `name` is `panel_show` or `app_show`, and for no
   other call.
4. From a `panel_show` record, the host reads `title` from the input, and `description` from the
   result. From an `app_show` record, it reads `appId` and `note` from the input, and `name` and
   `revision` from the result.
5. A record whose status is `completed` but whose output doesn't parse as a result carries
   `failed: true`. A `failed` status is the same.
6. The parsing is shared, not copied:
   - Move `readPanelShowCall` and its result schema from client-core into a protocol module the Node
     doesn't load at boot, such as a new `panelShowCall.ts` beside `panels.ts`. The desktop
     card, the terminal client, and the host all import it.
   - Give trellis a contract folder, `plugins/trellis/src/contract/`, and move `appShowInput`,
     `appShowResultSchema`, and the envelope unwrapping into it. List the host's import in
     `tools/arch/boundaries.test.ts`, as the agents contract imports are listed.

### The sidebar

7. `conversationItems` in `apps/extension/src/sidebar/conversationWindow.ts` gives a tool line with a
   `card` its own item kind, `card`. A card item ends a run of tool lines, so it never folds.
8. `Conversation.tsx` draws a `card` item with the kit's `Stack`, `Text`, and `Alert`, and the
   sidebar's `OpenInAcorn`. A panel links with `conversationLink`. An app links to the task's `apps`
   pane with the app as its item.
9. A card with neither a title nor a name, such as an opener whose input didn't parse, reads as the
   tool line it would have been.

## Out of scope

- Drawing the panel or the app. That's phases 3 and 4.
- Collapsing an older version of the same panel or app. A line costs one row, so two lines for two
  versions read fine.

## Risks

- **A tool name a harness changes.** The desktop's slot has the same dependency, so a rename breaks
  both, and their tests catch it together.
- **Compatibility.** An older sidebar ignores `card` and draws a line as before. A newer sidebar with
  an older host gets no `card` and does the same.

## Steps and checkpoints

**Checkpoint 1.** Host tests in `apps/cli/src/browser/agents.test.ts`: a `panel_show` call in one
record, in two records across pages, still running, failed, and completed with an error as its
output. The same for `app_show`. A call named anything else carries no `card`.

**Checkpoint 2.** Sidebar tests in `conversationWindow.test.ts` and `Conversation.test.tsx`: a card
between tool lines splits the fold, and three tool lines around a card fold as two runs.

**Checkpoint 3.** In `pnpm dev:extension`, ask an agent to "graph my commits this week by day." The
sidebar shows the panel's title and description, and **Open in Acorn** opens the conversation in the
desktop with the card drawn.

## Docs that change

- [Native messaging](../../browser-extension/native-messaging.md): the `card` field.
- [The conversation view](../../browser-extension/transcript.md): card lines, and that they don't fold.
- [Browser extension](../../browser-extension.md#limits): the limit on tool details becomes "draws
  panel and app calls as lines."
- [Dashboards](../../dashboards.md#panels-from-a-conversation) and
  [agent-built apps](../../agent-built-apps.md#cards): the extension's line.

## Verify before building

- That an `acorn://` task link with the `apps` pane and an app ID as its item selects the app, as
  `openPane(taskId, 'apps', { kind: 'plugin:select', item })` does.
- That `name` reaches the folded record for every harness that can call `panel_show`: Claude, Codex,
  and OpenCode. `mergeToolCall` keeps it, but a driver that never sets it leaves the sidebar with
  plain lines.

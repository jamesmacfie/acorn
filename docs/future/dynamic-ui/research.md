# Research: Lemma's widgets and apps, and Acorn's seams

Status: research notes, 2026-10-01. Lemma was read from the clone at `references/lemma-platform` in
the main checkout, which is not part of the repository. Treat version-specific details as dated.

## What Lemma does

Lemma is a shared agent workspace for business teams. A _pod_ holds tables, files, agents, workflows,
and permissions, and people reach it from a web app, a terminal client, or messaging apps. It generates
UI in two tiers.

### Widgets

A widget is an HTML fragment an agent writes and shows inline in a conversation, through
`display_resource(type="WIDGET")`. The agent skill is `lemma-skills/lemma-widget/SKILL.md`, and the
server side is `lemma-backend/app/modules/agent/api/controllers/widget_controller.py` with
`lemma-backend/app/core/widget_html_validation.py`.

- **Two ways to show one.** Inline `content` is frozen when the call succeeds, and a correction is a
  second widget under the first. A `path` to a pod file is re-read every time the widget is drawn, so
  an edit to the file changes every place the widget appears, earlier messages included.
- **Files are strongly preferred.** The skill's reasons: the agent can read back what it wrote, fix a
  few lines instead of retyping, and check the file before anyone sees it.
- **Validation before display.** The backend rejects unresolved placeholders, broken SDK loaders,
  whole documents instead of fragments, encoded blobs, and markup that does not parse as written.
- **A design vocabulary.** The agent pastes a CSS token block, `widget-tokens-v1.css`, and adapts one
  of six examples: a finding, a table, a record, a trend, a ranked list, and a note. The host sends
  its palette by message after first paint, so every token reference carries a fallback.
- **Live data.** A widget loads Lemma's browser SDK and reads records, runs queries, searches files,
  and subscribes to change streams, all as the signed-in person.
- **Limits.** The inline view clips at 480 pixels with a fade and **Expand**. No fixed positioning, no
  nested scrolling, and loading, empty, error, and narrow states are required.
- **It offers, never sends.** `composeInConversation` puts text in the composer for the person to send.
- **Isolation.** Each widget runs in an iframe with scripts, same-origin, forms, and popups allowed,
  served from a route that needs a pod session or a short-lived signed token.

### Apps

An app is a full frontend, often a React build, uploaded as a versioned bundle and served on its own
subdomain with the SDK configuration injected. Apps can be installed to a phone's home screen.
`/apps/from-widget` promotes a widget to an app without changing its source, because the backend
serves both through the same inject-and-serve path. The module doc is
`lemma-backend/docs/modules/apps.md`.

### What works and what does not

It works: agents produce useful views, file-based editing keeps them correct, and one primitive for
widgets and apps makes promotion free.

What costs Lemma:

- **The history lies.** A file-backed widget redraws earlier messages with later versions.
- **Nothing looks native.** Each widget reimplements its styling from tokens, and a missing fallback
  renders colourless.
- **Authentication in a cross-site iframe is fragile.** The skill spends a section explaining that
  `unauthenticated` often does not mean signed out, because browsers withhold the cookie.
- **No keyboard or focus model** shared with the host, and no terminal rendering.

## What Acorn already has

Almost every piece this programme needs has shipped for another reason.

| Need | Acorn seam | Where it is documented |
| --- | --- | --- |
| Sandboxed UI in host components | Remote component trees, run in a worker, drawn by the host on desktop and in the terminal | [Descriptors, trees, rectangles](../../plugins/descriptors-for-facts-trees-for-ui-rectangles-for-pixels.md) |
| A plugin with no build step | The scaffold inlines the bridge handshake and tree protocol | [Start from the scaffold](../../plugin-authoring/start-from-the-scaffold.md) |
| Agent-written bundles without a prompt per save | Dev mode, a device-side grant that records acceptances as `dev` and `partial` | [Activation](../../plugins/activation.md#the-dev-loop) |
| Teaching an agent the contract from the running host | `plugin_authoring` | [Agent tools](../../agent-tools.md) |
| A custom card in the transcript | `agents:tool-card`, a `replace` remote point keyed by tool name | [Cooperative extension points](../../plugins/cooperative-extension-points.md) |
| The conversation inside another pane | The `agents.conversation` client capability | `plugins/agents/src/contract/conversation.ts` |
| Cross-plugin data | Typed data sources, with host-dispatched row actions and a risk confirm | [Data sources](../../data-sources.md) |
| A read-only archived view | Panes that declare `readsArchived` | [Workspaces and tasks](../../workspaces-and-tasks.md#restoring-a-task) |
| Project-scoped panes beside a rail list | The `/p/:projectId/x/<plugin-id>/` routes | [Panes](../../panes.md) |
| Find or create a task for an item | The reference panel action | [Panes](../../panes.md#not-a-pane-the-reference-panel) |

## What is missing

- **A light authoring format.** The scaffold is close, but it assumes a person running a command and
  a package with a node half.
- **Lifecycle.** Nothing ties a plugin to a task, archives it with the task, or promotes it.
- **Revisions.** A plugin has one installed version. Apps need numbered revisions and a head.
- **Narrow trust.** Dev mode waives prompts for one plugin with its full permissions. Apps need a
  waiver that covers a namespace and only a narrow profile.
- **Validation before display.** Nothing boots a tree headlessly and reports errors to the agent.
- **An authoring guide for the kit.** `plugin_authoring` covers the manifest and the bridge. It does
  not teach an agent which kit components to use for a board, a chart, or a form, and it has no worked
  examples.

## What the spike must answer

Whether an agent, given the kit vocabulary and a handful of examples, writes a useful tree in one or
two tries. Everything else in this programme is plumbing that already has a pattern. That one question
does not, which is why [phase 0](./00-spike.md) exists.

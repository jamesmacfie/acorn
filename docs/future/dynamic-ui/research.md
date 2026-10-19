# Research: Lemma's widgets and apps, OpenUI, and Acorn's seams

Status: research notes. Lemma was read on 2026-10-01 from the clone at `references/lemma-platform` in
the main checkout, which is not part of the repository. OpenUI was read on 2026-10-19 from
[thesysdev/openui](https://github.com/thesysdev/openui) at commit `8d9c4c3`, dated October 16, 2026,
with `@openuidev/lang-core` at version 1.0.1. Treat version-specific details as dated.

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

## What OpenUI does

OpenUI is a specification and a set of packages for model-written UI, maintained by Thesys under the
MIT license. Thesys also sells a hosted Gateway that repairs model output and a hosted observability
service.

### The language

OpenUI Lang 1.0 is defined in three documents in the repository's `spec` folder: an overview, the
language rules, and the prompt and message protocol.

- A program is one statement per line, `name = Expression`. Rendering starts at `root`, a name can be
  used before its statement, and the last statement for a name wins.
- Component arguments are positional, in the key order of the component's Zod schema. `null` skips an
  optional argument.
- `$` variables hold state. Passing one to an input binds it both ways, and `@Set` and `@Reset` change
  it.
- Expressions cover arithmetic, comparison, logic, `? :`, member access, and indexing. Member access on
  a list gives that field of every element.
- The built-in functions are `@Count`, `@Sum`, `@Avg`, `@Min`, `@Max`, `@First`, `@Last`, `@Filter`,
  `@Sort`, `@Round`, `@Abs`, `@Floor`, `@Ceil`, and `@Each`. There is none for grouping or joining. A
  library adds pure, synchronous functions of its own.
- `Query(tool, args, defaults)` reads from a tool the host provides, and runs again when a `$`
  variable written in its arguments changes. `Mutation` writes, and runs only through `@Run`. The host
  supplies tools as a map of async functions or as an MCP client.
- The built-in actions are `@ToAssistant`, `@OpenUrl`, `@Set`, `@Reset`, and `@Run`. A library adds
  custom actions, which reach the host as events.
- Editing is a patch of statements merged by name. `name = null` deletes a statement, and statements
  nothing reaches are dropped.
- Errors carry a code, the statement, and a hint for the model: `unknown-component`,
  `missing-required`, `null-required`, `type-mismatch`, `excess-args`, `inline-reserved`,
  `unknown-function`, `no-root`, `parse-failed`, `runtime-error`, and `tool-not-found`. The client
  drops the smallest broken piece and draws the rest.
- Stored programs keep working while a library changes if the library adds props only at the end,
  never reorders or removes one, and gives a new required prop a default.

The conformance suite holds 58 cases. Every case checks parsing and evaluation without a UI, and 12
also check interaction: a runner mounts the program, replays clicks and typing, and compares the host
events and final state.

OpenUI claims up to 67% fewer tokens than JSON formats. The benchmarks are its own.

### The packages

- `@openuidev/lang-core` is the framework-free core: parser, validation, evaluator, query manager, and
  prompt generation. It takes Zod 4 as a peer dependency, the same major Acorn's catalog pins.
- `@openuidev/react-lang` is the React renderer, at 1.0.1. Its source outside tests is about 3,200
  lines, including devtools and observability hooks.
- The Vue, Svelte, and Angular renderers are at 0.4.2 and depend on `lang-core` 0.4. There is no Solid
  renderer.
- The rest are React chat components, an email library, a LangChain adapter, an A2UI client, a
  browser bundle, server helpers, and a CLI.

### What to watch

- `lang-core` runs an install script that sends an anonymous install event to PostHog unless
  `DO_NOT_TRACK` or `OPENUI_TELEMETRY_DISABLED` is set. Runtime telemetry is opt-in through
  `OPENUI_RUNTIME_TELEMETRY_ENABLED`, and never sends from a browser.
- The evaluator's member access reads any property of a value, including `constructor`. There is no
  way to call a value from a program.
- OpenUI calls itself "the open standard for generative UI". Other formats compete: Google's A2UI and
  Vercel's json-render are JSON formats, and MCP Apps draws HTML in iframes.

## What Acorn already has

Almost every piece this programme needs has shipped for another reason.

| Need | Acorn seam | Where it is documented |
| --- | --- | --- |
| Host components that draw in both clients | The kit, through `@acorn/plugin-api/ui`, which the terminal build resolves to its own kit | `apps/tui/vite.config.ts` |
| A plugin with no build step, for turning an app into a plugin | The scaffold inlines the bridge handshake and tree protocol | [Start from the scaffold](../../plugin-authoring/start-from-the-scaffold.md) |
| An agent writing a plugin without a prompt per save | Dev mode, a device-side grant that records acceptances as `dev` and `partial` | [Activation](../../plugins/dev-loop.md#the-dev-loop) |
| Teaching an agent the contract from the running host | `plugin_authoring` | [Agent tools](../../agent-tools.md) |
| A custom card in the transcript | `agents:tool-card`, a `replace` remote point keyed by tool name | [Cooperative extension points](../../plugins/cooperative-extension-points.md) |
| The conversation inside another pane | The `agents.conversation` client capability | `plugins/agents/src/contract/conversation.ts` |
| Cross-plugin data | Typed data sources, with host-dispatched row actions and a risk confirm | [Data sources](../../data-sources.md) |
| A read-only archived view | Panes that declare `readsArchived` | [Workspaces and tasks](../../workspaces-and-tasks/archive.md#restoring-a-task) |
| Project-scoped panes beside a rail list | The `/p/:projectId/x/<plugin-id>/` routes | [Panes](../../panes.md) |
| Find or create a task for an item | The reference panel action | [Panes](../../panes.md#not-a-pane-the-reference-panel) |
| Publishing a package from this repository | Three unscoped MIT packages with a pinned published surface | [Published packages](../../plugins/publishing.md) |

## What is missing

- **A Solid renderer for OpenUI.** `lang-core` does the language. Acorn writes the renderer, and
  OpenUI's conformance cases test it.
- **A library over the kit.** The schemas, descriptions, and kit bindings for the components agents
  use, plus any library functions phase 0 shows they need.
- **Tools over Acorn's data.** Data sources, row actions, task context, compose, and links as OpenUI
  tools and actions.
- **Lifecycle.** Nothing ties a UI to a task, archives it with the task, or promotes it.
- **Revisions.** Apps need numbered revisions and a head.
- **Worked examples.** `lang-core` generates the language prompt from the library. It doesn't know
  which components suit a board, a chart, or a form in Acorn.

Apps need neither a narrow trust grant nor a headless worker. A program runs no code, and `lang-core`
validates it on the Node.

## What the spike must answer

Whether an agent, given the library and a handful of examples, writes a useful program in one or two
tries. Everything else in this programme is plumbing that already has a pattern. That one question
does not, which is why [phase 0](./00-spike.md) exists.

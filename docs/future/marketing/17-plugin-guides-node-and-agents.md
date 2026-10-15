# Phase 17: write the Node, agent, data, and browser guides

Date: October 15, 2026. Status: done. Needs phase 15. Runs beside phase 16 and shares its guide
shape and example harness.

## Completion note

October 16, 2026. All 22 guides in the table below are written and published. Every code block comes from a tested example file or passes phase 15's manifest
check, and every "Wrong" manifest fails for the reason its guide gives. [Plugin guides and their
examples](../../site/plugin-guides.md) is the reference for the examples and the harness.

What landed:

- **Five examples** in `examples/plugins/`: `acme-agent`, `acme-harness`, `acme-data`, and
  `acme-browser` as planned, and `acme-readiness`, a derived source in the scaffold's `--data-source`
  form. All but `acme-readiness` are hand-written with no build.
- **`test/nodeExamples.test.ts`**, 13 cases, each answer parsed with the schema the host applies. It
  drives a stand-in `acme-code` over the Agent Client Protocol with the published SDK, runs the
  harness conformance script, summarizes notes through a fake model provider and a real model grant,
  and builds `acme-readiness` outside the repository from the packed SDK, running its own test.
- **The harness** passes the manifest's migrations and event grants, binds an owner on request, and
  calls a route as any principal, such as an agent's task credential. `NodeHalf.ctx` exposes the
  context for seeding core's rows.
- **The testkit** takes `events`, the manifest's `permissions.events`. Without it, a loaded plugin that
  calls `ctx.events.on` can't start in a test.
- **`acme-tracker`** hears `plugin:acme-data:deploys-changed` and reads the `acme-data.deploys`
  capability, so its task mark names the latest deploy. Its pictures are unchanged.
- **A sidebar picture**, `sidebar-plugin-panel`, from a new scene in
  `apps/extension/src/sidebar/pictures.test.tsx`.
- **`ExampleCode`** shows `.sql` and `.md` files, extensionless files with a `lang` override, and the
  examples' own tests in `examples/plugins/test/`.
- **`acme-review/node.js`** gained `hover` and `diagnostics` regions, with no change in behavior.

The checks: the examples suite passes, 55 cases, and the scaffold's 24. A production build writes 203
pages, and the site's tests pass with 231 Playwright tests. `astro check` and the examples package's
`tsc` find no errors, and knip is clean. The architecture suite fails six checks, none in a file this
phase touched. Phase 16 recorded eight on its base.

### The walk

In a `dev:agent` session, a scratch plugin written from "Give agents tools" alone, outside the
repository, installed from its folder. Its tool was listed under **Tools and permissions**, and a
Claude Code session loaded and called it as `mcp__acorn-dev__echo-notes_shout`. Fixed on the way:

- **A plugin with no client gets no trust prompt.** It goes active on install. A device asks only for
  a client bundle, skills, or a derived source's inputs. The guides that promised a prompt now say the
  plugin's **Permissions** tab lists the grant, and the prompt shows it when a device asks.
- **The tool's MCP name** is `mcp__acorn__…` in a packaged app and `mcp__acorn-dev__…` in a
  development build. The guide gives both.

`dev:agent` still fails the Node service budget on the base commit, 1,855,253 bytes against 1,820,500.
The walk ran the rest of `pnpm run stage` by hand and started with `--prepared`.

### Decisions

- **A fifth example for the derived source.** A derived source needs `acorn-plugin-sdk/data`, which
  a no-build Node half can't import. `acme-readiness` is what `npm create acorn-plugin -- --data-source`
  writes, reading core's tasks and `acme-data:deploys`. Mixing a bundled source into `acme-data` would
  have made the other eight features a build example too.
- **A no-build plugin uses `$client` for SQL.** `ctx.storage.open()` is a Drizzle handle, and a plugin
  with no build can't import Drizzle, so `acme-data` uses the SQLite driver under it with `?`
  parameters. The guide says to use Drizzle's query builder with a bundler.
- **The harness conformance run is a script in the example**, `acme-harness/test/conformance.mjs`.
  acorn has no conformance command. The script reads the manifest, makes the driver's calls, and runs
  the one-shot argv. An author runs it against their own command line.
- **The fake model is a real provider registration.** The test registers a connection provider and a
  model adapter through a test context, stores a connection and a grant in core's tables, and calls
  the route, so the grant path is the Node's own.
- **Cross-plugin capability isn't tested end to end.** Each testkit context has its own capability
  registry, so `acme-tracker` can't see `acme-data`'s in one test. The provider side is tested through
  `acme-data`'s routes, and the tracker's absent path through its own tests.
- **Results without a picture are text.** A transcript line, a trust prompt line, command-line output,
  or a dialog's text, in a `text` block. Existing snapshots and specimens are reused where they fit:
  the Context pane, a workflow run, the handoff card, and the permissions page.

### Deviations

- **"Match your app's pages to tasks" had no draft page.** It's new, after the sidebar panel guide, in
  the sidebar and the site map, and the `taskAddresses` reference page links to it.
- **`acme-data` records an audit verb.** The `auditActions` reference names "Log and measure" as its
  guide, so that guide covers `ctx.audit`.
- **A workflow file block isn't from an example.** "Add a workflow step" shows the step in a TOML file,
  the person's usage rather than the plugin's code.

### Problems for their owners

- **A harness-only plugin shows its program nowhere before it runs.** With no client, skills, or
  inputs, no prompt appears, and the plugin page's **Permissions** tab lists no harness, task check,
  context section, or custom agent line. `docs/plugin-authoring/harnesses.md` says the owner approves
  "the two lines the trust prompt shows".
- **A connection provider's `toPublic`** must match the host's projection exactly, and a hand-written
  plugin has to write it out. A host default would remove the trap.
- **An unknown `permissions.node.core` facet is skipped silently.** A typo such as `model` parses, and
  the first call throws a `TypeError`. The guide warns about it.

### What later phases need to know

- Phase 18 and 19: the Node guides link to reference pages and to user docs, and use the snapshots
  and specimens listed above. `sidebar-plugin-panel` is new.
- Phase 20: a person walking these guides with the published packages, and the harness and model
  steps against a real agent and key, are still yours. The walk used `dev:agent` and a scratch folder.

## Goal

A plugin author can do real work on the Node and hand it to agents: store data, connect a service, give
agents tools and context, add a harness, generate text with the person's chosen model, act on agent
turns, feed dashboards and workflows, run on a schedule, add a command-line command, and bring a website
into a task through the browser extension. Every guide is backed by a tested example.

## Starting point

- The internal authoring guide covers each of these in a topic page under `docs/plugin-authoring/`, and
  the reference behind each is in `docs/plugins/`.
- [Model providers](../../integrations/model-providers.md#plugin-model-grants) owns plugin model
  grants: a plugin spends the person's chosen model without seeing a key.
- `acorn-plugin-sdk/data` builds derived data sources, and `acorn-plugin-sdk/testing` tests them.
- `@acorn/plugin-api/testkit`'s `makeTestNodeContext` runs a Node half against the real host context,
  and [testing a plugin](../../plugin-authoring/testing.md) explains it.
- Phase 16 built the example harness and the guide shape.

## Example plugins

Add four more under `examples/plugins/` (new folder), tested by phase 16's harness:

| Example | What it shows |
| --- | --- |
| `acme-agent` | Agent tools with schemas and risk levels, a context section, two custom agents, a skill, a hook on agent turns, and generating text with a model grant. |
| `acme-harness` | A harness for an agent that speaks the Agent Client Protocol, with a one-shot mode for generating text. Its test drives a fake agent, like `apps/node/test/__fixtures__/fake-agent.sh`. |
| `acme-data` | Its own SQLite tables and a migration, a typed data source with dashboard starters, a derived source, a workflow step kind, a schedule, a task check, a command-line command, a connection to a service, and events and capabilities shared with `acme-tracker`. |
| `acme-browser` | A browser handoff with a task chip on `example.com`, task addresses, and a browser sidebar panel. |

## The guides

| Guide | What it has to make clear |
| --- | --- |
| Write the Node half | The default export, `init`, `ready`, and `dispose`, the order plugins start in, the worker the half runs in, and loading a route on first use. |
| Store data | Opening the plugin's database, migrations and how the host applies them, and never touching another plugin's file. |
| Use events and talk to other plugins | Subscribing to core channels, publishing on your own, declaring what you emit, capabilities with `get` and `require`, and re-reading state after a reconnect because events have no replay. |
| Connect a service | Providers and connections, borrowing a credential without reading it, and the settings page that comes with a connection. |
| Give agents tools | `agentTools`: names qualified as `<pluginId>_<localId>`, input schemas and their limits, risk, output bounds, and how the tool reaches Claude Code and Codex over MCP. |
| Add task context | `contextSections`: byte and token budgets, timeouts, and what the person sees when they send context. |
| Add a harness | Writing a launch spec for an agent command line, the stream it speaks, the one-shot block for generating text, what the trust prompt shows, and checking it with the conformance run. |
| Ship custom agents and skills | `customAgents` and `skills`, and how each shows up under **New** and in a session. |
| Generate text with a model | Asking for the model grant, calling `generateText`, using the person's **Generate with** default, and what happens when they have no key but have an agent command line. This is how a plugin gets an AI to write something for the person, so show a complete example, such as `acme-agent` summarizing a task's notes. |
| Act on agent turns with hooks | Hook points, modes, and what a hook may change. |
| Add a data source | Field specs, identity and reach, coverage, starter panels for dashboards, discovery, and derived sources with the SDK. |
| Add a workflow step | Step kinds, `describe`, the closed field vocabulary, and typed output. |
| Run work on a schedule | Declaring a schedule, the 300-second floor, overrides, and why the work runs on the Node. |
| Check a task before it's archived | Task checks, with and without an apply action. |
| Add a command-line command | `cliCommands`, its arguments and output schema, scope, and retries. |
| Add hover and diagnostics for a language | `documentServices` for Editor, and what happens when two plugins claim a language. |
| Bring a website's item into a task | `browserHandoffs`, the chip the extension draws, resolving the page on your route, and creating the linked task. |
| Show a panel in the browser sidebar | `browserPanel` and its fixed blocks. |
| Match your app's pages to tasks | `taskAddresses`, so the extension knows which task an open page belongs to. |
| Log and measure | `ctx.log` and `ctx.telemetry`, and what reaches a sink. |
| Test your plugin | The two test environments, the testkit, testing a derived source, and running the example harness on your own plugin. |
| Install, update, and share | Installing from a folder, a GitHub release, npm, or an HTTPS tarball, on a Node or on one device, updates and the second trust prompt, and the compatibility range in `apiVersion`. |

Each guide follows phase 16's shape: the result, steps with file paths on every code block, mistakes,
limits, and reference links. Where a guide adds nothing visible, its "result" is the transcript card,
the palette row, the terminal output, or the extension sidebar it changes, shown as a specimen.

## Out of scope

Publishing to a registry or a marketplace. There isn't one, and [refused](./refused.md) says why.

## Acceptance

- The four examples pass phase 16's harness, including `acme-harness` against a fake agent.
- `acme-agent`'s generate example works against a fake model adapter in its test.
- Every code block in these guides comes from an example file region or passes phase 15's manifest
  check.
- A developer adds an agent tool to their own plugin from "Give agents tools" alone, and the tool
  appears in a Claude Code session in `dev:agent`.

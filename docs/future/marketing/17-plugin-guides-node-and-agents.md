# Phase 17: write the Node, agent, data, and browser guides

Date: October 15, 2026. Status: proposed. Needs phase 15. Runs beside phase 16 and shares its guide
shape and example harness.

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

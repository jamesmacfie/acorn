# Build a mobile web app

Date: October 17, 2026. Status: in progress. Phase 1 shipped October 21, 2026.

This programme plans a mobile web app that reaches a Node and draws the same plugin UI the desktop
draws, at phone width. It starts small: the things you want from your phone while agents work. Read
this page before you pick up a phase. [Remote access](../remote.md) owns the wider design for
browser sessions, custody, and push. This programme is the first slice of it.

## What the first release does

A person opens the app on their phone, sees what needs them, and answers it. These features make the
first release:

- A **Needs you** list: agent permission requests and questions across every task.
- A task list, grouped by workspace, with each task's state.
- A task, one pane at a time, with a bar at the bottom to switch panes.
- The agent conversation: read the transcript, answer a permission request or a question, send a
  message, and stop a turn.
- **New task**, through the same draft flow the desktop uses.

Every other built-in pane draws too, because the panes come with the plugins. A pane that can't work
on a phone, such as Preview, says so and the app hides it.

## Starting point

The checkout at `73fd11ad7` already holds most of what a phone needs:

- No plugin ships a stylesheet or draws its own `div` or `span`. Every plugin draws with the kit, so
  narrow behavior written once in client-core reaches every plugin.
- Eight of the nine built-in task panes name a host layout. Agents, git, notes, and workflows use
  `list-detail`. Ten plugin files use the kit's `ListDetail` component inside a region.
- [Pane layouts](../../panes/layout.md#named-layouts) gives every layout a narrow projection, written
  down and not built. Layouts never read the window width.
- The style packs set the size and spacing values from one attribute on the root element, as
  `packages/client-core/src/infra/styles/style-cozy.css` does. A narrow mode can work the same way.
- The terminal client is a second shell over the same client-core. It installs its own platform
  seam in `apps/tui/src/platform.ts`, its own plugin list in `apps/tui/src/roster.ts`, and its own
  layout table. The mobile app copies that shape with the browser's DOM.

Four things stop a phone browser from reaching a Node:

- The Node accepts a device token only in a request header. A browser can't set a header on a
  WebSocket upgrade ([transport and auth](../../security/transport-and-auth.md#transport)).
- The Node's certificate is self-signed and pinned by fingerprint. A phone browser refuses it, and a
  web app needs a trusted certificate to install or to run a service worker.
- The Node listens on loopback and serves no HTML.
- Loaded plugin bundles need custody, and frame plugins load from a desktop-only scheme.

## The phases

| Phase | What changes |
| --- | --- |
| [1](./01-gateway.md) | A gateway process on the Node's computer holds the device token and the pinned connection, and gives a browser a session. |
| [2](./02-shell.md) | `apps/mobile` boots client-core in a browser through the gateway: task list, a task, one pane at a time. |
| [3](./03-narrow-mode.md) | One root attribute turns on touch sizes, shows hover-only controls, and tells plugins the form factor. |
| [4](./04-narrow-layouts.md) | The host layouts and the kit's `ListDetail` draw their narrow projections. |
| [5](./05-needs-you.md) | The first release's features: **Needs you**, the agent conversation, and **New task**. |
| [6](./06-on-a-phone.md) | A real phone over Tailscale, installed to the home screen, with real-device acceptance. |

[Later](./later.md) lists the work after the first release: push, Node-side browser sessions, loaded
plugins, more than one Node, and the browser extension.

Phases 1 and 2 give you something to look at in desktop Chrome at phone width. Do them first, because
phases 3 and 4 are UI work that needs a real screen to check. Phases 3 and 4 can run in parallel.
Phase 5 needs both. Phase 6 needs everything.

## What holds across every phase

- The desktop shell doesn't change shape. `apps/desktop/src/client/App.tsx` and
  `apps/desktop/src/client/TaskView.tsx` keep their navigation. The phone gets its own shell.
- Narrow behavior lives in client-core: in the kit, the layouts, and the style values. A fix for one
  plugin's pane on a phone goes in the shared component, never in the plugin.
- Nothing in a layout reads the window width. The mobile shell sets the form factor on the root
  element, and layouts read that ([the closed kit](../../ui-design/closed-kit.md#what-the-kit-and-layouts-must-never-do)).
- The browser never holds a Node device token or a certificate. The gateway does, the way the
  extension's native host does ([browser extension](../../browser-extension.md#what-runs-where)).
- The Node's auth and routes don't change in this programme.
- When a phase ships behavior, document it in the owning reference page and trim this plan.

## Decisions for the owner

These decisions belong to the owner. Each phase names the default it assumes:

1. The gateway, not the Node, holds browser sessions for the first release. This keeps the Node's
   security model unchanged while the app proves itself. The cost: the Node sees one device for every
   phone behind a gateway, so revoking a single phone happens at the gateway.
2. Tailscale provides the trusted certificate and the reachability. The app works on any network
   that gives the gateway a trusted HTTPS name, but Tailscale is the one the plan tests.
3. The phone gets owner power over the Node, minus a short denylist of routes it has no screen for.
   Phase 1 lists them.
4. Built-in plugins only. Loaded plugins wait for browser custody ([later](./later.md)).

## Why

A responsive desktop app was the other option. The desktop's shell is the part that has to change on a
phone. It holds the rail, the three-column grid, the fixed pane switcher, the fixed footer, and the
terminal drawer. Making it responsive puts two navigation models in one file. The parts under the
shell are what a phone shares, and they already live in client-core.

A native wrapper, such as Capacitor, was also considered. It would solve the certificate pin, but it
adds two app stores, a native build, and a second plugin custody story before anyone knows which
features people use on a phone. A web app on a tailnet answers that question first, and a wrapper can
come later around the same bundle.

Serving the app from the Node was the third. It needs browser sessions, origin checks, and a trusted
certificate on the Node itself, which are the open decisions in [remote access](../remote.md). The
gateway lets the UI work start without them.

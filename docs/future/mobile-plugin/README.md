# Run installed plugins, the terminal, and Preview on the phone

Date: October 23, 2026. Status: all six phases built on the open side. Still to do: the real-device
checkpoints, the hosted-service steps, Runn's opt-in in its own repository, and phase 6's staging
certificate check. Each phase file's completion note says what landed and what's left. Where a file
here disagrees with a shipped contract, the owning reference document wins.

This programme plans the rest of the plugin UI on the phone: plugins installed on a Node, such as
Database, HTTP, and Runn, the terminal, plugins that paint their own iframe, and Preview through the
Node. Read this page before you pick up a phase.

## What this is

The phone app draws the built-in panes one at a time ([the mobile web app](../../mobile.md)). Panes
from installed plugins are missing, and so are the terminal and Preview. At the end of this
programme, a person on their phone can:

- Open the Database, HTTP, Rollbar, Linear, and Runn panes on a task, after the same trust decision
  the desktop asks for.
- Open a terminal on a task and type into it, with the keys a phone keyboard lacks.
- Use a plugin that paints its own iframe, such as the image markup overlay.
- See a task's running app in a Preview pane, served by the Node through the relay.

## Why it exists

Three gaps hold these back, each in a different layer:

- **Custody.** The phone has no store for verified plugin bundles and trust decisions, so
  `pluginHostAvailable()` in `packages/client-core/src/host/plugins/host.ts` is false and no
  installed plugin registers. The desktop keeps them in its helper process, and the terminal client
  keeps them in its config directory.
- **An origin for plugin code.** The desktop runs each bundle on `app-plugin://<hash>`, an origin with
  no network ([the plugin frame origin](../../shell/origins.md#the-plugin-frame-origin)). A browser
  has no custom schemes. Plugin code on the phone app's own origin could use the account session and
  the key that unseals the device token, which is full access to the Node.
- **Places to draw.** The terminal is a drawer
  (`plugins/terminal/src/client/drawerContribution.tsx`), and the phone draws no drawers. Preview is a
  native web view (`plugins/preview/src/client/paneContribution.ts`) that a browser can't host, and
  the task's dev server listens on the Node's loopback, which the phone can't reach.

## Goals

- Installed plugins whose authors opt in draw on the phone, under the desktop's trust rules:
  consent bound to a hash, a prompt on each device, and a prompt again on update.
- Plugin code runs on an origin of its own with no network, as it does on the desktop.
- The terminal works on a phone, including Ctrl, Esc, Tab, and the arrow keys.
- Preview loads the task's app in an iframe, through the Node, while the relay reads nothing.

## Non-goals

- Installing a plugin from the phone, or a device-held plugin with no Node half.
- Project-scoped panes, settings pages, and reference panels. The phone has no screen for them, so
  Linear's issue panel, the HTTP and Rollbar project panes, and machine-stats' project pane stay on
  the desktop.
- Changing the `formFactor` default. A plugin opts in.
- A `mobile` value in a manifest's `clients` list. The phone draws the desktop's DOM plugin halves,
  and screen size is `formFactor`'s job.
- Keeping trust decisions on the Node. Consent stays per device
  ([plugin bundles](../../security/plugin-bundles.md#consent-is-per-device-and-per-bundle)).
- Push, a native wrapper, and reaching more than one Node at a time.
  [Mobile work after the first release](../mobile/later.md) and
  [remote access](../remote-access/README.md) keep those.

## Starting point

Checked on October 23, 2026, at `74f2decc3`:

- The phone registers the 15 built-in client plugins in `apps/mobile/src/client/plugins.ts` and runs
  the desktop's pane filter, `paneAvailable` in
  `packages/client-core/src/host/registries/panes/panes.ts`.
- `apps/mobile/src/client/platform.ts` implements the `transport` and `fleet` seam groups only, and
  `apps/mobile/src/client/platform.test.ts` pins that list.
- Seven loaded plugins ship with the desktop and the standalone Node: agent-cost, database, http,
  linear, model-providers, rollbar, and sentry-telemetry (`scripts/bundled-plugins.mjs`). Every pane
  they declare is a `remote` tree or a host document. Runn's pane is a `remote` tree too.
- Of the plugins checked, only machine-stats, a project pane, and image markup, an overlay, paint
  their own iframe.
- A frame surface defaults to `formFactor: ['desktop']`
  (`packages/protocol/src/plugin/manifest/surfaces.ts`), and
  `packages/client-core/src/host/frames/register.ts` skips a surface whose list leaves out the
  device's form factor. No plugin lists `mobile`.
- A phone's device may call `GET /v1/core/plugins/:id/bundles/:hash`. The phone rules refuse only
  writes under `/v1/core/plugins`
  ([what a phone device may do](../../relay/phone-channel.md#what-a-phone-device-may-do)). A client
  bundle is at most 8 MiB, and a channel answer at most 16 MiB.
- The terminal draws with xterm.js. Its output reaches the phone as `term:out` frames on the channel.
- [Split phase 10](../split/10-remote-preview-proxy.md) designs the Node's preview proxy route and the
  desktop's path to a remote Node's preview. Neither is built.
- The phone's first screen is 506,975 B of scripts against a 520,000 B ceiling
  ([the phone's budget](../../frontend/startup-budget.md#the-phone)).

## Rules no phase may break

| Rule | Why |
| --- | --- |
| No plugin bytes run on the phone app's origin. | That origin holds the account session and can unseal the device token. |
| A bundle runs only after this phone accepted its exact hash, or when the hash is one the phone build carries. | The same consent the desktop asks for ([plugin bundles](../../security/plugin-bundles.md)). |
| The desktop, the terminal client, and the phone share one set of custody rules. Storage may differ. Decisions don't. | `apps/tui/src/plugins/custody.ts`: a second implementation would be a second set of security decisions. |
| The relay forwards bytes it can't read, Preview included. | [Remote access](../remote-access/README.md#rules-no-phase-may-break) holds the same rule. |
| The `formFactor` default stays `['desktop']`. | A plugin's author decides that a surface works at phone width. |
| The desktop and the terminal client behave as before. | They're the shipped clients. |
| The phone's first screen stays under its ceiling. Code from this programme loads after the first frame. | [The phone's budget](../../frontend/startup-budget.md#the-phone). |
| Hosted-side work goes through the published account API and static files built from this repository. | [Where the code lives](../remote-access/services.md#where-the-code-lives). |

## The phases

| Phase | What works at the end | Depends on |
| --- | --- | --- |
| [1. Terminal](./01-terminal.md) | A terminal pane on the phone, with a row of extra keys. | Nothing. |
| [2. Sandbox origin](./02-sandbox-origin.md) | A test tree bundle draws on a real iPhone from its own origin, with no network. | Nothing. |
| [3. Browser custody](./03-browser-custody.md) | The phone fetches, checks, and keeps bundles, asks for trust, and draws Runn. | 2. |
| [4. First-party plugins](./04-first-party-plugins.md) | Database, HTTP, Rollbar, Linear, and agent-cost on the phone, trusted with no prompt when the releases match. | 3. |
| [5. Pixel frames](./05-pixel-frames.md) | Task panes and overlays that paint their own iframe, such as image markup. | 3. |
| [6. Preview](./06-preview.md) | A task's running app in a Preview pane on the phone, through the Node. | The Node route from split phase 10. |

Phases 1, 2, and 6 can start in any order. Phases 4 and 5 can run in parallel.

## Why this order

- **The terminal first.** It needs no custody and no hosting, and it's the smallest piece that makes
  the phone more useful.
- **The sandbox before custody.** It carries the most risk: it depends on what iOS Safari does with a
  worker started from a `blob:` URL under a header policy, and on a hosted domain and certificate. A
  test bundle proves it before anything depends on it.
- **Custody with a third-party plugin.** Runn takes the prompt path, which every bundle falls back
  to. First-party trust with no prompt is a shortcut on top of it.
- **Preview apart from the rest.** It shares nothing with plugin custody. It waits on split phase
  10's Node route and needs relay and hosted work of its own.

## Decisions

The owner made these on October 23, 2026:

1. All four jobs belong here: installed plugin trees, the terminal, pixel frames, and Preview.
2. Plugin code runs on a subdomain per bundle, on a domain separate from the phone app's, as the
   desktop's `app-plugin://<hash>` does. A self-hoster serves one too.
3. Each plugin opts into phones with `formFactor: ['desktop', 'mobile']`. The default doesn't change.
4. The phone build carries the hashes of the first-party bundles from the same release. A match is
   trusted with no prompt, and a mismatch falls back to the prompt.
5. Preview reaches the phone over TLS that the Node ends, with a certificate the Node gets through a
   DNS challenge that the hosted service answers. The relay passes the bytes through by name.
6. Preview is designed for the phone and for a desktop on a remote Node, with the phone built first.
   Split phase 10 already plans the desktop's path, over the pinned connection it has, so this
   programme builds the phone's and shares phase 10's Node route.

## Rules for every phase

- Steps whose titles start with **Hosted service** happen in the hosted service, not in this
  repository. Open-side steps run against the stand-in account service
  ([test an account service](../../account-api/testing.md)).
- Each phase starts by writing its design section: exact routes, message shapes, header policies,
  and which owning documents change. Put it at the top of the phase file.
- Check UI at 390 by 844 in Playwright WebKit and Chromium, as
  [checking UI work with Playwright](../../mobile.md#check-ui-work-with-playwright) describes. Then
  run the phase's real-device checkpoint on an iPhone and an Android phone.
- Build the phone with `pnpm --filter @acorn/mobile build`, which checks the startup budget. Record the
  first screen's size in the phase's evidence, with the date.
- Run `pnpm lint` and the relevant tests for each slice, and `pnpm test` for the whole suite.
- When a phase touches code the desktop shares, check the desktop in its real window with
  `pnpm dev:agent` ([local development](../../local-development.md)).
- When a phase ships a contract, update the owning document under `docs/` in the same change. Leave
  the phase file as the record of decisions and evidence.
- Answer each phase's open questions, or defer them with a reason, before signing off its acceptance.

## How a checkpoint works

A checkpoint is a manual test that someone runs and records before the phase continues. It names the
setup, the steps, and what you should see. If a checkpoint fails, fix the cause before the next step.
A skipped checkpoint is written down as skipped, with the reason. A real-device checkpoint needs the
owner, because no agent holds a phone.

## Owning documents this programme extends

Before changing code, read [plugin bundles](../../security/plugin-bundles.md),
[the client sandbox](../../security/plugin-client-sandbox.md),
[the plugin frame origin](../../shell/origins.md#the-plugin-frame-origin),
[frames](../../plugins/frames.md), [the mobile web app](../../mobile.md),
[the phone channel](../../relay/phone-channel.md),
[using the app on a phone](../../mobile/phone-setup.md), and the relay protocol in
`apps/relay/PROTOCOL.md`.

## Verify before building

Recheck the starting point against your checkout before each phase. Don't turn a proposal in this
folder into a claim that a feature exists.

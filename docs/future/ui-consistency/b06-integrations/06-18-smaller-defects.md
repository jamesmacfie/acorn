# 06-18. Smaller defects on the integration pages

**Status:** not started. Batch B06. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

Seven small defects on the same pages. Each is local and small. Items a and h need a product call
and are in [deferred.md](../deferred.md).

## Where to see it

Settings › Tools and permissions, Custom agents, Add connection (the GitHub device-code panel, read
from code), a connection's page, Install a plugin, Installed (with an acorn.json that asks for
plugins, read from code), and Sentry export.

## The fix

- **b. The tier checkbox.** Write and Execute tiers are 12-pixel checkboxes beside 52 tool switches
  (`packages/client-core/src/features/settings/AgentToolsSettings.tsx:119-126`). Keep the checkbox,
  because a tier can be partly on, but at md (14). Draw **Read**'s "Always available" (`:112`, a raw
  13px muted span) as a disabled checked checkbox, so the three tiers line up.
- **c. `Chip` used as a label.** `AgentToolsSettings.tsx:174` and
  `plugins/agents/src/client/settings/CustomAgentsSettings.tsx:77` use `Badge size="xs"`, not `Chip`.
- **d. The device-code panel.** `packages/client-core/src/features/settings/connections/AddConnection.tsx:166-177`:
  the raw `<a class="ui-btn">` becomes a `Link`, or a `Button` with `href`. Its `p.muted` lines become
  `Text`. **Cancel** is ghost, not ghost-danger, because cancelling destroys nothing.
- **e. "On" and "Enabled".** `ConnectionPage.tsx:208`: **On** becomes **Enabled**, the word every
  plugin page uses.
- **f. The install form's selects.** `InstallPlugin.tsx:102-110`: drop `width="auto"`, so both
  selects take the full control width.
- **g. `ConfigPluginOffers`.** `packages/client-core/src/features/settings/plugins/ConfigPluginOffers.tsx:14-23`
  becomes a `SettingsSection` "Asked for by acorn.json" with [06-3](./06-3-one-list-row.md) rows. The
  hand-rolled `.plugin-list` grid goes.
- **i. The Sentry provider's label.** `plugins/sentry-telemetry/src/server/provider.ts:52`: "Sentry
  (telemetry export)" becomes "Sentry export", the name the settings page already uses. K5 renamed the
  manifest and left this label for B06.

## Copy

| Item | Where | Current text | Decision | New text |
| --- | --- | --- | --- | --- |
| b | `AgentToolsSettings.tsx:112` | Always available | Rewrite | Always on (a disabled checked checkbox) |
| d | `AddConnection.tsx:166` | Enter this code at the provider, then leave this page open. | Rewrite | Enter this code on the {provider} page. Keep this page open until it finishes. |
| d | `AddConnection.tsx:173` | The provider returned an unsafe sign-in address. Cancel and retry. | Rewrite | {provider} sent a sign-in address acorn won't open. Cancel and try again. |
| d | `AddConnection.tsx:176` | Waiting for approval… | Keep | |
| e | `ConnectionPage.tsx:208` | On / Turning it off pauses it. Its project links stay. | Rewrite | Label **Enabled**. Inline: "Turn it off to pause updates. It keeps the projects it follows." |
| g | `ConfigPluginOffers.tsx:15` | acorn.json requests these plugins. Installing each one still asks for trust. | Rewrite | This computer's acorn.json asks for these plugins. Each one asks for your approval when you install it. |
| i | `provider.ts:52` | Sentry (telemetry export) | Rewrite | Sentry export |

Sentry export's own settings page (`plugins/sentry-telemetry/src/tree/settings.tsx`) has copy rows
that no other finding owns. Apply them with item i:

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `settings.tsx:82` | Nothing is sent until telemetry is on in Settings → Telemetry and a Sentry DSN is connected in Settings → Services. Both, not either. | Rewrite, keep inline | acorn sends nothing until you turn on **Telemetry** and connect Sentry in **Services**. |
| `settings.tsx:84` | Decided per trace, so a transaction keeps its own spans. | Remove | |
| `settings.tsx:33` | A caught or uncaught failure, as a Sentry issue. | Rewrite | Sent as Sentry issues. |
| `settings.tsx:34` | Requests, commands, page changes and schedule runs, as transactions. | Rewrite | Requests, commands, page changes, and schedule runs. |
| `settings.tsx:35` | Lines written by core and by plugins, as structured logs. | Rewrite | Log lines from acorn and its plugins. |
| `settings.tsx:36` | Counters, gauges and the hot-seam histograms, as trace metrics. | Rewrite | Counts and timings from acorn. |
| `settings.tsx:37` | Things that happened with no duration, as logs at info. | Rewrite | One-off events, sent as info logs. |
| `settings.tsx:107` | Paths are collapsed to ~ and to the data root before they leave this machine. | Rewrite | acorn replaces your home folder with ~ in file paths before sending them. |
| `settings.tsx:119` | Lets a Sentry issue be traced back to the task it happened in. Ids only, never a task's contents. | Rewrite | Links a Sentry issue to its task. Only the id is sent, never the task's contents. |

The `settings.tsx:107` wording is the plan's overrule. The area file's "so your folder names aren't
sent" claimed more than the code does.

Item a's page (Workflows settings) has two copy rows that can land while its fate is open:

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `plugins/workflows/src/client/WorkflowsSettings.tsx:39-40` | Loaded workflows / Read-only view of the workflows the active task's worktree would load (…). | Rewrite, split | Inline: "Workflows the open task can run, and any that failed to load." Help: "acorn reads .acorn/workflows in the repo and ~/.acorn/workflows. To write or edit one, open **Workflows** in the left rail. To run one, use the command palette." |
| `WorkflowsSettings.tsx:46` | No workflows found — open a task to scan its worktree. | Rewrite | No workflows found. Open a task to check its worktree. |

## What earlier batches give you

- **Unlabelled checkbox size** (K1b's P5). `Checkbox` puts `data-size` on the input. An unlabelled box
  defaults to sm; pass `size="md"` for 14.

## Risk and checks

- Before you start, confirm the device-code panel still builds its link by hand.
- Item i changes a provider label on the node side. Rebuild the sentry-telemetry bundle and restart
  the node.
- Screens: Tools and permissions (tiers), Custom agents, Install a plugin, Sentry export, and the Add
  connection gallery for item i.
- Tests: client-core, `plugins/agents`, `plugins/sentry-telemetry`, `plugins/workflows`.

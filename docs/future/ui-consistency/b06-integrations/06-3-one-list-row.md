# 06-3. Lists of things take seven shapes, and status shows five ways

**Status:** not started. Batch B06. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

Nine lists on the integration and plugin settings pages each show "a thing you have, whether it
works, and how to change it", and no two share a shape. Status is an 8-pixel dot with only an
`aria-label` in three of them, so a sighted person cannot learn what amber means. Connections and
plugins then repeat the status in their description. Agent CLIs and Harnesses list the same programs
and disagree about them. Status is the one thing a person scans these lists for, and each page
teaches a different way to read it.

## Where to see it

Settings › Services, AI models, Installed, Tools and permissions, MCP config files, MCP servers,
Custom agents, Harnesses and defaults, and a plugin's **Permissions** tab. A connection row only
appears once a connection exists, so read that one from code.

## The fix

One row shape for a list of things on a settings page:

- An inline `SettingRow`. The label is the thing's name. The description is one line saying where it
  comes from or what it is. The status sentence leaves the description.
- The control column holds the status as a toned `Badge` word, then the actions as ghost sm buttons,
  the main one first. Words: **Connected**, **Needs you**, **Off**, **Installed**, **Not installed**,
  **Broad access**.
- When the state is itself the setting, a switch replaces the badge.
- An unusual state goes in the description with a danger badge. It never goes in the row's `error`
  line, because `error` means "the last write failed" (plan decision 12).
- MCP server rows go inline: name, the command as the description, then the switch, **Edit**, and
  **Test**.
- Where a dot stays, give it `StatusDot tip`.

The sites, all under `packages/client-core/src/features/settings/` unless named:

| List | File and lines |
| --- | --- |
| Connections | `connections/ServicesSettings.tsx:32-38` |
| API keys and Agent CLIs | `models/AiModelsSettings.tsx:75-81, 90-95` |
| Installed plugins | `packages/client-core/src/features/settings/plugins/PluginsSettings.tsx:194-201` |
| Harnesses | `plugins/agents/src/client/settings/AgentSessionDefaultsSettings.tsx:115-120` |
| Custom agents | `plugins/agents/src/client/settings/CustomAgentsSettings.tsx:72-86` |
| MCP servers | `plugins/agents/src/client/settings/AgentMcpServersSettings.tsx:183-218` |
| MCP config servers | `McpSettings.tsx:100-118` (with [06-8](./06-8-mcp-pages.md)) |
| Tools | `AgentToolsSettings.tsx:165-186` |
| Plugin permissions | `packages/client-core/src/features/settings/plugins/PluginPage.tsx:317` |

AI models' Agent CLIs should read the same descriptor Harnesses reads, so the two say the same
thing. B01 noted that `AiModelsSettings.tsx:94` still says "Not found on this machine." while
onboarding says **Not installed**.

## Copy

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `connections/connections.ts:41` | Needs you / Not answering / Off / Connected | Keep | As the row's `Badge`. |
| `connections.ts:47` | Connected, one allowed / Connected, {n} allowed | Keep | |
| `connections.ts:51` | acorn could not read the stored credential. Nothing new arrives until it is replaced. | Rewrite | acorn couldn't read the saved key. Replace it to get updates again. |
| `connections.ts:52` | {provider} refused the credential. Nothing new arrives until it is replaced. | Rewrite | {provider} rejected the key. Replace it to get updates again. |
| `connections.ts:54` | {provider} did not answer the last check. acorn keeps trying. | Rewrite | {provider} didn't answer the last check. acorn keeps trying. |
| `connections.ts:56` | Turned off. acorn fetches nothing from it until it is on again. | Rewrite | Off. acorn doesn't fetch anything from it until you turn it on. |
| `AiModelsSettings.tsx:91, 94` | Installed on this machine. / Not found on this machine. | Rewrite | `Badge` **Installed** / **Not installed**. Inline: the version, and "Not signed in" when that is true. |
| `AgentSessionDefaultsSettings.tsx:30-32` | Not installed on this machine. / Installed, {version}. / … Not signed in. | Rewrite first | Not installed on this computer. The rest stays, and Agent CLIs uses the same text. |
| `PluginsSettings.tsx:196` | {version}, built in. Active. | Rewrite | Version {version}, built in. The status moves to a `Badge`. |
| `installed.ts:39-42` | on this device, from … / built in / from … / installed by hand | Rewrite | On this device, from … / Built in / From … / Installed by hand. Keep a lower-case form for use mid-sentence ("Version 1.0.0, built in."). |
| `PluginsSettings.tsx:187` | {node} did not report a plugin list. It may be offline. | Rewrite | {node} didn't send its plugin list. It may be offline. |
| `PluginsSettings.tsx:191` | Nothing needs you. / No plugins held by this device. | Rewrite second | Nothing needs you. / No plugins on this device. |
| `PluginsSettings.tsx:151` | Restart it on its own machine to apply the change. | Keep | |
| `PluginsSettings.tsx:209-210` | Ask an agent to write one / Drafts a prompt in the current task's agent. It writes the package and asks you to install it, and cannot install anything itself. | Rewrite, keep inline | Starts a prompt in the open task's agent. It writes the plugin, and you decide whether to install it. |
| `PluginsSettings.tsx:212` | Create a plugin (button) | Rewrite | Ask an agent |
| `PluginPage.tsx:317` | Broad access (dot label) | Keep | As a `Badge` with the word. |

## Already done

- K5 shows plugin names on the Installed list, sorts by name, and capitalises a line that starts
  with the origin ("Built in. Active."). Row 814 is done.
- K3 added `StatusDot tip`.
- K1b's P6 puts `Row`s inside a settings section on the section edge, and B05 did the same for a
  start-aligned `EmptyState`.

## What earlier batches give you

- **`StatusDot tip`** (K3). An optional string. It is not taken from `label`, so a labelled dot inside
  a tipped rail tab does not steal the tab's tip.
- **`pluginLabel(idOrRow)`** (K5), from `@acorn/plugin-api/client` in a plugin, or
  `packages/client-core/src/host/plugins/public.ts` in core. It falls back to the id.
  `installed.ts` adds `pluginName(plugin)` on top of it.

## Risk and checks

- Before you start, confirm each site above still draws the list the table says.
- The vocabulary rule applies to row 884: "this computer" in static copy. See
  [deferred.md](../deferred.md) for the open product call.
- Screens: every page named under "Where to see it".
- Tests: client-core, `plugins/agents`, `plugins/model-providers`.

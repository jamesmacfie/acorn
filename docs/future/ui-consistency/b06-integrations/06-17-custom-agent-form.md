# 06-17. The custom agent form: small selects, a typed icon name, and an echoing section

**Status:** not started. Batch B06. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

The page is **Custom agents** and its first section is **Custom agents** again. The **Icon** field
asks for "A Lucide icon name, such as bug" in a text box, though the kit has an `IconPicker` that the
task rail already uses. Six selects are 26 high under 32-high inputs in one form. "Acorn tools" is
the only capitalised "Acorn" on the page.

## Where to see it

Settings › Custom agents, then **New agent**.

## Already done

- K1a made **New agent** outline instead of solid, and small through the section-actions rule.
- K5 shows "From {plugin name}" on agents a plugin adds.
- K4a's 03-19 made `IconPicker` rows read as words ("Flask conical") with `IconButton` tools.

## The fix

All in `plugins/agents/src/client/settings/CustomAgentsSettings.tsx`:

- Around `:100`: the section label becomes **Your agents**, beside **From plugins**.
- Around `:237-240`: the **Icon** field becomes `IconPicker`. `null` means the harness icon.
- Around `:265, 281`: selects at md.
- Around `:278`: "acorn tools", lower case.

The form's footer and field layout are [06-5](./06-5-add-and-edit-forms.md)'s.

## Copy

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `:100` | Custom agents (section) | Rewrite | Your agents |
| `:101` | A custom agent is a harness with the settings, instructions, and tool access a session should start on. Each one appears under New in the Agent pane and in the command palette. Editing an agent changes the sessions you start from it later, not the ones already running. | Move to `help`, rewrite | A custom agent starts a session with the harness, settings, instructions, and tool access you choose. It shows under **New** in the Agent pane and in the command palette. Changes apply to sessions you start later. |
| `:108` | No custom agents yet. | Rewrite | No custom agents. |
| `:114` | Agents a plugin adds. Duplicate one to change it. | Keep | |
| `:235` | Shown under the name in New. Leave it empty to show the harness and its settings. | Keep | |
| `:238` | A Lucide icon name, such as bug. Leave it empty to use the harness's mark. | Rewrite | Leave it empty to use the harness's icon. |
| `:255-257` | Open a {harness} session once. The model, effort, and mode it offers appear here after that. | Keep | |
| `:278` | Acorn tools / The most this agent may do with Acorn's own tools. It never widens what Tools and permissions allows. | Rewrite | Label **acorn tools**. Hint: "The most this agent can do with acorn's tools. **Tools and permissions** still applies." |
| `:27-29` | Every tool the session may use / Read and change, no running things / Read only | Rewrite | All allowed tools / Read and write, but don't run anything / Read only |
| `:289` | Added to {harness}'s system prompt for every session started from this agent. | Keep | |
| `:291` | This harness has no system prompt Acorn can add to, so these go in front of the first message instead. A compaction can drop them. | Rewrite | This harness can't take extra instructions, so acorn adds them before your first message. The agent can lose them when it shortens a long conversation. |
| `:310` | Delete agent / Sessions already started from it keep running. | Keep | |
| `:77` | From {plugin} | Rewrite | As a `Badge` (see [06-18](./06-18-smaller-defects.md) item c). The name is done. |

## What earlier batches give you

- **`IconPicker`** (K4a). It claims the nearest `Field`. If a field's caption should name a different
  control, wrap the picker in the `NO_FIELD` provider, as `TabRail.tsx` does for the New task dialog.

## Risk and checks

- Before you start, confirm the stored icon value is a Lucide name, so `IconPicker`'s value round-trips.
- Screens: Custom agents empty, New agent top and bottom.
- Tests: `plugins/agents`.

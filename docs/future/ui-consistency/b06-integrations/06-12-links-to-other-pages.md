# 06-12. Links to another settings page come in four looks

**Status:** not started. Batch B06. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

The same job, "go to that page", is a ghost sm button in one place, a bare sm button 11 to 12 pixels
high in another, and an inline `Link` in a paragraph in a third. A person cannot tell at a glance
which of these leave the page.

## Where to see it

A plugin's page (**Keyboard shortcuts**, **Tools and permissions** on Overview), Tools and
permissions (the owner and plugin links in **By tier**), and a connection's **Where it shows up**
section.

## Already done

- B04 made the plugin strip's **Manage plugin** a ghost sm button (`PluginStrip.tsx:87`).
- K1a gave a bare text button in an action row a 26 height, which helps but does not fix a bare
  button alone in a row's control column.

## The fix

One rule: a link in a row's control column or a section's actions is a ghost sm button named after
the page. A link inside a sentence is a `Link`. Nothing is bare.

Sites:

- `packages/client-core/src/features/settings/plugins/PluginPage.tsx:198, 203`
- `packages/client-core/src/features/settings/AgentToolsSettings.tsx:156, 176`
- `packages/client-core/src/features/settings/ConnectionProjectMap.tsx:191`

The two MCP cross-references become section-action links in [06-8](./06-8-mcp-pages.md).

## Copy

`ConnectionProjectMap.tsx` rows. B05's 05-10 turned the map into a small table; check what it left
before you apply these.

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `ConnectionProjectMap.tsx:123` | Followed projects (row label on the connection's page) | Remove | The section is **Where it shows up**. |
| `ConnectionProjectMap.tsx:128` | Pick a workspace to follow a project everywhere in it, or one repository to follow it there alone. | Rewrite, keep inline | Follow a project in a whole workspace, or in one project only. |
| `AgentToolsSettings.tsx:176` | Manage the {plugin id} plugin (tip) | Rewrite | Manage {plugin label} (K5 may have done this; check). |

## Risk and checks

- Before you start, grep each site for `variant="bare"` to confirm it is still bare.
- Screens: a plugin page's Overview, Tools and permissions in **By tier**, and a connection's page
  (from code if no connection exists).
- Tests: client-core.

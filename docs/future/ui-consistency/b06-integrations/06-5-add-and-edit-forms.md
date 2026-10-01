# 06-5. Five add-and-edit forms, three field layouts, three button orders

**Status:** not started. Batch B06. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

Add connection, Replace key, Install a plugin, New MCP server, and New custom agent are each a whole
settings page for one job: fill in some fields and save. They use three field layouts and put their
buttons in three places. Add connection's **Save** sits 8 below its last input while its fields sit 17
apart, so the buttons look like part of the last field. Five forms a click apart look like the work
of five teams, and someone who learns where **Save** is on one looks in the wrong place on the next.

## Where to see it

- Settings › Services › **Add connection**, then a key provider such as Sentry.
- A connection's page › **Replace key** (needs a connection; read from code otherwise).
- Settings › Installed › **Install…**.
- Settings › MCP servers › **Add server**.
- Settings › Custom agents › **New agent** (the form itself is [06-17](./06-17-custom-agent-form.md)).

## Already done

- B01 made Add connection's primary a solid **Connect** with the button's own busy spinner. The
  replace-key form keeps **Save**.
- K1a stopped a `SegmentedControl` (class `.ui-segments`) and buttons from stretching in a stacked
  `Field`.
- K4b wrote the page-form rule in `docs/frontend.md` § Forms and flows.

## The fix

The page-form shape (plan decision 1): `Field`s in a `Stack gap="stack"`, label over control, md
controls, then a left-aligned `Inline gap="row"` under the last field with the one `solid` primary
first and **Cancel** as `ghost`. Errors go between the last field and the buttons.

- `packages/client-core/src/features/settings/connections/AddConnection.tsx:131-149` and
  `ConnectionPage.tsx:156-175`: put the error on the same side in both (between the fields and the
  buttons).
- `packages/client-core/src/features/settings/plugins/InstallPlugin.tsx:94-128`: **Install** becomes
  solid.
- `plugins/agents/src/client/settings/AgentMcpServersSettings.tsx:278-339`: the right-hand
  `Toolbar variant="actions"` becomes the left `Inline`.
- `plugins/agents/src/client/settings/CustomAgentsSettings.tsx:265, 281`: selects at md, actions on
  the left.
- `docs/frontend.md` § Forms and flows: add two short examples, the page form (this finding) and the
  boxed form (B05's Nodes pairing card and run target form: a `Card` of `Field`s with a "Step N of 3"
  line and the same left footer).

The area file also proposed one shared `CredentialFields` component for Add connection and Replace
key, so the two cannot drift. The plan does not require it. Do it if the two loops are still copies.

## Copy

Add connection rows owned by other findings: the title and the gallery are
[06-10](./06-10-services-and-ai-models.md); the device-code panel is
[06-18](./06-18-smaller-defects.md). Row 638 (**Connect**) is done.

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `AddConnection.tsx:124` | {provider} shows a page where you enter a code from here. | Rewrite, keep inline | {provider} opens a page in your browser where you enter a code. |
| `AddConnection.tsx:125` | acorn checks them with {provider} before it keeps them. | Rewrite, keep inline | acorn checks with {provider} before it saves anything. |
| `plugins/sentry-telemetry/src/server/provider.ts:72` | Sentry → Settings → Projects → your project → Client Keys. The DSN stays encrypted on this machine. | Rewrite | Sentry → Settings → Projects → your project → Client Keys. acorn stores it encrypted. |
| `provider.ts:80` | Tags everything this node sends. Sentry defaults it to production when it is blank. | Rewrite | Added to everything acorn sends. Leave it blank to use production. |
| `provider.ts:88` | Optional. No source maps are uploaded, so this only groups what you send. | Rewrite | Optional. Groups what you send by version. |
| `ConnectionPage.tsx:100` | The test did not pass. ({code}) | Rewrite | The test failed. Error code: {code}. |
| `ConnectionPage.tsx:112` | acorn deletes its stored credentials, its project links, the issues it cached, and the links from tasks to those issues. | Rewrite | acorn deletes the saved key, the projects it follows, the issues it saved, and the links from tasks to those issues. A sign-in connection says "saved credentials". |
| `ConnectionPage.tsx:155` | New {provider} credentials / acorn checks them with the provider before it keeps them. | Rewrite | Label **Replace key** (**Replace credentials** for a sign-in connection). Inline: "acorn checks with {provider} before it saves the new key." |
| `ConnectionPage.tsx:196-199` | Credentials / Connected. Test asks the provider whether they still work. | Rewrite | Label **Key** for a key connection, **Credentials** for a sign-in one. Inline: "Test checks that {provider} still accepts it." |
| `ConnectionPage.tsx:224` | Disconnect / Deletes its stored credentials and its project links. | Rewrite, keep inline | Deletes the saved key and the projects it follows. You can connect it again later. |
| `ConnectionPage.tsx:113, 149, 184, 185` | (four lines) | Keep | |
| `AgentMcpServersSettings.tsx:280` | A server keeps its name. Remove it and add it again to rename it. / What agents and the session panel call it. | Keep | |
| `AgentMcpServersSettings.tsx:299` | Found on the PATH agents run with, or give a full path. | Rewrite | A program on your PATH, or its full path. |
| `AgentMcpServersSettings.tsx:302` | One per line. | Keep | |
| `AgentMcpServersSettings.tsx:306` | Mark a value secret to store it encrypted. acorn never shows it again, and a stored secret left empty keeps its value. | Rewrite | Secret values are stored encrypted and never shown again. Leave a saved secret empty to keep it. |
| `AgentMcpServersSettings.tsx:266-268` | Discard unsaved changes? / The changes to this server that are not saved yet. | Rewrite | Discard unsaved changes / Your unsaved changes to this server. |
| `AgentMcpServersSettings.tsx:342` | Remove server / Every session drops it the next time it starts. | Keep | |
| `InstallPlugin.tsx:94` | Install a plugin (section) | Rewrite | Package |
| `InstallPlugin.tsx:98` | Its server code runs in an isolated, permission-scoped realm on the node. This device asks again, showing its enforced grants, before any of its interface code runs here. | Move to `help` on **Install on**, rewrite | Its server code runs on the node with only the permissions it asks for. This computer asks you again before it runs any of the plugin's screens. |
| `InstallPlugin.tsx:99` | A client-only plugin runs from a bundle this device holds. It cannot have server code, and every new bundle asks for trust. | Move to `help`, rewrite | A plugin on this computer has no server code. You approve every new version. |
| `InstallPlugin.tsx:118-121` | A folder is linked, not copied. Whatever is in it when the node next starts is what runs, and acorn cannot pin those bytes the way it pins a downloaded package. | Rewrite, keep inline | acorn links to this folder instead of copying it. Whatever is in it when the node starts is what runs, so acorn can't check it the way it checks a download. |

The plan's overrule on rows 663, 666, 669, and 671: a sign-in connection shows **Credentials**, not
**Key**. Only key connections say "key". K4b already dropped the "?" from the Disconnect dialog title.

## What earlier batches give you

- **`Field help`** (K3), for text that explains rather than says what to type. `hint` stays the place
  for what to type.
- **`Field` names only its caption** (K3). The caption is a `<label for>` its control, and hint, error,
  and help describe it.

## Risk and checks

- Before you start, read both credential loops and confirm they still match each other.
- Check every form for a stretched control after the change.
- Screens: Add connection for Sentry, AI models › Connect OpenAI, Install a plugin, New server, and
  New agent. Do not type a real key.
- Tests: client-core, `plugins/agents`, `plugins/sentry-telemetry`. Rebuild the sentry-telemetry
  bundle to see its hints.

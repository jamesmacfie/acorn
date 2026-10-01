# 06-10. Services and AI models: a section that only points away, and a page with the wrong title

**Status:** not started. Batch B06. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

Services has an **AI models** section whose only job is to say the keys are on the next page, though
the rail lists AI models right under Services. **Add a key** on AI models opens a page titled **Add
connection**, because the gallery is shared, so the button and the page it opens disagree. **Generate
with** squeezes two selects into the 288 control column on AI models, while Review after archive
draws the same picker stacked at full width. Both selects name themselves only with a native `title`.

## Where to see it

Settings › Services; Settings › AI models and its **Add a key**; Settings › Review after archive
(findings plugin, a remote tree).

## The fix

- `packages/client-core/src/features/settings/connections/ServicesSettings.tsx:43-47`: delete the
  **AI models** section. In `packages/client-core/src/features/settings/corePages.ts` (around
  `:97-103`), point the "api key" keywords at the AI models page, so a search still lands there.
- `AddConnection.tsx:82-97`: the gallery takes a title. "Add an API key" with a **Providers** section
  when opened from AI models; "Add connection" when opened from Services.
- `packages/client-core/src/features/settings/models/ModelBackendPicker.tsx:40-64`: `layout="stacked"`
  rows wherever there are two selects. Both selects take `label` instead of `title` (`:44`, `:56`),
  which gives them an accessible name. The picker also draws on the findings settings page.
- `models/AiModelsSettings.tsx:72, 87`: `EmptyState size="sm"`.

## Copy

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `ServicesSettings.tsx:22` | The services acorn reads issues, errors, and pull requests from. | Move to `help` on **Connections**, rewrite | Services acorn reads issues, errors, and pull requests from, such as GitHub, Linear, and Rollbar. |
| `ServicesSettings.tsx:27` | Nothing connected yet. Add a connection to see its items in the rail. | Rewrite, keep inline | Nothing connected. Add a connection to see its issues and errors in the rail. |
| `ServicesSettings.tsx:43-44` | AI models / Keys for generating text / … / Open AI models | Remove | The section goes. |
| `AddConnection.tsx:83` | Add connection (page title) | Rewrite | "Add an API key" when opened from AI models. |
| `AddConnection.tsx:96` | Pick one to see what it asks for. | Remove | Each card says what it asks for. |
| `AddConnection.tsx:97` | No provider on this node can be connected. A plugin adds them. | Rewrite | No services can be connected here. Plugins add them. |
| `AiModelsSettings.tsx:52` | Commit messages, SQL, and workflows are written with whichever of these you pick. A key is spent from the node. An installed agent signs in on its own, and acorn never passes it a key. | Move to `help` on **Generating text**, rewrite | acorn writes commit messages, SQL, and workflow drafts with the model you pick. An API key is billed to that key. An agent CLI uses its own sign-in. |
| `AiModelsSettings.tsx:58` | Nothing to generate with. Add a key, or install an agent CLI. | Keep | |
| `AiModelsSettings.tsx:72` | No key on this node. Add one to generate with a provider such as Anthropic or OpenAI. | Rewrite | No API keys. Add one from Anthropic or OpenAI. |
| `AiModelsSettings.tsx:86` | Agent programs on this machine that can write a one-off answer. Each signs in on its own. | Move to `help` on **Agent CLIs**, rewrite | Command-line agents on this computer, such as Claude Code. Each one uses its own sign-in. |
| `AiModelsSettings.tsx:87` | No agent CLI offers one-off answers here. | Rewrite | No agent CLIs found on this computer. |
| `ModelBackendPicker.tsx:61` | Could not refresh this CLI's model list. Saved choices are kept. | Rewrite | Couldn't refresh this CLI's models. Your choice is kept. |
| `ModelBackendPicker.tsx:33` | Use {backend} default | Keep | |
| `plugins/findings/src/tree/FindingsSettings.tsx:59` | Findings quietly records bounded evidence at completion boundaries. Recording does not run a model. Closing a task queues the review in the background, and a preparation failure never changes task or workflow success. | Move to `help`, rewrite | When you archive a task, acorn keeps a short record of it. A model runs only when it prepares suggestions, in the background. If that fails, your task and workflow results don't change. |
| `FindingsSettings.tsx:61` | A model backend and review target are needed to prepare suggestions. Findings will still be recorded. | Rewrite, keep inline | To get suggestions, choose a review model and where they go. acorn still keeps a record of each archived task. |
| `FindingsSettings.tsx:62` | Prepare suggestions when I archive a task | Keep | |
| `FindingsSettings.tsx:69` | Using {backend}. | Remove | The select says it. |
| `FindingsSettings.tsx:84` | Notify me when a prepared review bundle is ready | Rewrite | Notify me when suggestions are ready |

The `FindingsSettings.tsx:61` wording follows the plan's overrule: it matches the Memory page's
"To get suggestions, choose a review model and where they go."

## Risk and checks

- Before you start, confirm the search keywords on the AI models page still find "api key".
- The `ModelBackendPicker` change reaches the findings settings page and the Generate SQL dialog
  ([11-13](../b11-tool-panes/11-13-save-dialogs.md)). Shoot both.
- Rebuild the findings bundle to see its page change.
- Screens: Services, AI models, AI models › Add a key, Review after archive.
- Tests: client-core, `plugins/findings`, `plugins/model-providers`.

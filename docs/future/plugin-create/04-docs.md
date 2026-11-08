# Phase 4: the docs

Date: November 9, 2026. Status: proposed. Depends on phase 3. Context:
[the programme README](./README.md).

## Goal

Every page that describes the **Create a plugin** buttons describes the new modal, and the scaffold
route has an owning page.

## Starting point

- `docs/plugins/agent-install.md` § Teaching the agent (around lines 94-118) describes the current
  button. It says "It doesn't open a new task, because `TaskSeed` has no prompt field and Settings
  has no project in scope." That stops being true.
- These site pages mention the buttons:
  - `apps/site/src/content/docs/docs/settings/plugins.md`
  - `apps/site/src/content/docs/docs/build-plugins/start/have-your-agent-build-it.mdx`
- `docs/future/README.md` lists every programme in its table.

## Steps

1. In `docs/plugins/agent-install.md`:
   - Rewrite § Teaching the agent for the modal.
   - Document `POST /v1/core/plugins/scaffold` beside `/install`: its fields, the empty-folder rule,
     the git step, and its device-only gate.
2. Update the two site pages so they describe what a person types and sees.
3. Check `apps/site` builds. Its scripts check page budgets and runtime names.
4. In `docs/future/README.md`, mark the programme's status. When every phase has landed, remove this
   folder and the row, as other finished programmes were.

## Acceptance

- `grep -rn "Ask an agent" docs apps/site/src` shows only text that matches the new flow.
- The site builds.

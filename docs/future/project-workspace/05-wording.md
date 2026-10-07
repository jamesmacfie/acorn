# Phase 05: wording

Date: October 7, 2026. Status: planned; implementation not started. Dependencies: [phase 02](./02-desktop-chrome.md).
Read the [plan](./README.md) first, especially [decision](./README.md#decisions) 7.

## Deliverable

While workspaces are off, nothing the desktop or a first-party plugin shows says "workspace". One
helper picks the word, and plugins reach it through `plugin-api`.

## Steps

1. Add the helper in `packages/client-core/src/features/workspaces/`, using the mode accessor from
   phase 02. It returns the word in the forms the strings need: singular, plural, and capitalized.
   Keep it to the forms that callers use.
2. Export it from `packages/plugin-api/src/client.ts`, beside `workspaceForProject` at line 185.
3. Find the strings. This search finds about 235 lines in core, plugins, and the terminal client,
   with some false positives:

   ```sh
   git ls-files plugins packages/client-core/src apps/tui/src | grep -E '\.tsx?$' | grep -v test \
     | xargs grep -n -E "['\"\`>][^'\"\`<]*\b[Ww]orkspace\b[^'\"\`<]*['\"\`<]"
   ```

   Ignore identifiers, query keys, route paths, and comments. Change only text a person reads.
4. Replace the strings in core first:
   - Palette commands and their keybinding descriptions, such as `core.goto.workspace-last` ("Switch
     to the last workspace", Cmd+;) in `apps/desktop/src/client/App.tsx:150`.
   - The **Add project** hint "from a folder, into this workspace" (`App.tsx:119`).
   - The rail toast "This workspace has no visible projects yet" (`TabRail.tsx:264`).
   - Home, Archive, and dashboard text.
5. Then the first-party plugins: notes scope labels, Agent Center filters and empty states, workflows,
   GitHub, Linear, and Rollbar empty states.
6. Leave the terminal client's strings to [phase 06](./06-terminal-client.md). It uses the same
   helper.
7. Leave command IDs and preference keys as they are. Only the words change.
8. Note the helper in the plugin docs, beside the other workspace helpers in
   `docs/plugin-authoring/` or `docs/plugins/`, wherever `workspaceForProject` is documented.

## Acceptance

- Existing tests pass, with string assertions updated to read through the helper or to cover both
  modes.
- In `pnpm dev:agent -- --session pw-words --workspaces off`, walk the topbar, rail, palette, Home,
  Agent Center, notes, workflows, Settings, and the archive. Check each snapshot for "workspace". None
  should appear.
- The same walk with `--workspaces on` reads as it does today.
- `pnpm lint` and `pnpm test` pass, because this phase touches many packages.

## Verify before building

- Which strings plugins build on the Node side, such as agent tool descriptions and notice text. The
  helper is client-side, so Node-side text needs the mode from phase 01 or a neutral word.
- Whether any loaded plugin outside this repository imports the strings you change. Loaded plugins
  only see `plugin-api`, so a new export doesn't break them.

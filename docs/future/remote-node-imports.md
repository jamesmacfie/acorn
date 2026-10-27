# Remote Node imports: clone and link with a typed folder

Date: October 27, 2026. Status: implemented October 27, 2026. The live checks under Acceptance, on a
remote Node, remain open.

With a remote Node selected, such as a homelab, the GitHub, GitLab, and Bitbucket importers list the
Node's repositories but won't import any of them. Each one says "Choose the local Node to import
from GitHub." This plan gives each importer a typed folder field on a remote Node, so **Clone** and
**Link folder** work there the way they work on the local Node.

[Projects](../workspaces-and-tasks/projects.md) owns how folders reach a Node.
[GitHub](../github-integration.md) owns the importer. Both pages win if this plan disagrees with
them, and both change when it lands.

## Why the importers refuse

Each importer asks for a folder before it writes anything. **Clone** asks for the folder to clone
into. **Link folder** asks for the checkout that's already there. It gets that folder from
`pickNodeFolder` (`packages/client-core/src/features/workspaces/addProject.ts`), which opens the
desktop's native folder dialog. That dialog browses the desktop's own disk, so `pickNodeFolder`
returns `null` for any Node that isn't on this machine. A desktop path must never reach a remote
Node. The importers check `canAddProjectFromFolder()` first, and on a remote Node they hide the
buttons and show the refusal.

The refusal is in the client only. The Node's import routes take a plain path:

- `plugins/github/src/server/routes/repos/import.ts`, and the matching GitLab and Bitbucket routes,
  take `path` for `map` and `parentDir` for `clone`.
- Each route rejects a path that isn't absolute. `map` then goes through core's `createProject`,
  which rejects a folder that doesn't exist.
- Each route requires a paired device. A task token gets `403 interactive_user_required`.

A typed path adds no new authority. The owner can already type any folder on the Node into
**Add project**.

## Decisions

- **Follow the typed-folder pattern the app already uses.** Two screens already handle a remote Node
  with an inline `NodePathForm` instead of the native dialog. The projects table opens one in the
  row when you press **Add folder** (`ProjectTable.tsx`, `typingFolder`). Project settings draws one
  in place of the **Change folder** button (`ProjectSettings.tsx`). The importers do the same: on a
  remote Node, pressing **Clone** or **Link folder** opens a `NodePathForm` in that repository's row.
  The local Node keeps the native dialog.
- **Not a dialog inside `pickNodeFolder`.** An earlier analysis suggested making `pickNodeFolder`
  ask for a typed path itself. It has 10 callers, and two of them already draw their own inline
  form, so they'd ask twice. The app also has no dialog that takes typed text, only
  `confirmAction`. The inline form needs neither change.
- **Export `NodePathForm` to plugins.** The importers are plugins and import UI from
  `@acorn/plugin-api/ui`, which doesn't offer it. Adding it to that surface is additive: one export
  and the line in `packages/plugin-api/src/surface.snapshot.txt`. Three plugins don't each rebuild
  the same field and button.
- **Fill in the last folder.** **Clone** starts with the last folder typed for **Clone** in the open
  importer, so cloning five repositories into `/home/james/src` means typing it once. **Link
  folder** starts empty, because each checkout's folder is different.
- **The Node reports a missing clone folder by name.** A `clone` into a folder that doesn't exist
  fails today with `spawn git ENOENT`, because the folder is the process's working directory. That
  reads as if Git isn't installed. Each clone route checks the folder first and answers
  "That folder doesn't exist on this Node." The desktop dialog only ever returns real folders, so
  nobody saw this until a typed path could reach the route.

## Changes

1. Export `NodePathForm` from `@acorn/plugin-api/ui` and update the surface snapshot.
2. In `GithubImporter.tsx`, `GitlabImporter.tsx`, and `BitbucketImporter.tsx`:
   - Show the repository list whenever the code host is connected, and delete both refusal lines.
     A host with no folder dialog, such as a browser, gets the typed field even on the local Node.
   - Split `importOne` into asking for the folder and sending the import. When
     `canPickNodeFolder(nodeId)` is true, ask with `pickNodeFolder` as today. Otherwise, set the row
     and action being typed, and draw a `NodePathForm` in that row with the action as its button
     label. Its submit sends the import.
   - Keep the "The active Node changed" check between asking and sending.
3. In each import route, check that `parentDir` is a folder before `git clone`, and fail with the
   message above.
4. Update [Projects](../workspaces-and-tasks/projects.md), which says the GitHub importer refuses
   its picker action for a remote Node, and [GitHub § Importing projects](../github-integration.md#importing-projects),
   which says both actions ask through the dialog.

## Acceptance

Run these with a remote standalone Node, or `pnpm dev:remote`, signed in to GitHub on that Node.

- With the remote Node selected, the importer lists repositories and shows **Clone** and **Link
  folder** on each row.
- **Clone** opens a folder field in the row. Typing an existing folder on the Node clones there, the
  project appears, and the row says it's imported.
- **Clone** on the next row starts with the same folder filled in.
- **Link folder** with the path of an existing checkout on the Node links it, and fills in a
  placeholder project for that repository instead of adding a second one.
- A relative path, `~/src`, and a folder that doesn't exist each fail in the row with a readable
  message, and nothing is written.
- Switching Node while a row's field is open drops the field and imports nothing.
- With the local Node selected, both actions still open the native dialog.
- The same checks pass for GitLab and Bitbucket against their fake APIs.

Unit tests: each importer's test for the typed path on a remote Node and the dialog on the local one,
and each route's test for the missing clone folder.

## Not in this plan

- **Private repositories on a remote Node.** `clone` runs `git clone https://<host>/<owner>/<name>.git`
  with prompts off, using whatever Git login the Node's machine has. It doesn't use the importer's
  GitHub sign-in. A homelab with no saved Git credentials can clone public repositories and fails on
  private ones with "could not read Username." Passing the plugin's token to that one clone is a
  separate change with its own security review. Check a private clone on the homelab first.
- **`~` in a typed path.** Only the Node knows its home folder. Expanding `~` belongs in core's path
  checks for every typed folder, not only the importers.
- **Browsing the Node's folders.** No route lists a remote Node's folders. A typed path is enough for
  the owner of the machine.
- **The first-run wizard's folder card**, `OnboardingWizard.tsx`, which stays disabled on a remote
  Node. Its code host step uses the importers, so it gains this change.
- **Trellis's Turn into plugin**, which also hides its button on a remote Node.

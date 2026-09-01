# Phase 4: the shell's keyboard contract

Shipped 2026-09-02. [docs/tui.md](../../tui.md) § Navigation owns where Escape goes, which region
opens the screen, and which source a workspace starts on; § A descriptor source's list owns the title
filter. [focus-model.md](./focus-model.md) still holds the target the last two phases build towards.

`apps/tui/src/chrome/topology.ts` (new) is the shell's whole arrangement — `home`, `opensOn`, `skips`
— and the one file in the chrome that names a region by string anywhere but where it declares one.
The Rail's defaulting effect moved into `chrome/model.ts` as `defaultSource()`, so the Rail is a
component that draws. `chooseWorkspace`, `chooseProject` and the defaulting effect each schedule a
settle, which is what took the polling loop out of `workspaceFocus.test.tsx`.

## Where the design changed, and why

Four requirements did not survive contact.

1. **The topology is a constant, not a factory.** Requirement 1 said "builds the `Topology` from the
   shell model". It needs nothing from the model: `home` asks the source registry whether the selected
   source draws a list, and `opensOn` asks `selectedSource()` and `activeTaskId()`. Both read their
   signals when the keys module calls them, so the file exports one object and `Shell.tsx` installs
   it. A factory taking a model it never reads is a parameter the next person has to disprove.
2. **Requirement 8 was already done.** Phase 1 replaced `takeFocus`'s two microtasks with settle
   steps 4a and 4b. This phase only confirmed it.
3. **The `chrome.test.tsx` case in the Tests section is `workspaceFocus.test.tsx`.** The phase asked
   for a `w`-then-second-workspace case in `chrome.test.tsx`. That file cannot have one: the shell's
   QueryClient survives a render on purpose, so changing fixture workspaces inside it reuses the
   roster an earlier case cached — which is the reason `workspaceFocus.test.tsx` is a file of its own,
   written at the top of it. It already makes exactly the two assertions requirement 6 asks for, and
   it now makes them after one `until` instead of twenty polls. `chrome/topology.test.ts` (new) pins
   the four `home` cases and `opensOn` directly, which a render test would need five regions to say.
4. **The filter field is drawn only once there is a list to filter.** Requirement 9 read as an
   always-present field. Entering a region lands on its first collection row, else on its first stop,
   so a field above an empty list takes the keys the moment the panel opens — and `j` types a `j`,
   which is the exact bug `entryStop` exists to prevent. It is also two walks rather than one: `↓`
   walls at the last stop, Escape does not, so a filter matching nothing still lets a reader out of
   the panel.

`Rail.tsx` keeps one `createEffect`, against the acceptance's letter: `requestTaskAnnotations` over
the ids on screen. It writes no focus and no selection — it asks the other plugins what they have to
say about these rows — and moving it would put a rendering question in the model.

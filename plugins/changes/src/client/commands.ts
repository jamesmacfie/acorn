import type { RemoteAction } from './model'

// The commands the panel answers to: the two the commit editor holds chords for, and the three remote
// verbs as palette rows.
//
// Data rather than registration calls, so the ids, the scope and the chords are a table test and the
// model is the only thing that owns their lifetime (./changesModel.tsx). Neither chord is handled in
// the pane: a pane that installed a key handler of its own would reach neither Settings → Shortcuts
// nor the cheat sheet, and could not be rebound
// (docs/command-palette-and-shortcuts.md § Focus and typing).

/** The pane both bindings are scoped to. The pane contribution's id, which is what the host writes
 *  into `focusedPane` (./paneContribution.ts). */
export const CHANGES_PANE = 'changes'

export const COMMIT_COMMAND = 'changes.commit'
export const AMEND_COMMAND = 'changes.amend'

/** One row as this plugin declares it. Spelled out rather than inferred, so the commit pair and the
 *  remote rows are one type and a test can read `palette` off either. The host's own command type is
 *  wider than a plugin needs; what is here is what these five set. */
type ChangesCommand = {
  id: string
  title: string
  hint?: string
  category: 'action'
  keywords?: readonly string[]
  palette?: boolean
  scope?: 'task'
  when?: () => boolean
  run: () => void
}

/** The three remote verbs a reader can reach by typing. Force push is not among them: it is armed in
 *  the menu because arming is the prompt, and a palette row that ran on Enter would have none. */
const REMOTE_ROWS: { id: string; action: RemoteAction; title: string; hint: string }[] = [
  { id: 'changes.fetch', action: 'fetch', title: 'Fetch from origin', hint: 'ask the remote what has moved' },
  { id: 'changes.pull', action: 'pull', title: 'Pull this branch', hint: 'fast-forward only' },
  { id: 'changes.push', action: 'push', title: 'Push this branch', hint: 'and set its upstream' },
]

/**
 * The commit pair, then the remote rows.
 *
 * The commit pair is not in the palette: both act on the text in a field, so a reader who reached one
 * from a list of commands would be committing a message they cannot see. The remote three are, because
 * a fetch needs nothing typed and nothing selected.
 *
 * `inPane` is what makes the remote rows pane-scoped. A command has no `pane` field — that belongs to
 * a keybinding — so the gate is a `when` over the host's `focusedPane`, which the model closes over.
 */
export const changesCommands = (run: {
  commit: () => void
  amend: () => void
  remote: (action: RemoteAction) => void
  inPane: () => boolean
}): ChangesCommand[] => [
  { id: COMMIT_COMMAND, title: 'Commit the working tree', category: 'action' as const, run: run.commit },
  { id: AMEND_COMMAND, title: 'Amend the last commit', category: 'action' as const, run: run.amend },
  ...REMOTE_ROWS.map((row) => ({
    id: row.id,
    title: row.title,
    hint: row.hint,
    category: 'action' as const,
    keywords: ['git', 'remote', 'origin'],
    palette: true,
    scope: 'task' as const,
    when: run.inPane,
    run: () => run.remote(row.action),
  })),
]

/**
 * `meta+enter` commits and `meta+alt+enter` amends, while the keys are in the message field.
 *
 * `meta+enter` is the `commit` chord in the closed intent set, which is why it reads as the obvious
 * one. `meta+alt+enter` is not the `meta+shift+enter` that Zed uses, because core spent that chord on
 * `core.surface.toggle-maximize` (apps/desktop TaskView) and two bindings on one chord means one of
 * them registers nothing at all.
 *
 * `active` is the field's own focus rather than the pane's. A pane is wider than its editor, and
 * `meta+enter` inside the diff column's comment box is that box's business.
 */
export const changesBindings = (editorFocused: () => boolean) => [
  {
    id: COMMIT_COMMAND, command: COMMIT_COMMAND, description: 'Commit', category: 'Changes',
    defaultChord: 'meta+enter', when: 'pane' as const, pane: CHANGES_PANE, active: editorFocused,
  },
  {
    id: AMEND_COMMAND, command: AMEND_COMMAND, description: 'Amend the last commit', category: 'Changes',
    defaultChord: 'meta+alt+enter', when: 'pane' as const, pane: CHANGES_PANE, active: editorFocused,
  },
]

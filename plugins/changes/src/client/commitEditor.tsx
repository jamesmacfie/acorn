import { Button, Icon, Menu, Textarea } from '@acorn/plugin-api/ui'
import type { ChangesModel } from './changesModel'

// The commit editor's shared parts: the field, the options menu, and the two strings that describe
// what pressing the button will do.
//
// Their own module because two surfaces draw them — the footer in ./ChangesPane.tsx and the expanded
// ./CommitModal.tsx — and the footer imports the modal, so anything both need cannot live in either.

/** The menu's own context, as its children are handed it. Read off `Menu` rather than restated,
 *  because the type is not on the plugin surface and a copy here would be a second one to keep. */
type MenuContext = Parameters<Parameters<typeof Menu>[0]['children']>[0]

/** What the commit button says. `Amend` wins over the mode, because an amend is what the press will
 *  do whatever is staged. */
export const commitButtonLabel = (model: ChangesModel): string => {
  if (model.amend()) return 'Amend'
  return model.commitMode() === 'tracked' ? 'Commit tracked' : 'Commit'
}

/** The tooltip's first line: what pressing the button does to the tree, where `gitCommitLine` below
 *  is the command it does it with. */
export const commitButtonTip = (model: ChangesModel): string => {
  if (model.amend()) return 'Rewrite the last commit'
  return model.commitMode() === 'tracked' ? 'Commit every tracked change' : 'Commit what is in the index'
}

/** The git command the button is about to run, for the button's own hint.
 *
 *  Written out rather than summarised, because the difference between a commit and a commit with
 *  `-a` is the whole reason the label changes, and this is the one place a reader can see it. */
export function gitCommitLine(model: ChangesModel): string {
  return [
    'git commit',
    ...(model.commitMode() === 'tracked' ? ['-a'] : []),
    ...(model.amend() ? ['--amend'] : []),
    ...(model.signoff() ? ['--signoff'] : []),
    ...(model.noVerify() ? ['--no-verify'] : []),
    '-m',
  ].join(' ')
}

/** The message field, bound to the draft on the pane's model.
 *
 *  `onField` rather than `ref`: a prop of that name becomes a DOM ref setter on a Solid component
 *  and the caller's function never runs, which an arch rule refuses outright. */
export function CommitField(props: {
  model: ChangesModel
  rows: number
  grow?: boolean
  onField?: (element: HTMLTextAreaElement) => void
}) {
  const model = () => props.model
  return (
    <Textarea
      rows={props.rows}
      grow={props.grow}
      mono
      label="Commit message"
      placeholder="Commit message"
      value={model().draft()}
      ref={props.onField}
      onInput={(value) => model().setDraft(value)}
      // Which field the keys are in is what gates the two chords: they are pane-scoped bindings and
      // a pane is wider than its editor (./commands.ts).
      onFocus={() => model().setEditorFocused(true)}
      onBlur={() => model().setEditorFocused(false)}
    />
  )
}

/** Amend, sign-off, and skip git hooks.
 *
 *  No heading above the run and no rule between the items. `Menu.Label` and `Menu.Separator` are
 *  DOM-only halves of `Menu` and the terminal host's table has neither
 *  (apps/tui/src/kit/components.tsx), so a heading here would be a footer that draws on one of the
 *  two hosts. Each label says what it turns on instead, and the leading `○` or `◉` says whether it
 *  is on, which is the same mark the view menu uses for the same reason.
 *
 *  The menu stays open on a press, because these are three switches and a reader who wants two of
 *  them should not have to open it twice. */
export function CommitOptionsMenu(props: { model: ChangesModel }) {
  const model = () => props.model
  const Toggle = (own: { menu: MenuContext; on: boolean; hint: string; onSelect: () => void; children: string }) => (
    <Menu.Item
      context={own.menu}
      closeOnSelect={false}
      leading={<Icon name={own.on ? 'circle-dot' : 'circle'} title={own.on ? 'On' : undefined} />}
      title={own.hint}
      onSelect={own.onSelect}
    >
      {own.children}
    </Menu.Item>
  )
  return (
    <Menu
      ariaLabel="Commit options"
      placement="bottom-end"
      trigger={({ open, toggle }) => (
        <Button
          variant="bare"
          size="sm"
          label="Commit options"
          title="Amend, sign-off, and skipping git's hooks"
          opens="menu"
          expanded={open()}
          onPress={toggle}
        >
          Options
        </Button>
      )}
    >
      {(menu) => (
        <>
          <Toggle
            menu={menu}
            on={model().amend()}
            hint="Rewrite the last commit instead of adding one. Fills an empty message from it."
            onSelect={() => void model().toggleAmend()}
          >
            Amend the last commit
          </Toggle>
          <Toggle
            menu={menu}
            on={model().signoff()}
            hint="Add a Signed-off-by line for the committer."
            onSelect={() => model().setSignoff(!model().signoff())}
          >
            Add a sign-off line
          </Toggle>
          <Toggle
            menu={menu}
            on={model().noVerify()}
            hint="git's pre-commit and commit-msg hooks; acorn's before-commit chain still runs."
            onSelect={() => model().setNoVerify(!model().noVerify())}
          >
            Skip git hooks
          </Toggle>
        </>
      )}
    </Menu>
  )
}

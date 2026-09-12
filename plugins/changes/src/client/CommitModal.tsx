import { Show } from 'solid-js'
import { Alert, Button, Modal, Text } from '@acorn/plugin-api/ui'
import { CommitField, commitButtonLabel, gitCommitLine } from './commitEditor'
import type { ChangesModel } from './changesModel'

// The commit message with room to write it in. Same draft as the footer's three-row field, so a
// reader can open this, type a body, dismiss it, and see what they wrote back in the pane: both
// fields read and write `draft` on the pane's model, and the model is what outlives either of them
// (docs/panes.md § Layout model).
//
// A `Modal`, not a pane and not a drawer: it is one field and one button, it goes away on Escape, and
// it draws the same on both hosts.
export function CommitModal(props: { model: ChangesModel; onDismiss: () => void }) {
  const model = () => props.model
  return (
    <Modal title="Commit message" size="lg" onDismiss={props.onDismiss}>
      <Modal.Body>
        {/* The footer's alert is behind this, and on the terminal a dialog is a scope with nothing of
            the pane visible around it, so a refusal has to be readable here too. */}
        <Show when={model().actionError()}>{(error) => <Alert>{error()}</Alert>}</Show>
        {/* `grow`, unlike the footer's copy: a modal body has a height of its own for the field to
            fill, and the whole reason to open this is that three rows were not enough.

            Focused a microtask after the ref rather than with `autofocus`: a Solid ref fires while
            the element is still detached, and a detached element cannot take focus. `focus?.()`
            because the terminal hands its `Textarea` ref a renderable with no such method, and it
            needs none — entering a dialog there lands on its first stop
            (docs/tui.md § Keys and focus). */}
        <CommitField model={model()} grow rows={12} onField={(element) => queueMicrotask(() => element.focus?.())} />
      </Modal.Body>
      <Modal.Actions>
        <Text emphasis="muted">{gitCommitLine(model())}</Text>
        <Button variant="bare" size="sm" onPress={props.onDismiss}>Cancel</Button>
        <Button
          size="sm"
          busy={model().committing()}
          disabled={!model().canCommit()}
          // Dismissed only once the draft is gone, which is what a commit that landed leaves
          // behind. A `before-commit` veto keeps the text, so the reader stays here with the reason
          // in the footer's alert and the message still in front of them.
          onPress={() => void model().commit().then(() => { if (!model().draft()) props.onDismiss() })}
        >
          {commitButtonLabel(model())}
        </Button>
      </Modal.Actions>
    </Modal>
  )
}

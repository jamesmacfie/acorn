import { Show } from 'solid-js'
import {
  ConfirmButton, Icon, IconButton, Inline, ModelBackendPicker, Popover, Stack, Text,
} from '@acorn/plugin-api/ui'
import type { ChangesModel } from './changesModel'

// "Write it for me", at the left of the commit toolbar where Zed's is.
//
// One press asks the picked backend — a stored key, or an agent CLI installed on this machine — for a
// message from the diff the next commit would take, and the answer lands in the same draft typed text
// does (./commitState.ts § generate). Nothing here knows a provider key exists: the node holds it, and
// this sends a backend id (../server/routes/localGit.ts).
//
// Drawn only when there is something to spend. A button that exists to say "connect a provider first"
// is a button in the way of the four controls beside it, and Settings is where connections are made.

/** The backend a press will spend, or undefined while the pick does not resolve. Also what the
 *  failure copy reads: an installed CLI that is signed out fails like an unreachable provider and
 *  needs a different next step (./model.ts § generateReason). */
const pickedBackend = (model: ChangesModel) =>
  model.modelBackends().find((candidate) => candidate.id === model.modelPick()?.backendId)

/** What the backend is called, for the tip that says whose tokens a press spends. The reader's own
 *  label when they gave one to a connection, the provider's or the CLI's name otherwise. */
const labelFor = (model: ChangesModel): string => {
  const held = pickedBackend(model)
  if (!held) return 'a connected model'
  const modelId = model.modelPick()?.modelId
  return modelId ? `${held.label}, ${modelId}` : held.label
}

/** Which connection and model to spend, when more than one is connected.
 *
 *  Beside the wand rather than opening from it, on the pattern the branch bar's verb menu set: a
 *  button that does the thing and a trigger that changes what the thing will do. The wand itself
 *  never opens this, because a first press that opens a dropdown is a press that did nothing.
 *
 *  A `Popover` rather than a `Menu`, because `ModelBackendPicker` is two `Select`s and a menu item
 *  is not a control. The pick is written on change and becomes the default every other Generate
 *  control in the app opens on, so this is opened once and then not again. */
function ModelPickerButton(props: { model: ChangesModel }) {
  const model = () => props.model
  return (
    <Popover
      placement="top-start"
      role="dialog"
      ariaLabel="Model for the message"
      minWidth={220}
      trigger={({ open, toggle }) => (
        <IconButton
          icon="chevron-down"
          label="Model for the message"
          title={`Which provider writes the message. Now: ${labelFor(model())}`}
          opens="menu"
          expanded={open()}
          onPress={toggle}
        />
      )}
    >
      <Stack gap="row">
        {/* A `Text` heading rather than `Menu.Label`, which the terminal host's table does not have.
            This is a popover, so a heading is an ordinary node in it. */}
        <Text emphasis="eyebrow">Model for the message</Text>
        <ModelBackendPicker
          backends={model().modelBackends()}
          backendId={model().modelPick()?.backendId ?? ''}
          modelId={model().modelPick()?.modelId ?? ''}
          onChange={(pick) => model().setModelPick(pick)}
        />
      </Stack>
    </Popover>
  )
}

export function GenerateButton(props: { model: ChangesModel }) {
  const model = () => props.model
  // Nothing to read, nothing to describe. An amend on a clean tree is the one commit the button
  // beside this one allows with no diff, and a message for it would have to be written from the
  // commit being replaced, which is a different prompt and a door nobody has opened.
  const empty = () => model().commitMode() === 'none'
  // A pick exists only when something is connected (client-core's generatePick.ts), so this one
  // guard hides the whole control.
  const pick = () => model().modelPick()
  return (
    <Show when={pick()}>
      {(chosen) => (
        <Inline gap="inline">
          {/* One control for both states rather than two that swap: `skipConfirm` is off the moment
              there is text to lose, so a press over an empty field generates and a press over a
              message somebody wrote arms first and reads Replace?. `ConfirmButton` is the prompt on
              every host (docs/ui-design.md § The closed kit), and no `iconOnly`, because the armed
              label needs the room. */}
          <ConfirmButton
            variant="bare"
            size="sm"
            label="Write the commit message"
            confirmLabel="Replace?"
            skipConfirm={!model().draft().trim()}
            busy={model().generating()}
            disabled={empty()}
            tip={empty() ? 'Nothing staged or changed to describe' : `Write the message from the diff, using ${labelFor(model())}`}
            tipSub={model().commitMode() === 'staged' ? 'git diff --staged' : 'git diff'}
            onConfirm={() => void model().generate(
              { backendId: chosen().backendId, ...(chosen().modelId ? { modelId: chosen().modelId } : {}) },
              pickedBackend(model()),
            )}
          >
            <Icon name="sparkles" />
          </ConfirmButton>
          <Show when={model().modelBackends().length > 1}>
            <ModelPickerButton model={model()} />
          </Show>
        </Inline>
      )}
    </Show>
  )
}

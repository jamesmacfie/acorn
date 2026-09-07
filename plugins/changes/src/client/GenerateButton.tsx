import { Show } from 'solid-js'
import { Button, ConfirmButton, Icon, Inline, ModelConnectionPicker, Popover, Stack, Text } from '@acorn/plugin-api/ui'
import type { ChangesModel } from './changesModel'

// "Write it for me", at the left of the commit toolbar where Zed's is.
//
// One press asks a connected model provider for a message from the diff the next commit would take,
// and the answer lands in the same draft typed text does (./commitState.ts § generate). Nothing here
// knows a provider key exists: the node holds it, and this sends a connection id
// (../server/routes/localGit.ts).
//
// Drawn only when a model provider is connected. A button that exists to say "connect a provider
// first" is a button in the way of the four controls beside it, and Settings is where connections
// are made.

/** What the connection is called, for the tip that says whose tokens a press spends. The reader's own
 *  label when they gave it one, the provider's name otherwise. */
const labelFor = (model: ChangesModel): string => {
  const pick = model.modelPick()
  const held = model.modelConnections().find((candidate) => candidate.connection.id === pick?.connectionId)
  if (!held) return 'a connected provider'
  const name = held.connection.label || held.provider.label
  return pick?.modelId ? `${name}, ${pick.modelId}` : name
}

/** Which connection and model to spend, when more than one is connected.
 *
 *  Beside the wand rather than opening from it, on the pattern the branch bar's verb menu set: a
 *  button that does the thing and a trigger that changes what the thing will do. The wand itself
 *  never opens this, because a first press that opens a dropdown is a press that did nothing.
 *
 *  A `Popover` rather than a `Menu`, because `ModelConnectionPicker` is two `Select`s and a menu item
 *  is not a control. The pick is written on change and remembered per device, so this is opened once
 *  and then not again. */
function ModelPickerButton(props: { model: ChangesModel }) {
  const model = () => props.model
  return (
    <Popover
      placement="top-start"
      role="dialog"
      ariaLabel="Model for the message"
      minWidth={220}
      trigger={({ open, toggle }) => (
        <Button
          variant="bare"
          size="sm"
          iconOnly
          label="Model for the message"
          title={`Which provider writes the message. Now: ${labelFor(model())}`}
          opens="menu"
          expanded={open()}
          onPress={toggle}
        >
          <Icon name="chevron-down" />
        </Button>
      )}
    >
      <Stack gap="row">
        {/* A `Text` heading rather than `Menu.Label`, which the terminal host's table does not have.
            This is a popover, so a heading is an ordinary node in it. */}
        <Text emphasis="eyebrow">Model for the message</Text>
        <ModelConnectionPicker
          connections={model().modelConnections()}
          connectionId={model().modelPick()?.connectionId ?? ''}
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
  // A pick exists only when something is connected (./model.ts § effectiveModelPick), so this one
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
            onConfirm={() => void model().generate({ connectionId: chosen().connectionId, ...(chosen().modelId ? { modelId: chosen().modelId } : {}) })}
          >
            <Icon name="sparkles" />
          </ConfirmButton>
          <Show when={model().modelConnections().length > 1}>
            <ModelPickerButton model={model()} />
          </Show>
        </Inline>
      )}
    </Show>
  )
}

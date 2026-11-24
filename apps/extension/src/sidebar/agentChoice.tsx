import { Show, createSignal, type JSX } from 'solid-js'
import type { BridgeAgentChoice, BridgeAgentSession } from '@acorn/protocol/extensionBridge.ts'
import Icon from '@acorn/client-core/kit/components/content/Icon.tsx'
import { Button } from '@acorn/client-core/kit/components/primitives.tsx'
import { IconButton } from '@acorn/client-core/kit/components/inputs'
import Picker from '@acorn/client-core/kit/components/inputs/Picker.tsx'
import { Toolbar } from '@acorn/client-core/kit/components/layout'
import { CallFailure, choiceKey, isUncertain } from '../messages'
import type { BridgeClient } from './bridgeClient'
import { errorGuidance } from './guidance'

// What a new conversation can start from on one Node, as the desktop's New picker lists it: each
// harness or its named logins, then each custom agent. Which row the task's project starts by default,
// and pinning it. And the start itself.
export function agentChoice(client: BridgeClient, nodeId: string, taskId: string) {
  const [choices, setChoices] = createSignal<BridgeAgentChoice[] | null>(null)
  const [starting, setStarting] = createSignal(false)
  const [problem, setProblem] = createSignal<string | null>(null)
  // An unconfirmed start keeps its key, so starting the same chat again can't make a second one.
  let pending: { key: string; taskId: string; choice: string } | null = null

  // `refresh` asks the Node to check its harnesses again, as the desktop's Refresh does. `again` reads
  // the Node's last answer again without that check, which is cheap enough for every return to the panel.
  const load = async (refresh = false, again = refresh) => {
    if (choices() && !again) return
    setProblem(null)
    try {
      const ask = (withTask: boolean) =>
        client.call({ op: 'agents.choices', nodeId, ...(refresh ? { refresh } : {}), ...(withTask ? { taskId } : {}) })
      // An older CLI refuses the task, and its rows then carry no pins.
      const result = await ask(true).catch((error: unknown) => {
        if (error instanceof CallFailure && error.code === 'bad_request') return ask(false)
        throw error
      })
      // The host lists only rows that can start, but an older CLI also sends the rest, disabled.
      setChoices(result.choices.filter((choice) => choice.available))
    } catch (error) {
      setProblem(error instanceof CallFailure ? errorGuidance(error) : String(error))
    }
  }

  // The new conversation, or null with `problem` saying why there isn't one.
  const start = async (taskId: string, choice: BridgeAgentChoice): Promise<BridgeAgentSession | null> => {
    if (!choice.available || starting()) return null
    const same = pending?.taskId === taskId && pending.choice === choiceKey(choice)
    const key = same ? pending!.key : crypto.randomUUID()
    pending = { key, taskId, choice: choiceKey(choice) }
    setStarting(true)
    setProblem(null)
    try {
      const { session } = await client.call({
        op: 'session.create',
        nodeId,
        taskId,
        providerId: choice.providerId,
        profileId: choice.profileId,
        ...(choice.customAgentId ? { customAgentId: choice.customAgentId } : {}),
        ...(choice.account ? { account: choice.account } : {}),
        key,
      })
      pending = null
      return session
    } catch (error) {
      const failure = error instanceof CallFailure ? error : new CallFailure('node_error', String(error))
      setProblem(
        isUncertain(failure.code)
          ? "The Node didn't confirm the new chat. Start it again to retry; the Node won't make a second one."
          : errorGuidance(failure),
      )
      return null
    } finally {
      setStarting(false)
    }
  }

  // Pins the row as the project's default, or clears the pin when it's the pinned one, then reads the
  // rows again so every pin shows what the Node holds. A failed pin leaves the rows and says why.
  const pin = async (choice: BridgeAgentChoice) => {
    if (!choice.id) return
    setProblem(null)
    try {
      await client.call({ op: 'agents.pin', nodeId, taskId, choiceId: choice.pinned ? null : choice.id })
    } catch (error) {
      setProblem(error instanceof CallFailure ? errorGuidance(error) : String(error))
      return
    }
    await load(false, true)
  }

  // The row New starts: the project's pinned row, else the first, as on the desktop.
  const startChoice = () => choices()?.find((choice) => choice.pinned) ?? choices()?.[0]

  return { choices, starting, problem, load, start, pin, startChoice }
}

// The desktop's New control. With several rows it's a split button: the button starts the project's
// default and the chevron opens the kit's Picker, with a filter, each row's mark and account icon over
// its name and what it runs, a pin per row, and a refresh that checks the harnesses again. A pick starts
// the chat. `label` is the button's, such as New chat in a section's header. `solid` makes it the view's
// one action, as in an empty state. With one row there is nothing to pick, so the button alone starts it.
// With none, the picker alone says why.
export function AgentPicker(props: {
  label: string
  solid?: boolean
  agents: ReturnType<typeof agentChoice>
  disabled: boolean
  pick(choice: BridgeAgentChoice): void
}) {
  const count = () => props.agents.choices()?.length ?? 0
  return (
    <Show
      when={props.agents.startChoice()}
      fallback={picker(
        props,
        <>
          <Icon name="plus" />
          <span>{props.agents.starting() ? 'Starting…' : props.label}</span>
        </>,
      )}
    >
      {(choice) => (
        <Show when={count() > 1} fallback={button(props, choice())}>
          <Toolbar.Group joined>
            {button(props, choice())}
            {picker(props, null)}
          </Toolbar.Group>
        </Show>
      )}
    </Show>
  )
}

function button(props: Parameters<typeof AgentPicker>[0], choice: BridgeAgentChoice) {
  return (
    <Button
      label={`${props.label}: ${choice.label}`}
      size="sm"
      variant={props.solid ? 'solid' : undefined}
      disabled={props.disabled || props.agents.starting()}
      onPress={() => props.pick(choice)}
    >
      {marks(choice)}
      <span>{props.agents.starting() ? 'Starting…' : props.label}</span>
    </Button>
  )
}

// A row's harness mark, and its account's icon when it has one.
const marks = (choice: BridgeAgentChoice) => (
  <span class="agent-marks">
    {/* An unmatched name draws as text, which is how a harness with no mark shows its initial. */}
    <Icon name={choice.glyph ?? choice.label.slice(0, 1).toUpperCase()} tone="brand" />
    <Show when={choice.accountIcon}>{(icon) => <Icon name={icon()} title={choice.label} />}</Show>
  </span>
)

function picker(props: Parameters<typeof AgentPicker>[0], label: JSX.Element) {
  return (
    <Picker<BridgeAgentChoice>
      label={label}
      ariaLabel={props.label}
      size="sm"
      variant={props.solid ? 'solid' : undefined}
      placement="bottom-end"
      placeholder="Filter agents…"
      emptyText={
        props.agents.choices()
          ? 'No agent on this Node is installed and signed in. Set one up in Settings > Agents.'
          : 'Checking which agents this Node can run…'
      }
      results={(query) =>
        (props.agents.choices() ?? []).filter((choice) =>
          choice.label.toLowerCase().includes(query.trim().toLowerCase()),
        )
      }
      leading={marks}
      rowLabel={(choice) => choice.text}
      rowDescription={(choice) => choice.description}
      // The row New starts, so the list shows what the button beside it does.
      isActive={(choice) => choice === props.agents.startChoice()}
      isDisabled={() => props.agents.starting()}
      disabled={props.disabled}
      onSelect={props.pick}
      // Only rows the host reports pins for, which an older CLI doesn't.
      trailing={(choice) => (
        <Show when={choice.id && typeof choice.pinned === 'boolean'}>
          <IconButton
            icon={choice.pinned ? 'pin-off' : 'pin'}
            variant="bare"
            size="xs"
            label={
              choice.pinned ? 'Stop starting this in the project by default' : 'Start this in the project by default'
            }
            disabled={props.disabled}
            onPress={() => void props.agents.pin(choice)}
          />
        </Show>
      )}
      tools={
        <IconButton icon="refresh-cw" label="Refresh provider health" onPress={() => void props.agents.load(true)} />
      }
    />
  )
}

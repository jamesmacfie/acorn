import { Show, createSignal } from 'solid-js'
import type { BridgeAgentChoice, BridgeAgentSession } from '@acorn/protocol/extensionBridge.ts'
import Icon from '@acorn/client-core/kit/components/content/Icon.tsx'
import { Button } from '@acorn/client-core/kit/components/primitives.tsx'
import { IconButton } from '@acorn/client-core/kit/components/inputs'
import Picker from '@acorn/client-core/kit/components/inputs/Picker.tsx'
import { CallFailure, choiceKey, isUncertain } from '../messages'
import type { BridgeClient } from './bridgeClient'
import { errorGuidance } from './guidance'

// What a new conversation can start from on one Node, as the desktop's New picker lists it: each
// harness or its named logins, then each custom agent. And the start itself.
export function agentChoice(client: BridgeClient, nodeId: string) {
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
      const result = await client.call({ op: 'agents.choices', nodeId, ...(refresh ? { refresh } : {}) })
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

  return { choices, starting, problem, load, start }
}

// The desktop's New picker, in the kit's own Picker: a filter, each row's mark and account icon over
// its name and what it runs, and a refresh that checks the harnesses again. A pick starts the chat.
// `label` is the button's, such as New chat in a section's header. `solid` makes it the view's one
// action, as in an empty state. With one choice there is nothing to pick, so the button starts it.
export function AgentPicker(props: {
  label: string
  solid?: boolean
  agents: ReturnType<typeof agentChoice>
  disabled: boolean
  pick(choice: BridgeAgentChoice): void
}) {
  const only = () => {
    const choices = props.agents.choices()
    return choices?.length === 1 ? choices[0] : undefined
  }
  return (
    <Show when={only()} fallback={picker(props)}>
      {(choice) => (
        <Button
          label={`${props.label}: ${choice().label}`}
          size="sm"
          variant={props.solid ? 'solid' : undefined}
          disabled={props.disabled || props.agents.starting()}
          onPress={() => props.pick(choice())}
        >
          {marks(choice())}
          <span>{props.agents.starting() ? 'Starting…' : props.label}</span>
        </Button>
      )}
    </Show>
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

function picker(props: Parameters<typeof AgentPicker>[0]) {
  return (
    <Picker<BridgeAgentChoice>
      label={
        <>
          <Icon name="plus" />
          <span>{props.agents.starting() ? 'Starting…' : props.label}</span>
        </>
      }
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
      isActive={() => false}
      isDisabled={() => props.agents.starting()}
      disabled={props.disabled}
      onSelect={props.pick}
      tools={
        <IconButton icon="refresh-cw" label="Refresh provider health" onPress={() => void props.agents.load(true)} />
      }
    />
  )
}

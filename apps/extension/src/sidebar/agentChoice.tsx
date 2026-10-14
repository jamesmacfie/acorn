import { Show, createSignal } from 'solid-js'
import type { BridgeAgentChoice, BridgeAgentSession } from '@acorn/protocol/extensionBridge.ts'
import Icon from '@acorn/client-core/kit/components/content/Icon.tsx'
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

  // `refresh` asks the Node to check its harnesses again, as the desktop's Refresh does.
  const load = async (refresh = false) => {
    if (choices() && !refresh) return
    setProblem(null)
    try {
      const result = await client.call({ op: 'agents.choices', nodeId, ...(refresh ? { refresh } : {}) })
      setChoices(result.choices)
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
export function AgentPicker(props: {
  agents: ReturnType<typeof agentChoice>
  disabled: boolean
  pick(choice: BridgeAgentChoice): void
}) {
  return (
    <Picker<BridgeAgentChoice>
      label={props.agents.starting() ? 'Starting…' : 'New chat'}
      ariaLabel="New chat"
      size="sm"
      placeholder="Filter agents…"
      emptyText={
        props.agents.choices() ? 'No managed providers available.' : 'Checking which agents this Node can run…'
      }
      results={(query) =>
        (props.agents.choices() ?? []).filter((choice) =>
          choice.label.toLowerCase().includes(query.trim().toLowerCase()),
        )
      }
      leading={(choice) => (
        <span class="agent-marks">
          {/* An unmatched name draws as text, which is how a harness with no mark shows its initial. */}
          <Icon name={choice.glyph ?? choice.label.slice(0, 1).toUpperCase()} tone="brand" />
          <Show when={choice.accountIcon}>{(icon) => <Icon name={icon()} title={choice.label} />}</Show>
        </span>
      )}
      rowLabel={(choice) => choice.text}
      rowDescription={(choice) => choice.description}
      isActive={() => false}
      isDisabled={(choice) => !choice.available || props.agents.starting()}
      disabled={props.disabled}
      onSelect={props.pick}
      tools={
        <button
          type="button"
          class="icon"
          aria-label="Refresh provider health"
          title="Refresh provider health"
          onClick={() => void props.agents.load(true)}
        >
          <Icon name="refresh-cw" />
        </button>
      }
    />
  )
}

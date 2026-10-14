import { For, Show, createSignal } from 'solid-js'
import type { BridgeAgentProfile, BridgeAgentSession } from '@acorn/protocol/extensionBridge.ts'
import { CallFailure, isUncertain } from '../messages'
import type { BridgeClient } from './bridgeClient'
import { errorGuidance } from './guidance'

// The profile a person may start a chat with, or why not.
const unavailableReason = (profile: BridgeAgentProfile): string | null => {
  if (!profile.installed) return profile.diagnostics[0] ?? 'Not installed on this Node'
  if (profile.authenticated === false) return 'Not signed in on this Node'
  return null
}

// The agents a new conversation can start with on one Node, one per provider on its default account,
// and the start itself. New chat and Start task both use it.
export function agentChoice(client: BridgeClient, nodeId: string) {
  const [profiles, setProfiles] = createSignal<BridgeAgentProfile[] | null>(null)
  const [choice, setChoice] = createSignal('')
  const [starting, setStarting] = createSignal(false)
  const [problem, setProblem] = createSignal<string | null>(null)
  // An unconfirmed start keeps its key, so starting the same chat again can't make a second one.
  let pending: { key: string; taskId: string; choice: string } | null = null

  const load = async () => {
    if (profiles()) return
    setProblem(null)
    try {
      const result = await client.call({ op: 'agents.profiles', nodeId })
      setProfiles(result.profiles)
      setChoice(result.profiles.find((profile) => !unavailableReason(profile))?.providerId ?? '')
    } catch (error) {
      setProblem(error instanceof CallFailure ? errorGuidance(error) : String(error))
    }
  }

  const chosen = () => {
    const profile = profiles()?.find((candidate) => candidate.providerId === choice())
    return profile && !unavailableReason(profile) ? profile : null
  }

  // The new conversation, or null with `problem` saying why there isn't one.
  const start = async (taskId: string): Promise<BridgeAgentSession | null> => {
    const profile = chosen()
    if (!profile || starting()) return null
    const same = pending?.taskId === taskId && pending.choice === profile.providerId
    const key = same ? pending!.key : crypto.randomUUID()
    pending = { key, taskId, choice: profile.providerId }
    setStarting(true)
    setProblem(null)
    try {
      const { session } = await client.call({
        op: 'session.create',
        nodeId,
        taskId,
        providerId: profile.providerId,
        profileId: profile.profileId,
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

  return { profiles, choice, setChoice, chosen, starting, problem, load, start }
}

// The agent picker, or why no agent can start.
export function AgentSelect(props: { agents: ReturnType<typeof agentChoice> }) {
  return (
    <Show
      when={props.agents.profiles()}
      fallback={<p class="quiet">{props.agents.problem() ? '' : 'Loading agents…'}</p>}
    >
      {(loaded) => (
        <Show
          when={loaded().some((profile) => !unavailableReason(profile))}
          fallback={
            <p class="notice">
              No agent can start on this Node.{' '}
              {loaded()
                .map((profile) => `${profile.label}: ${unavailableReason(profile)}`)
                .join('. ')}
            </p>
          }
        >
          <select name="profile" class="grow" onChange={(event) => props.agents.setChoice(event.currentTarget.value)}>
            <For each={loaded()}>
              {(profile) => (
                <option
                  value={profile.providerId}
                  disabled={unavailableReason(profile) !== null}
                  selected={profile.providerId === props.agents.choice()}
                >
                  {unavailableReason(profile) ? `${profile.label} (${unavailableReason(profile)})` : profile.label}
                </option>
              )}
            </For>
          </select>
        </Show>
      )}
    </Show>
  )
}

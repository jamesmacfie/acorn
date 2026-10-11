import { createResource, createSignal, For, Show } from 'solid-js'
import type { SecretPublicationDecision } from '@acorn/protocol/secretChecks.ts'
import {
  allowSecretPublication,
  nodeSecretPublication,
  setSecretPublicationBlocking,
} from '../../infra/node/nodeSecurity'
import { Button, Checkbox } from '../../kit/components/primitives'
import { Text } from '../../kit/components/content/Text'
import { SettingRow } from '../../kit/components/layout/SettingRow'
import { SettingsSection } from '../../kit/components/layout/SettingsSection'
import { createSettingSave } from './settingSave'

// Settings → Security and backup → Secret checks (docs/security/secret-publication.md). The switch
// and the operations it refused, on the node the settings header names. Allowing one lets that exact
// operation through once in the next ten minutes; any change to its content or destination asks again.

const LABEL = 'Block publication with secret findings'
const OPERATIONS: Record<SecretPublicationDecision['operation'], string> = {
  commit: 'Commit',
  push: 'Push',
  export: 'Transcript export',
  send: 'Agent message with attachments',
}

const describe = (decision: SecretPublicationDecision): string => {
  const found =
    decision.reason === 'findings'
      ? `${decision.highCount} likely secret${decision.highCount === 1 ? '' : 's'} (${decision.rules.join(', ')})`
      : `${decision.unscannedCount} input${decision.unscannedCount === 1 ? '' : 's'} not checked`
  return `${OPERATIONS[decision.operation]} to ${decision.destination}: ${found}.`
}

export default function SecretPublicationSection(props: { nodeId: string | null }) {
  const nodeId = () => props.nodeId ?? undefined
  const [state, { mutate, refetch }] = createResource(
    () => props.nodeId ?? '',
    (id) => nodeSecretPublication(id || undefined),
  )
  const save = createSettingSave()
  const [allowError, setAllowError] = createSignal('')

  const allow = async (decisionId: string) => {
    setAllowError('')
    try {
      mutate(await allowSecretPublication(decisionId, nodeId()))
    } catch (failure) {
      setAllowError(failure instanceof Error ? failure.message : String(failure))
      void refetch()
    }
  }

  return (
    <SettingsSection
      id="secret-checks"
      label="Secret checks"
      description="Acorn checks for credential-shaped text before a commit, a push, a transcript export, or an agent message with attachments."
      help="The check runs on this node and sends nothing anywhere. A match is a likely secret, not proof of a live one. It does not cover Git, curl, or uploads run outside Acorn. If a secret already left this machine, rotate it with its provider."
    >
      <SettingRow
        label={LABEL}
        description="Off by default. On, a likely secret or an incomplete check stops the operation until you allow it once here. Assignments, URL passwords, and JWTs only warn."
        savedAt={save.savedAt()}
        error={save.error() ?? (state.error ? "Couldn't load this setting." : undefined)}
      >
        <Checkbox
          switch
          ariaLabel={LABEL}
          checked={state()?.block ?? false}
          // Until the node answers, the switch would show Off as a guess and a click would write it.
          disabled={!state()}
          onChange={(next) =>
            save.run(async () => {
              mutate(await setSecretPublicationBlocking(next, nodeId()))
            })
          }
        />
      </SettingRow>
      <Show when={state()?.decisions.length}>
        <SettingRow label="Blocked operations" layout="stacked" error={allowError() || undefined}>
          <For each={state()!.decisions}>
            {(decision) => (
              <SettingRow label={describe(decision)} layout="stacked">
                <Show
                  when={!decision.allowed}
                  fallback={<Text emphasis="muted">Allowed once. Try the operation again.</Text>}
                >
                  <Button onPress={() => void allow(decision.decisionId)}>Allow once</Button>
                </Show>
              </SettingRow>
            )}
          </For>
          <Button variant="ghost" onPress={() => void refetch()}>
            Refresh
          </Button>
        </SettingRow>
      </Show>
    </SettingsSection>
  )
}

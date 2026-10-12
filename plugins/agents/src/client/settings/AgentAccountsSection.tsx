import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { createSignal, For, Show } from 'solid-js'
import {
  Badge,
  Button,
  CodeBlock,
  ConfirmButton,
  Inline,
  Input,
  Select,
  SettingRow,
  SettingsSection,
  Stack,
  Text,
} from '@acorn/plugin-api/ui'
import type { AgentAccountDescriptor, AgentProviderDescriptor } from '../../contract/wire.ts'
import { isAccountName } from '../../shared/accounts'
import { agentProvidersOptions, agentProvidersQueryKey, refreshAgentProviders } from '../providersClient'
import { managedAgentApi } from '../sessions/managedClient'

// Settings > Agents > Harnesses and defaults > Accounts: extra subscriptions for a harness, each signed
// in through the harness's own CLI (docs/managed-agents/accounts.md). Acorn makes the folder and shows
// the command; the person runs it, so Acorn never handles a token.
export default function AgentAccountsSection() {
  const queryClient = useQueryClient()
  const providers = createQuery(() => agentProvidersOptions())
  const withAccounts = () => (providers.data ?? []).filter((provider) => provider.accounts)
  const [error, setError] = createSignal('')
  const [checking, setChecking] = createSignal(false)

  const apply = async (change: () => Promise<AgentProviderDescriptor[]>) => {
    setError('')
    try {
      queryClient.setQueryData(agentProvidersQueryKey, await change())
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The account could not be changed.')
    }
  }
  const checkAgain = async () => {
    setChecking(true)
    try {
      await refreshAgentProviders(queryClient)
    } finally {
      setChecking(false)
    }
  }

  return (
    <Show when={withAccounts().length}>
      <SettingsSection
        id="accounts"
        label="Accounts"
        help="A second subscription for a harness, such as a work account beside a personal one. Each account signs in on its own, a session stays on the account it started with, and your usual sign-in stays the default. Pick the account when you start a session."
      >
        <Show when={error()}>
          <Text tone="danger">{error()}</Text>
        </Show>
        <For each={withAccounts()}>
          {(provider) => (
            <Stack gap="stack">
              <Show when={provider.accounts?.length}>
                <SettingRow
                  label={`Default ${provider.label} account`}
                  help="New sessions that don't name an account start here, including workflow steps, custom agents, and inline diff chats."
                >
                  <Select
                    label={`Default ${provider.label} account`}
                    value={provider.defaultAccount ?? ''}
                    options={(provider.accounts ?? []).map((account) => ({ value: account.name, label: account.name }))}
                    onChange={(name) => void apply(() => managedAgentApi.setDefaultAccount(provider.id, name))}
                  />
                </SettingRow>
              </Show>
              <For each={provider.accounts}>
                {(account) => (
                  <AccountRow
                    provider={provider}
                    account={account}
                    checking={checking()}
                    onCheck={() => void checkAgain()}
                    onRemove={() => void apply(() => managedAgentApi.removeAccount(provider.id, account.name))}
                  />
                )}
              </For>
              <AddAccountRow
                provider={provider}
                onAdd={(name) => apply(() => managedAgentApi.addAccount(provider.id, name))}
              />
            </Stack>
          )}
        </For>
      </SettingsSection>
    </Show>
  )
}

function AccountRow(props: {
  provider: AgentProviderDescriptor
  account: AgentAccountDescriptor
  checking: boolean
  onCheck: () => void
  onRemove: () => void
}) {
  const signedOut = () => props.account.authenticated !== true
  return (
    <SettingRow
      label={`${props.provider.label} · ${props.account.name}`}
      description={
        signedOut() && props.account.loginCommand
          ? 'Run this on the computer the Node runs on to sign in, then check again.'
          : undefined
      }
    >
      <Stack gap="row">
        <Inline>
          <Badge tone={props.account.authenticated ? 'ok' : 'neutral'}>
            {props.account.authenticated ? 'Signed in' : 'Not signed in'}
          </Badge>
          <Show when={signedOut()}>
            <Button size="sm" variant="ghost" busy={props.checking} onPress={props.onCheck}>
              Check again
            </Button>
          </Show>
          <ConfirmButton
            size="sm"
            variant="ghost"
            tone="danger"
            label="Remove"
            confirmLabel={`Remove ${props.account.name}?`}
            onConfirm={props.onRemove}
          >
            Remove
          </ConfirmButton>
        </Inline>
        <Show when={signedOut() && props.account.loginCommand}>
          {(command) => (
            <CodeBlock size="xs" wrap copy>
              {command()}
            </CodeBlock>
          )}
        </Show>
      </Stack>
    </SettingRow>
  )
}

function AddAccountRow(props: { provider: AgentProviderDescriptor; onAdd: (name: string) => Promise<void> }) {
  const [name, setName] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const add = async () => {
    setBusy(true)
    try {
      await props.onAdd(name())
      setName('')
    } finally {
      setBusy(false)
    }
  }
  return (
    <SettingRow
      label={`Add a ${props.provider.label} account`}
      help="Lowercase letters, numbers and dashes, such as work."
    >
      <Inline>
        <Input
          value={name()}
          placeholder="work"
          maxLength={32}
          label={`New ${props.provider.label} account name`}
          onInput={(value) => setName(value.trim().toLowerCase())}
        />
        <Button size="sm" busy={busy()} disabled={!isAccountName(name())} onPress={() => void add()}>
          Add
        </Button>
      </Inline>
    </SettingRow>
  )
}

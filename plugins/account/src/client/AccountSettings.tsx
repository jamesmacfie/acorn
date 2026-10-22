// Settings → Account: sign in to the account service, and turn on remote access for the Node whose
// settings these are. The sections match the ones `./index.ts` declares for search. It's drawn with the
// kit, so the terminal client draws the same page (docs/tui/sources-and-settings.md § Settings).
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { Show } from 'solid-js'
import { activeNodeId, createDeviceFlow, createSettingSave } from '@acorn/plugin-api/client'
import { Alert, Button, Checkbox, CodeBlock, SettingRow, SettingsSection, Text } from '@acorn/plugin-api/ui'
import { safeVerificationUrl } from '@acorn/protocol/externalUrl.ts'
import type { AccountState } from '../shared/state'
import { fetchAccountState, setRemoteAccess, signOut } from './accountClient'

const REFRESH_WHILE_CONNECTING_MS = 2_000

const connectionText = (remote: AccountState['remoteAccess']): string => {
  if (remote.blocked) return remote.blocked
  if (!remote.enabled)
    return 'Reach this Node from another network, through the relay. A device you’ve already paired approves each new one.'
  const relay = remote.relayUrl ? new URL(remote.relayUrl).host : 'the relay'
  return remote.connected
    ? `Connected to ${relay} since ${new Date(remote.since ?? Date.now()).toLocaleTimeString()}.`
    : `Connecting to ${relay}…`
}

export default function AccountSettings() {
  const client = useQueryClient()
  const key = ['account', 'state', activeNodeId()]
  const state = createQuery(() => ({
    queryKey: key,
    queryFn: () => fetchAccountState(),
    // The relay connection opens a moment after the switch, so look again until it has.
    refetchInterval: (query) =>
      query.state.data?.remoteAccess.enabled && !query.state.data.remoteAccess.connected
        ? REFRESH_WHILE_CONNECTING_MS
        : false,
  }))
  const refresh = () => client.invalidateQueries({ queryKey: key })
  const deviceFlow = createDeviceFlow(() => 'account', refresh)
  const remoteSave = createSettingSave()
  const signOutSave = createSettingSave()

  return (
    <>
      <SettingsSection id="account" label="Account">
        <Show when={state.data}>
          {(current) => (
            <Show
              when={current().configured}
              fallback={
                <SettingRow label="Sign in" description="This copy of acorn has no account service to sign in to." />
              }
            >
              <Show
                when={current().account}
                fallback={
                  <SettingRow
                    label="Sign in"
                    description="Sign in with GitHub to reach this Node from another network."
                    layout={deviceFlow.device() ? 'stacked' : undefined}
                    error={deviceFlow.error()}
                  >
                    <Show
                      when={deviceFlow.device()}
                      fallback={
                        <Button
                          variant="solid"
                          tone="accent"
                          busy={deviceFlow.busy()}
                          onPress={() => void deviceFlow.start()}
                        >
                          Sign in
                        </Button>
                      }
                    >
                      {(started) => (
                        <>
                          <Text wrap>
                            Open {started().verificationUri} and enter this code. Keep this page open until it finishes.
                          </Text>
                          <CodeBlock size="sm" copy>
                            {started().userCode}
                          </CodeBlock>
                          <Show
                            when={safeVerificationUrl(started().verificationUri)}
                            fallback={<Alert>acorn won't open that address. Open it yourself, in your browser.</Alert>}
                          >
                            {(url) => <Button href={url().href}>Open {url().host}</Button>}
                          </Show>
                          <Text emphasis="muted">Waiting for approval…</Text>
                          <Button variant="ghost" onPress={deviceFlow.cancel}>
                            Cancel
                          </Button>
                        </>
                      )}
                    </Show>
                  </SettingRow>
                }
              >
                {(account) => (
                  <SettingRow
                    label="Signed in as"
                    description={`${account().name}. Signing out also turns remote access off.`}
                    error={signOutSave.error()}
                  >
                    <Button
                      variant="ghost"
                      onPress={() =>
                        void signOutSave.run(async () => {
                          await signOut()
                          await refresh()
                        })
                      }
                    >
                      Sign out
                    </Button>
                  </SettingRow>
                )}
              </Show>
            </Show>
          )}
        </Show>
      </SettingsSection>

      <SettingsSection id="remote-access" label="Remote access">
        <Show when={state.data}>
          {(current) => (
            <SettingRow
              label="Remote access"
              description={connectionText(current().remoteAccess)}
              error={remoteSave.error()}
            >
              <Checkbox
                switch
                ariaLabel="Remote access"
                checked={current().remoteAccess.enabled}
                disabled={!current().account || (!current().remoteAccess.enabled && !!current().remoteAccess.blocked)}
                onChange={(enabled) =>
                  void remoteSave.run(async () => {
                    await setRemoteAccess(enabled)
                    await refresh()
                  })
                }
              />
            </SettingRow>
          )}
        </Show>
      </SettingsSection>
    </>
  )
}

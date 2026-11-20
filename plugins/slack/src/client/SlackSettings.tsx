// Settings → Slack: link this Node's owner's Slack user, confirm the Slack user the link names, and
// choose whether approvals can be answered from Slack (docs/integrations/slack.md § Linking). Drawn with the kit, so the terminal client draws the
// same page, where the link's address shows as text to open.
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { createSignal, For, Show } from 'solid-js'
import { activeNodeId, createSettingSave } from '@acorn/plugin-api/client'
import { Alert, Button, Checkbox, SettingRow, SettingsSection, Text } from '@acorn/plugin-api/ui'
import { confirmLink, fetchSlackState, setApprovals, startLink, unlink } from './slackClient'

const POLL_WHILE_LINKING_MS = 2_000
const RISK =
  'If the hosted service were broken into, whoever did it could send your agent a prompt and approve what it runs.'

export default function SlackSettings() {
  const client = useQueryClient()
  const key = ['slack', 'state', activeNodeId()]
  const [pending, setPending] = createSignal<{ url: string } | null>(null)
  const [approvalsOnConfirm, setApprovalsOnConfirm] = createSignal(false)
  const state = createQuery(() => ({
    queryKey: key,
    queryFn: () => fetchSlackState(),
    // Sign-in and Remote access change on Settings → Account, and nothing tells this query, so it reads
    // again each time the page opens.
    staleTime: 0,
    // Linking finishes in the browser. Look again until the link reaches this Node.
    refetchInterval: (query) =>
      pending() && !query.state.data?.links.some((link) => link.here) ? POLL_WHILE_LINKING_MS : false,
  }))
  const refresh = () => client.invalidateQueries({ queryKey: key })
  const save = createSettingSave()
  const link = () =>
    void save.run(async () => {
      setPending(await startLink())
      await refresh()
    })

  return (
    <SettingsSection id="slack" label="Slack">
      <Show when={state.data}>
        {(current) => (
          <Show
            when={current().signedIn && current().remoteAccess}
            fallback={
              <SettingRow
                label="Link Slack"
                description={
                  current().signedIn
                    ? 'Slack reaches this Node through the relay. Turn on Remote access in Settings → Account first.'
                    : 'Sign in to your acorn account in Settings → Account first.'
                }
              />
            }
          >
            <Show when={current().error}>{(error) => <Alert>{error()}</Alert>}</Show>
            <For each={current().links.filter((entry) => !entry.here)}>
              {(entry) => (
                <SettingRow
                  label={entry.teamName}
                  description={`Slack work goes to ${entry.nodeLabel ?? 'another Node'}.`}
                  error={save.error()}
                >
                  <Button onPress={link}>Link this Node instead</Button>
                </SettingRow>
              )}
            </For>
            <Show
              when={current().links.some((entry) => entry.here)}
              fallback={
                <SettingRow
                  label="Link Slack"
                  description="Mention @acorn in Slack, or DM it, to start an agent here. Only your replies run as turns."
                  layout={pending() ? 'stacked' : undefined}
                  error={save.error()}
                >
                  <Show
                    when={pending()}
                    fallback={
                      <Button variant="solid" tone="accent" onPress={link}>
                        Link Slack
                      </Button>
                    }
                  >
                    {(started) => (
                      <>
                        <Text wrap>Sign in with Slack at this address. Keep this page open until it finishes.</Text>
                        <Button href={started().url}>Open Slack sign-in</Button>
                        <Text emphasis="muted" wrap>
                          {started().url}
                        </Text>
                        <Button variant="ghost" onPress={() => setPending(null)}>
                          Cancel
                        </Button>
                      </>
                    )}
                  </Show>
                </SettingRow>
              }
            >
              <For each={current().links.filter((entry) => entry.here && !entry.confirmed)}>
                {(entry) => (
                  <>
                    <SettingRow
                      label={`Confirm ${entry.teamName}`}
                      description={`Your acorn account linked the Slack user ${entry.slackUserName} (${entry.slackUserId}) in ${entry.teamName} to this Node. Confirm only if that's you. Until you do, Slack can't start agents here.`}
                      layout="stacked"
                      error={save.error()}
                    >
                      <Button
                        variant="solid"
                        tone="accent"
                        onPress={() =>
                          void save.run(async () => {
                            await confirmLink(entry.teamId, entry.slackUserId, approvalsOnConfirm())
                            setPending(null)
                            setApprovalsOnConfirm(false)
                            await refresh()
                          })
                        }
                      >
                        Confirm
                      </Button>
                      <Button
                        variant="ghost"
                        onPress={() =>
                          void save.run(async () => {
                            setPending(null)
                            await unlink(entry.teamId)
                            await refresh()
                          })
                        }
                      >
                        Not me, unlink
                      </Button>
                    </SettingRow>
                    {/* Sent with the confirmation, so it applies to this Slack user and no other. */}
                    <SettingRow label="Answer approvals from Slack" description={RISK}>
                      <Checkbox
                        switch
                        ariaLabel="Answer approvals from Slack"
                        checked={approvalsOnConfirm()}
                        onChange={setApprovalsOnConfirm}
                      />
                    </SettingRow>
                  </>
                )}
              </For>
              <For each={current().links.filter((entry) => entry.here && entry.confirmed)}>
                {(entry) => (
                  <>
                    <SettingRow
                      label={entry.teamName}
                      description={`Linked as ${entry.slackUserName}. Mentions and DMs from you start agents on this Node.`}
                      error={save.error()}
                    >
                      <Button
                        variant="ghost"

                        onPress={() =>
                          void save.run(async () => {
                            setPending(null)
                            await unlink(entry.teamId)
                            await refresh()
                          })
                        }
                      >
                        Unlink
                      </Button>
                    </SettingRow>
                    <SettingRow label="Answer approvals from Slack" description={RISK}>
                      <Checkbox
                        switch
                        ariaLabel="Answer approvals from Slack"
                        checked={entry.approvals}
                        onChange={(enabled) =>
                          save.run(async () => {
                            await setApprovals(entry.teamId, enabled)
                            await refresh()
                          })
                        }
                      />
                    </SettingRow>
                  </>
                )}
              </For>
            </Show>
          </Show>
        )}
      </Show>
    </SettingsSection>
  )
}

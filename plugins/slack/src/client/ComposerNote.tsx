// "Shared to #billing in Slack" in the composer of a session Slack started, because what's typed there
// posts to the thread (docs/integrations/slack/conversation-rules.md § Mirroring).
import { createQuery } from '@tanstack/solid-query'
import { Show } from 'solid-js'
import { Text } from '@acorn/plugin-api/ui'
import { fetchSharedTo } from './slackClient'

export function SlackComposerNote(props: { taskId: string; sessionId: string }) {
  const shared = createQuery(() => ({
    queryKey: ['slack', 'shared', props.sessionId],
    queryFn: () => fetchSharedTo(props.sessionId),
    staleTime: 60_000,
  }))
  return <Show when={shared.data?.sharedTo}>{(place) => <Text emphasis="muted">Shared to {place()}</Text>}</Show>
}

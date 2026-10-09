import { Show } from 'solid-js'
import { clientEvents } from '@acorn/plugin-api/client'
import { Alert, Button, Fold, Stack, Text } from '@acorn/plugin-api/ui'
import type { AgentNormalizedEvent } from '../../contract/wire'

type AgentError = Extract<AgentNormalizedEvent, { type: 'error' }>

function instructionFailure(error: AgentError): string | null {
  if (error.code.startsWith('instruction_')) return error.code
  // Saved turns from before structured admission errors still need a way to their review.
  if (error.code !== 'turn_dispatch_failed') return null
  if (error.message.startsWith('Instruction review required:')) return 'instruction_review_required'
  if (error.message.startsWith('Instruction scan incomplete:')) return 'instruction_scan_incomplete'
  if (error.message.startsWith('Hidden character ')) return 'instruction_hidden_characters'
  return null
}

export default function AgentErrorCard(props: { error: AgentError }) {
  const failure = () => instructionFailure(props.error)
  const title = () => failure() === 'instruction_review_required' ? 'Review instructions to continue'
    : failure() === 'instruction_hidden_characters' ? 'Hidden characters in instruction files'
    : failure() ? 'Instruction check could not finish'
    : props.error.code === 'turn_dispatch_failed' ? 'The agent could not start this turn' : 'Agent error'
  return <Alert variant="banner" tone={failure() ? 'warn' : 'danger'} title={title()}
    actions={<Show when={failure()}>
      <Button size="sm" onPress={() => clientEvents.emit('presentation:open-settings', { tab: 'security#agent-instructions' })}>Review instructions</Button>
    </Show>}>
    <Stack gap="row">
      <Text wrap>{failure() === 'instruction_review_required'
        ? 'Your instructions need approval before the agent can use them. Review them in Security and backup, then send your message again.'
        : props.error.message}</Text>
      <Fold label="Error details" defaultOpen={false}>
        <Show when={failure()}><Text wrap>{props.error.message}</Text></Show>
        <Text emphasis="muted">{props.error.code}</Text>
      </Fold>
    </Stack>
  </Alert>
}

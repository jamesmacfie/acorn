import { createSignal, Show } from 'solid-js'
import { clientEvents, requestTerminalFocusIntent, setTerminalOpen } from '@acorn/plugin-api/client'
import { Alert, Button, Fold, Stack, Text } from '@acorn/plugin-api/ui'
import type { AgentNormalizedEvent } from '../../contract/wire'
import { sessionAccount } from '../../shared/accounts'
import { managedAgentApi } from './managedClient'
import { managedAgentStore } from './managedStore'

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

// shortcut: matches the CLI's wording, because Claude's adapter reports an expired login as a plain
// internal error with no code. Add a code check here if a harness starts sending one.
const SIGN_IN_FAILURE = /failed to authenticate|\bauth login\b|run \/login/i

/** The named account a failed turn needs signed in again, or null. The CLI's own login has no folder
 *  the Node can open a terminal on, so its failures keep the plain card. */
function signInTarget(error: AgentError, taskId: string | undefined, sessionId: string | undefined) {
  if (!taskId || !sessionId || !SIGN_IN_FAILURE.test(error.message)) return null
  const session = managedAgentStore.snapshotFor(sessionId)?.session
  const account = session && sessionAccount(session.config)
  return account ? { taskId, providerId: session.providerId, account } : null
}

export default function AgentErrorCard(props: { error: AgentError; taskId?: string; sessionId?: string }) {
  const failure = () => instructionFailure(props.error)
  const signIn = () => signInTarget(props.error, props.taskId, props.sessionId)
  const [opening, setOpening] = createSignal(false)
  const [openError, setOpenError] = createSignal('')
  const openSignIn = async ({ taskId, providerId, account }: NonNullable<ReturnType<typeof signInTarget>>) => {
    setOpening(true)
    setOpenError('')
    try {
      const { terminalSessionId } = await managedAgentApi.openAccountTerminal(taskId, providerId, account, true)
      setTerminalOpen(taskId, true)
      requestTerminalFocusIntent(taskId, terminalSessionId)
    } catch (caught) {
      setOpenError(caught instanceof Error ? caught.message : 'Could not open a sign-in terminal.')
    } finally {
      setOpening(false)
    }
  }
  const title = () =>
    failure() === 'instruction_review_required'
      ? 'Review instructions to continue'
      : failure() === 'instruction_hidden_characters'
        ? 'Hidden characters in instruction files'
        : failure()
          ? 'Instruction check could not finish'
          : signIn()
            ? `Sign in to the ${signIn()!.account} account to continue`
            : props.error.code === 'turn_dispatch_failed'
              ? 'The agent could not start this turn'
              : 'Agent error'
  return (
    <Alert
      variant="banner"
      tone={failure() ? 'warn' : 'danger'}
      title={title()}
      actions={
        <>
          <Show when={failure()}>
            <Button
              size="sm"
              onPress={() => clientEvents.emit('presentation:open-settings', { tab: 'security#agent-instructions' })}
            >
              Review instructions
            </Button>
          </Show>
          <Show when={signIn()}>
            {(target) => (
              <Button size="sm" busy={opening()} onPress={() => void openSignIn(target())}>
                Sign in
              </Button>
            )}
          </Show>
        </>
      }
    >
      <Stack gap="row">
        <Text wrap>
          {failure() === 'instruction_review_required'
            ? 'Your instructions need approval before the agent can use them. Review them in Security and backup, then send your message again.'
            : props.error.message}
        </Text>
        <Show when={signIn()}>
          <Text wrap>Sign in from the terminal that opens, then send your message again.</Text>
        </Show>
        <Show when={openError()}>
          <Text tone="danger" wrap>
            {openError()}
          </Text>
        </Show>
        <Fold label="Error details" defaultOpen={false}>
          <Show when={failure()}>
            <Text wrap>{props.error.message}</Text>
          </Show>
          <Text emphasis="muted">{props.error.code}</Text>
        </Fold>
      </Stack>
    </Alert>
  )
}

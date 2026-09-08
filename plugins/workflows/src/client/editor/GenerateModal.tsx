import { createSignal, onCleanup, Show } from 'solid-js'
import {
  Alert,
  Button,
  defaultModelIdFor,
  Modal,
  ModelConnectionPicker,
  Text,
  Textarea,
} from '@acorn/plugin-api/ui'
import type { AvailableModelConnection } from '@acorn/protocol/modelProviders.ts'
import {
  GENERATE_MAX_DESCRIPTION_CHARS,
  type WorkflowGenerateRequest,
  type WorkflowGenerateResult,
} from '../../shared/api'
import { workflowApi } from '../workflowsClient'

// Describe a workflow, get the whole definition (docs/workflows.md § Authoring). The prompt, the
// grounding and the repair pass all live on the node; this collects three things and shows what
// came back.
//
// Kit nodes only, so the terminal host draws the same dialog. `ModelConnectionPicker` is two
// `Select`s, which is why it needs no counterpart there.

/** What a failed generate says above the buttons.
 *
 *  Matched on the error envelope's `code` rather than on an `ApiError` instance, the way the changes
 *  plugin's wand does it: the class is not on the plugin surface, and the code is the part of the
 *  envelope that is a contract (docs/api-reference.md § Errors). The 422 is the exception: the node
 *  put its own sentence in `message` there, and it says which of the four ways the reply failed. */
export function generateReason(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? String((error as { code: unknown }).code) : ''
  const message = error instanceof Error && error.message ? error.message : ''
  if (code === 'model_answer_unusable') return message || 'Nothing in the reply could be read as a workflow.'
  if (code === 'provider_needs_auth') return 'The provider key was rejected. Reconnect it in Settings, under Integrations.'
  if (code === 'provider_not_connected') return 'That provider is no longer connected. Pick another, or add one in Settings, under Integrations.'
  if (code === 'provider_unavailable') return 'The provider did not answer. Try again shortly.'
  return message || 'Writing the workflow failed.'
}

export default function GenerateModal(props: {
  connections: AvailableModelConnection[]
  /** Everything the request carries that this dialog does not ask for: the workspace to read worked
   *  examples from, the definition to leave out of them, and the draft's name and inputs. */
  context: Omit<WorkflowGenerateRequest, 'connectionId' | 'modelId' | 'description'>
  onDismiss: () => void
  onGenerated: (result: WorkflowGenerateResult) => void
}) {
  const [description, setDescription] = createSignal('')
  const [connectionId, setConnectionId] = createSignal(props.connections[0]?.connection.id ?? '')
  const [modelId, setModelId] = createSignal(defaultModelIdFor(props.connections[0]))
  const [busy, setBusy] = createSignal(false)
  const [seconds, setSeconds] = createSignal(0)
  const [error, setError] = createSignal('')

  // A count, not a spinner. Two model calls at a 60-second ceiling each means a press that sits for
  // two minutes is working, and a spinner that long reads as wedged.
  let ticker: ReturnType<typeof setInterval> | undefined
  onCleanup(() => clearInterval(ticker))

  // Escape and a backdrop click go through the same gate the Cancel button does. Nothing calls a
  // generation off once it has been asked for, so a dialog that vanished on a stray press would let
  // the reply land two minutes later on top of whatever was edited in between. Before the press both
  // gestures dismiss the way they do in every other dialog, which is why the guard is `busy()` and
  // not `dismissOn={[]}` the way ../../../onboarding/src/client/OnboardingWizard.tsx has it: that
  // prop is read once, when the dialog mounts, on both hosts.
  const dismiss = (): void => {
    if (!busy()) props.onDismiss()
  }

  const generate = async (): Promise<void> => {
    if (busy() || !description().trim() || !connectionId()) return
    setBusy(true)
    setError('')
    setSeconds(0)
    ticker = setInterval(() => setSeconds((n) => n + 1), 1000)
    try {
      props.onGenerated(await workflowApi.generateDef({
        ...props.context,
        connectionId: connectionId(),
        ...(modelId() ? { modelId: modelId() } : {}),
        description: description().trim(),
      }))
    } catch (failure) {
      setError(generateReason(failure))
    } finally {
      clearInterval(ticker)
      setBusy(false)
    }
  }

  return (
    <Modal title="Generate a workflow" onDismiss={dismiss} size="md">
      <Modal.Body>
        <Textarea
          label="Description"
          rows={8}
          maxLength={GENERATE_MAX_DESCRIPTION_CHARS}
          assist={false}
          disabled={busy()}
          placeholder="Say what should happen, what runs at the same time, and where you want to approve before it goes on."
          value={description()}
          // Typed, because the terminal host's `Textarea` declares `ref` as `unknown`.
          ref={(el: HTMLTextAreaElement) => queueMicrotask(() => el.focus())}
          onInput={(value: string) => setDescription(value)}
        />
        <Text emphasis="muted" wrap>
          It replaces the whole draft. One Undo puts back what is there now.
        </Text>
        <ModelConnectionPicker
          connections={props.connections}
          connectionId={connectionId()}
          modelId={modelId()}
          onChange={(pick: { connectionId: string; modelId: string }) => {
            setConnectionId(pick.connectionId)
            setModelId(pick.modelId)
          }}
        />
        <Show when={busy()}>
          <Alert tone="muted" title={`Writing it. ${seconds()}s so far`}>
            <Text wrap>The model writes a draft and then checks its own answer, so a couple of minutes is normal.</Text>
          </Alert>
        </Show>
        <Show when={error()}>{(reason) => <Alert>{reason()}</Alert>}</Show>
      </Modal.Body>
      <Modal.Actions>
        <Button variant="bare" disabled={busy()} onPress={dismiss}>Cancel</Button>
        <Button variant="solid" busy={busy()} disabled={busy() || !description().trim()} onPress={() => void generate()}>
          Generate
        </Button>
      </Modal.Actions>
    </Modal>
  )
}

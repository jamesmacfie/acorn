import { createResource, createSignal, Show } from 'solid-js'
import {
  Alert,
  Button,
  defaultModelIdFor,
  EmptyState,
  Field,
  Icon,
  Modal,
  ModalActions,
  ModalBody,
  ModelBackendPicker,
  Text,
  Textarea,
} from '@acorn/plugin-api/ui/tree'
import type { AcornBridge } from '@acorn/plugin-api/ui/sdk'
import { HARNESS_BACKEND_PREFIX, type ModelBackend } from '@acorn/protocol/modelProviders.ts'
import { GUIDE_CONTEXT_MAX_CHARS, type GenerateRequest } from '../shared/guide'

export const errorMessage = (error: unknown) =>
  error instanceof Error && error.message ? error.message : 'Something went wrong. Try again.'

type Pick = { backendId: string; modelId: string }

/** Pick the harness and its model, and add any context, before the guide is written. The harnesses
 *  come as `harness:<profileId>` backends, so the picker is the one the app's other AI dialogs draw. */
export function GenerateModal(props: {
  bridge: AcornBridge
  title: string
  /** The person's saved harness, which the picker starts on. */
  profileId: string | null
  onGenerate: (request: GenerateRequest) => Promise<void>
  onDismiss: () => void
}) {
  // Read when the dialog opens, because a live model list can start the harness's CLI.
  const [backends] = createResource(
    async () => (await props.bridge.api.get<{ backends: ModelBackend[] }>('/v1/p/review-guide/backends')).backends,
  )
  // Reading a failed resource throws, so read it only once it's ready.
  const list = () => (backends.state === 'ready' ? backends() : [])
  const [picked, setPicked] = createSignal<Pick | null>(null)
  const [context, setContext] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')

  const pick = (): Pick | null => {
    if (picked()) return picked()
    const saved = list().find((backend) => backend.id === `${HARNESS_BACKEND_PREFIX}${props.profileId}`) ?? list()[0]
    return saved ? { backendId: saved.id, modelId: defaultModelIdFor(saved) } : null
  }

  // A sent generation can't be taken back here; Stop in the toolbar ends it.
  const dismiss = () => {
    if (!busy()) props.onDismiss()
  }

  const generate = async () => {
    const chosen = pick()
    if (!chosen || busy()) return
    setBusy(true)
    setError('')
    try {
      await props.onGenerate({
        profileId: chosen.backendId.slice(HARNESS_BACKEND_PREFIX.length),
        ...(chosen.modelId ? { model: chosen.modelId } : {}),
        ...(context().trim() ? { context: context().trim() } : {}),
      })
      props.onDismiss()
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={props.title} onDismiss={dismiss}>
      <ModalBody>
        <Text tone="muted" wrap>
          The harness reads the change in this task's worktree and arranges it for review.
        </Text>
        <Field label="Extra context (optional)">
          <Textarea
            rows={4}
            maxLength={GUIDE_CONTEXT_MAX_CHARS}
            assist={false}
            autofocus
            placeholder="What should the guide focus on? Who is reviewing it?"
            value={context()}
            disabled={busy()}
            onChange={(value: string) => setContext(value)}
          />
        </Field>
        <Show
          when={!backends.loading}
          fallback={
            <EmptyState align="start" busy>
              Loading the harnesses…
            </EmptyState>
          }
        >
          <Show
            when={pick()}
            fallback={<Alert>{backends.error ? errorMessage(backends.error) : 'No harness can write a guide.'}</Alert>}
          >
            {(chosen) => (
              <ModelBackendPicker
                backends={list()}
                backendId={chosen().backendId}
                modelId={chosen().modelId}
                onChange={(next: Pick) => setPicked(next)}
              />
            )}
          </Show>
        </Show>
        <Show when={error()}>{(text) => <Alert>{text()}</Alert>}</Show>
      </ModalBody>
      <ModalActions>
        <Button variant="ghost" disabled={busy()} onPress={dismiss}>
          Cancel
        </Button>
        <Button variant="solid" busy={busy()} disabled={!pick()} onPress={() => void generate()}>
          <Icon name="sparkles" />
          Generate
        </Button>
      </ModalActions>
    </Modal>
  )
}

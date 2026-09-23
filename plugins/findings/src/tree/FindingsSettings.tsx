import { createResource, createSignal, Show } from 'solid-js'
import type { AcornBridge } from '@acorn/plugin-api/ui/sdk'
import { Alert, Button, Checkbox, Field, Heading, ModelBackendPicker, Stack, Text, defaultModelIdFor } from '@acorn/plugin-api/ui/tree'
import { DEFAULT_FINDINGS_SETTINGS, type FindingsReviewSettings } from '../contract/lifecycle'
import { findingsTreeClient } from './findingsClient'

export function FindingsSettings(props: { bridge: AcornBridge }) {
  const api = findingsTreeClient(props.bridge)
  const [loaded] = createResource(() => api.settings())
  const [catalog, { refetch: refetchCatalog }] = createResource(() => api.modelBackends())
  const [edited, setEdited] = createSignal<FindingsReviewSettings | null>(null)
  const [error, setError] = createSignal<string | null>(null)
  const [refreshing, setRefreshing] = createSignal(false)
  const settings = () => edited() ?? loaded() ?? DEFAULT_FINDINGS_SETTINGS
  const backends = () => catalog()?.backends ?? []
  const save = async (patch: Partial<FindingsReviewSettings>) => {
    const previous = settings()
    const next = { ...previous, ...patch }
    setEdited(next)
    setError(null)
    try { setEdited(await api.saveSettings(next)) }
    catch (reason) { setEdited(previous); setError(reason instanceof Error ? reason.message : String(reason)) }
  }
  const chosen = () => backends().find((backend) => backend.id === settings().backendId) ?? backends()[0]
  const setArchiveReview = (enabled: boolean) => {
    if (!enabled) return void save({ backendId: null, modelId: null })
    const backend = chosen()
    if (!backend) return
    void save({ backendId: backend.id, modelId: defaultModelIdFor(backend) || null })
  }
  const refreshModels = async () => {
    setRefreshing(true)
    setError(null)
    try { await refetchCatalog() }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setRefreshing(false) }
  }

  return (
    <Stack gap="section">
      <Heading level={3}>Findings</Heading>
      <Text tone="muted" wrap>Findings quietly records bounded evidence at completion boundaries. Recording does not run a model.</Text>
      <Show when={error()}>{(detail) => <Alert tone="danger">{detail()}</Alert>}</Show>
      <Field label="Memory review">
        <Show when={backends().length} fallback={<Alert tone="warn">No model backend is available. Findings will still be recorded, but memory suggestions cannot be prepared.</Alert>}>
          <Stack gap="row">
            <Checkbox label="Prepare memory suggestions when I archive a task" checked={!!settings().backendId} onChange={setArchiveReview} />
            <Show when={!!settings().backendId}>
              <Stack gap="row">
                <Text tone="muted" wrap>Using {chosen()?.label ?? 'the selected backend'}.</Text>
                <ModelBackendPicker
                  backends={backends()}
                  backendId={settings().backendId ?? ''}
                  modelId={settings().modelId ?? defaultModelIdFor(chosen())}
                  onChange={(pick: { backendId: string; modelId: string }) => void save({ backendId: pick.backendId || null, modelId: pick.modelId || null })}
                />
                <Show when={chosen()?.catalogUnavailable}>
                  <Button label="Retry model list" busy={refreshing()} onPress={() => void refreshModels()} />
                </Show>
              </Stack>
            </Show>
          </Stack>
        </Show>
      </Field>
      <Checkbox label="Notify me when a prepared review bundle is ready" checked={settings().notifyWhenReady} onChange={(notifyWhenReady: boolean) => void save({ notifyWhenReady })} />
      <Text tone="muted" wrap>Closing a task queues the review in the background. A preparation failure never changes task or workflow success.</Text>
    </Stack>
  )
}

import { createResource, createSignal, Show } from 'solid-js'
import type { AcornBridge } from '@acorn/plugin-api/ui/sdk'
import { Alert, Checkbox, Field, Heading, ModelBackendPicker, Select, Stack, Text, defaultModelIdFor } from '@acorn/plugin-api/ui/tree'
import { DEFAULT_FINDINGS_SETTINGS, type FindingsReviewSettings } from '../contract/lifecycle'
import { findingsTreeClient } from './findingsClient'

export function FindingsSettings(props: { bridge: AcornBridge }) {
  const api = findingsTreeClient(props.bridge)
  const [loaded] = createResource(() => Promise.all([api.settings(), api.modelBackends(), api.reviewTargets()]))
  const [edited, setEdited] = createSignal<FindingsReviewSettings | null>(null)
  const [error, setError] = createSignal<string | null>(null)
  const settings = () => edited() ?? loaded()?.[0] ?? DEFAULT_FINDINGS_SETTINGS
  const backends = () => loaded()?.[1].backends ?? []
  const targets = () => loaded()?.[2] ?? []
  const targetIds = () => targets().map((target) => target.id)
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
    const targetId = settings().targetId
    void save({ backendId: backend.id, modelId: defaultModelIdFor(backend) || null, targetId: targetId && targetIds().includes(targetId) ? targetId : targets()[0]?.id ?? null })
  }

  return (
    <Stack gap="section">
      <Heading level={3}>Findings</Heading>
      <Text tone="muted" wrap>Findings quietly records bounded evidence at completion boundaries. Recording does not run a model.</Text>
      <Show when={error()}>{(detail) => <Alert tone="danger">{detail()}</Alert>}</Show>
      <Field label="Automatic review">
        <Show when={backends().length && targets().length} fallback={<Alert tone="warn">A model backend and review target are needed to prepare suggestions. Findings will still be recorded.</Alert>}>
          <Stack gap="row">
            <Checkbox label="Prepare suggestions when I archive a task" checked={!!settings().backendId && targetIds().includes(settings().targetId ?? '')} onChange={setArchiveReview} />
            <Show when={!!settings().backendId}>
              <Stack gap="row">
                <Text tone="muted" wrap>Using {chosen()?.label ?? 'the selected backend'}.</Text>
                <Select label="Review target" value={settings().targetId ?? ''} options={targets().map((target) => ({ value: target.id, label: target.label }))} onChange={(targetId: string) => void save({ targetId })} />
                <ModelBackendPicker
                  backends={backends()}
                  backendId={settings().backendId ?? ''}
                  modelId={settings().modelId ?? defaultModelIdFor(chosen())}
                  onChange={(pick: { backendId: string; modelId: string }) => void save({ backendId: pick.backendId || null, modelId: pick.modelId || null })}
                />
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

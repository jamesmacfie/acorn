import { createResource, createSignal, Show } from 'solid-js'
import type { AcornBridge } from '@acorn/plugin-api/ui/sdk'
import { Alert, Checkbox, Field, Heading, ModelBackendPicker, Stack, Text, defaultModelIdFor } from '@acorn/plugin-api/ui/tree'
import { DEFAULT_FINDINGS_SETTINGS, type FindingsReviewSettings } from '../contract/lifecycle'
import { findingsTreeClient } from './findingsClient'

export function FindingsSettings(props: { bridge: AcornBridge }) {
  const api = findingsTreeClient(props.bridge)
  const [loaded] = createResource(() => Promise.all([api.settings(), api.modelBackends()]))
  const [edited, setEdited] = createSignal<FindingsReviewSettings | null>(null)
  const [error, setError] = createSignal<string | null>(null)
  const settings = () => edited() ?? loaded()?.[0] ?? DEFAULT_FINDINGS_SETTINGS
  const backends = () => loaded()?.[1].backends ?? []
  const save = async (patch: Partial<FindingsReviewSettings>) => {
    const previous = settings()
    const next = { ...previous, ...patch }
    setEdited(next)
    setError(null)
    try { setEdited(await api.saveSettings(next)) }
    catch (reason) { setEdited(previous); setError(reason instanceof Error ? reason.message : String(reason)) }
  }
  const chosen = () => backends().find((backend) => backend.id === settings().backendId) ?? backends()[0]

  return (
    <Stack gap="section">
      <Heading level={3}>Findings</Heading>
      <Text tone="muted" wrap>Findings quietly records bounded evidence at completion boundaries. Recording does not run a model.</Text>
      <Show when={error()}>{(detail) => <Alert tone="danger">{detail()}</Alert>}</Show>
      <Checkbox label="Automatically prepare memory suggestions at workflow, terminal, and archive boundaries" checked={settings().automaticPreparation} onChange={(automaticPreparation: boolean) => void save({ automaticPreparation })} />
      <Show when={settings().automaticPreparation}>
        <Field label="Prepare suggestions with">
          <Show when={backends().length} fallback={<Alert tone="warn">No model backend is available. Findings will still be recorded.</Alert>}>
            <ModelBackendPicker
              backends={backends()}
              backendId={settings().backendId ?? ''}
              modelId={settings().modelId ?? (chosen() ? defaultModelIdFor(chosen()!) : '')}
              onChange={(pick: { backendId: string; modelId: string }) => void save({ backendId: pick.backendId || null, modelId: pick.modelId || null })}
            />
          </Show>
        </Field>
      </Show>
      <Checkbox label="Notify me when a prepared review bundle is ready" checked={settings().notifyWhenReady} onChange={(notifyWhenReady: boolean) => void save({ notifyWhenReady })} />
      <Text tone="muted" wrap>Both options are off by default. A preparation failure never changes task or workflow success.</Text>
    </Stack>
  )
}

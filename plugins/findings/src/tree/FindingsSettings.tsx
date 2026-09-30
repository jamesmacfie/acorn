import { createResource, createSignal, Show } from 'solid-js'
import type { AcornBridge } from '@acorn/plugin-api/ui/sdk'
import { Alert, Button, Checkbox, ModelBackendPicker, Select, SettingRow, SettingsSection, defaultModelIdFor } from '@acorn/plugin-api/ui/tree'
import { DEFAULT_FINDINGS_SETTINGS, type FindingsReviewSettings } from '../contract/lifecycle'
import { findingsTreeClient } from './findingsClient'

// Settings → Review after archive. A remote tree, so each row's error is a signal here: the host
// header names the page, and the sections match the ones the manifest declares for search. Every
// control is a switch, a select or the model picker, which save on change and show their own state,
// so a failed write puts the old value back and names the failure on its row.
type RowId = 'archive' | 'target' | 'model' | 'notify'

export function FindingsSettings(props: { bridge: AcornBridge }) {
  const api = findingsTreeClient(props.bridge)
  const [loaded] = createResource(() => api.settings())
  const [catalog, { refetch: refetchCatalog }] = createResource(() => api.modelBackends())
  const [reviewTargets] = createResource(() => api.reviewTargets())
  const [edited, setEdited] = createSignal<FindingsReviewSettings | null>(null)
  const [failure, setFailure] = createSignal<{ row: RowId; message: string } | null>(null)
  const [refreshing, setRefreshing] = createSignal(false)
  const settings = () => edited() ?? loaded() ?? DEFAULT_FINDINGS_SETTINGS
  const backends = () => catalog()?.backends ?? []
  const targets = () => reviewTargets() ?? []
  const targetIds = () => targets().map((target) => target.id)
  const errorOn = (row: RowId) => {
    const failed = failure()
    return failed?.row === row ? failed.message : undefined
  }
  const messageOf = (reason: unknown) => reason instanceof Error ? reason.message : String(reason)
  const save = async (row: RowId, patch: Partial<FindingsReviewSettings>) => {
    const previous = settings()
    const next = { ...previous, ...patch }
    setEdited(next)
    setFailure(null)
    try { setEdited(await api.saveSettings(next)) }
    catch (reason) { setEdited(previous); setFailure({ row, message: messageOf(reason) }) }
  }
  const chosen = () => backends().find((backend) => backend.id === settings().backendId) ?? backends()[0]
  const setArchiveReview = (enabled: boolean) => {
    if (!enabled) return void save('archive', { backendId: null, modelId: null })
    const backend = chosen()
    if (!backend) return
    const targetId = settings().targetId
    void save('archive', { backendId: backend.id, modelId: defaultModelIdFor(backend) || null, targetId: targetId && targetIds().includes(targetId) ? targetId : targets()[0]?.id ?? null })
  }
  const refreshModels = async () => {
    setRefreshing(true)
    setFailure(null)
    try { await refetchCatalog() }
    catch (reason) { setFailure({ row: 'model', message: messageOf(reason) }) }
    finally { setRefreshing(false) }
  }

  return (
    <>
      <SettingsSection
        id="review"
        label="Automatic review"
        description="Findings quietly records bounded evidence at completion boundaries. Recording does not run a model. Closing a task queues the review in the background, and a preparation failure never changes task or workflow success."
      >
        <Show when={backends().length && targets().length} fallback={<Alert tone="warn">A model backend and review target are needed to prepare suggestions. Findings will still be recorded.</Alert>}>
          <SettingRow label="Prepare suggestions when I archive a task" error={errorOn('archive')}>
            <Checkbox switch ariaLabel="Prepare suggestions when I archive a task" checked={!!settings().backendId && targetIds().includes(settings().targetId ?? '')} onChange={setArchiveReview} />
          </SettingRow>
          <Show when={!!settings().backendId}>
            <SettingRow label="Review target" error={errorOn('target')}>
              <Select label="Review target" value={settings().targetId ?? ''} options={targets().map((target) => ({ value: target.id, label: target.label }))} onChange={(targetId: string) => void save('target', { targetId })} />
            </SettingRow>
            <SettingRow label="Model" description={`Using ${chosen()?.label ?? 'the selected backend'}.`} layout="stacked" error={errorOn('model')}>
              <ModelBackendPicker
                backends={backends()}
                backendId={settings().backendId ?? ''}
                modelId={settings().modelId ?? defaultModelIdFor(chosen())}
                onChange={(pick: { backendId: string; modelId: string }) => void save('model', { backendId: pick.backendId || null, modelId: pick.modelId || null })}
              />
              <Show when={chosen()?.catalogUnavailable}>
                <Button label="Retry model list" busy={refreshing()} onPress={() => void refreshModels()} />
              </Show>
            </SettingRow>
          </Show>
        </Show>
      </SettingsSection>
      <SettingsSection id="notifications" label="Notifications">
        <SettingRow label="Notify me when a prepared review bundle is ready" error={errorOn('notify')}>
          <Checkbox switch ariaLabel="Notify me when a prepared review bundle is ready" checked={settings().notifyWhenReady} onChange={(notifyWhenReady: boolean) => void save('notify', { notifyWhenReady })} />
        </SettingRow>
      </SettingsSection>
    </>
  )
}

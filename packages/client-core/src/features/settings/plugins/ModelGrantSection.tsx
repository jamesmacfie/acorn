import { createEffect, createMemo, createSignal, on, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import type { PluginModelGrantState } from '@acorn/protocol/modelProviders.ts'
import { readPluginModelGrant, removePluginModelGrant, savePluginModelGrant } from '../../../infra/node/nodePlugins'
import { Alert, Button, Input, Meter } from '../../../kit/components/primitives'
import { Text } from '../../../kit/components/content/Text'
import { Inline } from '../../../kit/components/layout/Inline'
import { SettingRow } from '../../../kit/components/layout/SettingRow'
import { SettingsSection } from '../../../kit/components/layout/SettingsSection'
import ModelBackendPicker, { defaultModelIdFor } from '../models/ModelBackendPicker'
import { createSettingSave } from '../settingSave'

// The model a plugin holding `models` spends when it names none, and how much of it per day
// (docs/integrations/model-providers.md § Plugin model grants). The Node holds the grant and checks
// every save; this section reads and writes it on the active Node, through that Node's query cache.

const DEFAULT_ALLOWANCE = 50_000
// Versioned: the cache persists, and a later shape must not be read as this one.
const grantKey = (pluginId: string) => ['plugin-model-grant', 'v1', pluginId] as const
const count = (value: number) => value.toLocaleString()

const STATUS_TEXT: Record<Exclude<PluginModelGrantState['status'], 'ready'>, string> = {
  unconfigured: 'Not set up. Until you choose a model, this plugin can\'t generate text without naming a backend itself.',
  'backend-missing': 'The chosen backend isn\'t available on this Node. Choose another, or reconnect it.',
  exhausted: 'Today\'s allowance is used up. Calls are refused until midnight on this Node.',
}

export function ModelGrantSection(props: { pluginId: string }) {
  const qc = useQueryClient()
  const grant = createQuery(() => ({
    queryKey: grantKey(props.pluginId),
    queryFn: ({ signal }: { signal?: AbortSignal }) => readPluginModelGrant(props.pluginId, signal),
    // Usage moves while the plugin works, so an open page keeps up.
    refetchInterval: 15_000,
  }))
  const [backendId, setBackendId] = createSignal('')
  const [modelId, setModelId] = createSignal('')
  const [allowance, setAllowance] = createSignal(String(DEFAULT_ALLOWANCE))
  // The draft starts from what the Node holds, and from the first backend when nothing is chosen yet.
  // Keyed on the stored grant, a string, so a refetch that only moved the usage leaves an edit alone.
  const stored = createMemo(() => grant.data && JSON.stringify([grant.data.grant, grant.data.backends[0]?.id]))
  createEffect(on(stored, () => {
    const state = grant.data
    if (!state) return
    const first = state.backends[0]
    setBackendId(state.grant?.backendId ?? first?.id ?? '')
    setModelId(state.grant?.modelId ?? defaultModelIdFor(first))
    setAllowance(String(state.grant?.dailyOutputTokens ?? DEFAULT_ALLOWANCE))
  }))
  const save = createSettingSave()
  const settle = (state?: PluginModelGrantState) =>
    state ? qc.setQueryData(grantKey(props.pluginId), state) : qc.invalidateQueries({ queryKey: grantKey(props.pluginId) })

  return (
    <SettingsSection id="model" label="Model" description="What this plugin spends when it generates text on its own.">
      <Show when={grant.error}><Alert tone="danger">Couldn't read this plugin's model. {String(grant.error)}</Alert></Show>
      <Show when={grant.data}>
        {(state) => (
          <>
            <Show when={state().status !== 'ready'}>
              <Alert tone={state().status === 'unconfigured' ? 'muted' : 'warn'} variant="banner">
                {STATUS_TEXT[state().status as Exclude<PluginModelGrantState['status'], 'ready'>]}
              </Alert>
            </Show>
            <Show when={state().backends.length} fallback={<Text tone="muted" wrap>Connect a model provider or install an agent CLI first, in Settings › AI models.</Text>}>
              <SettingRow label="Generate with" error={save.error()} savedAt={save.savedAt()}>
                <ModelBackendPicker
                  backends={state().backends}
                  backendId={backendId()}
                  modelId={modelId()}
                  onChange={(pick) => { setBackendId(pick.backendId); setModelId(pick.modelId) }}
                />
              </SettingRow>
              <SettingRow
                label="Daily allowance"
                description={`Output tokens per day. An agent CLI call counts as ${count(state().harnessCallEstimate)}, whatever it reports, because a CLI can't be held to a token limit.`}
              >
                <Input type="number" min={1} step={1000} width="narrow" label="Daily allowance in output tokens" value={allowance()} onChange={setAllowance} />
              </SettingRow>
              <Inline>
                <Button
                  variant="solid"
                  size="sm"
                  onPress={() => void save.run(async () => settle(await savePluginModelGrant(props.pluginId, {
                    backendId: backendId(), modelId: modelId(), dailyOutputTokens: Number(allowance()),
                  })))}
                >
                  Save
                </Button>
                <Show when={state().grant}>
                  <Button size="sm" onPress={() => void save.run(async () => { await removePluginModelGrant(props.pluginId); await settle() })}>
                    Remove
                  </Button>
                </Show>
              </Inline>
            </Show>
            <Show when={state().grant}>
              {(chosen) => (
                <SettingRow
                  label="Today"
                  description={`${count(state().usage.spent)} of ${count(chosen().dailyOutputTokens)} output tokens over ${count(state().usage.calls)} ${state().usage.calls === 1 ? 'call' : 'calls'}`
                    + (state().usage.reserved ? `, ${count(state().usage.reserved)} held for calls still running.` : '.')}
                >
                  <Meter tone="auto" label="Today's allowance used" value={state().usage.spent / chosen().dailyOutputTokens} />
                </SettingRow>
              )}
            </Show>
            <Text tone="muted" wrap>
              The allowance covers calls where this plugin lets acorn choose the model. It can still name a backend itself,
              which this doesn't limit{state().usage.explicitCalls ? `: it did that ${count(state().usage.explicitCalls)} times today` : ''}.
              A call that fails or is cancelled stays counted, because the provider may already have charged for it.
            </Text>
          </>
        )}
      </Show>
    </SettingsSection>
  )
}

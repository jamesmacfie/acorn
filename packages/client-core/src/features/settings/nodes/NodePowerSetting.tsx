import { createResource, createSignal, Show } from 'solid-js'
import { KEEP_AWAKE_PREF_KEY } from '@acorn/protocol/api.ts'
import { readNodePower } from '../../../infra/node/fleetActions'
import { Alert, Checkbox } from '../../../kit/components/primitives'
import { setPref } from '../savePref'

// Whether a Node keeps its computer awake while agents work or workflows run
// (docs/node-distribution/keep-awake.md). On every row, because it's an ordinary owner preference that
// a client on another machine may change. The Node applies a change when this re-reads its state.
export function NodePowerSetting(props: { nodeId: string }) {
  // A Node from an earlier build has no route, so its row leaves the switch out.
  const [power, { refetch }] = createResource(
    () => props.nodeId,
    (nodeId) => readNodePower(nodeId).catch(() => undefined),
  )
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')

  const save = async (on: boolean) => {
    setBusy(true)
    setError('')
    try {
      await setPref(KEEP_AWAKE_PREF_KEY, on ? 'while-busy' : 'never', props.nodeId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      await refetch()
      setBusy(false)
    }
  }

  return (
    <Show when={power()}>
      {(current) => (
        <>
          <Checkbox
            switch
            label="Keep this computer awake while agents work"
            hint={
              current().available
                ? "The computer stays awake while an agent works or waits for you, or a workflow runs. Closing a laptop's lid can still sleep it."
                : 'Unavailable on this computer'
            }
            checked={current().setting === 'while-busy'}
            disabled={busy()}
            onChange={(on) => void save(on)}
          />
          <Show when={error()}>
            <Alert>{error()}</Alert>
          </Show>
        </>
      )}
    </Show>
  )
}

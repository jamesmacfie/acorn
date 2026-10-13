import { Show, createSignal } from 'solid-js'
import type { NodeProbeResult, NodeRecord } from '@acorn/protocol/broker.ts'
import { fingerprintPhrase } from '@acorn/protocol/fingerprintWords.ts'
import { CallFailure } from '../messages'
import type { BridgeClient } from './bridgeClient'
import { errorGuidance } from './guidance'

// Probe, compare, pair. The identity words come from the certificate the address presented, and the
// person compares them with what the Node itself shows before the code field appears. That
// comparison is what makes pairing safe, so it is a step rather than a field to skip.
export function Pairing(props: { client: BridgeClient; onPaired(node: NodeRecord): void; onCancel(): void }) {
  const [address, setAddress] = createSignal('https://')
  const [probe, setProbe] = createSignal<NodeProbeResult | null>(null)
  const [confirmed, setConfirmed] = createSignal(false)
  const [code, setCode] = createSignal('')
  const [label, setLabel] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)

  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await work()
    } catch (failure) {
      setError(failure instanceof CallFailure ? errorGuidance(failure) : String(failure))
    } finally {
      setBusy(false)
    }
  }

  const check = (event: SubmitEvent) => {
    event.preventDefault()
    setProbe(null)
    setConfirmed(false)
    void run(async () => {
      const result = await props.client.call({ op: 'node.probe', endpoint: address().trim() })
      setProbe(result)
      setLabel(new URL(result.endpoint).host)
    })
  }

  const pair = (event: SubmitEvent) => {
    event.preventDefault()
    void run(async () => {
      props.onPaired(await props.client.call({ op: 'node.pair', code: code().trim(), label: label().trim() }))
    })
  }

  return (
    <section class="card" aria-label="Pair a Node">
      <h2>Pair a Node</h2>
      <form onSubmit={check}>
        <label>
          Node address
          <input
            name="address"
            type="url"
            required
            value={address()}
            onInput={(event) => setAddress(event.currentTarget.value)}
          />
        </label>
        <div class="row">
          <button type="submit" disabled={busy()}>
            Check identity
          </button>
          <button type="button" class="quiet" onClick={() => props.onCancel()}>
            Cancel
          </button>
        </div>
      </form>
      <Show when={probe()}>
        {(result) => (
          <Show
            when={result().compatible}
            fallback={
              <p class="problem" role="alert">
                {result().endpoint} speaks Acorn protocol {result().protocolVersion}, which this bridge can't use.
                Update whichever side is older.
              </p>
            }
          >
            <div class="identity">
              <p>Compare these words with the ones the Node shows:</p>
              <p class="words" data-testid="identity-words">
                {fingerprintPhrase(result().fingerprint) ?? result().fingerprint}
              </p>
              <label class="check">
                <input
                  name="confirm"
                  type="checkbox"
                  checked={confirmed()}
                  onChange={(event) => setConfirmed(event.currentTarget.checked)}
                />
                The words match
              </label>
            </div>
            <Show when={confirmed()}>
              <form onSubmit={pair}>
                <label>
                  Pairing code
                  <input
                    name="pairing-code"
                    required
                    autocomplete="off"
                    value={code()}
                    onInput={(event) => setCode(event.currentTarget.value)}
                  />
                </label>
                <label>
                  Name in this browser
                  <input
                    name="label"
                    required
                    value={label()}
                    onInput={(event) => setLabel(event.currentTarget.value)}
                  />
                </label>
                <button type="submit" disabled={busy()}>
                  Pair
                </button>
              </form>
            </Show>
          </Show>
        )}
      </Show>
      <Show when={error()}>
        <p class="problem" role="alert">
          {error()}
        </p>
      </Show>
    </section>
  )
}

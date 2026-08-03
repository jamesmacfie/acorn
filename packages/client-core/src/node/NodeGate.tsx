import { createSignal, Match, Show, Switch } from 'solid-js'
import Acorn from '../Acorn'
import { acornGlobal } from '../capabilities'
import { nodeReadiness, selectActiveNode } from './activeNode'

// The shell's pre-flight screen, in the slot LoginGate used to hold. It answers a different question:
// not "who are you?" (there is no account any more) but "is there a node to talk to?".
//
// With a bundled local node the only reachable state is `starting`, and only for as long as the broker
// takes to answer — Electron main starts and adopts the local node before the window loads. The other
// two are the recovery screen docs/vNext/architecture.md § Failure behavior calls for: never a silent
// fresh data root, always the owner's decision.
export default function NodeGate() {
  const [showReason, setShowReason] = createSignal(false)
  const readiness = nodeReadiness

  return (
    <main class="node-gate">
      <Switch>
        <Match when={readiness().kind === 'starting'}>
          <Acorn label="starting local node…" />
        </Match>
        <Match when={readiness().kind === 'unpaired'}>
          <Acorn label="no node paired yet" />
          {/* Pairing itself is main-side work that lands with Settings → Nodes; until then this state
              is unreachable, because the local node is always adopted at boot. */}
          <p class="muted">Add a node from Settings → Nodes.</p>
        </Match>
        <Match when={readiness().kind === 'failed'}>
          <Acorn label="local node failed" />
          <div class="node-gate-actions">
            <button type="button" class="ui-btn" onClick={() => void selectActiveNode()}>Retry</button>
            <button type="button" class="ui-btn" aria-expanded={showReason()} onClick={() => setShowReason((v) => !v)}>
              Diagnostics
            </button>
            <Show when={acornGlobal()?.recovery}>
              {(recovery) => (
                <>
                  <button type="button" class="ui-btn" onClick={() => recovery().openDataFolder()}>Open data folder</button>
                  <button type="button" class="ui-btn" onClick={() => recovery().quit()}>Quit</button>
                </>
              )}
            </Show>
          </div>
          {/* The broker's own error text. It is the only diagnostic the renderer has — everything else
              about the failure is in main's log, which "Open data folder" is the route to. */}
          <Show when={showReason()}>
            <pre class="node-gate-reason">{failureReason(readiness())}</pre>
          </Show>
        </Match>
      </Switch>
    </main>
  )
}

const failureReason = (readiness: ReturnType<typeof nodeReadiness>): string =>
  readiness.kind === 'failed' ? readiness.reason : ''

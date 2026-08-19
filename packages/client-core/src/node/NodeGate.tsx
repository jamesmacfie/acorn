import { createSignal, Match, Show, Switch } from 'solid-js'
import Acorn from '../Acorn'
import { recoveryActions } from '../platform'
import { nodeReadiness, selectActiveNode } from './activeNode'
import { Button } from '../ui/primitives'

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
            <Button onClick={() => void selectActiveNode()}>Retry</Button>
            <Button aria-expanded={showReason()} onClick={() => setShowReason((v) => !v)}>
              Diagnostics
            </Button>
            <Show when={recoveryActions()}>
              {(recovery) => (
                <>
                  <Button onClick={() => recovery().openDataFolder()}>Open data folder</Button>
                  <Button onClick={() => recovery().quit()}>Quit</Button>
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

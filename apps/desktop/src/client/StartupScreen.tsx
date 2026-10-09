import { createSignal, Show } from 'solid-js'
import Acorn from '@acorn/client-core/kit/components/content/Acorn.tsx'
import { Button } from '@acorn/client-core/kit/components/primitives.tsx'
import { recoveryActions } from '@acorn/client-core/infra/platform'
import { failureText, startupMessage, type StartupStage } from './startupStage'

/**
 * What a launch shows until the shell or its restored content can draw. The same mark and place for
 * every stage, so only the words change. The words are about the person's workspace; a plugin
 * module name or a stack goes under Show details.
 */
export default function StartupScreen(props: { stage: StartupStage; onRetry: () => void }) {
  const [showReason, setShowReason] = createSignal(false)
  const failure = () => (props.stage.kind === 'failed' ? props.stage : undefined)

  return (
    <>
      {/* A live region, so each change of stage is announced. Busy until the stage needs the person. */}
      <div role="status" aria-busy={!failure() && props.stage.kind !== 'offline' && props.stage.kind !== 'unpaired'}>
        <Acorn label={startupMessage(props.stage)} />
      </div>
      <Show when={props.stage.kind === 'unpaired'}>
        <p class="muted">Connect a computer in Settings, under Nodes.</p>
      </Show>
      <Show when={props.stage.kind === 'offline'}>
        <p class="muted">Acorn will open your workspace when your computer is back online.</p>
        <div class="node-gate-actions">
          <Button variant="solid" onPress={props.onRetry}>Try again</Button>
        </div>
      </Show>
      <Show when={failure()}>
        {(failed) => (
          <>
            <div class="node-gate-actions">
              <Button variant="solid" onPress={props.onRetry}>Try again</Button>
              <Button expanded={showReason()} onPress={() => setShowReason((v) => !v)}>
                Show details
              </Button>
              <Show when={recoveryActions()}>
                {(recovery) => (
                  <>
                    <Button onPress={() => recovery().openDataFolder()}>Open data folder</Button>
                    <Button onPress={() => recovery().quit()}>Quit</Button>
                  </>
                )}
              </Show>
            </div>
            {/* The renderer's own words for the failure. Everything else is in the app's logs, which
                "Open data folder" is the route to. */}
            <Show when={showReason()}>
              <pre class="node-gate-reason">{failureText(failed().error)}</pre>
            </Show>
          </>
        )}
      </Show>
    </>
  )
}

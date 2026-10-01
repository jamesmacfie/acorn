/** @jsxImportSource @acorn/tui/jsx */
import { createResource, Show } from 'solid-js'
import { Dynamic } from '../tree/renderer'
import { Line } from '../kit/cells'
import { Alert, Row, Rows } from '../kit/showing'
import { Modal, ModalBody } from '../kit/grouping'

/** The Settings route and its page graph load only when the route first opens, the way setup's do
 *  (./SetupHost.tsx). */
export function SettingsHost(props: { nodeId: string; onClose: () => void; onSetup: () => void }) {
  const [component, { refetch }] = createResource(async () => (await import('./Settings')).Settings)
  return (
    <Show when={component()} fallback={
      <Modal onDismiss={props.onClose} title="Settings" size="wide">
        <ModalBody>
          <Show when={component.error} fallback={<Line role="muted">Opening settings…</Line>}>
            <Alert>{String(component.error)}</Alert>
            <Rows id="settings.load.actions" items={[{ key: 'retry', label: 'Retry' }, { key: 'close', label: 'Close' }]}
              onActivate={(key) => key === 'retry' ? void refetch() : props.onClose()}>
              {(entry, item) => <Row item={item}>{entry.label}</Row>}
            </Rows>
          </Show>
        </ModalBody>
      </Modal>
    }>
      {(ready) => <Dynamic component={ready()} nodeId={props.nodeId} onClose={props.onClose} onSetup={props.onSetup} />}
    </Show>
  )
}

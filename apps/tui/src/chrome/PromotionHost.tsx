/** @jsxImportSource @acorn/tui/jsx */
import { createResource, Show } from 'solid-js'
import { Dynamic } from '../tree/renderer'
import { Line } from '../kit/cells'
import { Alert, Row, Rows } from '../kit/showing'
import { Modal, ModalBody } from '../kit/grouping'
import { closePromotion, type PromotionRequest } from './promotionStore'

/** Source promotion is an occasional route; its task picker stays outside the first-frame graph. */
export function PromotionHost(props: { request: PromotionRequest }) {
  const [component, { refetch }] = createResource(async () => (await import('./Promotion')).Promotion)
  return (
    <Show when={component()} fallback={
      <Modal onDismiss={closePromotion} title="Create or link task" size="wide">
        <ModalBody>
          <Show when={component.error} fallback={<Line role="muted">Opening task choices…</Line>}>
            <Alert>{String(component.error)}</Alert>
            <Rows id="promotion.load.actions" items={[{ key: 'retry', label: 'Retry' }, { key: 'close', label: 'Close' }]}
              onActivate={(key) => key === 'retry' ? void refetch() : closePromotion()}>
              {(entry, item) => <Row item={item}>{entry.label}</Row>}
            </Rows>
          </Show>
        </ModalBody>
      </Modal>
    }>
      {(ready) => <Dynamic component={ready()} request={props.request} />}
    </Show>
  )
}

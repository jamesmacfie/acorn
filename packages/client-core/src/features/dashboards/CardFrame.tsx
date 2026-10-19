import { createSignal, onCleanup, Show, type JSX } from 'solid-js'
import { Button } from '../../kit/components/primitives'
import { Stack } from '../../kit/components/layout/Stack'
import './dashboards.css'

/** A transcript card's body: capped at 480 pixels with Expand, and reporting whether it is on screen,
 *  so a long conversation of cards runs only the plans someone can see. The panel card and the app
 *  card both draw in one. */
export default function CardFrame(props: { onVisible?: (visible: boolean) => void; children: JSX.Element }) {
  const [expanded, setExpanded] = createSignal(false)
  const [overflows, setOverflows] = createSignal(false)
  const watchFrame = (frame: HTMLDivElement) => {
    if (typeof IntersectionObserver === 'undefined' || typeof ResizeObserver === 'undefined')
      return void props.onVisible?.(true)
    const visibility = new IntersectionObserver(([entry]) => props.onVisible?.(!!entry?.isIntersecting))
    visibility.observe(frame)
    const size = new ResizeObserver(() => setOverflows(frame.scrollHeight > frame.clientHeight))
    size.observe(frame)
    queueMicrotask(() => frame.firstElementChild && size.observe(frame.firstElementChild))
    onCleanup(() => {
      visibility.disconnect()
      size.disconnect()
    })
  }
  return (
    <Stack gap="row">
      <div ref={watchFrame} class="dash-card-frame" data-expanded={expanded() ? '' : undefined}>
        {props.children}
      </div>
      <Show when={overflows() || expanded()}>
        <Button size="sm" variant="ghost" onPress={() => setExpanded((value) => !value)}>
          {expanded() ? 'Collapse' : 'Expand'}
        </Button>
      </Show>
    </Stack>
  )
}

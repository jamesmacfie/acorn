import { Show } from 'solid-js'
import type { Size, Tone } from '../../tokens/tokens'

/* Meter: a ratio bar. See docs/ui-design/kit-internals.md § How the kit is built for why it is a div and
   not a native <meter>.

   `label` is required, or a screen reader announces a number with nothing attached to it. `auto`
   uses context's 80% and 95% thresholds.

   `mark` is a second ratio on the same scale, drawn as a small triangle under the track: where the
   fill would sit if whatever the bar measures moved at a steady rate. It is decoration on top of the
   number the bar already announces, so it carries no separate label.

   `shape="pie"` draws the same ratio as a small disc filled clockwise from the top, for a reading
   that sits inline with text, where a bar would need a width the line does not have. A pie has no
   `mark`. `muted` is for a ratio that is information rather than a warning, such as time passing. */
const METER_WARN = 0.8
const METER_DANGER = 0.95

export function Meter(props: {
  value: number
  tone?: Extract<Tone, 'accent' | 'ok' | 'warn' | 'danger' | 'muted'> | 'auto'
  label: string
  size?: Extract<Size, 'sm' | 'md'>
  mark?: number
  shape?: 'bar' | 'pie'
}) {
  const ratio = () => Math.min(1, Math.max(0, props.value))
  const mark = () => (props.mark == null || props.shape === 'pie' ? null : Math.min(1, Math.max(0, props.mark)))
  const tone = () => {
    if (props.tone !== 'auto') return props.tone ?? 'accent'
    return ratio() >= METER_DANGER ? 'danger' : ratio() >= METER_WARN ? 'warn' : 'accent'
  }
  return (
    <div
      class="ui-meter"
      data-tone={tone()}
      data-size={props.size ?? 'sm'}
      data-shape={props.shape === 'pie' ? 'pie' : undefined}
      data-marked={mark() == null ? undefined : ''}
      role="progressbar"
      aria-label={props.label}
      aria-valuenow={Math.round(ratio() * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <span class="ui-meter-fill" style={{ '--meter-value': String(ratio()) }} />
      {/* `!= null` rather than a truthy test: a mark at 0 is the end of the window, not the absence
          of one. */}
      <Show when={mark() != null}>
        <span class="ui-meter-mark" style={{ '--meter-mark': String(mark()) }} />
      </Show>
    </div>
  )
}

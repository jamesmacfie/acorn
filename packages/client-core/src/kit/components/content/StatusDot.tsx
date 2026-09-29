import type { Size, Tone } from '../../tokens/tokens'

/* StatusDot. Tones are semantic, not domain states: the call site maps running to ok, exited to
   muted, failed to bad. No children; a dot with a label beside it is Row or Badge composition. */
export function StatusDot(props: {
  tone: Extract<Tone, 'ok' | 'warn' | 'danger' | 'muted' | 'accent'>
  /* Half this tone and half warn. A prop rather than a seventh tone, because it is two states at
     once rather than one more state: core's rail status and github's PR rows both draw it. */
  mixed?: boolean
  pulse?: boolean
  label?: string
  size?: Extract<Size, 'sm' | 'md'>
}) {
  return (
    <span
      class="ui-dot"
      data-tone={props.tone}
      data-mixed={props.mixed ? '' : undefined}
      data-size={props.size ?? 'sm'}
      data-pulse={props.pulse ? '' : undefined}
      role={props.label ? 'status' : undefined}
      aria-label={props.label}
      aria-hidden={props.label ? undefined : 'true'}
    />
  )
}

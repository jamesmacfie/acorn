/* Spinner. The rotation stays on the wrapper span rather than the svg, so a pack can swap the mark
   without touching the animation. It comes from `.ui-spinner` and not from the shared `.spin` class,
   because `.spin` stops under prefers-reduced-motion and a spinner that holds still says the opposite
   of what it is there to say. See primitives.css. */
export function Spinner(props: { size?: 'sm' | 'md'; label?: string }) {
  return (
    <span class="ui-spinner" data-size={props.size ?? 'sm'} role="status" aria-label={props.label ?? 'Working'}>
      {/* Inline Lucide loader-circle geometry, so Button does not pull in the whole icon registry
          for a busy state. */}
      <svg class="glyph" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
      </svg>
    </span>
  )
}

import { Show, type JSX } from 'solid-js'

export function QueryGate(props: {
  loading: boolean
  error: unknown
  retry?: () => void
  children: JSX.Element
  loadingLabel?: string
}) {
  return (
    <Show when={!props.loading} fallback={<div class="query-gate-loading" role="status">{props.loadingLabel ?? 'Loading…'}</div>}>
      <Show
        when={!props.error}
        fallback={
          <div class="query-gate-error" role="alert">
            <span>{props.error instanceof Error ? props.error.message : String(props.error ?? 'Unable to load')}</span>
            {props.retry && <button type="button" class="overlay-btn" onClick={props.retry}>Retry</button>}
          </div>
        }
      >
        {props.children}
      </Show>
    </Show>
  )
}

import { ErrorBoundary, type JSX } from 'solid-js'

export function ContributionBoundary(props: { contributionId: string; children: JSX.Element; quiet?: boolean }) {
  return (
    <ErrorBoundary
      fallback={(error, reset) =>
        props.quiet ? null : (
          <section class="pane contribution-failed" role="status">
            <strong>Contribution failed</strong>
            <span class="muted">{props.contributionId}</span>
            <button type="button" class="overlay-btn" onClick={reset}>Try again</button>
            <span class="sr-only">{error instanceof Error ? error.message : String(error)}</span>
          </section>
        )
      }
    >
      {props.children}
    </ErrorBoundary>
  )
}

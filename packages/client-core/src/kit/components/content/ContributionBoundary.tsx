import { ErrorBoundary, type JSX } from 'solid-js'
import { reportContributionError } from '../../lib/contributionErrors'
import { Button } from '../primitives'

export function ContributionBoundary(props: { contributionId: string; owner?: string; children: JSX.Element; quiet?: boolean }) {
  return (
    <ErrorBoundary
      fallback={(error, reset) => {
        // Reported from the fallback, which is where Solid hands the error over. `owner` is the
        // registry's word: the caller looked the contribution up to draw it, so it already knows
        // whose it is, and a boundary in `kit/` cannot ask a registry itself.
        reportContributionError({ contributionId: props.contributionId, owner: props.owner, error })
        return props.quiet ? null : (
          <section class="pane contribution-failed" role="status">
            <strong>Contribution failed</strong>
            <span class="muted">{props.contributionId}</span>
            <Button onPress={reset}>Try again</Button>
            <span class="sr-only">{error instanceof Error ? error.message : String(error)}</span>
          </section>
        )
      }}
    >
      {props.children}
    </ErrorBoundary>
  )
}

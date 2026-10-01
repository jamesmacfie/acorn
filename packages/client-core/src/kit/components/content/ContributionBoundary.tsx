import { ErrorBoundary, type JSX } from 'solid-js'
import { reportContributionError } from '../../lib/telemetry/contributionErrors'
import { Button } from '../inputs/Button'
import { EmptyState } from './EmptyState'

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
            {/* Host-neutral words: this boundary wraps settings pages and UI slots as well as panes.
                The id stays for a screen reader and in telemetry, where it helps; on screen it
                meant nothing to the person looking at it. */}
            <EmptyState title="This view stopped working" action={<Button onPress={reset}>Try again</Button>}>
              Something went wrong while drawing it.
            </EmptyState>
            <span class="sr-only">{props.contributionId}: {error instanceof Error ? error.message : String(error)}</span>
          </section>
        )
      }}
    >
      {props.children}
    </ErrorBoundary>
  )
}

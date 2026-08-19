import { createMemo, Show } from 'solid-js'
import { Portal } from 'solid-js/web'
import { createQuery } from '@tanstack/solid-query'
import { useNavigate } from '@solidjs/router'
import { CHECK_TONE, checksState, formatRelativeTime, openInAppUrl, type RefPanelProps } from '@acorn/plugin-api/client'
import { Button, EmptyState, StatusDot, Toolbar } from '@acorn/plugin-api/ui'
import { RefPanelTaskLink } from '@acorn/plugin-api/ui/host'
import { parsePullRef } from '../contract/pullRef'
import { pullDetailOptions } from './queries'
import './styles/ref-panel.css'

// GitHub's reference panel: one pull request, glance-sized, over whatever the reader was looking at.
//
// This is the surface github spent a long time deliberately NOT having, and the old comment was right
// about the thing it was arguing against: a pull request is a whole review — diff, threads, checks,
// commits — and that does not belong in an overlay. What changed is the question. Nobody wants to REVIEW
// here; they want to know what `Runn-Fast/runn#8811` is without losing the Linear issue they are reading.
// So this deliberately shows less than the pane does and offers the pane as the next step, rather than
// being a smaller copy of it.
//
// Adding it is what makes the second half of the pairing work. A ticket clicked from a PR already opened
// beside the diff; a PR clicked from a ticket had nowhere to go but the browser, because github declared
// no `providerId` and the panel rung looks a provider up by exactly that.

export default function PullRefPanel(props: RefPanelProps) {
  const navigate = useNavigate()
  // `owner/repo#number`, parsed by the one module that also spells it (../contract/pullRef.ts), so this
  // panel cannot disagree with the collection row or the URL recogniser about what it is looking at.
  const parts = createMemo(() => parsePullRef(props.target.displayId))

  const detail = createQuery(() => {
    const at = parts()
    return pullDetailOptions(at?.owner ?? '', at?.repo ?? '', at?.number ?? '', !!at)
  })
  const pull = () => detail.data?.pull
  const checks = () => detail.data?.checks ?? []

  // Through the host's own ladder rather than a path built here, so the panel reaches the pull request
  // exactly the way a dashboard row does — including selecting the rail source, which navigating alone
  // does not do. `prefer: 'route'` because this IS the "take me there" affordance; if the repo is not one
  // acorn tracks there is no route, the URL opens in the browser, and either way the panel is done.
  const openFull = (): void => {
    const at = parts()
    if (at) openInAppUrl(`https://github.com/${at.owner}/${at.repo}/pull/${at.number}`, { prefer: 'route', navigate })
    props.onClose()
  }

  return (
    <Portal>
      <div class="integrations-panel-backdrop" onClick={props.onClose} />
      <aside class="integrations-panel">
        <header class="integrations-panel-head">
          <span class="integrations-panel-title">{props.target.displayId}</span>
          <Toolbar.Spacer />
          <Button class="integrations-panel-close" onClick={props.onClose} aria-label="Close">✕</Button>
        </header>
        <div class="integrations-panel-body">
          <Show
            when={pull()}
            fallback={(
              <EmptyState align="start" size="sm" busy={detail.isLoading}>
                {/* A displayId this panel cannot parse is a recogniser and a panel disagreeing, which is a
                    bug rather than a missing pull request — so it says so instead of spinning forever. */}
                {!parts() ? 'Not a pull request reference.' : detail.isLoading ? 'Loading…' : 'Could not load this pull request.'}
              </EmptyState>
            )}
          >
            {(loaded) => (
              <>
                <h3 class="gh-ref-title">{loaded().title}</h3>
                <div class="gh-ref-meta">
                  <StatusDot tone={loaded().draft ? 'muted' : loaded().state === 'open' ? 'ok' : 'accent'} />
                  <span>{loaded().draft ? 'Draft' : loaded().state}</span>
                  <Show when={loaded().author}>{(author) => <span class="muted">· {author()}</span>}</Show>
                  <Show when={loaded().updatedAt}>
                    {(at) => <span class="muted">· {formatRelativeTime(at())}</span>}
                  </Show>
                </div>
                <Show when={loaded().headRef}>
                  {(head) => <div class="gh-ref-branch muted">{head()} → {loaded().baseRef ?? ''}</div>}
                </Show>
                {/* Checks as one word, not a list. The list is the pane's job, and a reader glancing wants
                    to know whether to care. */}
                <Show when={checks().length}>
                  <div class="gh-ref-meta">
                    <StatusDot tone={CHECK_TONE[checksState(checks())]} />
                    <span>{checks().length} check{checks().length === 1 ? '' : 's'}</span>
                  </div>
                </Show>
                <Toolbar>
                  <Button onClick={openFull}>Open pull request</Button>
                </Toolbar>
                {/* Host-drawn and provider-agnostic: whether a task already tracks this PR, and the means
                    to start one if not. github never touches core's task routes to offer it. */}
                <RefPanelTaskLink target={props.target} />
              </>
            )}
          </Show>
        </div>
      </aside>
    </Portal>
  )
}

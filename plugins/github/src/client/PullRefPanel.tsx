import { createMemo, Show } from 'solid-js'
import { Portal } from 'solid-js/web'
import { createQuery } from '@tanstack/solid-query'
import { useNavigate } from '@solidjs/router'
import { CHECK_TONE, railDotProps, checksState, formatRelativeTime, openInAppUrl, type RefPanelProps } from '@acorn/plugin-api/client'
import { Button, EmptyState, StatusDot, Toolbar } from '@acorn/plugin-api/ui'
import { RefPanelTaskLink } from '@acorn/plugin-api/ui/host'
import { parsePullRef } from '../contract/pullRef'
import { pullDetailOptions } from './queries'
import './styles/ref-panel.css'

// GitHub's reference panel: one pull request, glance-sized, over whatever the reader was looking at
// (docs/github-integration.md § Content links). It shows less than the full pane and offers the pane
// as the next step, rather than being a smaller copy of a whole review.

export default function PullRefPanel(props: RefPanelProps) {
  const navigate = useNavigate()
  // `owner/repo#number`, parsed by the module that also spells it (../contract/pullRef.ts), so this
  // panel, the collection row, and the URL recogniser name the same thing.
  const parts = createMemo(() => parsePullRef(props.target.displayId))

  const detail = createQuery(() => {
    const at = parts()
    return pullDetailOptions(at?.owner ?? '', at?.repo ?? '', at?.number ?? '', !!at)
  })
  const pull = () => detail.data?.pull
  const checks = () => detail.data?.checks ?? []

  // Through the host's ladder rather than a path built here, so the panel reaches the pull request
  // the way a dashboard row does, including selecting the rail source, which navigating alone does
  // not do. `prefer: 'route'` because this is the "take me there" affordance. An untracked repo has
  // no route, so the URL opens in the browser and the panel is done either way.
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
          <Button onPress={props.onClose} label="Close">✕</Button>
        </header>
        <div class="integrations-panel-body">
          <Show
            when={pull()}
            fallback={(
              <EmptyState align="start" size="sm" busy={detail.isLoading}>
                {/* A displayId this panel cannot parse means the recogniser and the panel disagree,
                    which is a bug, not a missing pull request. Say so instead of spinning. */}
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
                {/* Checks as one word, not a list. The list is the pane's job. */}
                <Show when={checks().length}>
                  <div class="gh-ref-meta">
                    <StatusDot {...railDotProps(CHECK_TONE[checksState(checks())])} />
                    <span>{checks().length} check{checks().length === 1 ? '' : 's'}</span>
                  </div>
                </Show>
                <Toolbar>
                  <Button onPress={openFull}>Open pull request</Button>
                </Toolbar>
                {/* Host-drawn and provider-agnostic: whether a task tracks this PR, and how to start
                    one. github never touches core's task routes to offer it. */}
                <RefPanelTaskLink target={props.target} />
              </>
            )}
          </Show>
        </div>
      </aside>
    </Portal>
  )
}

import { createMemo, Show } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import { useNavigate, useParams } from '@solidjs/router'
import { projectsOptions } from '@acorn/plugin-api/client'
import { EmptyState, Fold, Stack } from '@acorn/plugin-api/ui'
import { useChangedFiles } from './changedFiles'
import { makeContentLinkHandler } from './contentLinks'
import { requestFileScroll, routeKey } from './fileNavigation'
import ChecksPanel from './checks/ChecksPanel'
import { PrConversation } from './pullDetail/Conversation'
import { PrFileList } from './pullDetail/PrFiles'
import { PrOverview } from './pullDetail/PrOverview'
import { prModel } from './pullDetail/prModel'

// The navigator column of the browse surface: one pull request as a single column, with the diff
// beside it (./GithubBrowse.tsx).
//
// The same three trees the PR pane draws as tabs, stacked instead, because browse has a third column
// for the diff and a pane does not. Everything they share is in ./pullDetail/prModel.ts.
export default function PullDetail() {
  const params = useParams()
  const navigate = useNavigate()
  const projects = createQuery(() => projectsOptions(true))
  const project = () => projects.data?.find((candidate) => candidate.id === params.projectId)
  const owner = () => project()?.github?.owner ?? ''
  const repo = () => project()?.github?.name ?? ''
  const number = () => params.number ?? ''
  const ready = () => !!owner() && !!repo() && !!number()

  const model = createMemo(() => (ready() ? prModel({ owner: owner(), repo: repo(), number: number() }) : null))
  // Browse owns a route, so the selected file is `?file=` and the diff column reads it back.
  const changedFiles = useChangedFiles(() => (ready() ? { owner: owner(), repo: repo(), number: number() } : null))
  const selectFile = (path: string) => {
    changedFiles.selectFile(path)
    requestFileScroll({ routeKey: routeKey(owner(), repo(), number()), path })
  }
  const onLinkClick = makeContentLinkHandler(navigate)

  return (
    <Show when={number()} fallback={<EmptyState align="start">Select a PR.</EmptyState>}>
      <Show when={ready() || !projects.data} fallback={<EmptyState align="start">Not found.</EmptyState>}>
        <Show when={model()} fallback={<EmptyState align="start" busy>Loading…</EmptyState>}>
          {(loaded) => (
            <Show
              when={loaded().pull()}
              fallback={
                <EmptyState align="start" busy={!loaded().detail.isError}>
                  {loaded().detail.isError ? 'Not found.' : 'Loading…'}
                </EmptyState>
              }
            >
              <Stack gap="section">
                <PrOverview model={loaded()} onOpenFile={selectFile} onLinkClick={onLinkClick} />
                <Fold persistKey="files" defaultOpen label="Files" count={loaded().files().length}>
                  <PrFileList model={loaded()} current={changedFiles.currentFile} onSelect={selectFile} />
                </Fold>
                <Fold
                  persistKey="conversation"
                  defaultOpen
                  label="Comments/Commits"
                  count={loaded().conversationEntries().length}
                >
                  <PrConversation model={loaded()} onOpenFile={selectFile} onLinkClick={onLinkClick} />
                </Fold>
                <Show when={loaded().openCheck()}>
                  {(check) => (
                    <ChecksPanel
                      owner={owner()}
                      repo={repo()}
                      runId={check().runId}
                      jobName={check().name}
                      onClose={() => loaded().setOpenCheck(null)}
                    />
                  )}
                </Show>
              </Stack>
              {/* No reference panel here. The shell owns both the registry and the invocation
                  (client-core/registries/refPanels.ts and refPanelHost.tsx), so this only asks. */}
            </Show>
          )}
        </Show>
      </Show>
    </Show>
  )
}

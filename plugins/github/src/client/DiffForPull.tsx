import { createEffect, createMemo, createSignal, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { useSearchParams } from '@solidjs/router'
import { clientCapability, openPane } from '@acorn/plugin-api/client'
import { pullKey } from '../shared/api'
import { fetchDiffSegments, fileBlobOptions, mentionsOptions, pullDetailOptions, pullDiffOptions, searchDiff } from './queries'
import { addReviewComment, replyReview, resolveThread } from './mutations'
import { Alert, DiffPane } from '@acorn/plugin-api/ui'
import { loadDiffLineContext, type CodeRow, type DiffLineAnchor } from '@acorn/plugin-api/ui/diff'
import { sameInlineLine, type InlineDiffOrigin } from '@acorn/plugin-agents/contract/inlineDiff.ts'
import { AGENTS_INLINE_DIFF } from '@acorn/plugin-agents/contract/inlineDiffClient.ts'
import type { DiffSource } from '@acorn/plugin-api/ui/diff'
import { DIFF_LINE_POINT } from './extensionPoints'
import { incompleteFilesMessage } from './completeness'

// Right (Diff) pane: the shared diff shell (client-core's DiffPane, docs/diff-rendering.md) filled in
// from a pull request. Everything here answers one of the shell's questions and nothing more: which
// document, where its segments come from, which threads to place, and what a comment does.
//
// The document is the node's (docs/github-integration.md § Diff documents): every file with the
// segments its patch was cut into, and no patch text. The viewer asks for the segments it is near.
// Binary and too-large files have no patch; the shell renders a "No diff" row for them. This component
// owns the warning that GitHub's 3,000-file API limit cut the list short.
export type PullRoute = {
  owner: string
  repo: string
  number: string
  key: string
}

export function DiffForPull(props: { route: PullRoute; router: boolean; taskId?: string; readOnly?: boolean }) {
  const searchParams = props.router ? useSearchParams()[0] : {}
  const queryClient = useQueryClient()
  const owner = props.route.owner
  const repo = props.route.repo
  const number = props.route.number
  const taskId = props.taskId

  const diff = createQuery(() => pullDiffOptions(owner, repo, number, true))
  const detail = createQuery(() => pullDetailOptions(owner, repo, number, true))
  const mentionsQuery = createQuery(() => mentionsOptions(owner, repo, true))
  const topology = () => diff.data?.document
  const inline = () => clientCapability(AGENTS_INLINE_DIFF)
  createEffect(() => { if (taskId) inline()?.prime(taskId) })
  createEffect(() => {
    const files = topology()?.files
    if (taskId && files) inline()?.reportPatches(
      { taskId, source: 'pull-request', pull: { owner, repo, number } },
      Object.fromEntries(files.map((file) => [file.path, file.patchKey])),
    )
  })
  const [openInline, setOpenInline] = createSignal<InlineDiffOrigin | null>(null)
  createEffect(() => {
    const opened = openInline()
    if (opened && topology()?.files.find((file) => file.path === opened.path)?.patchKey !== opened.patchKey) setOpenInline(null)
  })
  const inlineOrigin = (row: CodeRow): InlineDiffOrigin | null => {
    if (!taskId) return null
    const patchKey = topology()?.files.find((file) => file.path === row.path)?.patchKey
    const line = row.kind === 'delete' ? row.oldNo : row.newNo
    if (!patchKey || line == null) return null
    return {
      kind: 'inline-diff', source: 'pull-request', taskId, path: row.path,
      side: row.kind === 'delete' ? 'old' : 'new', line, patchKey,
      quote: row.raw.slice(0, 2_000),
      pull: { owner, repo, number },
    }
  }
  const inlineAnchors = createMemo<DiffLineAnchor[]>(() => {
    if (!taskId) return []
    const visible = (inline()?.sessionsForTask(taskId) ?? []).flatMap((session) => {
      const origin = session.origin
      if (!origin || origin.source !== 'pull-request' || session.archivedAt ||
          origin.pull?.owner !== owner || origin.pull.repo !== repo || origin.pull.number !== number) return []
      if (topology()?.files.find((file) => file.path === origin.path)?.patchKey !== origin.patchKey) return []
      return [{ path: origin.path, side: origin.side, line: origin.line }]
    })
    const opened = openInline()
    return opened ? [...visible, { path: opened.path, side: opened.side, line: opened.line }] : visible
  })

  const source: DiffSource = {
    scope: { taskId: props.taskId, routeKey: props.route.key },
    topology,
    // The threads come with the detail, so the document is not ready until both are in.
    loading: () => diff.isLoading || detail.isLoading,
    // A force-push, a new commit, or a new base moves the revision, which is the shell's signal to
    // drop expanded gaps, the remembered scroll offset, and any collapsed files. A patch's key is its
    // own digest, so a base change that leaves the head blob alone still moves it.
    signature: () => topology()?.revision ?? '',
    selectedPath: () => typeof searchParams.file === 'string' ? searchParams.file : '',
    threads: () => detail.data?.threads,
    mentions: () => mentionsQuery.data ?? [],
    loadSegments: (requests, signal) => fetchDiffSegments(owner, repo, requests, signal),
    search: async (request, signal) => {
      const document = topology()
      return document ? searchDiff(owner, repo, document, request, signal) : { matches: [], nextCursor: null }
    },
    // Immutable by sha, so one fetch per blob serves every gap in that file.
    fileText: async ({ sha }) => (await queryClient.fetchQuery(fileBlobOptions(owner, repo, sha))).text,
    canComment: () => !props.readOnly && detail.data?.pull?.headSha != null,
    ...(!props.readOnly ? {
      addComment: (body: string, { row, side, lineNo }: Parameters<NonNullable<DiffSource['addComment']>>[1]) =>
        addReviewComment(owner, repo, number, body, row.path, lineNo, side),
      reply: (databaseId: number, body: string) => replyReview(owner, repo, number, databaseId, body),
      resolveThread: (threadId: string, resolved: boolean) => resolveThread(owner, repo, number, threadId, resolved),
    } : {}),
    invalidate: () => void queryClient.invalidateQueries({ queryKey: pullKey(owner, repo, number) }),
    draftPrefix: `${owner}/${repo}/${number}`,
    ...(taskId ? { inlineChat: {
      anchors: inlineAnchors,
      open: (row: CodeRow) => setOpenInline(inlineOrigin(row)),
      render: (row: CodeRow) => {
        const origin = inlineOrigin(row)
        const Card = inline()?.Card
        if (!origin || !Card) return null
        const exists = inline()?.sessionsForTask(taskId).some((session) => session.origin && sameInlineLine(session.origin, origin) && !session.archivedAt)
        if (!exists && (!openInline() || !sameInlineLine(openInline()!, origin))) return null
        return <Card origin={origin} loadContext={() => loadDiffLineContext(source, row)} onClose={() => setOpenInline(null)} />
      },
    } } : {}),
    ...(taskId ? {
      openLine: (row: Parameters<NonNullable<DiffSource['openLine']>>[0]) => {
        if (row.newNo == null) return
        openPane(taskId, 'editor', { kind: 'editor:reveal', path: row.path, line: row.newNo }, 'add')
      },
    } : {}),
    // In router mode this pane owns the route, so the chord is claimed globally; in a task it is one
    // pane among several and has to be scoped to win only when the reader is looking at it.
    find: {
      commandId: 'github.diff.find',
      description: 'Find in diff',
      category: 'Pull requests',
      ...(props.router ? {} : { pane: 'pr' }),
    },
  }

  // What another plugin knows about a line of this diff — coverage, a lint result — drawn under the
  // row it belongs to. The host fetches, batches and stamps; this only names the point
  // (docs/plugins.md § Cooperative extension points, the `annotation` kind).
  // A sibling of the pane rather than a wrapper: DiffPane is a fragment that fills its container, and
  // the warning stays above it whichever file is on screen.
  return (
    <>
      <Show when={incompleteFilesMessage(diff.data?.completeness)}>{(message) => <Alert tone="warn">{message()}</Alert>}</Show>
      <DiffPane source={source} annotations={DIFF_LINE_POINT} />
    </>
  )
}

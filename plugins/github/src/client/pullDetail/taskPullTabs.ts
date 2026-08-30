import { scanContentRefs, type Task } from '@acorn/plugin-api/client'
import type { Pull, PullDetail, TaskPullRelation } from '../../shared/api'
import { formatPullRef, parsePullRef, type PullRef } from '../../shared/pullRef'

export type RelatedPullEvidence =
  | { kind: 'stack'; anchorPullNumber: number; direction: 'parent' | 'child' }
  | { kind: 'mention'; sourcePullNumber: number; surface: 'description' | 'comment' | 'review' | 'thread' }
  | { kind: 'agent'; sessionId: string; requestId?: string }

export type TaskPullTab = {
  pull: PullRef
  relationship: 'primary' | 'related' | 'discovered'
  evidence: RelatedPullEvidence[]
  linkedTasks: Array<Pick<Task, 'id' | 'title'>>
  creatingAgent?: { taskId: string; sessionId: string; requestId?: string }
  title?: string
}

export const pullRefKey = (pull: PullRef): string =>
  formatPullRef(pull.owner.toLowerCase(), pull.repo.toLowerCase(), pull.number)

const sameRepo = (a: PullRef, b: PullRef): boolean =>
  a.owner.toLowerCase() === b.owner.toLowerCase() && a.repo.toLowerCase() === b.repo.toLowerCase()

const evidenceKey = (evidence: RelatedPullEvidence): string => JSON.stringify(evidence)

function mentions(detail: PullDetail | undefined, source: PullRef): Array<{ pull: PullRef; evidence: RelatedPullEvidence }> {
  if (!detail) return []
  const surfaces: Array<[RelatedPullEvidence & { kind: 'mention' }, Array<string | null | undefined>]> = [
    [{ kind: 'mention', sourcePullNumber: Number(source.number), surface: 'description' }, [detail.pull?.body]],
    [{ kind: 'mention', sourcePullNumber: Number(source.number), surface: 'comment' }, detail.comments.map((item) => item.body)],
    [{ kind: 'mention', sourcePullNumber: Number(source.number), surface: 'review' }, detail.reviews.map((item) => item.body)],
    [{ kind: 'mention', sourcePullNumber: Number(source.number), surface: 'thread' }, detail.threads.flatMap((thread) => thread.comments.map((item) => item.body))],
  ]
  const found: Array<{ pull: PullRef; evidence: RelatedPullEvidence }> = []
  for (const [evidence, texts] of surfaces) {
    for (const ref of scanContentRefs(texts)) {
      if (ref.providerId !== 'github') continue
      const pull = parsePullRef(ref.item)
      if (pull && pullRefKey(pull) !== pullRefKey(source)) found.push({ pull, evidence })
    }
  }
  return found
}

function stackNeighbours(primary: PullRef, openPulls: readonly Pull[]): Array<{ pull: PullRef; evidence: RelatedPullEvidence; title: string }> {
  const byNumber = new Map(openPulls.map((pull) => [pull.number, pull]))
  if (!byNumber.has(Number(primary.number))) return []
  const visited = new Set([Number(primary.number)])
  const queue = [Number(primary.number)]
  const found: Array<{ pull: PullRef; evidence: RelatedPullEvidence; title: string }> = []
  while (queue.length) {
    const anchorNumber = queue.shift()!
    const anchor = byNumber.get(anchorNumber)
    if (!anchor) continue
    for (const candidate of openPulls) {
      if (candidate.number === anchorNumber) continue
      const direction = anchor.headRef && candidate.baseRef === anchor.headRef
        ? 'child'
        : anchor.baseRef && candidate.headRef === anchor.baseRef
          ? 'parent'
          : null
      if (!direction) continue
      found.push({
        pull: { owner: primary.owner, repo: primary.repo, number: String(candidate.number) },
        evidence: { kind: 'stack', anchorPullNumber: anchorNumber, direction },
        title: candidate.title,
      })
      if (!visited.has(candidate.number)) {
        visited.add(candidate.number)
        queue.push(candidate.number)
      }
    }
  }
  return found
}

export function buildTaskPullTabs(input: {
  task: Task
  primary: PullRef
  relations: readonly TaskPullRelation[]
  openPulls: readonly Pull[]
  primaryDetail?: PullDetail
  tasks: readonly Task[]
  selectedIntent?: PullRef
}): TaskPullTab[] {
  const tabs = new Map<string, TaskPullTab>()
  const primaryKey = pullRefKey(input.primary)
  const linkedTasks = (pull: PullRef) => input.tasks
    .filter((task) => task.pullNumber === Number(pull.number) && !!task.github && sameRepo(pull, {
      owner: task.github!.owner,
      repo: task.github!.name,
      number: String(task.pullNumber),
    }))
    .map(({ id, title }) => ({ id, title }))
  const add = (
    pull: PullRef,
    relationship: TaskPullTab['relationship'],
    evidence?: RelatedPullEvidence,
    extra?: Pick<TaskPullTab, 'creatingAgent' | 'title'>,
  ) => {
    const key = pullRefKey(pull)
    const existing = tabs.get(key)
    if (existing) {
      if (evidence && !existing.evidence.some((item) => evidenceKey(item) === evidenceKey(evidence))) existing.evidence.push(evidence)
      if (!existing.creatingAgent && extra?.creatingAgent) existing.creatingAgent = extra.creatingAgent
      if (!existing.title && extra?.title) existing.title = extra.title
      return
    }
    tabs.set(key, {
      pull,
      relationship: key === primaryKey ? 'primary' : relationship,
      evidence: evidence ? [evidence] : [],
      linkedTasks: linkedTasks(pull),
      ...extra,
    })
  }

  add(input.primary, 'primary')
  for (const relation of input.relations) {
    const evidence: RelatedPullEvidence = {
      kind: 'agent',
      sessionId: relation.sessionId,
      ...(relation.requestId ? { requestId: relation.requestId } : {}),
    }
    add(relation.pull, 'related', evidence, {
      creatingAgent: {
        taskId: input.task.id,
        sessionId: relation.sessionId,
        ...(relation.requestId ? { requestId: relation.requestId } : {}),
      },
    })
  }
  for (const neighbour of stackNeighbours(input.primary, input.openPulls))
    add(neighbour.pull, 'discovered', neighbour.evidence, { title: neighbour.title })
  for (const mention of mentions(input.primaryDetail, input.primary)) add(mention.pull, 'discovered', mention.evidence)
  if (input.selectedIntent) add(input.selectedIntent, 'discovered')

  return [...tabs.values()]
}

export function taskPullTabTooltip(tab: TaskPullTab, currentTaskId: string): string {
  const otherTasks = tab.linkedTasks.filter((task) => task.id !== currentTaskId)
  const evidence = tab.evidence.map((item) => {
    if (item.kind === 'agent') return 'Created by an agent in this task'
    if (item.kind === 'stack') return `${item.direction === 'parent' ? 'Parent' : 'Child'} of #${item.anchorPullNumber}`
    return `Mentioned in #${item.sourcePullNumber}'s ${item.surface}`
  })
  if (otherTasks.length === 1) evidence.push(`Open in ${otherTasks[0].title}`)
  else if (otherTasks.length > 1) evidence.push(`Open one of ${otherTasks.length} linked tasks`)
  return evidence.join('. ') || (tab.relationship === 'primary' ? 'Primary pull request' : 'Related pull request')
}

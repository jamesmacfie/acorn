import { and, desc, eq, ne } from 'drizzle-orm'
import type { CoreServices, HeadlessResult, PluginDatabase } from '@acorn/plugin-api/node'
import type { AgentProfiles, AgentSessionExecute } from '@acorn/plugin-agents/contract/sessionExecute.ts'
import type {
  AgentProfile,
  GenerateRequest,
  Guide,
  GuideProgress,
  GuideView,
  ProgressMark,
  StoredGuide,
} from '../shared/guide'
import { guidePath, OVERVIEW, stepPage } from '../shared/path'
import { reviewGuides } from '../node/schema'
import { ChangeError, readChange, type Change } from './change'
import { checkCoverage } from './coverage'
import { noteMarks, type DiffLineKey, type DiffLineMark } from './marks'
import { checkNotes } from './notes'
import { GUIDE_SCHEMA, guideTurn, type GuideAnswer } from './prompt'

/** A request the pane can't act on, with the sentence it shows and the status the route answers. */
export class GuideError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 409 | 503,
  ) {
    super(message)
  }
}

export type GuideDeps = {
  db: PluginDatabase
  tasks: Pick<CoreServices['tasks'], 'root' | 'changeRequests' | 'changeRequestDetail'>
  git: Pick<CoreServices['git'], 'git'>
  prefs: CoreServices['prefs']
  /** Says a task's guide changed, so the pane reads it again. */
  changed: (taskId: string) => void
  /** Resolved per call, because the Agents plugin may be off or load after this one. */
  execute: () => AgentSessionExecute | undefined
  profiles: () => AgentProfiles | undefined
}

// The person's harness choice, in this plugin's own prefs namespace.
const PROFILE_KEY = 'profile'

/** How a generation ended, for a caller that waits on it. `guide` is null when it failed or stopped. */
export type FinishedGuide = {
  guide: Guide | null
  error: string | null
  costUsd: number | null
  usage?: HeadlessResult['capture']['usage']
}

type Running = {
  controller: AbortController
  headSha: string | null
  stale: boolean
  finished: Promise<FinishedGuide>
}

// The saved choice while the harness is still installed. Otherwise the first, which is the Agents
// plugin's default.
// What one turn is asked for. `background` comes only from a workflow step, never from the route.
type TurnRequest = GenerateRequest & { background?: string }

const pickProfile = (profiles: AgentProfile[], saved: string | null) =>
  profiles.find((profile) => profile.id === saved)?.id ?? profiles[0]?.id ?? null

// A guide stored before steps had notes. Each one cost harness usage, so it still reads.
type GuideWithSections = Omit<Guide, 'steps' | 'misplacedNotes'> & {
  sections: Omit<Guide['steps'][number], 'notes'>[]
}

const NO_PROGRESS: GuideProgress = { pages: [], notes: [] }
const readProgress = (json: string | null): GuideProgress => (json ? (JSON.parse(json) as GuideProgress) : NO_PROGRESS)

function readGuide(json: string): Guide {
  const stored = JSON.parse(json) as Guide | GuideWithSections
  if (!('sections' in stored)) return stored
  const { sections, ...rest } = stored
  return { ...rest, steps: sections.map((section) => ({ ...section, notes: [] })), misplacedNotes: 0 }
}

export function createGuides(deps: GuideDeps) {
  const db = deps.db
  // One generation per task. Set before the first await, so a second request can't slip in beside it.
  const running = new Map<string, Running>()

  const listProfiles = async () => (await deps.profiles()?.list()) ?? []
  const listBackends = async () => (await deps.profiles()?.backends()) ?? []
  const where = (change: Pick<Change, 'baseSha' | 'headSha'>, taskId: string) =>
    and(
      eq(reviewGuides.taskId, taskId),
      eq(reviewGuides.baseSha, change.baseSha),
      eq(reviewGuides.headSha, change.headSha),
    )
  const save = (taskId: string, change: Change, patch: Partial<typeof reviewGuides.$inferInsert>) =>
    db
      .update(reviewGuides)
      .set({ ...patch, updatedAt: Date.now() })
      .where(where(change, taskId))

  /** The task's newest guide, whatever its status. */
  async function newest(taskId: string): Promise<StoredGuide | null> {
    const [row] = await db
      .select()
      .from(reviewGuides)
      .where(eq(reviewGuides.taskId, taskId))
      .orderBy(desc(reviewGuides.updatedAt))
      .limit(1)
    return row
      ? {
          status: row.status,
          profileId: row.profileId,
          baseRef: row.baseRef,
          baseSha: row.baseSha,
          headSha: row.headSha,
          sessionId: row.sessionId,
          error: row.error,
          guide: row.guide ? readGuide(row.guide) : null,
          progress: readProgress(row.progress),
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        }
      : null
  }

  async function view(userId: string, taskId: string): Promise<GuideView> {
    const [requests, profiles, saved, guide, head] = await Promise.all([
      deps.tasks.changeRequests(taskId),
      listProfiles(),
      deps.prefs.read(userId, PROFILE_KEY),
      newest(taskId),
      changeRequestHead(taskId),
    ])
    return {
      hasChangeRequest: requests.some((request) => request.role === 'primary'),
      profiles,
      profileId: pickProfile(profiles, saved),
      guide,
      changeRequestHead: head,
      matchesChangeRequest: matches(guide, head),
    }
  }

  const changeRequestHead = async (taskId: string) => (await deps.tasks.changeRequestDetail(taskId))?.headSha ?? null

  /** A guide made on a commit the change request doesn't have yet may not have the diff's lines. */
  const matches = (stored: StoredGuide | null, head: string | null) =>
    stored?.status === 'ready' && !!stored.guide && !!head && head === stored.headSha

  /** Read the change, store a `generating` row, and start the turn. Answers once the turn has started,
   *  with the job already running for the task if there is one. `remember` saves `profileId` as the
   *  person's choice. */
  async function start(userId: string, taskId: string, request: TurnRequest, remember: boolean) {
    const { profileId } = request
    const existing = running.get(taskId)
    if (existing) return existing
    const finished = Promise.withResolvers<FinishedGuide>()
    const job: Running = { controller: new AbortController(), headSha: null, stale: false, finished: finished.promise }
    running.set(taskId, job)
    try {
      const execute = deps.execute()
      if (!execute) throw new GuideError("The Agents plugin is off, so there's no harness to ask.", 503)
      const profiles = await listProfiles()
      const chosen = profileId ?? pickProfile(profiles, await deps.prefs.read(userId, PROFILE_KEY))
      if (!chosen || !profiles.some((profile) => profile.id === chosen)) {
        throw new GuideError('Pick a harness that can run a guide.', 400)
      }
      if (remember && profileId) await deps.prefs.write(userId, PROFILE_KEY, profileId)
      const detail = await deps.tasks.changeRequestDetail(taskId)
      if (!detail) throw new GuideError("This task has no change request, or its code host didn't answer.", 409)
      if (!detail.baseRef) {
        throw new GuideError("The code host hasn't said which branch this change merges into yet. Try again soon.", 409)
      }
      const root = await deps.tasks.root(taskId)
      if (!root) throw new GuideError('This task has no worktree.', 409)
      const change = await readChange(deps.git, root, detail.baseRef).catch((error: unknown) => {
        throw error instanceof ChangeError ? new GuideError(error.message, 409) : error
      })
      if (!change.items.length) throw new GuideError(`This branch has no changes against ${detail.baseRef}.`, 409)
      job.headSha = change.headSha
      const now = Date.now()
      // One guide per task: a new one replaces the guide for any earlier commits.
      await db.delete(reviewGuides).where(eq(reviewGuides.taskId, taskId))
      await db.insert(reviewGuides).values({
        taskId,
        baseSha: change.baseSha,
        headSha: change.headSha,
        baseRef: change.baseRef,
        profileId: chosen,
        status: 'generating',
        createdAt: now,
        updatedAt: now,
      })
      finished.resolve(runTurn(execute, job, taskId, chosen, change, request))
    } catch (error) {
      running.delete(taskId)
      // A caller that joined this job while it was starting fails with the same sentence.
      finished.resolve({ guide: null, error: error instanceof Error ? error.message : String(error), costUsd: null })
      throw error
    }
    deps.changed(taskId)
    return job
  }

  /** The pane's generate. The harness it names becomes the person's choice. */
  async function generate(userId: string, taskId: string, request: GenerateRequest): Promise<GuideView> {
    await start(userId, taskId, request, true)
    return view(userId, taskId)
  }

  /** The workflow step's generate. Joins the task's running guide if there is one, and waits for it to
   *  finish. `signal` stops it, the way the pane's Stop does. A joined guide keeps its own prompt, so
   *  `background` only reaches a guide this call starts. */
  async function generateAndWait(
    userId: string,
    taskId: string,
    profileId: string | undefined,
    signal: AbortSignal,
    background?: string,
  ): Promise<FinishedGuide> {
    const job = await start(userId, taskId, { profileId, ...(background ? { background } : {}) }, false)
    const abort = () => job.controller.abort()
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    try {
      return await job.finished
    } finally {
      signal.removeEventListener('abort', abort)
    }
  }

  async function runTurn(
    execute: AgentSessionExecute,
    job: Running,
    taskId: string,
    profileId: string,
    change: Change,
    { model, context, background }: TurnRequest,
  ): Promise<FinishedGuide> {
    let sessionId: string | null = null
    let outcome: Partial<typeof reviewGuides.$inferInsert>
    let guide: Guide | null = null
    let cost: Pick<FinishedGuide, 'costUsd' | 'usage'> = { costUsd: null }
    try {
      const result = await execute({
        taskId,
        profileId,
        title: 'Review guide',
        ...guideTurn(change, { focus: context, background }),
        // Through `configOptions`, because the Claude driver reads the model only from the session's.
        ...(model ? { configOptions: { model } } : {}),
        schema: GUIDE_SCHEMA,
        tools: { maxRisk: 'read' },
        // A retry on the same commits with the same harness reuses its session instead of starting another.
        stepId: `${profileId}:${change.headSha}`,
        signal: job.controller.signal,
        onEvent: (event) => {
          if (sessionId || typeof event.sessionId !== 'string') return
          sessionId = event.sessionId
          void save(taskId, change, { sessionId }).then(() => deps.changed(taskId))
        },
      })
      sessionId = result?.agentSessionId ?? sessionId
      if (result)
        cost = { costUsd: result.capture.costUsd, ...(result.capture.usage ? { usage: result.capture.usage } : {}) }
      if (result?.status === 'ok' && result.capture.structuredOutput)
        guide = checkNotes(checkCoverage(result.capture.structuredOutput as GuideAnswer, change.items))
      outcome = !result
        ? { status: 'failed', error: "This harness can't run a guide." }
        : guide
          ? { status: job.stale ? 'stale' : 'ready', guide: JSON.stringify(guide) }
          : {
              status: 'failed',
              error:
                result.status === 'cancelled'
                  ? 'You stopped the guide.'
                  : result.stderrTail.trim() || `The harness's turn ended with ${result.status}.`,
            }
    } catch (error) {
      outcome = { status: 'failed', error: error instanceof Error ? error.message : String(error) }
    }
    try {
      await save(taskId, change, { ...outcome, sessionId })
    } finally {
      running.delete(taskId)
      deps.changed(taskId)
    }
    return { guide, error: outcome.error ?? null, ...cost }
  }

  /** Mark a page reviewed or a note checked on the task's guide, or undo it. In one transaction, so two
   *  marks sent together can't overwrite each other. */
  async function markProgress(userId: string, taskId: string, mark: ProgressMark): Promise<GuideView> {
    db.transaction((tx) => {
      const row = tx.select().from(reviewGuides).where(eq(reviewGuides.taskId, taskId)).get()
      if (!row?.guide) throw new GuideError("There's no guide to mark yet.", 409)
      const path = guidePath(readGuide(row.guide))
      const field = 'page' in mark ? 'pages' : 'notes'
      const key = 'page' in mark ? mark.page : mark.note
      const known =
        field === 'pages'
          ? key === OVERVIEW || path.some((step) => stepPage(step.number) === key)
          : path.some((step) => step.notes.some((note) => note.key === key))
      if (!known) throw new GuideError(`The guide has no ${field === 'pages' ? 'page' : 'note'} "${key}".`, 400)
      const progress = readProgress(row.progress)
      const rest = progress[field].filter((entry) => entry !== key)
      const next = { ...progress, [field]: mark.done ? [...rest, key] : rest }
      tx.update(reviewGuides)
        .set({ progress: JSON.stringify(next) })
        .where(eq(reviewGuides.taskId, taskId))
        .run()
    })
    deps.changed(taskId)
    return view(userId, taskId)
  }

  /** The marks a ready guide on the change request's head puts under that diff's rows. */
  async function marks(taskId: string, keys: DiffLineKey[]): Promise<DiffLineMark[]> {
    const stored = await newest(taskId)
    if (!stored?.guide || !matches(stored, await changeRequestHead(taskId))) return []
    const author = (await listProfiles()).find((profile) => profile.id === stored.profileId)?.label ?? stored.profileId
    return noteMarks(stored.guide, keys, author)
  }

  function stop(taskId: string): void {
    running.get(taskId)?.controller.abort()
  }

  /** HEAD moved: a guide for another commit is stale. A running one is marked when it finishes. */
  async function markStale(taskId: string, head: string): Promise<void> {
    const job = running.get(taskId)
    if (job?.headSha && job.headSha !== head) job.stale = true
    const marked = await db
      .update(reviewGuides)
      .set({ status: 'stale', updatedAt: Date.now() })
      .where(and(eq(reviewGuides.taskId, taskId), eq(reviewGuides.status, 'ready'), ne(reviewGuides.headSha, head)))
      .returning({ taskId: reviewGuides.taskId })
    if (marked.length) deps.changed(taskId)
  }

  /** A restart ends every turn, so a guide still marked `generating` will never finish. */
  async function failInterrupted(): Promise<void> {
    await db
      .update(reviewGuides)
      .set({ status: 'failed', error: 'Acorn restarted before the guide finished.', updatedAt: Date.now() })
      .where(eq(reviewGuides.status, 'generating'))
  }

  return {
    view,
    generate,
    generateAndWait,
    markProgress,
    marks,
    profiles: listProfiles,
    backends: listBackends,
    stop,
    markStale,
    failInterrupted,
  }
}

export type Guides = ReturnType<typeof createGuides>

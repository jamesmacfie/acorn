import { mergeStatements } from '@openuidev/lang-core'
import { ToolError, type ToolContext } from '@acorn/plugin-api/node'
import {
  appCreateInput,
  appPatchInput,
  appReadInput,
  appShowInput,
  appWriteInput,
  type AppShowResult,
} from '../shared/api'
import { LIBRARY_ID, LIBRARY_VERSION } from '../shared/library'
import { appGuide } from './guide'
import { AppConflict, type AppStore } from './store'
import { describeProblem, programProblems, type AppProblem } from './validate'

// What the app tools do (./tools.ts declares them). Loaded on the first call, with lang-core, so
// neither is on the Node's boot path.

// lang-core's opt-in usage telemetry reads the Node's environment. An owner who opted in for their own
// OpenUI project must not have Acorn report from their machine too.
process.env.OPENUI_TELEMETRY_DISABLED = '1'

export type AppToolDeps = {
  store(): Promise<AppStore>
  workspaceOf(taskId: string): Promise<string>
  planProblems(workspaceId: string, plan: unknown, userId: string, signal: AbortSignal): Promise<string[]>
  planGuide(workspaceId: string): Promise<unknown>
}

/** The app, when it belongs to the calling task. Another task's app reads as missing. */
async function ownApp(deps: AppToolDeps, appId: string, ctx: ToolContext) {
  const meta = await (await deps.store()).meta(appId)
  if (!meta || meta.taskId !== ctx.taskId) throw new ToolError('not_found', `No app ${appId} in this task.`)
  return meta
}

const conflict = <T>(work: Promise<T>): Promise<T> =>
  work.catch((error: unknown) => {
    throw error instanceof AppConflict ? new ToolError('conflict', error.message) : error
  })

export async function createApp(deps: AppToolDeps, raw: unknown, ctx: ToolContext) {
  const input = appCreateInput.parse(raw)
  const store = await deps.store()
  const meta = await store.create(ctx.taskId, input.name, input.description)
  return { appId: meta.appId, program: { hash: (await store.read(meta.appId, 'program'))!.hash } }
}

export async function readApp(deps: AppToolDeps, raw: unknown, ctx: ToolContext) {
  const input = appReadInput.parse(raw)
  const meta = await ownApp(deps, input.appId, ctx)
  const store = await deps.store()
  if (input.file) {
    const file = await store.read(input.appId, input.file)
    if (!file) throw new ToolError('not_found', `${input.file} doesn't exist yet. Write it with app_write.`)
    return file
  }
  const working = await store.working(input.appId)
  return {
    name: meta.name,
    description: meta.description,
    head: meta.head,
    files: ['program', ...Object.keys(working.plans).map((name) => `plans/${name}`)],
  }
}

export async function writeApp(deps: AppToolDeps, raw: unknown, ctx: ToolContext) {
  const input = appWriteInput.parse(raw)
  await ownApp(deps, input.appId, ctx)
  if (input.file === 'program' && input.content === null)
    throw new ToolError('bad_request', 'The program can be emptied, not deleted.')
  if (input.file !== 'program' && input.content !== null) {
    try {
      const plan: unknown = JSON.parse(input.content)
      if (!plan || typeof plan !== 'object' || Array.isArray(plan)) throw new Error()
    } catch {
      throw new ToolError('bad_request', 'A plan is one JSON object: a version 2 PanelPlan.')
    }
  }
  return conflict((await deps.store()).write(input.appId, input.file, input.content, input.hash))
}

export async function patchApp(deps: AppToolDeps, raw: unknown, ctx: ToolContext) {
  const input = appPatchInput.parse(raw)
  await ownApp(deps, input.appId, ctx)
  const store = await deps.store()
  const current = (await store.read(input.appId, 'program'))!
  const merged = mergeStatements(current.content, input.statements)
  if (merged.length > 256 * 1024) throw new ToolError('bad_request', 'The program would be over 256 KiB.')
  return conflict(store.write(input.appId, 'program', merged, input.hash))
}

export async function showApp(deps: AppToolDeps, raw: unknown, ctx: ToolContext): Promise<AppShowResult> {
  const input = appShowInput.parse(raw)
  const meta = await ownApp(deps, input.appId, ctx)
  const store = await deps.store()
  const files = await store.working(input.appId)
  const workspaceId = await deps.workspaceOf(ctx.taskId)
  const problems: AppProblem[] = []
  for (const [name, text] of Object.entries(files.plans)) {
    const found = await deps.planProblems(
      workspaceId,
      JSON.parse(text),
      ctx.userLogin,
      ctx.signal ?? new AbortController().signal,
    )
    for (const line of found) {
      const [path, ...message] = line.split(': ')
      problems.push({ code: 'plan', path: `/plans/${name}${path}`, message: message.join(': ') || line })
    }
  }
  const program = programProblems(files.program, Object.keys(files.plans))
  problems.push(...program.problems)
  if (problems.length)
    throw new ToolError(
      'bad_request',
      [...problems, ...program.warnings.map((warning) => ({ ...warning, code: `warning ${warning.code}` }))]
        .map(describeProblem)
        .join('\n'),
    )
  const revision = await store.publish(input.appId, files, {
    note: input.note,
    library: { id: LIBRARY_ID, version: LIBRARY_VERSION },
  })
  return { appId: input.appId, name: meta.name, revision }
}

export async function listApps(deps: AppToolDeps, ctx: ToolContext) {
  return (await (await deps.store()).forTask(ctx.taskId)).map(({ appId, name, description, head }) => ({
    appId,
    name,
    description,
    head,
  }))
}

export const guideApps = async (deps: AppToolDeps, ctx: ToolContext) =>
  appGuide(await deps.planGuide(await deps.workspaceOf(ctx.taskId)))

// The `http:request` workflow step (docs/workflows.md § Contributed step kinds), and this plugin's
// only node-side contribution to another plugin.
//
// It exists here rather than in workflows for the reason the extensibility review gave: everything an
// HTTP call needs to be safe already lives in this package — the scheme check that runs *after*
// interpolation, the 5 MB response cap, the variable layers with their secret redaction, the command
// deadline. A second caller in the workflows plugin would be a second, worse copy of all of it.
import type { StepHandler, StepValidator } from '@acorn/plugin-workflows/contract/extensions.ts'
import type { CoreServices, PluginDatabase } from '@acorn/plugin-api/node'
import { httpMethods, type HttpSendInput, type KeyValue } from '../shared/model'
import { send, SendError } from '../server/send'

/** `ctx.audit.record`, narrowed to what this module calls. Passed in rather than taking the whole
 *  context, so the step handler stays testable without a node. */
export type AuditRecorder = (action: string, entry: { subject: string; details: Record<string, string | number | boolean> }) => void

// What `[steps.with]` may say. Deliberately the send input minus the parts a workflow has no business
// setting: `executionTaskId` is the run's own task, and `vars` are the project's.
type StepConfig = {
  method: string
  url: string
  headers?: Record<string, string>
  bodyMode?: HttpSendInput['bodyMode']
  body?: string
  auth?: HttpSendInput['auth']
  vars?: Record<string, string>
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Checked at authoring time, so a bad step is a red row in the workflow list rather than a run that
 *  starts and then fails on its third step. The URL is not resolved here: it may be entirely
 *  `{{variables}}`, which is the normal case and is what makes the post-interpolation scheme check in
 *  buildRequest the one that matters. */
export const validateHttpStep: StepValidator = (step, { label }) => {
  const config = step.with
  if (!isRecord(config)) return [`${label} needs a [steps.with] table with a method and a url`]
  const errors: string[] = []
  if (typeof config.url !== 'string' || !config.url.trim()) errors.push(`${label} has no url`)
  if (typeof config.method !== 'string' || !(httpMethods as readonly string[]).includes(config.method.toUpperCase())) {
    errors.push(`${label} needs one of ${httpMethods.join(', ')} as its method`)
  }
  if (config.headers !== undefined && !isRecord(config.headers)) errors.push(`${label} headers must be a table of strings`)
  return errors
}

const toKeyValues = (headers: Record<string, unknown> | undefined): KeyValue[] =>
  Object.entries(headers ?? {}).map(([name, value]) => ({ name, value: String(value), enabled: true }))

/** The trail write, as narrow as the manifest's disclosure (../../acorn-plugin.config.mjs). The final
 *  URL is already redacted by `send`, and only its origin goes on the row: a query string is where a
 *  token ends up when someone puts one there, and an audit trail that quotes what it saw becomes a
 *  second copy of the thing it protects. */
const auditTarget = (url: string): string => {
  try {
    return new URL(url).origin
  } catch {
    return 'unknown'
  }
}

export function httpStepHandler(db: PluginDatabase, core: CoreServices, audit: AuditRecorder): StepHandler {
  return async (ctx) => {
    const config = ctx.def.with as unknown as StepConfig
    // The step runs as the node's owner, which is who the project's saved variables and secrets belong
    // to. A workflow run has no request identity to inherit.
    const userId = core.identity.active()
    const task = await core.tasks.load(ctx.run.taskId)
    if (!userId || !task?.projectId) return { status: 'failed', error: 'This node has no bound owner or the run has no project.' }

    const input: HttpSendInput = {
      method: config.method.toUpperCase(),
      url: config.url,
      headers: toKeyValues(config.headers),
      bodyMode: config.bodyMode ?? (config.body === undefined ? 'none' : 'json'),
      body: config.body ?? '',
      auth: config.auth ?? { mode: 'none' },
      vars: config.vars ?? {},
      // `{{worktree}}` and `{{branch}}` resolve against the run's own task, and a command variable
      // runs in that worktree. A step cannot point itself at another task's checkout.
      executionTaskId: ctx.run.taskId,
    }

    let result
    try {
      result = await send(db, core, userId, task.projectId, input)
    } catch (error) {
      // A bad URL or a smuggled scheme. Already a clean sentence, and already redacted.
      return { status: 'failed', error: error instanceof SendError ? error.message : 'The request could not be built.' }
    }
    audit('request.sent', {
      subject: auditTarget(result.url),
      details: { method: input.method, taskId: ctx.run.taskId, workflowRunId: ctx.run.id, ...(result.ok ? { status: result.status } : { failed: true }) },
    })
    if (!result.ok) return { status: 'failed', error: result.error, result }
    // 4xx and 5xx are answers, not transport failures, and a workflow that wants to branch on one
    // needs the step to succeed so the next step can read the status. `decide` is how you branch.
    return {
      status: 'done',
      result: { status: result.status, url: result.url, durationMs: result.durationMs },
      // The body as text, which is what a later step's `${steps.<name>.output}` interpolates.
      structured: { status: result.status, headers: Object.fromEntries(result.headers), body: Buffer.from(result.bodyBase64, 'base64').toString('utf8') },
    }
  }
}

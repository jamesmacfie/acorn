import { z } from 'zod'

// The app tools' inputs and results, and the routes the card and the Apps pane read, shared by the
// Node and both clients. No lang-core here: the client's tool-card registration imports this eagerly.

export const appIdSchema = z.string().regex(/^app-[0-9a-f]{12}$/, 'An app id looks like app-0123456789ab.')
/** A plan name is the file name under plans/, and the name a program's Query and Panel use. */
const planNameSchema = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/, 'A plan name is a letter, then letters, digits, or _.')
/** `program`, or `plans/<name>`. */
const appFileSchema = z.union([z.literal('program'), z.templateLiteral(['plans/', planNameSchema])])
export type AppFile = z.infer<typeof appFileSchema>

// Generous beside app_show's 64 KiB program limit, so a draft can be too long and still be fixed, but
// bounded, so a tool call can't fill the disk.
const fileText = z.string().max(256 * 1024)

export const appCreateInput = z.strictObject({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(500),
})
export const appReadInput = z.strictObject({ appId: appIdSchema, file: appFileSchema.optional() })
export const appWriteInput = z.strictObject({
  appId: appIdSchema,
  file: appFileSchema,
  /** The new text, or null to delete a plan. */
  content: fileText.nullable(),
  /** The hash app_read returned. Needed when the file exists. */
  hash: z.string().optional(),
})
export const appPatchInput = z.strictObject({ appId: appIdSchema, statements: fileText.min(1), hash: z.string() })
export const appShowInput = z.strictObject({ appId: appIdSchema, note: z.string().trim().min(1).max(200) })

/** What `app_show` returns, and what the card reads back from the transcript. */
export const appShowResultSchema = z.object({
  appId: appIdSchema,
  name: z.string(),
  revision: z.number().int().positive(),
})
export type AppShowResult = z.infer<typeof appShowResultSchema>

export type AppRevisionSummary = { revision: number; note: string; restoredFrom?: number }
/** An app's name, head, and revisions, as the card's route returns them. */
export type AppSummary = { appId: string; taskId?: string; name: string; head: number; revisions: AppRevisionSummary[] }
export type AppRevisionFiles = { program: string; plans: Record<string, unknown> }
/** One shown app, as the Apps pane and the Apps source list it. A task app or draft has `taskId`, and
 *  a project app has `projectId`. `sessionId` is the session its drawer draws. A draft's `draftOf`
 *  names its project app, the project revision it's at, and its own head when it got there. */
export type AppListing = {
  appId: string
  taskId?: string
  projectId?: string
  name: string
  description: string
  head: number
  updatedAt: number
  sessionId?: string
  draftOf?: { appId: string; revision: number; head: number }
  deletedAt?: number
}

/** How Publish treats a draft whose project app moved since the draft started: refuse with 409,
 *  replace its head anyway, or publish the draft as a new project app. */
export const publishModeSchema = z.enum(['safe', 'replace', 'new'])
export type PublishMode = z.infer<typeof publishModeSchema>

/** The frame the Node sends when an app's head moves, so the Apps pane and its gate follow. */
export const APP_CHANGED_VERB = 'app-changed'
export const APPS_PANE_ID = 'apps'
export const APPS_SOURCE_ID = 'apps'

/** Where the Apps source shows a project's apps, and one of them. */
export const projectAppsPath = (projectId: string, appId?: string) =>
  `/p/${encodeURIComponent(projectId)}/apps${appId ? `/${encodeURIComponent(appId)}` : ''}`

export const appsRoute = '/v1/p/trellis/apps'

export const appRoute = (appId: string) => `${appsRoute}/${encodeURIComponent(appId)}`
export const appRevisionRoute = (appId: string, revision: number) => `${appRoute(appId)}/revisions/${revision}`
export const appRestoreRoute = (appId: string) => `${appRoute(appId)}/restore`
export const appStateRoute = (appId: string) => `${appRoute(appId)}/state`
export const appSessionRoute = (appId: string) => `${appRoute(appId)}/session`
export const appPublishRoute = (appId: string) => `${appRoute(appId)}/publish`
export const appDraftsRoute = (appId: string) => `${appRoute(appId)}/drafts`
export const appDeletedRoute = (appId: string) => `${appRoute(appId)}/deleted`

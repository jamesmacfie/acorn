import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AppFile, AppRevisionFiles, AppRevisionSummary, AppSummary } from '../shared/api'

// An app's files under the Node's data root (docs/agent-built-apps.md § Files):
//
//   apps/<appId>/app.json                    the owner, name, description, head, building session, draft link
//   apps/<appId>/working/program.oui         what the tools edit
//   apps/<appId>/working/plans/<name>.json
//   apps/<appId>/revisions/<n>/              what app_show published; never changed again
//   apps/<appId>/state.json                  the program's saved $ variables
//
// Ids and file names are checked by the tool schemas before they reach a path here. Every change to
// one app runs in that app's queue, so a hash check and the write after it can't interleave.

/** A draft's project app: the project revision the draft is at, and the draft's own head when it got
 *  there, so a later head is a change not yet published. */
type DraftLink = { appId: string; revision: number; head: number }

/** Exactly one of `taskId` and `projectId` is set: a task app or draft, or a project app. */
export type AppMeta = {
  appId: string
  taskId?: string
  projectId?: string
  name: string
  description: string
  head: number
  createdAt: number
  /** When head last moved. Absent on an app that has never been shown. */
  updatedAt?: number
  /** The session that last showed the app, or the one the person started to edit it. */
  sessionId?: string
  draftOf?: DraftLink
  /** When a project app was deleted. It stays, listed as archived, until it's restored or removed. */
  deletedAt?: number
}
export type RevisionMeta = AppRevisionSummary & {
  library: { id: string; version: number }
  shownAt: number
  /** On a project app's revision: the task app revision it was published from, and the session that
   *  last showed that app. */
  publishedFrom?: { taskId: string; appId: string; revision: number; sessionId?: string }
}

export class AppConflict extends Error {}

export const fileHash = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16)

const fileName = (file: AppFile) => (file === 'program' ? 'program.oui' : `${file}.json`)

export class AppStore {
  private queues = new Map<string, Promise<unknown>>()

  constructor(private readonly root: string) {}

  private dir = (appId: string) => join(this.root, appId)

  private serial<T>(appId: string, work: () => Promise<T>): Promise<T> {
    const next = (this.queues.get(appId) ?? Promise.resolve()).then(work, work)
    this.queues.set(
      appId,
      next.catch(() => undefined),
    )
    return next
  }

  async create(
    owner: { taskId: string } | { projectId: string },
    name: string,
    description: string,
    sessionId?: string,
  ): Promise<AppMeta> {
    const meta: AppMeta = {
      appId: `app-${randomBytes(6).toString('hex')}`,
      ...owner,
      name,
      description,
      head: 0,
      createdAt: Date.now(),
      ...(sessionId ? { sessionId } : {}),
    }
    await mkdir(join(this.dir(meta.appId), 'working', 'plans'), { recursive: true })
    await writeFile(join(this.dir(meta.appId), 'working', 'program.oui'), '')
    await this.saveMeta(meta)
    return meta
  }

  async meta(appId: string): Promise<AppMeta | null> {
    try {
      return JSON.parse(await readFile(join(this.dir(appId), 'app.json'), 'utf8')) as AppMeta
    } catch {
      return null
    }
  }

  private async saveMeta(meta: AppMeta) {
    const path = join(this.dir(meta.appId), 'app.json')
    await writeFile(`${path}.tmp`, JSON.stringify(meta, null, 2))
    await rename(`${path}.tmp`, path)
  }

  /** Every app on this Node, archived tasks' included. */
  async all(): Promise<AppMeta[]> {
    const ids = await readdir(this.root).catch(() => [] as string[])
    const metas = await Promise.all(ids.map((id) => this.meta(id)))
    return metas.filter((meta): meta is AppMeta => !!meta)
  }

  async forTask(taskId: string): Promise<AppMeta[]> {
    return (await this.all()).filter((meta) => meta.taskId === taskId)
  }

  /** Changes fields of app.json other than the head, which only `publish` moves. Answers whether the
   *  app exists. */
  update(appId: string, change: Partial<Pick<AppMeta, 'sessionId' | 'draftOf' | 'deletedAt'>>): Promise<boolean> {
    return this.serial(appId, async () => {
      const meta = await this.meta(appId)
      if (meta) await this.saveMeta({ ...meta, ...change })
      return !!meta
    })
  }

  /** Deletes an app's files. */
  remove(appId: string): Promise<void> {
    return this.serial(appId, () => rm(this.dir(appId), { recursive: true, force: true }))
  }

  /** The saved $ variables, or none. */
  async state(appId: string): Promise<Record<string, unknown>> {
    const text = await this.readText(join(this.dir(appId), 'state.json'))
    const value: unknown = text ? JSON.parse(text) : {}
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  }

  /** Replaces the saved $ variables. The caller has checked the size. */
  saveState(appId: string, state: Record<string, unknown>): Promise<void> {
    return this.serial(appId, async () => {
      const path = join(this.dir(appId), 'state.json')
      await writeFile(`${path}.tmp`, JSON.stringify(state))
      await rename(`${path}.tmp`, path)
    })
  }

  private async readText(path: string): Promise<string | null> {
    try {
      return await readFile(path, 'utf8')
    } catch {
      return null
    }
  }

  /** The working files: the program, and each plan's text by name. */
  async working(appId: string): Promise<{ program: string; plans: Record<string, string> }> {
    const dir = join(this.dir(appId), 'working')
    const names = (await readdir(join(dir, 'plans')).catch(() => [] as string[])).filter((name) =>
      name.endsWith('.json'),
    )
    const plans: Record<string, string> = {}
    for (const name of names.sort())
      plans[name.slice(0, -'.json'.length)] = await readFile(join(dir, 'plans', name), 'utf8')
    return { program: (await this.readText(join(dir, 'program.oui'))) ?? '', plans }
  }

  async read(appId: string, file: AppFile): Promise<{ content: string; hash: string } | null> {
    const content = await this.readText(join(this.dir(appId), 'working', fileName(file)))
    return content === null ? null : { content, hash: fileHash(content) }
  }

  /** Replaces one working file, or deletes a plan when `content` is null. A file that exists needs the
   *  hash it was read with. */
  write(
    appId: string,
    file: AppFile,
    content: string | null,
    hash: string | undefined,
  ): Promise<{ hash: string | null }> {
    return this.serial(appId, async () => {
      const path = join(this.dir(appId), 'working', fileName(file))
      const current = await this.readText(path)
      if (current !== null && hash !== fileHash(current))
        throw new AppConflict(`${file} changed since it was read. Read it again, then write.`)
      if (content === null) {
        await rm(path, { force: true })
        return { hash: null }
      }
      await writeFile(path, content)
      return { hash: fileHash(content) }
    })
  }

  /** Publishes files as the next revision and makes it head. A restore copies them into the working
   *  files too, so the agent's next edit starts from what is on screen. `sessionId` is the session that
   *  showed it, which becomes the app's building session. With `expectedHead`, it publishes only while
   *  the head is still that revision, and throws AppConflict otherwise. */
  publish(
    appId: string,
    files: { program: string; plans: Record<string, string> },
    revision: Omit<RevisionMeta, 'revision' | 'shownAt'>,
    options: { toWorking?: boolean; sessionId?: string; expectedHead?: number } = {},
  ): Promise<number> {
    return this.serial(appId, async () => {
      const meta = await this.meta(appId)
      if (!meta) throw new Error(`No app ${appId}.`)
      if (options.expectedHead !== undefined && meta.head !== options.expectedHead)
        throw new AppConflict(`${meta.name} moved to v${meta.head} since v${options.expectedHead}.`)
      const number = meta.head + 1
      const target = join(this.dir(appId), 'revisions', String(number))
      const staging = `${target}.tmp`
      await rm(staging, { recursive: true, force: true })
      await mkdir(join(staging, 'plans'), { recursive: true })
      await writeFile(join(staging, 'program.oui'), files.program)
      for (const [name, text] of Object.entries(files.plans))
        await writeFile(join(staging, 'plans', `${name}.json`), text)
      const record: RevisionMeta = { ...revision, revision: number, shownAt: Date.now() }
      await writeFile(join(staging, 'revision.json'), JSON.stringify(record, null, 2))
      await rename(staging, target)
      if (options.toWorking) {
        const working = join(this.dir(appId), 'working')
        await rm(working, { recursive: true, force: true })
        await mkdir(join(working, 'plans'), { recursive: true })
        await writeFile(join(working, 'program.oui'), files.program)
        for (const [name, text] of Object.entries(files.plans))
          await writeFile(join(working, 'plans', `${name}.json`), text)
      }
      await this.saveMeta({
        ...meta,
        head: number,
        updatedAt: record.shownAt,
        ...(options.sessionId ? { sessionId: options.sessionId } : {}),
      })
      return number
    })
  }

  async revision(
    appId: string,
    number: number,
  ): Promise<{ files: { program: string; plans: Record<string, string> }; meta: RevisionMeta } | null> {
    const dir = join(this.dir(appId), 'revisions', String(number))
    const meta = await this.readText(join(dir, 'revision.json'))
    if (meta === null) return null
    const names = (await readdir(join(dir, 'plans'))).filter((name) => name.endsWith('.json')).sort()
    const plans: Record<string, string> = {}
    for (const name of names) plans[name.slice(0, -'.json'.length)] = await readFile(join(dir, 'plans', name), 'utf8')
    return {
      files: { program: await readFile(join(dir, 'program.oui'), 'utf8'), plans },
      meta: JSON.parse(meta) as RevisionMeta,
    }
  }

  /** The program and parsed plans of one revision, as the card draws them. */
  async revisionFiles(appId: string, number: number): Promise<AppRevisionFiles | null> {
    const found = await this.revision(appId, number)
    if (!found) return null
    return {
      program: found.files.program,
      plans: Object.fromEntries(Object.entries(found.files.plans).map(([name, text]) => [name, JSON.parse(text)])),
    }
  }

  async summary(appId: string): Promise<AppSummary | null> {
    const meta = await this.meta(appId)
    if (!meta) return null
    const revisions: AppRevisionSummary[] = []
    for (let number = 1; number <= meta.head; number++) {
      const text = await this.readText(join(this.dir(appId), 'revisions', String(number), 'revision.json'))
      if (!text) continue
      const { note, restoredFrom } = JSON.parse(text) as RevisionMeta
      revisions.push({ revision: number, note, ...(restoredFrom ? { restoredFrom } : {}) })
    }
    return { appId, taskId: meta.taskId, name: meta.name, head: meta.head, revisions }
  }

  /** Deletes the apps of tasks that were deleted, and answers how many went. Archiving keeps them. */
  async removeTasks(taskIds: readonly string[]): Promise<number> {
    const doomed = new Set(taskIds)
    let removed = 0
    for (const id of await readdir(this.root).catch(() => [] as string[])) {
      const meta = await this.meta(id)
      if (!meta?.taskId || !doomed.has(meta.taskId)) continue
      await rm(this.dir(id), { recursive: true, force: true })
      removed += 1
    }
    return removed
  }
}

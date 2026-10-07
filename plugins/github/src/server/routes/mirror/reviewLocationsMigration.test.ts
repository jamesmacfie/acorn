import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { expect, it, vi } from 'vitest'
import { makeTestPluginDb } from '@acorn/plugin-api/testkit'
import { syncState } from '../../../node/schema'
import { readComposite } from './prMirror'
import { fakeGithub, makeFakePull } from './fakeGithub.helper'
import { refreshPullDetail } from '../pulls/pullRefresh'

it('upgrades populated legacy history without trusting its ambiguous line and restores it on refresh', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'acorn-github-chain-'))
  const source = new URL('../../../../migrations/', import.meta.url)
  cpSync(source, folder, { recursive: true })
  const journalPath = join(folder, 'meta/_journal.json')
  const journal = JSON.parse(readFileSync(journalPath, 'utf8'))
  writeFileSync(journalPath, JSON.stringify({ ...journal, entries: journal.entries.slice(0, 2) }))
  const plugin = makeTestPluginDb('github', folder)
  const key = { userId: 'ada', repoId: 11, number: 7 }
  let upgraded: ReturnType<typeof plugin.openConnection> | undefined
  try {
    // Raw inserts use the legacy schema; the typed tables include columns the upgrade adds.
    plugin.db.run(sql`INSERT INTO pull_requests (user_id, repo_id, number, state, title, fetched_at)
      VALUES ('ada', 11, 7, 'open', 'Legacy pull', 1000)`)
    plugin.db.run(sql`INSERT INTO review_threads
      (user_id, repo_id, number, thread_id, id, database_id, path, line, side, resolved, body, position)
      VALUES ('ada', 11, 7, 'thread-0', 'thread-0-comment-0', 0, 'a.ts', 275, 'RIGHT', 0, 'Keep this history', 0),
      ('ada', 11, 7, 'thread-0', 'reply', 1, 'a.ts', 275, 'RIGHT', 0, 'Keep this reply', 1)`)
    plugin.db.run(sql`INSERT INTO sync_state (user_id, resource, fetched_at)
      VALUES ('ada', 'pr:11:7', 1000), ('ada', 'files:11:7', 1000)`)
    plugin.db.close()
    writeFileSync(journalPath, JSON.stringify(journal))
    upgraded = plugin.openConnection()
    const offline = await readComposite(upgraded, key)
    expect(offline.revision).toBeNull()
    expect(offline.threads[0]).toMatchObject({ threadId: 'thread-0', line: null, originalLine: null, outdated: null })
    expect(offline.threads[0]?.comments.map((c) => [c.id, c.body])).toEqual([
      ['thread-0-comment-0', 'Keep this history'], ['reply', 'Keep this reply'],
    ])
    expect(upgraded.select().from(syncState).all().map((row) => row.fetchedAt)).toEqual([0, 0])
    const pull = makeFakePull({ threads: 1, commentsPerThread: () => 2 })
    pull.threads[0]!.comments[1]!.id = 'reply'
    pull.threads[0]!.line = 12
    vi.stubGlobal('fetch', fakeGithub(pull).fetch)
    await refreshPullDetail('token', upgraded, { ...key, owner: 'acme', repo: 'web' })
    const refreshed = await readComposite(upgraded, key)
    expect(refreshed.threads[0]).toMatchObject({ line: 12, originalLine: 1, outdated: false })
    expect(refreshed.threads[0]?.comments.map((c) => c.id)).toEqual(['thread-0-comment-0', 'reply'])
    expect(refreshed.revision).toBe('base-sha:head-sha')
  } finally {
    upgraded?.close()
    plugin.cleanup()
    rmSync(folder, { recursive: true, force: true })
    vi.unstubAllGlobals()
  }
})

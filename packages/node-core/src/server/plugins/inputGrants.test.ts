import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { declaredInputs, grantCoversInput, inputGrantsStore, sameInputs, type InputGrant } from './inputGrants'

const grant: InputGrant = {
  pluginId: 'release-readiness',
  sources: { readiness: { issues: { source: 'linear:issues', optional: false }, pulls: { source: 'github:pull-requests', optional: true } } },
  grantedAt: 1, grantedBy: 'owner',
}

describe('inputGrantsStore', () => {
  let dir: string
  const file = () => join(dir, 'input-grants.json')
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'acorn-input-grants-')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('round-trips a grant across processes, privately', () => {
    expect(inputGrantsStore(dir).get(grant.pluginId)).toBeUndefined()
    inputGrantsStore(dir).set(grant)
    expect(statSync(file()).mode & 0o777).toBe(0o600)
    expect(inputGrantsStore(dir).get(grant.pluginId)).toEqual(grant)
    inputGrantsStore(dir).set({ ...grant, sources: {}, grantedAt: 2 })
    expect(JSON.parse(readFileSync(file(), 'utf8'))).toHaveLength(1)
    expect(inputGrantsStore(dir).get(grant.pluginId)?.grantedAt).toBe(2)
    inputGrantsStore(dir).delete(grant.pluginId)
    expect(inputGrantsStore(dir).get(grant.pluginId)).toBeUndefined()
  })

  it('reads a corrupt file as no grants and skips malformed entries', () => {
    for (const raw of ['{ not json', '{}', 'null', '']) {
      writeFileSync(file(), raw)
      expect(inputGrantsStore(dir).get(grant.pluginId), raw).toBeUndefined()
    }
    writeFileSync(file(), JSON.stringify([{ pluginId: 'broken', sources: { s: { a: { source: 7 } } } }, grant]))
    expect(inputGrantsStore(dir).get('broken')).toBeUndefined()
    expect(inputGrantsStore(dir).get(grant.pluginId)).toEqual(grant)
  })
})

describe('grantCoversInput', () => {
  it('covers the inputs that still match when a new version changes the list', () => {
    // The new version keeps `issues`, makes `pulls` required, and adds `checks`.
    expect(grantCoversInput(grant, 'readiness', 'issues', { source: 'linear:issues' })).toBe(true)
    expect(grantCoversInput(grant, 'readiness', 'pulls', { source: 'github:pull-requests' })).toBe(false)
    expect(grantCoversInput(grant, 'readiness', 'checks', { source: 'github:actions' })).toBe(false)
    expect(grantCoversInput(grant, 'readiness', 'issues', { source: 'jira:issues' })).toBe(false)
    expect(grantCoversInput(grant, 'other', 'issues', { source: 'linear:issues' })).toBe(false)
    expect(grantCoversInput(undefined, 'readiness', 'issues', { source: 'linear:issues' })).toBe(false)
  })
})

describe('declaredInputs and sameInputs', () => {
  const registration = { name: 'Release readiness', singular: 'Issue', plural: 'Issues', identityScope: 'issue', handler: '/v1/p/r/board' }
  it('keys a manifest the way a grant does, and compares lists in any order', () => {
    const declared = declaredInputs([
      { ...registration, sourceId: 'readiness', inputs: { pulls: { source: 'github:pull-requests', label: 'Pulls', optional: true }, issues: { source: 'linear:issues', label: 'Issues' } } },
      { ...registration, sourceId: 'plain' },
    ])
    expect(declared).toEqual({ readiness: { pulls: { source: 'github:pull-requests', optional: true }, issues: { source: 'linear:issues', optional: false } } })
    expect(sameInputs(declared, grant.sources)).toBe(true)
    expect(sameInputs(declared, { readiness: { issues: grant.sources.readiness!.issues! } })).toBe(false)
    expect(sameInputs(declared, { readiness: { ...grant.sources.readiness, pulls: { source: 'github:pull-requests', optional: false } } })).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { purgeRetiredLocalStorage } from './legacyStorage'

const fakeStorage = (entries: [string, string][]) => {
  const values = new Map(entries)
  return {
    values,
    storage: {
      get length() {
        return values.size
      },
      key: (index: number) => [...values.keys()][index] ?? null,
      removeItem: (key: string) => void values.delete(key),
    },
  }
}

describe('retired localStorage keys', () => {
  it('removes every credential-bearing HTTP draft without touching other local state', () => {
    const { values, storage } = fakeStorage([
      ['http-draft:acme/web:repo', '{"auth":"secret"}'],
      ['theme', 'dark'],
      ['http-draft:acme/api:task-1', '{"body":"secret"}'],
    ])

    expect(purgeRetiredLocalStorage(storage).sort()).toEqual(['http-draft:acme/api:task-1', 'http-draft:acme/web:repo'])
    expect([...values.entries()]).toEqual([['theme', 'dark']])
  })

  it('sweeps every match even though removing one reindexes the rest', () => {
    const { values, storage } = fakeStorage([
      ['http-draft:a', '1'],
      ['http-draft:b', '2'],
      ['http-draft:c', '3'],
    ])

    purgeRetiredLocalStorage(storage)

    expect(values.size).toBe(0)
  })

  it('removes only retired workflow-v2 device namespaces', () => {
    const { values, storage } = fakeStorage([
      ['workflow-recovery:v1:draft', '1'],
      ['query-recovery:v1:draft', '2'],
      ['acorn:dashboard-recovery:panel', '3'],
      ['acorn:ai-authoring:v1:conversation', '4'],
      ['agent-session:session-1', 'keep'],
      ['theme', 'dark'],
    ])
    expect(purgeRetiredLocalStorage(storage)).toHaveLength(4)
    expect([...values.entries()]).toEqual([['agent-session:session-1', 'keep'], ['theme', 'dark']])
  })

  it('leaves a device with nothing to clean alone', () => {
    const { values, storage } = fakeStorage([['theme', 'dark']])
    expect(purgeRetiredLocalStorage(storage)).toEqual([])
    expect(values.size).toBe(1)
  })
})

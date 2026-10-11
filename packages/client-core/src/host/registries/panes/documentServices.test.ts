import { afterEach, describe, expect, it } from 'vitest'
import { PrefKeys } from '../../../infra/persistence/prefKeys'
import {
  checkDiagnostics,
  checkHover,
  documentServiceRegistry,
  languageRequestTooLarge,
  positionAt,
  resolveDocumentServices,
  type DocumentServiceContribution,
} from './documentServices'

const disposers: (() => void)[] = []
afterEach(() => disposers.splice(0).forEach((dispose) => dispose()))

const provide = (pluginId: string, extra: Partial<DocumentServiceContribution> = {}, nodes = ['node-a']): void => {
  const registration = documentServiceRegistry.register({
    id: `${pluginId}:json`,
    pluginId,
    label: pluginId,
    languageId: 'json',
    diagnostics: `/v1/p/${pluginId}/check`,
    available: (nodeId) => nodes.includes(nodeId),
    ...extra,
  })
  disposers.push(() => registration.dispose())
}
const pick = (choices: Record<string, string>) => ({ [PrefKeys.documentServices]: JSON.stringify(choices) })

describe('resolveDocumentServices', () => {
  it('lets one provider serve on its own, per service', () => {
    provide('lint', { hover: '/v1/p/lint/hover' })
    expect(resolveDocumentServices('node-a', 'json', undefined)).toEqual({
      hover: { pluginId: 'lint', label: 'lint', route: '/v1/p/lint/hover' },
      diagnostics: { pluginId: 'lint', label: 'lint', route: '/v1/p/lint/check' },
    })
    expect(resolveDocumentServices('node-a', 'yaml', undefined)).toEqual({})
  })

  it('serves nobody on a tie until the person picks, and nobody when the pick has gone', () => {
    provide('lint')
    provide('schema')
    expect(resolveDocumentServices('node-a', 'json', undefined)).toEqual({})
    expect(
      resolveDocumentServices('node-a', 'json', pick({ 'json|diagnostics': 'schema' })).diagnostics?.pluginId,
    ).toBe('schema')
    // A pick names a plugin, never the runner-up.
    expect(resolveDocumentServices('node-a', 'json', pick({ 'json|diagnostics': 'gone' }))).toEqual({})
    // A pick for hover settles nothing about diagnostics.
    expect(resolveDocumentServices('node-a', 'json', pick({ 'json|hover': 'schema' }))).toEqual({})
  })

  it('chooses on the Node being viewed', () => {
    provide('lint', {}, ['node-a'])
    provide('schema', {}, ['node-b'])
    expect(resolveDocumentServices('node-a', 'json', undefined).diagnostics?.pluginId).toBe('lint')
    expect(resolveDocumentServices('node-b', 'json', undefined).diagnostics?.pluginId).toBe('schema')
  })
})

describe('positions', () => {
  it('is one-based and counts UTF-16 units, so an emoji is two columns', () => {
    expect(positionAt('ab\ncd', 0)).toEqual({ line: 1, column: 1 })
    expect(positionAt('ab\ncd', 4)).toEqual({ line: 2, column: 2 })
    expect(positionAt('😀x', 2)).toEqual({ line: 1, column: 3 })
  })

  it('caps a request at 1 MiB of UTF-8', () => {
    expect(languageRequestTooLarge('a'.repeat(1024 * 1024))).toBe(false)
    expect(languageRequestTooLarge('a'.repeat(1024 * 1024 + 1))).toBe(true)
    expect(languageRequestTooLarge('€'.repeat(349_526))).toBe(true)
    expect(languageRequestTooLarge('€'.repeat(349_525))).toBe(false)
  })
})

describe('checkHover', () => {
  const sent = { text: '{"a": 1}\n😀 ok', revision: 4 }

  it('keeps a hover for the revision it was asked about, with its range as offsets', () => {
    expect(
      checkHover(
        {
          revision: 4,
          contents: { kind: 'markdown', value: '**a**' },
          range: { start: { line: 2, column: 3 }, end: { line: 2, column: 5 } },
        },
        sent,
      ),
    ).toEqual({ kind: 'markdown', value: '**a**', from: 11, to: 13 })
    expect(checkHover({ revision: 4, contents: { kind: 'plaintext', value: 'number' } }, sent)).toEqual({
      kind: 'plaintext',
      value: 'number',
    })
  })

  it('refuses another revision, a bad range, a bad shape, and contents over 64 KiB', () => {
    const contents = { kind: 'plaintext', value: 'x' }
    expect(checkHover({ revision: 3, contents }, sent)).toBeUndefined()
    expect(
      checkHover(
        { revision: 4, contents, range: { start: { line: 3, column: 1 }, end: { line: 3, column: 1 } } },
        sent,
      ),
    ).toBeUndefined()
    expect(
      checkHover(
        { revision: 4, contents, range: { start: { line: 1, column: 10 }, end: { line: 1, column: 10 } } },
        sent,
      ),
    ).toBeUndefined()
    expect(
      checkHover(
        { revision: 4, contents, range: { start: { line: 1, column: 3 }, end: { line: 1, column: 2 } } },
        sent,
      ),
    ).toBeUndefined()
    expect(
      checkHover(
        { revision: 4, contents, range: { start: { line: 0, column: 1 }, end: { line: 1, column: 1 } } },
        sent,
      ),
    ).toBeUndefined()
    expect(checkHover({ revision: 4, contents: { kind: 'html', value: '<b>' } }, sent)).toBeUndefined()
    expect(checkHover({ revision: 4, contents: { kind: 'plaintext', value: '  ' } }, sent)).toBeUndefined()
    expect(
      checkHover({ revision: 4, contents: { kind: 'plaintext', value: '€'.repeat(21_846) } }, sent),
    ).toBeUndefined()
    expect(checkHover('nope', sent)).toBeUndefined()
  })
})

describe('checkDiagnostics', () => {
  const sent = { text: '{\n  "a": 1,\n}', revision: 7 }
  const item = (extra: Record<string, unknown> = {}) => ({
    range: { start: { line: 2, column: 9 }, end: { line: 2, column: 10 } },
    severity: 'error',
    message: 'Trailing comma',
    ...extra,
  })

  it('keeps good items as offsets and drops bad ones one by one', () => {
    const checked = checkDiagnostics(
      {
        revision: 7,
        items: [
          item({ code: 'E1', source: 'json' }),
          item({ severity: 'fatal' }),
          item({ message: '' }),
          item({ range: { start: { line: 2, column: 12 }, end: { line: 2, column: 13 } } }),
          null,
        ],
      },
      sent,
    )
    expect(checked).toEqual([
      { from: 10, to: 11, severity: 'error', message: 'Trailing comma', code: 'E1', source: 'json' },
    ])
  })

  it('refuses another revision and a missing list, and keeps 200 items', () => {
    expect(checkDiagnostics({ revision: 6, items: [item()] }, sent)).toBeUndefined()
    expect(checkDiagnostics({ revision: 7 }, sent)).toBeUndefined()
    expect(checkDiagnostics({ revision: 7, items: [] }, sent)).toEqual([])
    expect(checkDiagnostics({ revision: 7, items: Array.from({ length: 250 }, () => item()) }, sent)).toHaveLength(200)
  })
})

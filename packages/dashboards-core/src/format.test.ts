import { describe, expect, it } from 'vitest'
import type { PluginCollectionField } from '@acorn/protocol/collections.ts'
import { cellText, formatCell, personInitials } from './format'

const field = (over: Partial<PluginCollectionField> & Pick<PluginCollectionField, 'type'>): PluginCollectionField =>
  ({ id: 'f', name: 'F', ...over })

const NOW = 1_700_000_000_000

describe('formatCell', () => {
  it('draws nothing for both spellings of nothing', () => {
    expect(formatCell(field({ type: 'text' }), null)).toEqual({ kind: 'empty' })
    expect(formatCell(field({ type: 'text' }), undefined)).toEqual({ kind: 'empty' })
    expect(formatCell(field({ type: 'text' }), '')).toEqual({ kind: 'empty' })
  })

  it('renders a number with the unit its FIELD declared', () => {
    expect(formatCell(field({ type: 'number', unit: 'MB' }), 12)).toEqual({ kind: 'number', text: '12 MB' })
    expect(formatCell(field({ type: 'number', unit: '%' }), 80)).toEqual({ kind: 'number', text: '80%' })
    expect(formatCell(field({ type: 'number' }), 12)).toEqual({ kind: 'number', text: '12' })
    expect(formatCell(field({ type: 'number' }), 'not a number')).toEqual({ kind: 'empty' })
  })

  it('gives a datetime both an age and an absolute time', () => {
    const cell = formatCell(field({ type: 'datetime' }), NOW - 2 * 60 * 60 * 1000, NOW)
    expect(cell).toMatchObject({ kind: 'datetime', relative: '2h ago' })
    expect(cell.kind === 'datetime' && cell.absolute.length).toBeGreaterThan(0)
    expect(formatCell(field({ type: 'datetime' }), NOW - 30_000, NOW)).toMatchObject({ relative: 'now' })
    expect(formatCell(field({ type: 'datetime' }), NOW - 40 * 24 * 3600_000, NOW)).toMatchObject({ relative: '1mo ago' })
    expect(formatCell(field({ type: 'datetime' }), 'yesterday')).toEqual({ kind: 'empty' })
  })

  it('tones an enum from its declared value, and still renders one that was never declared', () => {
    const declared = field({ type: 'enum', values: [{ id: 'ready', label: 'Ready to merge', tone: 'ok' }] })
    expect(formatCell(declared, 'ready')).toEqual({ kind: 'enum', label: 'Ready to merge', tone: 'ok' })
    // A query-shaped collection cannot always know its values ahead of the data.
    expect(formatCell(declared, 'surprise')).toEqual({ kind: 'enum', label: 'surprise', tone: 'muted' })
    expect(formatCell(field({ type: 'enum' }), 'open')).toEqual({ kind: 'enum', label: 'open', tone: 'muted' })
  })

  it('only calls a link a link when the host would actually open it', () => {
    expect(formatCell(field({ type: 'link' }), 'https://github.com/a/b/pull/1'))
      .toEqual({ kind: 'link', url: 'https://github.com/a/b/pull/1', text: 'github.com/a/b/pull/1' })
    // The same refusal `openUrl` makes: anything but https is a string, not a link.
    expect(formatCell(field({ type: 'link' }), 'file:///etc/passwd')).toEqual({ kind: 'text', text: 'file:///etc/passwd' })
    expect(formatCell(field({ type: 'link' }), 'not a url')).toEqual({ kind: 'text', text: 'not a url' })
  })

  it('renders booleans and people as themselves', () => {
    expect(formatCell(field({ type: 'boolean' }), true)).toEqual({ kind: 'boolean', value: true, text: 'Yes' })
    // `false` is an answer, not an absence. "Auto-merge: No" is worth a cell.
    expect(formatCell(field({ type: 'boolean' }), false)).toEqual({ kind: 'boolean', value: false, text: 'No' })
    expect(formatCell(field({ type: 'person' }), 'jamesmacfie'))
      .toEqual({ kind: 'person', name: 'jamesmacfie', initials: 'J' })
  })
})

describe('personInitials', () => {
  it('takes the first and last words of a name', () => {
    expect(personInitials('Ada Lovelace')).toBe('AL')
    expect(personInitials('Ada Byron King Lovelace')).toBe('AL')
    expect(personInitials('grace')).toBe('G')
  })

  it('reads an address as one identity rather than three words', () => {
    // Splitting on the dots would put a "C" from ".com" on the mark.
    expect(personInitials('ada@example.com')).toBe('A')
    expect(personInitials('ada.lovelace@example.com')).toBe('AL')
  })

  it('treats the separators a handle actually uses as word breaks', () => {
    expect(personInitials('ada_lovelace')).toBe('AL')
    expect(personInitials('ada-lovelace')).toBe('AL')
  })

  it('answers empty where there is nothing to draw, which is what the name-only fallback needs', () => {
    expect(personInitials('')).toBe('')
    expect(personInitials('   ')).toBe('')
    expect(personInitials('--')).toBe('')
  })

  it('skips leading punctuation rather than putting it on the mark', () => {
    expect(personInitials('@ada')).toBe('A')
    expect(personInitials('(ada) lovelace')).toBe('AL')
  })
})

describe('cellText', () => {
  it('collapses every kind to one line', () => {
    expect(cellText(formatCell(field({ type: 'enum', values: [{ id: 'a', label: 'Alpha' }] }), 'a'))).toBe('Alpha')
    expect(cellText(formatCell(field({ type: 'datetime' }), NOW - 3600_000, NOW))).toBe('1h ago')
    expect(cellText(formatCell(field({ type: 'number', unit: 'MB' }), 4))).toBe('4 MB')
    expect(cellText(formatCell(field({ type: 'text' }), null))).toBe('')
  })
})

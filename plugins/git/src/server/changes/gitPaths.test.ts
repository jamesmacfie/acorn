import { expect, it } from 'vitest'
import { decodeGitPath, parseNumstat } from './gitPaths'

it('decodes Git byte escapes to exact UTF-8 paths', () => {
  expect(decodeGitPath('"caf\\303\\251\\t\\n\\\\\\\".txt"')).toBe('café\t\n\\".txt')
  expect(decodeGitPath('"\\360\\237\\214\\263.txt"')).toBe('🌳.txt')
  expect(decodeGitPath('"\\357\\273\\277mark.txt"')).toBe('\ufeffmark.txt')
  expect(decodeGitPath('"\\357\\277\\275mark.txt"')).toBe('\ufffdmark.txt')
  expect(decodeGitPath('space {a => b}.txt')).toBe('space {a => b}.txt')
})

it.each(['"missing', '"bad\\q"', '"bad\\400"', '"bad\\12"', '"bad\\000"', '"bad\\377"', '"bad"quote"'])('rejects malformed or unsupported Git paths: %s', (path) => {
  expect(() => decodeGitPath(path)).toThrow(/Git path/)
})

it('reads exact NUL numstat names and rename pairs without interpreting literal arrows or braces', () => {
  expect(parseNumstat('1\t2\tliteral {old => new}\0-\t-\ttab\tline\n.txt\0' + '3\t4\t\0old { => }\0new { => }\0')).toEqual([
    { path: 'literal {old => new}', counts: { a: 1, d: 2 } },
    { path: 'tab\tline\n.txt', counts: { a: null, d: null } },
    { oldPath: 'old { => }', path: 'new { => }', counts: { a: 3, d: 4 } },
  ])
})

it.each(['1\t2\tfile', '1\t2\t\0old\0', 'bogus\0'])('refuses incomplete numstat: %s', (text) => {
  expect(() => parseNumstat(text)).toThrow(/Git/)
})

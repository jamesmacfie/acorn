import { describe, expect, it } from 'vitest'
import { isLanguageId, languageIdForPath, LANGUAGE_IDS } from './languageIds'

// This vocabulary replaced two maps that disagreed — the editor pane fell back to `plaintext`, the
// highlighter to `text`, and each knew extensions the other did not. What is worth pinning is that
// there is now ONE answer per path and one fallback, because a manifest names one of these ids and a
// value that parses on the node has to mean the same thing in the renderer.

describe('languageIdForPath', () => {
  it('answers with one canonical id per extension', () => {
    expect(languageIdForPath('src/index.ts')).toBe('typescript')
    expect(languageIdForPath('App.tsx')).toBe('typescriptreact')
    expect(languageIdForPath('Comp.jsx')).toBe('javascriptreact')
    expect(languageIdForPath('a.mjs')).toBe('javascript')
    expect(languageIdForPath('query.sql')).toBe('sql')
    // Carried over from the editor pane's map, which the highlighter's did not have.
    expect(languageIdForPath('script.rb')).toBe('ruby')
    expect(languageIdForPath('Cargo.toml')).toBe('toml')
  })

  it('is case-insensitive and takes the LAST extension', () => {
    expect(languageIdForPath('README.MD')).toBe('markdown')
    expect(languageIdForPath('styles.module.css')).toBe('css')
    expect(languageIdForPath('a.test.ts')).toBe('typescript')
  })

  it('falls back once, not twice', () => {
    expect(languageIdForPath('notes.xyz')).toBe('plaintext')
    expect(languageIdForPath('Makefile')).toBe('plaintext') // no dot → no extension
    expect(languageIdForPath('')).toBe('plaintext')
  })

  it('only ever answers with a published id', () => {
    const paths = ['a.ts', 'a.tsx', 'a.rb', 'a.toml', 'a.unknown', 'a.SQL']
    for (const path of paths) expect(isLanguageId(languageIdForPath(path))).toBe(true)
  })
})

describe('the vocabulary itself', () => {
  it('is a set, and a manifest can only name what is in it', () => {
    expect(new Set(LANGUAGE_IDS).size).toBe(LANGUAGE_IDS.length)
    expect(isLanguageId('plaintext')).toBe(true)
    expect(isLanguageId('brainfuck')).toBe(false)
    // The old fallbacks are not ids. `text` was shiki's word for the same thing and is now gone.
    expect(isLanguageId('text')).toBe(false)
  })
})

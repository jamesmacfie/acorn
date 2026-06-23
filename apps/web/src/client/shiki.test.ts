import { describe, expect, it } from 'vitest'
import { langFor } from './shiki'

describe('langFor', () => {
  it('maps known extensions to their shiki language id', () => {
    expect(langFor('src/index.ts')).toBe('typescript')
    expect(langFor('App.tsx')).toBe('tsx')
    expect(langFor('a.mts')).toBe('typescript')
    expect(langFor('a.cts')).toBe('typescript')
    expect(langFor('main.js')).toBe('javascript')
    expect(langFor('a.mjs')).toBe('javascript')
    expect(langFor('a.cjs')).toBe('javascript')
    expect(langFor('Comp.jsx')).toBe('jsx')
    expect(langFor('package.json')).toBe('json')
    expect(langFor('script.py')).toBe('python')
    expect(langFor('server.go')).toBe('go')
    expect(langFor('lib.rs')).toBe('rust')
  })

  it('is case-insensitive on the extension', () => {
    expect(langFor('README.MD')).toBe('markdown')
    expect(langFor('Main.PY')).toBe('python')
  })

  it('keys on the last segment when there are multiple dots', () => {
    expect(langFor('a.test.ts')).toBe('typescript')
    expect(langFor('styles.module.css')).toBe('css')
  })

  it("falls back to 'text' for unknown or missing extensions", () => {
    expect(langFor('notes.xyz')).toBe('text')
    expect(langFor('Makefile')).toBe('text') // no dot → no extension
    expect(langFor('')).toBe('text')
  })
})

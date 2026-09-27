/** @jsxImportSource @acorn/tui/jsx */
import { mkdtemp, readFile, rm, truncate, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { renderFixture } from '../harness'
import { pickLocalFile, saveLocalFile } from './filePrompt'

async function type(screen: Awaited<ReturnType<typeof renderFixture>>, value: string) {
  for (const character of value) await screen.press(character)
}

describe('terminal file paths', () => {
  it('reads local bytes for an attachment and rejects an unsupported extension', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'acorn-tui-file-'))
    const file = join(directory, 'note.txt')
    await writeFile(file, 'from terminal')
    const screen = await renderFixture({ width: 80, height: 24 })
    try {
      const picked = pickLocalFile({ accept: ['txt'] })
      await screen.until('Attach local file')
      expect(await screen.reach('/absolute/path/to/file')).toBe(true)
      await type(screen, file)
      await screen.press('RETURN')
      expect((await picked)[0]).toMatchObject({ name: 'note.txt', type: 'text/plain' })
      expect(Buffer.from((await picked)[0]!.bytes).toString()).toBe('from terminal')
    } finally {
      screen.done()
      await rm(directory, { recursive: true, force: true })
    }
  }, 30_000)

  it('confirms before replacing an existing export', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'acorn-tui-save-'))
    const file = join(directory, 'export.txt')
    await writeFile(file, 'old')
    const screen = await renderFixture({ width: 120, height: 40 })
    try {
      const saved = saveLocalFile({ bytes: new TextEncoder().encode('new'), suggestedName: 'export.txt', mimeType: 'text/plain' })
      await screen.until('Save to local file')
      expect(await screen.reach('/absolute/path/to/file')).toBe(true)
      await type(screen, file)
      await screen.press('RETURN')
      expect(await screen.until('This file exists')).toContain('Replace file')
      expect(await readFile(file, 'utf8')).toBe('old')
      await screen.press('TAB')
      await screen.press('RETURN')
      expect(await saved).toBe(true)
      expect(await readFile(file, 'utf8')).toBe('new')
    } finally {
      screen.done()
      await rm(directory, { recursive: true, force: true })
    }
  }, 30_000)

  it('rejects an oversized attachment before loading its bytes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'acorn-tui-large-file-'))
    const file = join(directory, 'large.txt')
    await writeFile(file, '')
    await truncate(file, 10 * 1024 * 1024 + 1)
    const screen = await renderFixture({ width: 80, height: 24 })
    try {
      const picked = pickLocalFile({ accept: ['txt'] })
      await screen.until('Attach local file')
      expect(await screen.reach('/absolute/path/to/file')).toBe(true)
      await type(screen, file)
      await screen.press('RETURN')
      expect(await screen.until('Attachments are limited to 10 MiB each.')).toContain('Attach file')
      await screen.press('ESCAPE')
      expect(await picked).toEqual([])
    } finally {
      screen.done()
      await rm(directory, { recursive: true, force: true })
    }
  }, 30_000)
})

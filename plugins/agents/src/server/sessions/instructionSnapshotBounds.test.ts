import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ open: vi.fn() }))
vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs/promises')>()),
  open: mocks.open,
}))
const { scanInstructions } = await import('./instructionSnapshot')

let dir: string | null = null
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = null
  mocks.open.mockReset()
})

it('stops reading when a regular file grows beyond its fstat size', async () => {
  dir = mkdtempSync(join(tmpdir(), 'instruction-growth-'))
  writeFileSync(join(dir, 'AGENTS.md'), 'small')
  const contents = Buffer.alloc(1_000_001, 0x61)
  const read = vi.fn(async (buffer: Buffer, offset: number, length: number, position: number) => {
    const count = Math.min(length, contents.length - position)
    contents.copy(buffer, offset, position, position + count)
    return { bytesRead: count, buffer }
  })
  mocks.open.mockResolvedValue({
    stat: async () => ({ isFile: () => true, size: 5 }),
    read,
    close: async () => {},
  })

  await expect(scanInstructions(dir, [])).rejects.toThrow(/byte limit/)
  expect(read).toHaveBeenCalled()
  expect(Math.max(...read.mock.calls.map((call) => call[2]))).toBeLessThanOrEqual(64 * 1024)
})

it('rejects a special file swapped in before the opened-handle check', async () => {
  dir = mkdtempSync(join(tmpdir(), 'instruction-special-'))
  writeFileSync(join(dir, 'AGENTS.md'), 'small')
  const read = vi.fn()
  mocks.open.mockResolvedValue({
    stat: async () => ({ isFile: () => false, size: 0 }),
    read,
    close: async () => {},
  })

  await expect(scanInstructions(dir, [])).rejects.toThrow(/not a regular file/)
  expect(read).not.toHaveBeenCalled()
})

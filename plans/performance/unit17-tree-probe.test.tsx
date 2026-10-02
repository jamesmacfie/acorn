import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { expect } from 'vitest'
// Actual FileTree and host Rows. Listings are synthetic, DOM/counters are real jsdom ownership evidence.
import { render } from 'solid-js/web'
import { createSignal } from 'solid-js'
import { it, onTestFinished, vi } from 'vitest'
import { existsSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
Element.prototype.scrollIntoView ??= () => {}
const driver = vi.hoisted(() => ({ virtuals: [] as any[], list: vi.fn(async (_task: string, _path: string): Promise<any[]> => []) }))
vi.mock('../../plugins/editor/src/client/editorClient', () => ({ editorApi: () => ({ list: driver.list }) }))
vi.mock('@tanstack/solid-virtual', async original => { const actual = await original<any>(); return { ...actual, createVirtualizer: (options: any) => { const value = actual.createVirtualizer(options); driver.virtuals.push(value); return value } } })
const { default: FileTree } = await import('../../plugins/editor/src/client/FileTree')
const { clearEditorTreeStates, setEditorTreeDirectoryOpen } = await import('../../plugins/editor/src/client/editorTreeState')
const tag = process.env.ACORN_PERF_TAG ?? 'sample'
if (!/^[a-z0-9-]+$/.test(tag)) throw new Error('Use a safe output tag.')

it('counts actual tree row DOM for a wide directory and collapsed return', async () => {
  // Give the actual Rows virtual path a viewport when this probe is replayed after a fix.
  const height = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 300 })
  onTestFinished(() => { if (height) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', height) })
  const observations = []
  for (const count of [200, 2000]) {
    clearEditorTreeStates()
    const entries = Array.from({ length: count }, (_, i) => ({ name: `file-${i}.txt`, dir: false }))
    entries.unshift({ name: 'folder', dir: true })
    driver.list.mockReset().mockImplementation(async (_task, path) => path ? [{ name: 'nested.txt', dir: false }] : [...entries])
    const host = document.createElement('div'); document.body.append(host)
    const [active, setActive] = createSignal<string | null>(null)
    const cpu = process.cpuUsage(); const start = performance.now()
    const stop = render(() => <QueryClientProvider client={new QueryClient()}><FileTree taskId={`tree-${count}`} openPath={active()} onOpen={() => {}} reveal={null} onRevealed={() => {}} /></QueryClientProvider>, host)
    await vi.waitFor(() => { if (!host.querySelector('[role="treeitem"]')) throw new Error('Rows pending') })
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    expect(driver.virtuals.at(-1)?.scrollElement).toBeTruthy()
    expect(driver.virtuals.at(-1)?.scrollRect.height).toBe(300)
    expect(host.querySelectorAll('[role="treeitem"]').length).toBeLessThan(40)
    const used = process.cpuUsage(cpu)
    const first = host.querySelector('[role="treeitem"]')
    const initial = { listingReads: driver.list.mock.calls.length, treeItems: host.querySelectorAll('[role="treeitem"]').length,
      elements: host.querySelectorAll('*').length, scrollElementHeight: (host.querySelector('.ui-rows-scroll') as HTMLElement)?.offsetHeight, virtualCount: driver.virtuals.at(-1)?.getVirtualItems().length, scrollRect: driver.virtuals.at(-1)?.scrollRect, hasScroller: !!driver.virtuals.at(-1)?.scrollElement, rowHeight: (first as HTMLElement)?.style.height, projectedHeight: (host.querySelector('.ui-rows') as HTMLElement)?.style.height, nodeCpuMs: (used.user + used.system) / 1000, jsdomWallMs: performance.now() - start }
    setActive('file-0.txt')
    setEditorTreeDirectoryOpen(`tree-${count}`, 'folder', true)
    await vi.waitFor(() => { if (driver.list.mock.calls.length < 2) throw new Error('Folder pending') })
    await new Promise(resolve => setTimeout(resolve, 10))
    const expanded = { treeItems: host.querySelectorAll('[role="treeitem"]').length, firstRowRetained: first === host.querySelector('[role="treeitem"]') }
    // A fresh answer exists on the Node, but collapse/reopen never revalidates this mount's listing.
    entries.push({ name: 'new-from-agent.txt', dir: false })
    setEditorTreeDirectoryOpen(`tree-${count}`, 'folder', false)
    setEditorTreeDirectoryOpen(`tree-${count}`, 'folder', true)
    await new Promise(resolve => setTimeout(resolve, 10))
    const returned = { listingReads: driver.list.mock.calls.length, newRootFileVisible: host.textContent?.includes('new-from-agent') }
    observations.push({ files: count, initial, expanded, returned })
    stop(); host.remove()
  }
  clearEditorTreeStates()
  const path = join(dirname(fileURLToPath(import.meta.url)), `unit17-tree-${tag}.json`)
  if (tag.startsWith('before') && existsSync(path)) throw new Error('Before evidence exists; use a new tag.')
  writeFileSync(path, JSON.stringify({ fixture: 'actual FileTree and Rows, synthetic listings, jsdom; no visible UI timing claims', observations,
    expected: 'Wide directory row DOM remains bounded by viewport; normal worktree invalidation revalidates affected mounted tree listings while retaining expansion/selection.' }, null, 2) + '\n')
})

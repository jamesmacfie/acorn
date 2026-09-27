import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { NodePluginState } from '@acorn/protocol/api.ts'
import type { PluginCliCommandDescriptor } from '@acorn/protocol/plugin/cliCommands.ts'
import { runPluginCommand, pluginCommandHelp } from './pluginCommands'
import type { CliNode } from './node'
import type { ParsedArgs } from './args'

const descriptor = (name: string, risk: 'read' | 'write' = 'read'): PluginCliCommandDescriptor => ({
  name, title: `Run ${name}`, summary: 'Fixture command.', risk, scope: 'node', capability: 'tasks',
  ...(risk === 'write' ? { effects: 'Replaces a fixture value.' } : {}),
  route: { method: 'POST', path: `/cli/${name}` },
  inputSchema: { type: 'object', properties: { nodeId: { type: 'string' }, count: { type: 'integer' } }, required: ['nodeId', 'count'], additionalProperties: false },
  outputSchema: { type: 'object', properties: { count: { type: 'integer' } }, required: ['count'], additionalProperties: false },
})

const roster = (name: string, active = true): NodePluginState => ({ plugins: [{
  name: 'fixture', required: false, disabled: !active, running: active, state: active ? 'active' : 'disabled',
  active: active ? { activation: 'node', version: '1.0.0', apiVersion: '1', permissions: { api: [], events: [], node: { core: ['tasks'], capabilities: [], secrets: false, exec: false, net: [], sockets: false } },
    contributions: { frames: [], cliCommands: [descriptor(name)] }, client: null } : null,
}], restartRequired: false })

const node = (nodeId: string, state: NodePluginState): CliNode => ({
  nodeId, endpoint: 'https://fixture.test', get: vi.fn(async () => state),
  mutate: vi.fn(async () => ({ result: { count: 3 } })), close() {},
})

const args = (id: string, command: string, options: Record<string, string> = {}): ParsedArgs => ({
  positionals: ['plugin', id, command], options, output: 'json', noHeader: false, help: false,
})

describe('plugin command discovery', () => {
  it('uses the selected Node active version and hides disabled commands', async () => {
    const first = node('node-a', roster('inspect'))
    const second = node('node-b', roster('search'))
    expect((await runPluginCommand(first, args('fixture', 'commands')) as { name: string; capability: string }[])).toMatchObject([
      { name: 'inspect', capability: 'tasks' },
    ])
    expect((await runPluginCommand(second, args('fixture', 'commands')) as { name: string }[]).map((row) => row.name)).toEqual(['search'])
    expect(await pluginCommandHelp(second, args('fixture', 'search'))).toContain('Run search')
    await expect(runPluginCommand(node('node-a', roster('inspect', false)), args('fixture', 'commands'))).rejects.toThrow('not active')
    const pendingDisable = roster('inspect')
    pendingDisable.plugins[0]!.disabled = true
    await expect(runPluginCommand(node('node-a', pendingDisable), args('fixture', 'commands'))).rejects.toThrow('not active')
  })

  it('preserves JSON types and refuses wrong node, extra fields, and invalid handler output', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'acorn-cli-plugin-'))
    const file = join(dir, 'input.json')
    const selected = node('node-a', roster('inspect'))
    try {
      writeFileSync(file, JSON.stringify({ nodeId: 'node-a', count: 3 }))
      const result = await runPluginCommand(selected, args('fixture', 'inspect', { 'input-file': file })) as { result: { count: number } }
      expect(result.result.count).toBe(3)
      expect(selected.mutate).toHaveBeenCalledWith('POST', '/v1/core/plugins/fixture/cli/inspect', { input: { nodeId: 'node-a', count: 3 } }, expect.any(String))
      writeFileSync(file, JSON.stringify({ nodeId: 'node-b', count: 3 }))
      await expect(runPluginCommand(selected, args('fixture', 'inspect', { 'input-file': file }))).rejects.toThrow('nodeId')
      writeFileSync(file, JSON.stringify({ nodeId: 'node-a', count: 3, extra: true }))
      await expect(runPluginCommand(selected, args('fixture', 'inspect', { 'input-file': file }))).rejects.toThrow('extra')
      writeFileSync(file, JSON.stringify({ nodeId: 'node-a', count: 3, padding: 'x'.repeat(70_000) }))
      await expect(runPluginCommand(selected, args('fixture', 'inspect', { 'input-file': file }))).rejects.toThrow('exceeds')
      writeFileSync(file, JSON.stringify({ nodeId: 'node-a', count: 3 }))
      selected.mutate = vi.fn(async () => ({ result: { count: 'wrong' } }))
      await expect(runPluginCommand(selected, args('fixture', 'inspect', { 'input-file': file }))).rejects.toThrow('output failed')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})

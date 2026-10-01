import { describe, expect, it } from 'vitest'
import { ACORN_BASELINE } from '../baseline.ts'
import { PLUGIN_API_MAJOR } from './apiVersion.ts'
import { pluginManifestShape } from './contract.ts'
import {
  pluginAgentToolGrants,
  pluginContextSectionGrants,
  pluginExtensionGrants,
  pluginHarnessGrants,
  pluginKeyClaimGrants,
  pluginNavigationDestinationGrants,
  pluginScheduleGrants,
  pluginTaskCheckGrants,
  pluginWebviewGrants,
} from './grants.ts'

const contributions = (value: Record<string, unknown>) => pluginManifestShape.parse({
  id: 'board',
  name: 'Board',
  version: '1.0.0',
  baseline: ACORN_BASELINE,
  apiVersion: PLUGIN_API_MAJOR,
  contributions: value,
}).contributions

describe('plugin grant projections', () => {
  it('discloses the exact normalized hosts of a webview once', () => {
    const grant = pluginWebviewGrants(contributions({ frames: [{
      target: 'webview', id: 'preview', label: 'Preview',
      hosts: ['EXAMPLE.COM', '*.Docs.Example.com', 'example.com'],
    }] }))

    expect(grant).toEqual([{
      surface: 'preview', label: 'Preview',
      hosts: ['*.docs.example.com', 'example.com'],
    }])
  })

  it('discloses the one-shot program and environment of a managed harness', () => {
    const grant = pluginHarnessGrants(contributions({ harnesses: [{
      id: 'deepseek', label: 'DeepSeek', spawn: { command: 'dsh', args: ['--profile', 'agent'] },
      envPassthrough: ['DEEPSEEK_KEY', 'DEEPSEEK_KEY'],
      oneShot: { command: 'dsh', args: ['--profile', 'headless'], modelFlag: '--model', output: 'text' },
    }] }))

    expect(grant).toEqual([{
      id: 'deepseek', label: 'DeepSeek', kind: 'command', run: 'dsh --profile agent',
      env: ['DEEPSEEK_KEY'], oneShot: 'dsh --profile headless --model MODEL',
    }])
  })

  it('names both sides of an extension and discloses veto authority', () => {
    const grant = pluginExtensionGrants('board', contributions({
      extensionPoints: [{ id: 'cards', label: 'Cards', kind: 'rows' }],
      extensions: [
        { id: 'review', point: 'findings:review', label: 'Review', route: '/v1/p/board/review', mode: 'veto' },
        { id: 'summary', point: 'reports:summary', label: 'Summary', remote: 'summary' },
      ],
      frames: [{ target: 'coreSlot', id: 'task-list', label: 'Task list', coreSlot: 'rail.taskList' }],
    }))

    expect(grant).toEqual([
      { kind: 'extends', pointKind: 'hook', mode: 'veto', target: 'findings:review', label: 'Review' },
      { kind: 'extends', pointKind: 'remote', target: 'reports:summary', label: 'Summary' },
      { kind: 'hosts', pointKind: 'rows', target: 'board:cards', label: 'Cards' },
      { kind: 'replaces', target: 'rail.taskList', label: 'Task list' },
    ])
  })

  it('records exactly the keys and cross-owner destinations a surface declares', () => {
    const manifest = contributions({ frames: [{
      target: 'pane', id: 'cards', label: 'Cards',
      claimsKeys: ['meta+f', 'ctrl+g', 'meta+f'],
      destinations: [
        { id: 'review', label: 'Review in Findings', targetKind: 'finding', noticeKind: 'review' },
        { id: 'open', label: 'Open issue', targetKind: 'issue' },
      ],
    }] })

    expect(pluginKeyClaimGrants(manifest)).toEqual([
      { surface: 'cards', label: 'Cards', chords: ['ctrl+g', 'meta+f'] },
    ])
    expect(pluginNavigationDestinationGrants(manifest)).toEqual([
      { surface: 'cards', label: 'Open issue', destination: 'open', targetKind: 'issue' },
      { surface: 'cards', label: 'Review in Findings', destination: 'review', targetKind: 'finding', noticeKind: 'review' },
    ])
  })

  it('discloses scheduled work and whether an archive check can clean up', () => {
    const manifest = contributions({
      schedules: [
        { id: 'nightly', name: 'Nightly sync', run: '/v1/p/board/sync', cadence: { daily: '03:00' } },
        { id: 'hourly', name: 'Hourly sync', run: '/v1/p/board/sync', cadence: { every: 3600 } },
      ],
      taskChecks: [
        { id: 'warn', check: '/v1/p/board/check' },
        { id: 'cleanup', check: '/v1/p/board/check', apply: '/v1/p/board/cleanup' },
      ],
    })

    expect(pluginScheduleGrants(manifest)).toEqual([
      { id: 'hourly', label: 'Hourly sync', cadence: { every: 3600 } },
      { id: 'nightly', label: 'Nightly sync', cadence: { daily: '03:00' } },
    ])
    expect(pluginTaskCheckGrants(manifest)).toEqual([
      { id: 'cleanup', cleansUp: true },
      { id: 'warn', cleansUp: false },
    ])
  })

  it('captures tool risk and context inclusion from parsed manifest defaults', () => {
    const manifest = contributions({
      agentTools: [{
        id: 'find', description: 'Find cards', risk: 'read',
        inputSchema: { type: 'object', properties: {} }, handler: '/v1/p/board/find',
      }],
      contextSections: [{
        id: 'recent', label: 'Recent cards', order: 10,
        read: '/v1/p/board/recent', maxBytes: 4096, maxTokens: 512,
      }],
    })

    expect(pluginAgentToolGrants(manifest)).toEqual([{
      id: 'find', description: 'Find cards', risk: 'read', requiresSession: false, maxOutputBytes: 65_536,
    }])
    expect(pluginContextSectionGrants(manifest)).toEqual([{
      id: 'recent', label: 'Recent cards', defaultIncluded: false, maxBytes: 4096, maxTokens: 512,
    }])
  })
})

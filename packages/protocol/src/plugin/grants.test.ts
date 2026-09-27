import { describe, expect, it } from 'vitest'
import { ACORN_BASELINE } from '../baseline.ts'
import { PLUGIN_API_MAJOR } from './apiVersion.ts'
import { pluginManifestShape } from './contract.ts'
import { pluginHarnessGrants, pluginWebviewGrants } from './grants.ts'

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
})

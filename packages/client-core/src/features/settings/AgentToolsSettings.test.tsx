import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentToolCatalogEntry } from '@acorn/protocol/api.ts'

// Tools and permissions groups the catalog by the plugin that contributed each tool, or by tier, and a
// row names the other grouping so neither view hides it (docs/agent-tools.md § Projections).
const TOOLS: AgentToolCatalogEntry[] = [
  { name: 'notes_read', description: 'Read notes.', risk: 'read', owner: 'core' },
  { name: 'findings_record', description: 'Record a finding.', risk: 'write', owner: 'findings' },
  { name: 'run_start', description: 'Start a run target.', risk: 'execute', owner: 'core' },
]
vi.mock('@tanstack/solid-query', () => ({
  createQuery: (options: () => { queryKey: string[] }) => ({ data: options().queryKey[0] === 'agent-tools-catalog' ? TOOLS : {} }),
  useQueryClient: () => ({}),
}))
vi.mock('../../infra/queries', () => ({ prefsOptions: () => ({ queryKey: ['prefs'] }) }))
vi.mock('../../infra/node/apiClient', () => ({ readJson: vi.fn() }))

import AgentToolsSettings from './AgentToolsSettings'

let host: HTMLElement
let dispose: (() => void) | undefined
beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  dispose = render(() => <AgentToolsSettings />, host)
})
afterEach(() => {
  dispose?.()
  host.remove()
})

const headings = () => [...host.querySelectorAll('[data-settings-section="tools"] .ui-section-header-label')].map((label) => label.textContent)
const chipOf = (tool: string) =>
  [...host.querySelectorAll('.ui-setting-row')].find((row) => row.querySelector('.ui-setting-label')?.textContent === tool)?.querySelector('.ui-chip')?.textContent

describe('Tools and permissions', () => {
  it('groups tools by owner, acorn first, and by tier on request', () => {
    expect(headings()).toEqual(['acorn', 'findings'])
    expect(chipOf('findings_record')).toBe('Write')

    const byTier = [...host.querySelectorAll<HTMLButtonElement>('.ui-segment')].find((button) => button.textContent === 'By tier')!
    byTier.click()
    expect(headings()).toEqual(['Read tools', 'Write tools', 'Execute tools'])
    expect(chipOf('findings_record')).toBe('findings')
  })
})

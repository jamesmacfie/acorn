import { createEffect, createMemo, For, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { agentToolsCatalogRoute, type AgentToolCatalogEntry, type ToolRisk } from '../../../shared/api'
import { readJson } from '../../apiClient'
import { prefsOptions } from '../../queries'
import { saveJsonPref } from './savePref'
import { PrefKeys } from '../../persistence/prefKeys'

// Settings → Agent tools (docs/agent-tools.md, ux §3): the permission surface over the agent-tool
// registry. Tools are grouped by risk tier (read → write → execute); a tier toggle and per-tool
// toggles persist as ONE prefs slice. Turning a tier or tool off removes it from every projection
// (MCP tools/list AND a direct harness call) — the manifest re-reads these on each fetch.
type ToolPerms = { tiers?: Partial<Record<ToolRisk, boolean>>; tools?: Record<string, boolean> }

const TIERS: { risk: ToolRisk; label: string; blurb: string }[] = [
  { risk: 'read', label: 'Read', blurb: 'Inspect context, notes, memory, git and the PR. No side effects.' },
  { risk: 'write', label: 'Write', blurb: 'Create or edit notes and propose memory (proposals stay human-gated).' },
  { risk: 'execute', label: 'Execute', blurb: 'Drive the preview browser and run targets in the worktree.' },
]

export default function AgentToolsSettings() {
  const qc = useQueryClient()
  const prefs = createQuery(() => prefsOptions(true))
  const catalog = createQuery(() => ({
    queryKey: ['agent-tools-catalog'],
    queryFn: () => readJson<{ tools: AgentToolCatalogEntry[] }>(agentToolsCatalogRoute).then((r) => r.tools),
  }))

  const perms = createMemo<ToolPerms>(() => {
    const raw = prefs.data?.[PrefKeys.agentToolPermissions]
    if (!raw) return {}
    try {
      return JSON.parse(raw) as ToolPerms
    } catch {
      return {}
    }
  })

  const tierOn = (risk: ToolRisk) => (risk === 'read' ? true : (perms().tiers?.[risk] ?? true))
  const toolOn = (t: AgentToolCatalogEntry) => perms().tools?.[t.name] ?? tierOn(t.risk)

  const write = (next: ToolPerms) => saveJsonPref(qc, PrefKeys.agentToolPermissions, next)
  const setTier = (risk: ToolRisk, on: boolean) => {
    const names = new Set(toolsFor(risk).map((tool) => tool.name))
    const tools = Object.fromEntries(Object.entries(perms().tools ?? {}).filter(([name]) => !names.has(name)))
    return write({ ...perms(), tiers: { ...perms().tiers, [risk]: on }, tools })
  }
  const setTool = (name: string, on: boolean) => write({ ...perms(), tools: { ...perms().tools, [name]: on } })

  const toolsFor = (risk: ToolRisk) => (catalog.data ?? []).filter((t) => t.risk === risk)
  const tierState = (risk: ToolRisk): 'on' | 'off' | 'mixed' => {
    const values = toolsFor(risk).map(toolOn)
    if (!values.length || values.every(Boolean)) return 'on'
    return values.every((value) => !value) ? 'off' : 'mixed'
  }

  return (
    <>
      <p class="muted">
        Which tools the acorn MCP server exposes to agents. Changes apply on the next availability evaluation; live sessions receive a tool-list update.
        Proposed memory always stays behind the human review gate regardless of these toggles.
      </p>
      <For each={TIERS}>
        {(tier) => (
          <div class="settings-field">
            <Show
              when={tier.risk !== 'read'}
              fallback={<div class="settings-field-row"><span class="settings-label">{tier.label} tools · tier always available</span></div>}
            >
              <label class="settings-field-row">
                <input
                  ref={(element) => createEffect(() => { element.indeterminate = tierState(tier.risk) === 'mixed' })}
                  type="checkbox"
                  checked={tierState(tier.risk) !== 'off'}
                  onChange={(e) => void setTier(tier.risk, e.currentTarget.checked)}
                />
                <span class="settings-label">{tier.label} tools</span>
              </label>
            </Show>
            <p class="muted" style={{ 'margin-top': '0' }}>
              {tier.blurb}
            </p>
            <For each={toolsFor(tier.risk)}>
              {(t) => (
                <label class="settings-field-row" style={{ 'padding-left': '1.5rem' }}>
                  <input
                    type="checkbox"
                    checked={toolOn(t)}
                    onChange={(e) => void setTool(t.name, e.currentTarget.checked)}
                  />
                  <span class="settings-label">
                    <code>{t.name}</code> — {t.description}
                    <Show when={t.availability}><span class="muted"> {t.availability}</span></Show>
                  </span>
                </label>
              )}
            </For>
          </div>
        )}
      </For>
    </>
  )
}

import { createMemo, createSignal, For, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { agentToolsCatalogRoute, type AgentToolCatalogEntry, type ToolRisk } from '@acorn/protocol/api.ts'
import { readJson } from '../../infra/node/apiClient'
import { prefsOptions } from '../../infra/queries'
import { savePref } from './savePref'
import { PrefKeys } from '../../infra/persistence/prefKeys'
import { TOOL_TIER_DEFAULTS, toolPermissionsSchema, type ToolPermissions } from '@acorn/protocol/toolPermissions.ts'
import { Alert, Button, Checkbox, Chip, SegmentedControl } from '../../kit/components/primitives'
import { Inline } from '../../kit/components/layout/Inline'
import { SectionHeader } from '../../kit/components/layout/SectionHeader'
import { SettingRow } from '../../kit/components/layout/SettingRow'
import { SettingsSection } from '../../kit/components/layout/SettingsSection'
import { createSettingSave } from './settingSave'
import { openPluginPage } from './plugins/installed'
import type { SettingsNavigate } from '../../host/registries/shell/settings'

// Settings → Agents → Tools and permissions (docs/agent-tools.md § Projections): the permission surface
// over the agent-tool registry. The three risk tiers (read, write, execute) come first, then every tool,
// grouped by the plugin that contributed it or by its tier. A tier switch and the per-tool switches
// persist as one prefs slice. Turning a tier or tool off removes it from every projection (MCP
// tools/list and a direct harness call); the manifest re-reads these on each fetch. The sections match
// the ones ./corePages.ts declares for search.
type ToolPerms = ToolPermissions

const TIERS: { risk: ToolRisk; label: string; blurb: string }[] = [
  { risk: 'read', label: 'Read', blurb: 'Inspect context, notes, memory, git and the PR. No side effects.' },
  { risk: 'write', label: 'Write', blurb: 'Create or edit notes and propose memory (proposals stay human-gated).' },
  { risk: 'execute', label: 'Execute', blurb: 'Drive the preview browser and run targets in the worktree. Off until you turn it on, including for tools added by a later release.' },
]

type Grouping = 'owner' | 'tier'
// Core's tools are acorn's own. A node from before the catalog named owners reports none, and its
// tools are all core's then anyway.
const ownerOf = (tool: AgentToolCatalogEntry) => tool.owner ?? 'core'
const ownerLabel = (owner: string) => (owner === 'core' ? 'acorn' : owner)

/** `navigate` is settings' own, for the links to each tool's plugin; drawn without it, there are none. */
export default function AgentToolsSettings(props: { navigate?: SettingsNavigate } = {}) {
  const qc = useQueryClient()
  const prefs = createQuery(() => prefsOptions(true))
  const catalog = createQuery(() => ({
    queryKey: ['agent-tools-catalog'],
    queryFn: () => readJson<{ tools: AgentToolCatalogEntry[] }>(agentToolsCatalogRoute).then((r) => r.tools),
  }))
  // By owner first, because a plugin's tools arrive and leave together.
  const [grouping, setGrouping] = createSignal<Grouping>('owner')

  const perms = createMemo<ToolPerms>(() => {
    const raw = prefs.data?.[PrefKeys.agentToolPermissions]
    if (!raw) return {}
    try {
      const parsed = toolPermissionsSchema.safeParse(JSON.parse(raw))
      return parsed.success ? parsed.data : {}
    } catch {
      return {}
    }
  })

  // Same fallback the node applies (node-core/server/agentTools/registry.ts § isToolPermitted), so an
  // untouched execute tier draws as off here and is denied there rather than the two disagreeing.
  const tierOn = (risk: ToolRisk) => (risk === 'read' ? true : (perms().tiers?.[risk] ?? TOOL_TIER_DEFAULTS[risk]))
  const toolOn = (t: AgentToolCatalogEntry) => perms().tools?.[t.name] ?? tierOn(t.risk)

  // With `throwOnFailure`, so a failed write is said once, on the row that made it, and not again as a
  // background notice.
  const write = (next: ToolPerms) => savePref(qc, PrefKeys.agentToolPermissions, JSON.stringify(next), { throwOnFailure: true })
  const setTier = (risk: ToolRisk, on: boolean) => {
    const names = new Set(toolsFor(risk).map((tool) => tool.name))
    const tools = Object.fromEntries(Object.entries(perms().tools ?? {}).filter(([name]) => !names.has(name)))
    return write({ ...perms(), tiers: { ...perms().tiers, [risk]: on }, tools })
  }
  const setTool = (name: string, on: boolean) => write({ ...perms(), tools: { ...perms().tools, [name]: on } })

  const toolsFor = (risk: ToolRisk) => (catalog.data ?? []).filter((t) => t.risk === risk)
  const tierState = (risk: ToolRisk): 'on' | 'off' | 'mixed' => {
    const values = toolsFor(risk).map(toolOn)
    // No tools to count, while the list loads or on a node with none in the tier: the tier's own value.
    if (!values.length) return tierOn(risk) ? 'on' : 'off'
    if (values.every(Boolean)) return 'on'
    return values.every((value) => !value) ? 'off' : 'mixed'
  }
  const tierLabel = (risk: ToolRisk) => TIERS.find((tier) => tier.risk === risk)?.label ?? risk

  // The tools under one heading each: acorn's own first and then each plugin's, or the three tiers in
  // order. A row names the other grouping in a chip, so neither view hides it.
  const groups = createMemo((): { key: string; label: string; tools: AgentToolCatalogEntry[] }[] => {
    const tools = catalog.data ?? []
    if (grouping() === 'tier') {
      return TIERS.map((tier) => ({ key: tier.risk, label: `${tier.label} tools`, tools: toolsFor(tier.risk) }))
        .filter((group) => group.tools.length)
    }
    const owners = [...new Set(tools.map(ownerOf))].sort((a, b) => (a === 'core' ? -1 : b === 'core' ? 1 : a.localeCompare(b)))
    return owners.map((owner) => ({ key: owner, label: ownerLabel(owner), tools: tools.filter((tool) => ownerOf(tool) === owner) }))
  })

  return (
    <>
      <SettingsSection
        id="tiers"
        label="Tiers"
        description="Which tools the acorn MCP server exposes to agents, by how much a tool can do. Changes apply on the next availability evaluation; live sessions receive a tool-list update. Proposed memory always stays behind the human review gate regardless of these switches. A custom agent's Acorn tools setting can narrow this further, never widen it."
      >
        <For each={TIERS}>
          {(tier) => {
            const tierSave = createSettingSave()
            return (
              <Show
                when={tier.risk !== 'read'}
                fallback={
                  <SettingRow label={`${tier.label} tools`} description={tier.blurb}>
                    <span class="muted">Always available</span>
                  </SettingRow>
                }
              >
                <SettingRow label={`${tier.label} tools`} description={tier.blurb} error={tierSave.error()}>
                  {/* A checkbox rather than a switch: a tier with some tools on and some off is a
                      third state, and a switch has only two. */}
                  <Checkbox
                    ariaLabel={`${tier.label} tools`}
                    indeterminate={tierState(tier.risk) === 'mixed'}
                    checked={tierState(tier.risk) !== 'off'}
                    // A tier write also clears each of its tools' own switches, so it waits for the list.
                    disabled={!catalog.isSuccess}
                    onChange={(checked) => tierSave.run(() => setTier(tier.risk, checked))}
                  />
                </SettingRow>
              </Show>
            )
          }}
        </For>
      </SettingsSection>

      <SettingsSection
        id="tools"
        label="Tools"
        description="Each tool on its own. A tool's switch wins over its tier's."
        actions={
          <SegmentedControl
            size="sm"
            ariaLabel="Group tools by"
            value={grouping()}
            options={[{ value: 'owner', label: 'By owner' }, { value: 'tier', label: 'By tier' }]}
            onChange={setGrouping}
          />
        }
      >
        <Show when={catalog.isError}><Alert>Could not read this node's agent tools.</Alert></Show>
        <For each={groups()}>
          {(group) => (
            <>
              <SectionHeader
                level="sub"
                count={group.tools.length}
                actions={grouping() === 'owner' && group.key !== 'core' && props.navigate
                  ? <Button variant="bare" size="sm" onPress={() => openPluginPage(props.navigate!, group.key, 'node')}>Manage plugin</Button>
                  : undefined}
              >
                {group.label}
              </SectionHeader>
              <For each={group.tools}>
                {(t) => {
                  const save = createSettingSave()
                  return (
                    <SettingRow
                      label={t.name}
                      description={t.availability ? `${t.description} ${t.availability}` : t.description}
                      error={save.error()}
                    >
                      <Inline>
                        {/* By tier, the owner is the row's link to that plugin's page under Installed. */}
                        <Show
                          when={grouping() === 'tier' && ownerOf(t) !== 'core' && props.navigate}
                          fallback={<Chip size="xs">{grouping() === 'owner' ? tierLabel(t.risk) : ownerLabel(ownerOf(t))}</Chip>}
                        >
                          <Button variant="bare" size="sm" tip={`Manage the ${ownerOf(t)} plugin`} onPress={() => openPluginPage(props.navigate!, ownerOf(t), 'node')}>
                            {ownerLabel(ownerOf(t))}
                          </Button>
                        </Show>
                        <Checkbox
                          switch
                          ariaLabel={t.name}
                          checked={toolOn(t)}
                          onChange={(checked) => save.run(() => setTool(t.name, checked))}
                        />
                      </Inline>
                    </SettingRow>
                  )
                }}
              </For>
            </>
          )}
        </For>
      </SettingsSection>
    </>
  )
}

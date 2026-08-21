import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { PLUGIN_API_MAJOR } from '@acorn/protocol/pluginApiVersion.ts'
import { CONTEXT_MENU_LOCATIONS } from '@acorn/protocol/contextMenus.ts'
import { CORE_EXCLUSIVE_SLOTS, EXTENSION_POINT_LOCATIONS } from '@acorn/protocol/extensionPoints.ts'
import { pluginManifestShape } from '@acorn/protocol/pluginContract.ts'
import { THEME_PALETTE_TOKENS } from '@acorn/protocol/themeTokens.ts'
import { NODE_CORE_FACETS, scopeCore } from '../../main/pluginPermissions.ts'
import { getContextSections } from './contextSections.ts'
import {
  PLUGIN_AUTHORING_SECTION,
  PLUGIN_AUTHORING_TOOL,
  pluginAuthoringSection,
  pluginAuthoringTool,
  pluginAuthoringVocabulary,
  renderPluginAuthoring,
} from './pluginAuthoring.ts'
import type { CoreServices } from '../../main/core/index.ts'

// The point of this file is drift: every test below re-derives an answer from the source of truth
// and compares, rather than pinning a hand-written list (docs/agent-tools.md § plugin_authoring).

describe('the derived vocabulary tracks the manifest schema', () => {
  it('derives something at all', () => {
    // Anti-vacuity. Every assertion below is "derived equals derived", and a projection that started
    // returning empty arrays would satisfy most of them.
    const v = pluginAuthoringVocabulary()
    expect(v.manifest.required.length).toBeGreaterThan(3)
    expect(Object.keys(v.manifest.contributionCaps).length).toBeGreaterThan(8)
    expect(v.actions.railOnSelect.length).toBeGreaterThan(4)
    expect(v.actions.commandsAndBadges.length).toBeGreaterThan(3)
    expect(v.manifest.frameTargets).toContain('pane')
  })

  it('reads the two closed placement vocabularies off the things that enforce them', () => {
    // Both are short enums, and one has an independent declaration to compare against
    // (`@acorn/protocol/contextMenus.ts`, which the client also reads); the slot enum does not, so
    // it is checked the only way that proves anything: every listed name parses, and a plausible
    // one does not.
    const v = pluginAuthoringVocabulary()
    expect(v.manifest.contextMenuLocations).toEqual([...CONTEXT_MENU_LOCATIONS])
    const withSlot = (slot: string) => pluginManifestShape.safeParse({
      id: 'pp', name: 'P', version: '1', apiVersion: PLUGIN_API_MAJOR,
      contributions: { slots: [{ id: 's', slot, data: '/v2/p/pp/badge' }] },
    }).success
    expect(v.manifest.slots.length).toBeGreaterThan(1)
    for (const slot of v.manifest.slots) expect(withSlot(slot), slot).toBe(true)
    expect(withSlot('overlay')).toBe(false)
    expect(v.manifest.extensionPointLocations).toEqual([...EXTENSION_POINT_LOCATIONS])
    expect(v.manifest.coreSlots).toEqual([...CORE_EXCLUSIVE_SLOTS])
    for (const value of [
      ...v.manifest.slots,
      ...v.manifest.contextMenuLocations,
      ...v.manifest.extensionPointLocations,
      ...v.manifest.coreSlots,
    ]) {
      expect(renderPluginAuthoring(v)).toContain(`\`${value}\``)
    }
  })

  it('carries every manifest key, split on what the schema actually requires', () => {
    const shape = Object.keys(pluginManifestShape.shape)
    const v = pluginAuthoringVocabulary()
    expect([...v.manifest.required, ...v.manifest.optional].sort()).toEqual([...shape].sort())
    // A key moving between required and optional changes what a hand-written manifest must carry, so the
    // split is derived rather than declared here too.
    const required = shape.filter((key) => !pluginManifestShape.shape[key as keyof typeof pluginManifestShape.shape].safeParse(undefined).success)
    expect(v.manifest.required).toEqual([...required].sort())
  })

  it('carries every contribution key with the cap the schema enforces', () => {
    const v = pluginAuthoringVocabulary()
    for (const [key, cap] of Object.entries(v.manifest.contributionCaps)) {
      const one = { id: 'x', label: 'x', title: 'x', order: 1, items: '/v2/p/p/x', data: '/v2/p/p/x' }
      const overflowing = Array.from({ length: cap + 1 }, () => one)
      const parsed = pluginManifestShape.safeParse({
        id: 'p', name: 'P', version: '1', apiVersion: PLUGIN_API_MAJOR, contributions: { [key]: overflowing },
      })
      // Specifically the cap, not the entries' shape: the placeholder above is not a valid
      // descriptor for most of these keys, so "it failed" alone would prove nothing about the number.
      const tooBig = parsed.success
        ? []
        : parsed.error.issues.filter((issue) => issue.code === 'too_big' && issue.path.join('.') === `contributions.${key}`)
      expect(tooBig.length, `${key} did not refuse ${cap + 1} entries as too many`).toBe(1)
    }
  })

  it('lists the theme palette a manifest must state in full', () => {
    // A manifest's theme map must hold exactly these names. Deriving it from the schema's strict
    // object means a token added to the palette reaches the guide with no edit here.
    const v = pluginAuthoringVocabulary()
    expect(v.manifest.themeTokens).toEqual([...THEME_PALETTE_TOKENS])
    // And the three the host writes from `dark` are not in it: they are not colours, and a manifest
    // that could spell them could tell the terminal it was dark while rendering a light palette.
    for (const name of ['--is-dark', '--color-scheme', '--syntax-fg']) {
      expect(v.manifest.themeTokens).not.toContain(name)
    }
    for (const token of v.manifest.themeTokens) expect(renderPluginAuthoring(v)).toContain(`\`${token}\``)
  })

  it('reads the two action-verb unions off the descriptors that carry them', () => {
    const json = z.toJSONSchema(pluginManifestShape, { target: 'draft-7', io: 'input', unrepresentable: 'any' }) as {
      properties: Record<string, { properties: Record<string, { items: { properties: Record<string, { oneOf?: { properties: { verb: { const: string } } }[] }> } }> }>
    }
    const union = (descriptor: string, field: string) =>
      (json.properties.contributions.properties[descriptor].items.properties[field].oneOf ?? [])
        .map((option) => option.properties.verb.const)
        .sort()
    const v = pluginAuthoringVocabulary()
    expect(v.actions.railOnSelect).toEqual(union('sources', 'onSelect'))
    expect(v.actions.commandsAndBadges).toEqual(union('commands', 'action'))
    // The narrow set is a strict subset, and the guide says so in those words.
    expect(v.actions.railOnSelect).toEqual(expect.arrayContaining(v.actions.commandsAndBadges))
    expect(v.actions.commandsAndBadges.length).toBeLessThan(v.actions.railOnSelect.length)
  })

  it('pins the api major to the constant every manifest is compared against', () => {
    expect(pluginAuthoringVocabulary().apiMajor).toBe(PLUGIN_API_MAJOR)
    expect(renderPluginAuthoring()).toContain(`"${PLUGIN_API_MAJOR}"`)
  })
})

describe('the permission facets are the ones scopeCore honours', () => {
  // A facet in the guide that grants nothing is a lie the agent writes into a manifest and then
  // debugs. `scopeCore` gates by omission, so "this token grants something" is exactly "the
  // returned object is not empty", which is also why an unknown token has to come back empty.
  const core = {
    fs: {}, git: {}, tasks: {}, context: {}, models: {}, identity: {}, prefs: { read: () => {}, write: () => {} },
    projects: { byId: 1, byGithub: 1, checkouts: 1, externalProjects: 1, config: 1, assertConfigTrusted: 1, setup: 1, create: 1, update: 1 },
    secrets: {}, proc: {},
  } as unknown as CoreServices
  const scope = (token: string) =>
    scopeCore(core, { core: [token], capabilities: [], secrets: false, exec: false, net: [] }, 'p', { idsForOwner: () => [] })

  it('grants something for every facet the guide lists', () => {
    for (const token of NODE_CORE_FACETS) expect(Object.keys(scope(token)), token).not.toEqual([])
    expect(pluginAuthoringVocabulary().permissions.core).toEqual([...NODE_CORE_FACETS])
  })

  it('grants nothing for a token the guide does not list', () => {
    expect(Object.keys(scope('projects'))).toEqual([])
    expect(Object.keys(scope('from-a-newer-acorn'))).toEqual([])
  })

  it('names the permissions.node blocks the schema declares', () => {
    expect(pluginAuthoringVocabulary().permissions.node).toEqual(['core', 'capabilities', 'secrets', 'exec', 'net'])
  })
})

describe('the two doors', () => {
  it('registers an opt-in context section that costs a normal task nothing', () => {
    const section = getContextSections().find((candidate) => candidate.id === PLUGIN_AUTHORING_SECTION)
    expect(section).toBeDefined()
    // The whole affordability argument (docs/agent-tools.md § plugin_authoring): if this ever
    // flips, every task starts paying for a guide it is not using.
    expect(section?.defaultIncluded).toBe(false)
    // Keeps wire order after memory (docs/agent-tools.md § Context sections).
    expect(section?.order).toBeGreaterThan(40)
  })

  it('formats the section as the same guide the tool serves', async () => {
    const draft = await pluginAuthoringSection.assemble({} as never)
    expect(pluginAuthoringSection.format(draft.items, 0)).toBe(renderPluginAuthoring())
  })

  it('is a read-tier tool that answers with both halves', async () => {
    const tool = pluginAuthoringTool()
    expect(tool.name).toBe(PLUGIN_AUTHORING_TOOL)
    expect(tool.risk).toBe('read')
    const result = (await tool.handler({}, { taskId: 't', userLogin: 'u' })) as { guide: string; vocabulary: unknown }
    expect(result.guide).toBe(renderPluginAuthoring())
    expect(result.vocabulary).toEqual(pluginAuthoringVocabulary())
  })

  it('is still the tool the Settings → Plugins starter prompt tells the agent to call', () => {
    // A text read, not an import: node must not import the client, and this is the only way a rename here
    // can go red over there. The seeded prompt is the entry point to the whole loop; if it names a tool
    // that no longer exists, the first thing a new plugin author's agent does is fail.
    const settings = join(dirname(fileURLToPath(import.meta.url)), '../../../../client-core/src/settings/PluginsSettings.tsx')
    expect(readFileSync(settings, 'utf8')).toContain(`\`${PLUGIN_AUTHORING_TOOL}\``)
  })

  it('tells the agent the things about the loop it cannot derive', () => {
    const guide = renderPluginAuthoring()
    // Each of these is a fact the agent gets wrong by default, and the one it would waste a session on.
    expect(guide).toContain('plugin_request')
    expect(guide).toContain('identical arguments to collect the answer')
    expect(guide).toContain('Only the ENTRY module is re-evaluated')
    expect(guide).toContain('node:')
    expect(guide).toContain('acorn-plugin.json')
    // Every derived list reaches the rendered text; a vocabulary computed and then not printed would
    // pass every test above.
    const v = pluginAuthoringVocabulary()
    for (const verb of v.actions.railOnSelect) expect(guide).toContain(`\`${verb}\``)
    for (const kind of Object.keys(v.bridge.kinds)) expect(guide).toContain(`\`${kind}\``)
    for (const [key, cap] of Object.entries(v.manifest.contributionCaps)) expect(guide).toContain(`\`${key}\` — max ${cap}`)
  })
})

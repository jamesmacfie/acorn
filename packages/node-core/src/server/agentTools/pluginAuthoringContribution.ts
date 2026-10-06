import { z } from 'zod'
import { registerContextSection, type ContextSectionContribution } from './contextSections.ts'
import type { AgentToolContribution } from './registry.ts'

// ── The two doors ─────────────────────────────────────────────────────────────────────────────────

export const PLUGIN_AUTHORING_TOOL = 'plugin_authoring'
export const PLUGIN_AUTHORING_SECTION = 'plugin-authoring'

/** Read tier: it reads schemas this process already holds and touches nothing. */
export const pluginAuthoringTool = (): AgentToolContribution => ({
  name: PLUGIN_AUTHORING_TOOL,
  description:
    'How to write an acorn plugin against THIS node, with the current manifest vocabulary, action verbs, permission facets and frame-bridge messages read from the node itself. Call this before writing or changing a plugin, and before answering any question about the plugin contract — never answer one from memory. Installing is a separate tool (plugin_request); this one only tells you how.',
  input: z.object({}),
  scope: 'task',
  risk: 'read',
  handler: async () => {
    const { pluginAuthoringVocabulary, renderPluginAuthoring } = await import('./pluginAuthoring.ts')
    const vocabulary = pluginAuthoringVocabulary()
    // Both shapes in one result: an agent reads the markdown, and checks a manifest against the
    // structured half without parsing prose.
    return { guide: renderPluginAuthoring(vocabulary), vocabulary }
  },
})

// `defaultIncluded: false` is the whole reason this is affordable; order 50 keeps it after memory
// (docs/agent-tools/context-sections.md § Context sections).
export const pluginAuthoringSection: ContextSectionContribution = {
  id: PLUGIN_AUTHORING_SECTION,
  order: 50,
  label: 'Plugin authoring',
  defaultIncluded: false,
  // One item, and a per-item ceiling well above the rendered guide, so the budget is a backstop rather
  // than a silent truncation of the contract. `truncate-tail` because the brief leads and the derived
  // vocabulary follows, so losing the tail is the less wrong half to lose.
  budget: { maxItems: 1, maxBytesPerItem: 32_000, overflow: 'truncate-tail' },
  assemble: async () => {
    const { renderPluginAuthoring } = await import('./pluginAuthoring.ts')
    return { items: [{ id: PLUGIN_AUTHORING_SECTION, kind: 'guide', label: 'Writing an acorn plugin', body: renderPluginAuthoring() }] }
  },
  format: (items) => items[0]?.body ?? '',
}

registerContextSection('core', pluginAuthoringSection)

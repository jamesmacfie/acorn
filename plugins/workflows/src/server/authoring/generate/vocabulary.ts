import { DEFAULT_PROFILE_ID } from '@acorn/plugin-api/node'
import type { WorkflowCatalog } from '../../../shared/workflowContracts'
import { GENERATE_MAX_PROFILES, GENERATE_MAX_VOCABULARY_CHARS } from './limits'

// --- 5. the policies and profiles this node has ---

const vocabularyAt = (catalog: WorkflowCatalog, compact: boolean): string => {
  const lines = ['## 5. Policies and profiles', '', '### Policies']
  const policies = catalog.policies
  if (!policies.length) {
    lines.push('', 'This node offers no policies, so do not write a `gate-policy` step.')
  } else {
    lines.push('', 'A `gate-policy` step asks a policy for a verdict and fails the run when it says no. Its `policy`')
    lines.push(`is one of: ${policies.map((policy) => `\`${policy.id}\``).join(', ')}.`)
    if (!compact) {
      lines.push('', `{ "id": "checks", "name": "Checks", "kind": "gate-policy", "after": ["open-a-pull-request"], "policy": "${policies[0]!.id}" }`)
    }
  }

  lines.push('', '### Profiles', '')
  const profiles = catalog.profiles
  if (!profiles.length) {
    lines.push('This node has no agent profiles, so leave `profileId` off every step.')
    return lines.join('\n')
  }
  lines.push('`profileId` on an agent step picks which agent runs it. Leave it out and the step runs on the')
  lines.push('default, which is what you want unless the description asks for something else.')
  lines.push('')
  // The default first and the structured ones next, so a node with more profiles than fit keeps the
  // ones a definition might actually have to name.
  const ranked = [...profiles].sort((a, b) =>
    Number(b.id === DEFAULT_PROFILE_ID) - Number(a.id === DEFAULT_PROFILE_ID) || Number(b.structured) - Number(a.structured) || a.id.localeCompare(b.id))
  const shown = ranked.slice(0, GENERATE_MAX_PROFILES)
  const rest = ranked.length - shown.length
  if (compact) {
    lines.push(`${shown.map((profile) => `\`${profile.id}\``).join(', ')}${rest > 0 ? `, and ${rest} more` : ''}.`)
  } else {
    lines.push(...shown.map((profile) => {
      const notes = [
        ...(profile.id === DEFAULT_PROFILE_ID ? ['The default'] : []),
        ...(profile.structured ? ['Has a structured mode'] : []),
      ]
      return `- \`${profile.id}\`, ${profile.label}.${notes.map((note) => ` ${note}.`).join('')}`
    }))
    if (rest > 0) lines.push(`- and ${rest} more.`)
  }

  // `decide` is the one kind that needs a profile with a one-shot structured mode, and whether it
  // needs to say so depends on the node it runs on.
  const structured = ranked.filter((profile) => profile.structured)
  const defaultStructured = structured.some((profile) => profile.id === DEFAULT_PROFILE_ID)
  lines.push('')
  if (!structured.length) {
    lines.push('No profile here has a structured mode, and a `decide` step needs one, so do not write a')
    lines.push('`decide` step.')
  } else if (defaultStructured) {
    lines.push('A `decide` step needs a profile with a structured mode. The default has one, so a `decide` step')
    lines.push('needs no `profileId`.')
  } else {
    lines.push('A `decide` step needs a profile with a structured mode and the default has none, so give every')
    lines.push(`\`decide\` step a \`profileId\` of one of: ${structured.map((profile) => `\`${profile.id}\``).join(', ')}.`)
  }
  return lines.join('\n')
}

/** The vocabulary a definition may name, as large as it fits. Degraded in place, never dropped: an
 *  unlisted policy or profile is one the model would invent instead. */
export function renderVocabulary(catalog: WorkflowCatalog, budget = GENERATE_MAX_VOCABULARY_CHARS): string {
  const full = vocabularyAt(catalog, false)
  return full.length <= budget ? full : vocabularyAt(catalog, true)
}

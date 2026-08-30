import { brandMarkRegistry } from '@acorn/plugin-api/client'
import { Icon } from '@acorn/plugin-api/ui'

// A provider's mark, drawn wherever a surface names the provider: the onboarding cards, the New
// picker's rows, and each provider's block in Settings -> Agent defaults.
//
// The name comes off the descriptor, which is the node's answer rather than this file's guess, so a
// contributed harness gets the same treatment as the two built-in ones. It may be a `brand:` mark, a
// Lucide name, or nothing at all, which is why the label's first letter is the fallback and why the
// mark goes through Icon: an unmatched name renders as text (docs/ui-design.md section Icons).
//
// `tone="brand"` is the kit asking the mark for its own colour, held to the theme's contrast. No
// title, because the label it sits beside already says which provider this is.
export default function ProviderGlyph(props: { glyph?: string; label: string }) {
  return <Icon name={props.glyph ?? props.label.slice(0, 1).toUpperCase()} tone="brand" />
}

// The same mark, for a surface holding a provider id and no descriptor: the session rows in the task
// sidebar know `session.providerId` and nothing else, and fetching the whole provider list to colour a
// sub-line would be a request per sidebar.
//
// Undefined when nothing is registered under that id, so a provider without a mark draws no glyph
// rather than the literal string `brand:agents/whatever`. The row's text already names it.
export function providerMarkName(providerId: string): string | undefined {
  const id = `agents/${providerId}`
  return brandMarkRegistry.get(id) ? `brand:${id}` : undefined
}

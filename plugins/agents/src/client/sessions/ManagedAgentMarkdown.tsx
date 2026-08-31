import { openInAppUrl } from '@acorn/plugin-api/client'
import { Markdown } from '@acorn/plugin-api/ui'

// The transcript's Markdown policy, in one place: a turn is provider output rather than authored text,
// so a remote image in it never loads, and every code fence gets a copy button.
export default function AgentMarkdown(props: { text: string; taskId: string }) {
  return (
    <Markdown
      text={props.text}
      images="placeholder"
      copy
      onSelect={(href) => openInAppUrl(href, { taskId: props.taskId })}
    />
  )
}

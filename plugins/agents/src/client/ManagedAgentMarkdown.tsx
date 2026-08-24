import { handlePluginContentLinkClick } from '@acorn/plugin-api/client'
import { Markdown } from '@acorn/plugin-api/ui'

// The transcript's Markdown policy, in one place: a turn is provider output rather than authored text,
// so a remote image in it never loads, and every code fence gets a copy button. `.agent-markdown` adds
// what a transcript needs on top of `.ui-markdown` (a height cap, wrapped pre) in managed-agents.css.
export default function AgentMarkdown(props: { text: string; taskId: string; class?: string }) {
  return (
    <Markdown
      text={props.text}
      images="placeholder"
      copy
      class={`agent-markdown ${props.class ?? ''}`}
      onClick={(event) => handlePluginContentLinkClick(event, { taskId: props.taskId })}
    />
  )
}

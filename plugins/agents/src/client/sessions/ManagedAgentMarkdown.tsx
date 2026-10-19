import { openInAppUrl } from '@acorn/plugin-api/client'
import { Markdown } from '@acorn/plugin-api/ui'
import { markdownFences } from '@acorn/plugin-api/ui/host'

// The transcript's Markdown policy, in one place: a turn is provider output rather than authored text,
// so a remote image in it never loads, every code fence gets a copy button, and a closed fence may get
// another plugin's viewer (`core:markdown-fence`). Each message is its own owner for the viewer cap.
export default function AgentMarkdown(props: {
  text: string
  taskId: string
  /** Gets a pressed link first, and says whether it took it: a sent message's context references. */
  onLink?: (href: string) => boolean
}) {
  const fences = markdownFences({ taskId: props.taskId })
  return (
    <Markdown
      text={props.text}
      images="placeholder"
      copy
      onSelect={(href) => props.onLink?.(href) || openInAppUrl(href, { taskId: props.taskId })}
      fences={fences}
    />
  )
}

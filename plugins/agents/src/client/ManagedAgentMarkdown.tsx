import { createEffect, onCleanup } from 'solid-js'
import { getHighlighter, handlePluginContentLinkClick } from '@acorn/plugin-api/client'
import { renderAgentMarkdown } from './agentMarkdown'

const SHIKI_LANGUAGES = new Set([
  'typescript', 'tsx', 'javascript', 'jsx', 'json', 'css', 'html', 'markdown',
  'python', 'go', 'rust', 'java', 'c', 'cpp', 'shellscript', 'yaml', 'sql',
])

const LANGUAGE_ALIASES: Record<string, string> = {
  ts: 'typescript',
  js: 'javascript',
  md: 'markdown',
  py: 'python',
  sh: 'shellscript',
  bash: 'shellscript',
  yml: 'yaml',
}

export default function AgentMarkdown(props: { text: string; taskId: string; class?: string }) {
  let root: HTMLDivElement | undefined
  let generation = 0
  let rendered: string | undefined

  createEffect(() => {
    const text = props.text
    // A prop is a getter, not a memo, so this effect re-runs whenever anything upstream ticks, even
    // when the text is identical. Assigning innerHTML replaces every text node underneath, which throws
    // away the reader's selection, so compare before writing.
    if (!root || text === rendered) return
    rendered = text
    const current = ++generation
    root.innerHTML = renderAgentMarkdown(text)
    // Grammars load on demand now (client-core/highlight/langs.ts), so each fence has to ask for its
    // Grammars load on demand now (client-core/highlight/langs.ts), so each fence has to ask for its
    // own before `codeToHtml` can route to it. The highlighter starts with none loaded.
    const languagesInPost = new Set(
      [...(root.querySelectorAll<HTMLElement>('pre > code[data-language]') ?? [])]
        .map((node) => LANGUAGE_ALIASES[node.dataset.language ?? 'text'] ?? node.dataset.language ?? 'text')
        .filter((language) => SHIKI_LANGUAGES.has(language)),
    )
    if (!languagesInPost.size) return
    void (async () => {
      const highlighter = await getHighlighter()
      await Promise.all([...languagesInPost].map((language) => getHighlighter(language)))
      if (!root || current !== generation) return
      for (const node of root.querySelectorAll<HTMLElement>('pre > code[data-language]')) {
        const requested = node.dataset.language ?? 'text'
        const language = LANGUAGE_ALIASES[requested] ?? requested
        if (!SHIKI_LANGUAGES.has(language)) continue
        const html = highlighter.codeToHtml(node.textContent ?? '', {
          lang: language,
          themes: { light: 'github-light', dark: 'github-dark' },
        })
        const wrapper = document.createElement('div')
        wrapper.innerHTML = html
        const highlighted = wrapper.firstElementChild
        if (highlighted) node.parentElement?.replaceWith(highlighted)
      }
    })()
  })

  onCleanup(() => generation++)
  return (
    <div
      ref={root}
      class={`ui-markdown agent-markdown ${props.class ?? ''}`}
      onClick={(event) => handlePluginContentLinkClick(event, { taskId: props.taskId })}
    />
  )
}

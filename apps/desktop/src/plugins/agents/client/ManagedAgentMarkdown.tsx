import { createEffect, onCleanup } from 'solid-js'
import { getHighlighter } from '../../../core/client/highlight/shiki'
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

export default function AgentMarkdown(props: { text: string; class?: string }) {
  let root: HTMLDivElement | undefined
  let generation = 0

  createEffect(() => {
    const text = props.text
    const current = ++generation
    if (!root) return
    root.innerHTML = renderAgentMarkdown(text)
    void getHighlighter().then((highlighter) => {
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
    })
  })

  onCleanup(() => generation++)
  return <div ref={root} class={`agent-markdown ${props.class ?? ''}`} />
}

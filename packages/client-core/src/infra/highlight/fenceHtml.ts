import type { HighlighterCore } from 'shiki/core'

/**
 * One fence as dual-themed html, from whichever highlighter the caller owns: the worker's
 * (highlighter.worker.ts) or the main thread's fallback (shiki.ts).
 *
 * Each token carries both colours as --l/--r and the stylesheet picks a side with light-dark(), the
 * same way diff rows do (styles/primitives.css § Markdown, docs/ui-design/tokens.md § Token axes).
 * Shiki's own dual-theme default instead writes the light colour into `color` and the dark one into a
 * --shiki-dark no stylesheet here reads, so a dark theme would draw every fence in github-light.
 */
export const fenceHtml = (hl: HighlighterCore, code: string, lang: string): string =>
  hl.codeToHtml(code, {
    lang,
    themes: { l: 'github-light', r: 'github-dark' },
    defaultColor: false,
    cssVariablePrefix: '--',
  })

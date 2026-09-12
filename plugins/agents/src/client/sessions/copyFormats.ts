// The three ways a reader can take an agent's answer out of the transcript. Markdown is what the
// harness sent, JSON is the event record behind the card, and this is the third: the same prose with
// its markup taken out, for pasting somewhere that renders none of it.
//
// ponytail: regexes, not a parser. Fences, inline code, links, headings, quotes, bullets and bold
// cover what an agent writes; a table or a reference-style link comes through as it was. Reach for a
// real markdown walker if that starts to matter.
//
// Underscores are left alone on purpose: `snake_case` shows up in agent output far more often than
// `_italics_`, and stripping both would quietly rewrite identifiers.
export const asPlainText = (markdown: string): string =>
  markdown
    .replace(/^\s*```[^\n]*\n?/gm, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^(\s*)[-*+]\s+/gm, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(?!\s)(.+?)(?<!\s)\*/g, '$1')
    .trim()

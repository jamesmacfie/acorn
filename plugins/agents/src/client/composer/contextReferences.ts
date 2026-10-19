import { fuzzyScore } from '@acorn/plugin-api/client'

// `#keyword:slug` references to Acorn context (docs/managed-agents/composer.md § Reference Acorn
// context). Pure, with no Solid and no fetches, so the browser extension's composer can read the same
// tokens later.
//
// The resolver is the one reading of "does this token attach something". The composer colours what it
// returns and sends what it returns, so a coloured token always attaches and an uncoloured one is prose.

/** One context source as the resolver sees it. `items` is absent until its list has been read. */
export type ContextCategory = {
  keyword: string
  label: string
  itemless?: boolean
  items?: readonly ContextItem[]
}

export type ContextItem = { id: string; label: string }

/** What completion wrote, keyed by the token text: the item it meant. Kept with the draft, so a token
 *  keeps its item after a rename and two items with one slug stay apart. */
export type ContextReferenceMap = Readonly<Record<string, ContextItem>>

/** A token that resolved. `itemId` is absent for an itemless source such as `#task`. */
export type ContextReference = {
  text: string
  keyword: string
  start: number
  end: number
  itemId?: string
  label: string
}

/** "Refactor login (v2)" becomes `refactor-login-v2`. A label with no letters or digits in it gets
 *  `item`, so completion still has something to write. */
export function contextSlug(label: string): string {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'item'
  )
}

export const contextToken = (keyword: string, slug?: string): string => (slug ? `#${keyword}:${slug}` : `#${keyword}`)

// At a word boundary only, so `C#` and `a#b` stay prose, and starting with a letter, so `#123` and
// `# Heading` do too.
const REFERENCE = /(?:^|\s)#([a-z][a-z0-9-]*)(?::([a-z0-9][a-z0-9-]*))?/g
// A token followed by one of these is part of a longer word, such as `#agent:foo_bar` or `#tasks`.
const CONTINUES = /[\w:]/

/** Every token in `text` that names one of `categories` and resolves to something. */
export function resolveContextReferences(
  text: string,
  categories: readonly ContextCategory[],
  map: ContextReferenceMap = {},
): ContextReference[] {
  const byKeyword = new Map(categories.map((category) => [category.keyword, category]))
  const references: ContextReference[] = []
  for (const match of text.matchAll(REFERENCE)) {
    const [keyword, slug] = [match[1]!, match[2]]
    const start = match.index + match[0].indexOf('#')
    const end = match.index + match[0].length
    if (CONTINUES.test(text[end] ?? '')) continue
    const category = byKeyword.get(keyword)
    // `#task` is whole on its own, and `#terminal` without an item means nothing.
    if (!category || Boolean(slug) === Boolean(category.itemless)) continue
    const token = text.slice(start, end)
    const item = slug ? (map[token] ?? onlyMatch(category.items, slug)) : undefined
    if (slug && !item) continue
    references.push({
      text: token,
      keyword,
      start,
      end,
      ...(item ? { itemId: item.id } : {}),
      label: item?.label ?? category.label,
    })
  }
  return references
}

// A hand-typed token resolves only when exactly one item has its slug: two sessions both titled
// "Refactor login" leave `#agent:refactor-login` as prose rather than guessing.
const onlyMatch = (items: readonly ContextItem[] | undefined, slug: string): ContextItem | undefined => {
  const matches = items?.filter((item) => contextSlug(item.label) === slug) ?? []
  return matches.length === 1 ? matches[0] : undefined
}

/** The token completion writes for `item`. A slug another item already holds in the draft gets `-2`,
 *  `-3`, and so on, so the text stays unambiguous for the model. */
export function contextCompletion(category: ContextCategory, item: ContextItem, map: ContextReferenceMap): string {
  const base = contextToken(category.keyword, contextSlug(item.label))
  let token = base
  for (let n = 2; map[token] && map[token].id !== item.id; n++) token = `${base}-${n}`
  return token
}

/** Categories worth offering for what follows a bare `#`. A prefix of the keyword or of a word in the
 *  label, so `#123` and `#hashtag` match nothing and the list closes. */
export function categorySuggestions<T extends ContextCategory>(categories: readonly T[], query: string): T[] {
  const needle = query.trim().toLowerCase()
  return categories.filter(
    (category) =>
      category.keyword.startsWith(needle) ||
      category.label
        .toLowerCase()
        .split(/\s+/)
        .some((word) => word.startsWith(needle)),
  )
}

/** Items worth offering for what follows `#keyword:`, ranked by their label. */
export function itemSuggestions<T extends ContextItem>(items: readonly T[], query: string, limit = 10): T[] {
  if (!query) return items.slice(0, limit)
  return items
    .map((item) => ({ item, score: fuzzyScore(query, item.label) ?? fuzzyScore(query, contextSlug(item.label)) }))
    .filter((ranked): ranked is { item: T; score: number } => ranked.score != null)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((ranked) => ranked.item)
}

/** `token` written at `at`, with a space either side where the text has none. */
export function insertContextToken(text: string, at: number, token: string): { text: string; cursor: number } {
  const before = at > 0 && !/\s/.test(text[at - 1]!) ? ' ' : ''
  const after = /\s/.test(text[at] ?? '') ? '' : ' '
  const inserted = `${before}${token}${after}`
  return { text: `${text.slice(0, at)}${inserted}${text.slice(at)}`, cursor: at + inserted.length }
}

/** The text without these tokens, each taking one space beside it so no double space is left. */
export function removeContextTokens(text: string, references: readonly { start: number; end: number }[]): string {
  let result = text
  for (const { start, end } of [...references].sort((left, right) => right.start - left.start)) {
    const trailing = /\s/.test(result[end] ?? '') ? 1 : 0
    const leading = !trailing && start > 0 && /\s/.test(result[start - 1]!) ? 1 : 0
    result = `${result.slice(0, start - leading)}${result.slice(end + trailing)}`
  }
  return result
}

/** The fragment a sent message's link carries for its `index`th referenced context part. */
const contextLinkHref = (index: number): string => `#context-ref-${index}`

/** The index behind a link `linkContextReferences` wrote, or null for any other link. */
export const contextLinkIndex = (href: string): number | null => {
  const match = /^#context-ref-(\d+)$/.exec(href)
  return match ? Number(match[1]) : null
}

/**
 * A sent message as markdown, with each token in `refs` written as a link to its context part. Code
 * stays as it was, because a token in a code span or a fence is something the person quoted.
 */
export function linkContextReferences(text: string, refs: readonly string[]): string {
  if (!refs.length) return text
  const link = (prose: string) =>
    prose.replace(REFERENCE, (match: string, ...rest: unknown[]) => {
      const [offset, whole] = [rest.at(-2) as number, rest.at(-1) as string]
      const token = match.slice(match.indexOf('#'))
      const index = refs.indexOf(token)
      if (index < 0 || CONTINUES.test(whole[offset + match.length] ?? '')) return match
      return `${match.slice(0, match.indexOf('#'))}[${token}](${contextLinkHref(index)})`
    })
  let fenced = false
  return text
    .split('\n')
    .map((line) => {
      if (/^\s*```/.test(line)) {
        fenced = !fenced
        return line
      }
      if (fenced) return line
      return line
        .split(/(`+[^`]*`+)/)
        .map((part, index) => (index % 2 ? part : link(part)))
        .join('')
    })
    .join('\n')
}

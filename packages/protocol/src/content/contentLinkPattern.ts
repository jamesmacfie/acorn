import { normalizeWebviewHost } from './webview.ts'

export const CONTENT_LINK_PATTERN_MAX_LENGTH = 512
export const CONTENT_LINK_PATTERN_MAX_CAPTURES = 8

type ContentLinkCaptures = Readonly<Record<string, string>>
export type CompiledContentLinkPattern = {
  readonly captures: readonly string[]
  match(href: string): ContentLinkCaptures | null
}

// `rest` is a `{name+}` capture: one or more whole segments, joined with `/`.
type Segment = { literal: string } | { capture: string; rest?: true }
const CAPTURE = /^[A-Za-z][A-Za-z0-9_]{0,31}$/

const decoded = (value: string, label: string): string => {
  try {
    return decodeURIComponent(value)
  } catch {
    throw new Error(`${label} contains invalid URL encoding`)
  }
}

// Compile a non-regex URL grammar. Matching is linear over host/path segments, so no manifest string
// can introduce catastrophic backtracking into synchronous content rendering.
//
// A path segment is a literal, a `{capture}` of one segment, or a `{capture+}` of one or more. A
// `{capture+}` appears once and only right before a literal, such as GitLab's
// `https://gitlab.com/{path+}/-/merge_requests/{number}`. Every other segment has a fixed width, so
// the address's segment count alone says how many segments the `+` capture takes.
export function compileContentLinkPattern(pattern: string): CompiledContentLinkPattern {
  if (!pattern.length || pattern.length > CONTENT_LINK_PATTERN_MAX_LENGTH) {
    throw new Error(`content-link pattern must be 1-${CONTENT_LINK_PATTERN_MAX_LENGTH} characters`)
  }
  if (!pattern.startsWith('https://')) throw new Error('content-link pattern must use https://')
  if (pattern.includes('?') || pattern.includes('#'))
    throw new Error('content-link pattern cannot contain a query or fragment')

  const rest = pattern.slice('https://'.length)
  const slash = rest.indexOf('/')
  if (slash <= 0) throw new Error('content-link pattern must include a host and absolute path')
  const declaredHost = rest.slice(0, slash).toLowerCase()
  let normalizedHost: string
  try {
    normalizedHost = normalizeWebviewHost(declaredHost)
  } catch {
    throw new Error('content-link pattern has an invalid literal host')
  }
  const wildcard = normalizedHost.startsWith('*.')
  const host = wildcard ? normalizedHost.slice(2) : normalizedHost
  if (!host.includes('.')) throw new Error('content-link pattern has an invalid literal host')

  const rawPath = rest.slice(slash)
  const rawSegments = rawPath === '/' ? [] : rawPath.slice(1).split('/')
  if (rawSegments.some((segment) => !segment))
    throw new Error('content-link pattern path cannot contain empty segments')
  const captures: string[] = []
  const segments: Segment[] = rawSegments.map((segment, index) => {
    const rest = /^\{([^{}+]+)\+\}$/.exec(segment)?.[1]
    if (rest !== undefined) {
      if (!CAPTURE.test(rest)) throw new Error(`content-link capture '${rest}' has an invalid name`)
      if (captures.includes(rest)) throw new Error(`content-link capture '${rest}' is duplicated`)
      if (rawSegments.some((other, at) => at !== index && /^\{[^{}]+\+\}$/.test(other)))
        throw new Error('content-link pattern may contain one {capture+}')
      const next = rawSegments[index + 1]
      if (next === undefined || /[{}]/.test(next))
        throw new Error(`content-link capture '${rest}+' must come right before a literal segment`)
      captures.push(rest)
      return { capture: rest, rest: true }
    }
    const capture = /^\{([^{}]+)\}$/.exec(segment)?.[1]
    if (capture !== undefined) {
      if (!CAPTURE.test(capture)) throw new Error(`content-link capture '${capture}' has an invalid name`)
      if (captures.includes(capture)) throw new Error(`content-link capture '${capture}' is duplicated`)
      captures.push(capture)
      if (captures.length > CONTENT_LINK_PATTERN_MAX_CAPTURES) {
        throw new Error(`content-link pattern may contain at most ${CONTENT_LINK_PATTERN_MAX_CAPTURES} captures`)
      }
      return { capture }
    }
    if (/[{}*]/.test(segment)) throw new Error(`content-link path segment '${segment}' is not a literal or {capture}`)
    const literal = decoded(segment, 'content-link path')
    if (literal === '.' || literal === '..') throw new Error('content-link path cannot traverse')
    return { literal }
  })

  const spread = segments.some((segment) => 'rest' in segment && segment.rest)
  return {
    captures,
    match(href) {
      let url: URL
      try {
        url = new URL(href)
      } catch {
        return null
      }
      if (url.protocol !== 'https:' || url.username || url.password || url.port) return null
      const hostname = url.hostname.toLowerCase()
      if (wildcard ? hostname === host || !hostname.endsWith(`.${host}`) : hostname !== host) return null
      // One trailing slash names the same item: some providers spell their canonical address with one.
      const path = url.pathname.length > 1 && url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname
      const candidate = path === '/' ? [] : path.slice(1).split('/')
      // The `+` capture takes whatever the fixed-width segments leave, which must be at least one.
      const width = candidate.length - segments.length + 1
      if ((spread ? width < 1 : width !== 1) || candidate.some((segment) => !segment)) return null
      const result: Record<string, string> = {}
      let at = 0
      for (const segment of segments) {
        const taken = 'rest' in segment && segment.rest ? width : 1
        const values: string[] = []
        for (const raw of candidate.slice(at, at + taken)) {
          let value: string
          try {
            value = decoded(raw, 'content link')
          } catch {
            return null
          }
          // `%2F` is still a slash semantically. Reject it after decoding so a capture cannot smuggle
          // extra path segments past the grammar.
          if (value.includes('/')) return null
          values.push(value)
        }
        at += taken
        if ('literal' in segment) {
          if (values[0] !== segment.literal) return null
        } else {
          result[segment.capture] = values.join('/')
        }
      }
      return result
    },
  }
}

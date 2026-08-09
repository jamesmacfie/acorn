import { normalizeWebviewHost } from './webview'

export const CONTENT_LINK_PATTERN_MAX_LENGTH = 512
export const CONTENT_LINK_PATTERN_MAX_CAPTURES = 8

export type ContentLinkCaptures = Readonly<Record<string, string>>
export type CompiledContentLinkPattern = {
  readonly captures: readonly string[]
  match(href: string): ContentLinkCaptures | null
}

type Segment = { literal: string } | { capture: string }
const CAPTURE = /^[A-Za-z][A-Za-z0-9_]{0,31}$/

const decoded = (value: string, label: string): string => {
  try {
    return decodeURIComponent(value)
  } catch {
    throw new Error(`${label} contains invalid URL encoding`)
  }
}

// Compile a deliberately non-regex URL grammar. Matching is linear over host/path segments, so no
// manifest string can introduce catastrophic backtracking into synchronous content rendering.
export function compileContentLinkPattern(pattern: string): CompiledContentLinkPattern {
  if (!pattern.length || pattern.length > CONTENT_LINK_PATTERN_MAX_LENGTH) {
    throw new Error(`content-link pattern must be 1-${CONTENT_LINK_PATTERN_MAX_LENGTH} characters`)
  }
  if (!pattern.startsWith('https://')) throw new Error('content-link pattern must use https://')
  if (pattern.includes('?') || pattern.includes('#')) throw new Error('content-link pattern cannot contain a query or fragment')

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
  if (rawSegments.some((segment) => !segment)) throw new Error('content-link pattern path cannot contain empty segments')
  const captures: string[] = []
  const segments: Segment[] = rawSegments.map((segment) => {
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
      const candidate = url.pathname === '/' ? [] : url.pathname.slice(1).split('/')
      if (candidate.length !== segments.length || candidate.some((segment) => !segment)) return null
      const result: Record<string, string> = {}
      for (let index = 0; index < segments.length; index++) {
        const segment = segments[index]
        let value: string
        try {
          value = decoded(candidate[index]!, 'content link')
        } catch {
          return null
        }
        // `%2F` is still a slash semantically. Reject it after decoding so a capture cannot smuggle
        // multiple path segments through the single-segment grammar.
        if (value.includes('/')) return null
        if ('literal' in segment) {
          if (value !== segment.literal) return null
        } else {
          result[segment.capture] = value
        }
      }
      return result
    },
  }
}

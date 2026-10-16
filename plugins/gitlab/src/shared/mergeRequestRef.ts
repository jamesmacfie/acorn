import { compileContentLinkPattern } from '@acorn/protocol/contentLinkPattern.ts'

// How a project and a merge request are named outside their own pane. A project's address is its
// server's host and its path, such as `gitlab.com/group/sub/api`, because the same path can name two
// projects on two servers. A merge request is its address and number in GitLab's spelling,
// `gitlab.com/group/sub/api!12`. The source rows, the content link recogniser, the reference panel, the
// task link, and the routes all use these.

export type MergeRequestRef = { address: string; number: string }

/** A project's address on the server at `host`. */
export const projectAddress = (host: string, path: string): string => `${host}/${path}`

/** An address's host and project path. */
export function splitAddress(address: string): { host: string; path: string } {
  const at = address.indexOf('/')
  return { host: address.slice(0, at), path: address.slice(at + 1) }
}

export const formatMergeRequestRef = (address: string, number: string | number): string => `${address}!${number}`

// A host, then a project path of at least two segments: a project always sits in a group or a user.
const REF = /^([^!\s/]+(?:\/[^!\s/]+){2,})!(\d+)$/

export function parseMergeRequestRef(value: string): MergeRequestRef | null {
  const match = REF.exec(value)
  return match ? { address: match[1]!, number: match[2]! } : null
}

/** A merge request's page. */
export const mergeRequestUrl = (address: string, number: string | number) =>
  `https://${address}/-/merge_requests/${number}`

/** The merge request an address names, or null, on any host: the caller says which hosts are GitLab's.
 *  The grammar is the browser handoff's, so the pane, a content link, and the extension agree on which
 *  pages are merge requests. A project path nests groups to any depth. */
export function parseMergeRequestUrl(href: string): MergeRequestRef | null {
  // A content link can carry a query or fragment, which the page grammar leaves out.
  const bare = href.split(/[?#]/)[0]!
  let host: string
  try {
    host = new URL(bare).hostname
  } catch {
    return null
  }
  for (const page of ['{path+}/-/merge_requests/{number}', '{path+}/-/merge_requests/{number}/{tab}']) {
    let captures: Record<string, string> | null
    try {
      captures = compileContentLinkPattern(`https://${host}/${page}`).match(bare)
    } catch {
      return null
    }
    if (captures?.path && captures.number && /^\d+$/.test(captures.number))
      return { address: projectAddress(host, captures.path), number: captures.number }
  }
  return null
}

/** Paths are case-insensitive on GitLab, and core stores them folded. Hosts are lowercase already. */
export const samePath = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

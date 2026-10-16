import { compileContentLinkPattern } from '@acorn/protocol/contentLinkPattern.ts'

// How a merge request is named outside its own pane: `group/sub/api!12`, GitLab's own spelling. The
// source rows, the content link recogniser, the reference panel, and the task link all use it.

export type MergeRequestRef = { path: string; number: string }

export const formatMergeRequestRef = (path: string, number: string | number): string => `${path}!${number}`

const REF = /^([^!\s]+(?:\/[^!\s]+)+)!(\d+)$/

export function parseMergeRequestRef(value: string): MergeRequestRef | null {
  const match = REF.exec(value)
  return match ? { path: match[1]!, number: match[2]! } : null
}

/** A merge request's page on gitlab.com. */
export const mergeRequestUrl = (path: string, number: string | number) =>
  `https://gitlab.com/${path}/-/merge_requests/${number}`

// The same grammar the browser handoff declares, so the pane, a content link, and the extension agree
// on which pages are merge requests. A project path nests groups to any depth.
const MERGE_REQUEST_PAGES = [
  compileContentLinkPattern('https://gitlab.com/{path+}/-/merge_requests/{number}'),
  compileContentLinkPattern('https://gitlab.com/{path+}/-/merge_requests/{number}/{tab}'),
]

/** The merge request a gitlab.com address names, or null. */
export function parseMergeRequestUrl(href: string): MergeRequestRef | null {
  // A content link can carry a query or fragment, which the page grammar leaves out.
  const bare = href.split(/[?#]/)[0]!
  for (const pattern of MERGE_REQUEST_PAGES) {
    const captures = pattern.match(bare)
    if (captures?.path && captures.number && /^\d+$/.test(captures.number))
      return { path: captures.path, number: captures.number }
  }
  return null
}

/** Paths are case-insensitive on GitLab, and core stores them folded. */
export const samePath = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

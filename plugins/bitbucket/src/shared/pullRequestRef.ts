import { compileContentLinkPattern } from '@acorn/protocol/contentLinkPattern.ts'

// How a repository and a pull request are named outside their own pane. A repository is its full name,
// `workspace/repo`, and a pull request is that and its number, `workspace/repo#12`. The source rows,
// the content link recogniser, the reference panel, the task link, and the routes all use these.

export type PullRequestRef = { repository: string; number: string }

export const BITBUCKET_HOST = 'bitbucket.org'

export const formatPullRequestRef = (repository: string, number: string | number): string => `${repository}#${number}`

const REF = /^([^#\s/]+\/[^#\s/]+)#(\d+)$/

export function parsePullRequestRef(value: string): PullRequestRef | null {
  const match = REF.exec(value)
  return match ? { repository: match[1]!, number: match[2]! } : null
}

/** A pull request's page. */
export const pullRequestUrl = (repository: string, number: string | number) =>
  `https://${BITBUCKET_HOST}/${repository}/pull-requests/${number}`

// The browser handoff's grammar, so the pane, a content link, and the extension agree on which pages
// are pull requests.
export const PULL_REQUEST_PAGES = [
  `https://${BITBUCKET_HOST}/{workspace}/{repo}/pull-requests/{number}`,
  `https://${BITBUCKET_HOST}/{workspace}/{repo}/pull-requests/{number}/{tab}`,
]
const pages = PULL_REQUEST_PAGES.map((page) => compileContentLinkPattern(page))

/** The pull request a bitbucket.org address names, or null. */
export function parsePullRequestUrl(href: string): PullRequestRef | null {
  // A content link can carry a query or fragment, which the page grammar leaves out.
  const bare = href.split(/[?#]/)[0]!
  for (const page of pages) {
    const captures = page.match(bare)
    if (captures?.workspace && captures.repo && captures.number && /^\d+$/.test(captures.number))
      return { repository: `${captures.workspace}/${captures.repo}`, number: captures.number }
  }
  return null
}

/** Full names are case-insensitive on Bitbucket, and core stores them folded. */
export const sameRepository = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

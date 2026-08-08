import type { ContentLinkContribution } from '@acorn/plugin-api/client'

// Linear's URL recogniser. It used to live in plugins/github/src/client/contentLinks.ts, beside
// github's own two, because that is where the registry was — so the provider that owned the pattern
// was not the one that shipped it. The registry is core's now (finding 10), and this sits with the
// plugin that can actually answer for the URL.
const LINEAR_ISSUE_RE = /^https?:\/\/linear\.app\/[^/]+\/issue\/([A-Za-z][A-Za-z0-9]*-\d+)/i

export const linearContentLinkContribution: ContentLinkContribution = {
  id: 'linear.issue',
  parse: (href) => {
    const match = LINEAR_ISSUE_RE.exec(href)
    return match ? { kind: 'linear', identifier: match[1].toUpperCase() } : null
  },
}

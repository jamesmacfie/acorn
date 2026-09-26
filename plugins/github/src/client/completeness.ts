import type { PullTopologyCompleteness } from '../shared/api'

// What to tell the reader when GitHub's API limit cut a file list short. Null when the list is
// complete. Counts are the files received, never a claim about the ones GitHub did not send.
export function incompleteFilesMessage(completeness: PullTopologyCompleteness | undefined): string | null {
  if (!completeness || completeness.kind === 'complete') return null
  const received = completeness.received.toLocaleString('en-US')
  if (completeness.resource === 'compare-files') {
    return `GitHub shows only the first ${received} changed files of a comparison. This one may have more.`
  }
  if (completeness.reportedTotal != null) {
    return `GitHub returned ${received} of ${completeness.reportedTotal.toLocaleString('en-US')} changed files. The remaining files are outside the GitHub API limit.`
  }
  return `GitHub may have more changed files than the ${received} returned by its API.`
}

// A file count that does not read as exhaustive when it is not: "first 300 files" for a capped list.
export function fileCountLabel(count: number, completeness: PullTopologyCompleteness | undefined): string {
  const files = `${count.toLocaleString('en-US')} file${count === 1 ? '' : 's'}`
  return completeness?.kind === 'incomplete' ? `first ${files}` : files
}

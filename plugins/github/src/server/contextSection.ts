// The `pr` context section (docs/agent-tools/context-sections.md § Context sections). Its rows are this plugin's
// (`repos ⋈ pull_requests ⋈ pr_files` in github.sqlite), so its shape lives here rather than in core.
// Core keeps the assembly, the order and the byte ceiling.
import { pastedContent, truncateBytes, type PluginContextSection } from '@acorn/plugin-api/node'

export type ContextPullRequestSource = (
  userId: string,
  repoOwner: string,
  repoName: string,
  pullNumber: number,
) => Promise<{ number: number; title: string; body: string | null; changedFiles: string[] } | null>

export function pullRequestSection(source: ContextPullRequestSource): PluginContextSection {
  return {
    id: 'pr',
    order: 10,
    label: 'Pull request',
    defaultIncluded: false,
    budget: { maxItems: 1, maxBytesPerItem: 2_000, overflow: 'truncate-tail' },
    async assemble({ userLogin, task, github }) {
      if (task.pullNumber == null || !github) return { items: [] }
      const pr = await source(userLogin, github.owner, github.name, task.pullNumber)
      if (!pr) return { items: [] }
      const changedFiles = pr.changedFiles
      return {
        items: [{ id: `pr:${pr.number}`, kind: 'PR', label: `#${pr.number} ${pr.title}`, body: pr.body ?? undefined, details: changedFiles }],
      }
    },
    format(items) {
      const item = items[0]
      if (!item) return ''
      const lines = [`## PR ${item.label}`]
      // The body is the author's, not the reader's, so it is marked as text the model should not take
      // instructions from. Tags are stripped first, which also keeps a forged closing tag out.
      const body = item.body?.replace(/<[^>]+>/g, '').trim()
      if (body) lines.push(pastedContent(truncateBytes(body, 600)))
      const files = item.details ?? []
      if (files.length) {
        const shown = files.slice(0, 30)
        const more = files.length - shown.length
        lines.push(`Changed files (${files.length}): ${shown.join(', ')}${more > 0 ? `, +${more} more` : ''}`)
      }
      return lines.join('\n')
    },
  }
}

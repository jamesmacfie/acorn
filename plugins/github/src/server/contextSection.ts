// The `pr` context section (docs/agent-tools.md § Context sections). Its rows are this plugin's
// (`repos ⋈ pull_requests ⋈ pr_files` in github.sqlite), so its shape lives here rather than in core.
// Core keeps the assembly, the order and the byte ceiling.
import { truncateBytes, type PluginContextSection } from '@acorn/plugin-api/node'

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
      const compatibility = { number: pr.number, title: pr.title, body: pr.body, changedFiles }
      return {
        items: [{ id: `pr:${pr.number}`, kind: 'PR', label: `#${pr.number} ${pr.title}`, body: pr.body ?? undefined, details: changedFiles }],
        compatibility: { pr: compatibility },
      }
    },
    format(items) {
      const item = items[0]
      if (!item) return ''
      const lines = [`## PR ${item.label}`]
      const body = item.body?.replace(/<[^>]+>/g, '').trim()
      if (body) lines.push(truncateBytes(body, 600))
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

// The `notes` context section (docs/agent-tools.md § Context sections). The rows are this plugin's
// files, so its shape lives here rather than in core. Core keeps the assembly, the order and the
// byte ceiling.
import type { NoteAuthor, NoteScope } from '@acorn/protocol/notes.ts'
import { formatOmitted, type PluginContextSection } from '@acorn/plugin-api/node'

export type ContextNotesSource = (
  taskId: string,
  repo: string,
) => Promise<{ slug: string; scope: NoteScope; title: string; kind: string; body: string; author: NoteAuthor }[]>

export function notesSection(source: ContextNotesSource): PluginContextSection {
  return {
    id: 'notes',
    order: 30,
    label: 'Notes',
    defaultIncluded: true,
    budget: { maxItems: 10, maxBytesPerItem: 2_000, overflow: 'truncate-tail' },
    async assemble({ task, repo, workflowRunId }) {
      const allNotes = await source(task.id, repo)
      const notes = workflowRunId
        ? allNotes.filter((note) => !note.slug.startsWith('workflow-handoffs-') || note.slug === `workflow-handoffs-${workflowRunId}`)
        : allNotes
      return {
        items: notes.map((note) => ({ id: `${note.scope}:${note.slug}`, kind: note.kind, label: note.title, body: note.body, details: [note.scope], origin: { author: note.author } })),
        compatibility: { notes: notes.map((note) => ({ slug: note.slug, scope: note.scope, title: note.title, body: note.body })) },
      }
    },
    format(items, omitted) {
      if (!items.length) return ''
      return ['## Notes', ...items.flatMap((item) => [`### ${item.label}`, item.body?.trim() ?? ''])].join('\n') + formatOmitted(omitted)
    },
    jump: (item) => ({ pane: 'notes', itemId: item.id.slice(item.id.indexOf(':') + 1), noteScope: item.id.slice(0, item.id.indexOf(':')) as NoteScope }),
  }
}

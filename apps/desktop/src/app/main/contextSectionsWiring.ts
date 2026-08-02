import { buildContextSections, setContextSections } from '@acorn/node-core/server/agentTools/contextSections.ts'
import type { AppDatabase } from '@acorn/node-core/server/db/index.ts'
import type { NoteAuthor, NoteLocation, NoteScope } from '@acorn/protocol/notes.ts'
import { memoryIndexSlice } from '../../plugins/memory/main/memory'
import type { NotesStore } from '../../plugins/notes/main/notes'
import { loadTask, workspaceIdForRepo } from '@acorn/node-core/main/taskWorktree.ts'

export type ContextSectionsDeps = {
  db: AppDatabase
  notesStore: NotesStore
  reconciled(): Promise<void>
}

// Context contributions close over service-process stores once at composition time. The server route,
// compact formatter and renderer all consume their serialized result; no per-domain source setters.
export function wireContextSections({ db, notesStore, reconciled }: ContextSectionsDeps): void {
  setContextSections(
    buildContextSections({
      notes: async (taskId) => {
        const task = await loadTask(db, taskId)
        if (!task) return []
        const workspaceId = await workspaceIdForRepo(db, task.repoOwner, task.repoName)
        const locations: { scope: NoteScope; location: NoteLocation }[] = [
          { scope: 'task', location: { scope: 'task', taskId } },
          ...(workspaceId ? [{ scope: 'workspace' as const, location: { scope: 'workspace' as const, workspaceId } }] : []),
          { scope: 'global', location: { scope: 'global' } },
        ]
        const out: { slug: string; scope: NoteScope; title: string; kind: string; body: string; author: NoteAuthor }[] = []
        for (const { scope, location } of locations) {
          const summaries = await notesStore.list(location)
          for (const summary of summaries) {
            if (!summary.included) continue
            // Compatibility for pre-Phase-4 seeded workspace notes: keep the current task's rows,
            // exclude siblings. New task notes are isolated structurally by their directory.
            if (scope === 'workspace' && summary.originTaskId && summary.originTaskId !== taskId) continue
            const note = await notesStore.read(location, summary.slug).catch(() => null)
            // Skip empty notes (e.g. an untouched scratchpad): they'd contribute only a `### title`
            // header of noise. Covers all empty notes, not just scratchpads.
            if (note && note.body.trim()) out.push({ slug: summary.slug, scope, title: `${note.title} (${note.kind})`, kind: note.kind, body: note.body, author: note.author })
          }
        }
        return out
      },
      memory: async (_taskId, repo) => {
        await reconciled()
        return memoryIndexSlice(db, repo)
      },
    }),
  )
}

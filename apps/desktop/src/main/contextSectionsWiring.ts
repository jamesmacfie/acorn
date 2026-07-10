import { buildContextSections, setContextSections } from '../server/agentTools/contextSections'
import type { AppDatabase } from '../server/db'
import type { NoteLocation, NoteScope } from '../shared/notes'
import { memoryIndexSlice } from './memory'
import type { NotesStore } from './notes'
import { loadTask, workspaceConfigRow } from './taskWorktree'

export type ContextSectionsDeps = {
  db: AppDatabase
  notesStore: NotesStore
  reconciled(): Promise<void>
}

// Context contributions close over main-process stores once at composition time. The server route,
// compact formatter and renderer all consume their serialized result; no per-domain source setters.
export function wireContextSections({ db, notesStore, reconciled }: ContextSectionsDeps): void {
  setContextSections(
    buildContextSections({
      notes: async (taskId) => {
        const task = await loadTask(db, taskId)
        if (!task) return []
        const workspace = await workspaceConfigRow(db, task.repoOwner, task.repoName)
        const locations: { scope: NoteScope; location: NoteLocation }[] = [
          { scope: 'task', location: { scope: 'task', taskId } },
          ...(workspace ? [{ scope: 'workspace' as const, location: { scope: 'workspace' as const, workspaceId: workspace.id } }] : []),
          { scope: 'global', location: { scope: 'global' } },
        ]
        const out: { slug: string; scope: NoteScope; title: string; kind: string; body: string }[] = []
        for (const { scope, location } of locations) {
          const summaries = await notesStore.list(location)
          for (const summary of summaries) {
            if (!summary.included) continue
            // Compatibility for pre-Phase-4 seeded workspace notes: keep the current task's rows,
            // exclude siblings. New task notes are isolated structurally by their directory.
            if (scope === 'workspace' && summary.originTaskId && summary.originTaskId !== taskId) continue
            const note = await notesStore.read(location, summary.slug).catch(() => null)
            if (note) out.push({ slug: summary.slug, scope, title: `${note.title} (${note.kind})`, kind: note.kind, body: note.body })
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

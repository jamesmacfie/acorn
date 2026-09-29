import { lazy } from 'solid-js'
import type { PaneLayoutContribution } from '@acorn/plugin-api/client'
import { previewConfigured } from './configuredStore'

// The pane's registration, apart from what it draws: the plugin registers this before the first draw,
// and the pane itself only loads once a task opens it (docs/frontend.md § Startup budget).
const PreviewTaskPane = lazy(async () => ({ default: (await import('./PreviewTaskPane')).PreviewTaskPane }))

export const previewPaneContribution: PaneLayoutContribution = {
  id: 'preview', label: 'Browser preview', glyph: 'globe', description: 'Live preview of the app', order: 80,
  // The gate is the seam that actually backs the pane, not "am I the desktop" (docs/frontend.md §
  // The desktop gate audit). The pane is a WebContentsView the shell positions over the client, and
  // a desktop shell may ship without preview views — so a host that has not installed the group
  // never lists the pane at all, rather than listing it and then saying it cannot draw it.
  defaultChord: 'meta+shift+b', requires: { seam: 'preview' },
  // A task with no preview URL configured has nothing to draw here (./configuredStore.ts).
  when: (task) => previewConfigured(task.id),
  // `single`, so the pane inherits the host's frame, focus group and padding rules rather than the
  // `<section class="pane workspace-preview">` it used to write for itself.
  layout: 'single', regions: { body: PreviewTaskPane },
  minWidth: 320,
}

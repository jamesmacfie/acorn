import { lazy } from 'solid-js'
import type { PaneLayoutContribution } from '@acorn/plugin-api/client'
import { previewConfigured } from './configuredStore'

// The pane's registration, apart from what it draws: the plugin registers this before the first draw,
// and the pane itself only loads once a task opens it (docs/frontend/startup-budget.md § Startup budget).
const PreviewTaskPane = lazy(async () => ({ default: (await import('./PreviewTaskPane')).PreviewTaskPane }))

export const previewPaneContribution: PaneLayoutContribution = {
  id: 'preview',
  label: 'Preview',
  glyph: 'globe',
  description: 'The app running in this task',
  order: 80,
  defaultChord: 'meta+shift+b',
  // The gate is the seam that actually backs the pane, not "am I the desktop"
  // (docs/frontend/registries.md § Gates). The pane is a child webview the shell positions over the client, and
  // a desktop shell may ship without preview views — so a host that has not installed the group
  // never lists the pane at all, rather than listing it and then saying it cannot draw it.
  requires: { seam: 'preview' },
  // A native web view has no narrow form, so a phone's pane bar leaves the pane out.
  formFactor: ['desktop'],
  // A task with no preview URL configured has nothing to draw here (./configuredStore.ts).
  when: (task) => previewConfigured(task.id),
  // `single`, so the pane inherits the host's frame, focus group and padding rules.
  layout: 'single',
  regions: { body: PreviewTaskPane },
  minWidth: 320,
}

const PreviewPhonePane = lazy(() => import('./PreviewPhonePane'))

// The same app on a phone, in a frame the Node serves through the relay. The desktop's native view has no
// narrow form, and this has no desktop one, so each host draws the one that fits.
export const previewPhonePaneContribution: PaneLayoutContribution = {
  id: 'preview-phone',
  label: 'Preview',
  glyph: 'globe',
  description: 'The app running in this task',
  order: 80,
  requires: { plugin: 'preview' },
  formFactor: ['narrow'],
  when: (task) => previewConfigured(task.id),
  layout: 'single',
  regions: { body: PreviewPhonePane },
}

// Renderer broadcasts shared by the main-process IPC surfaces (split out of terminal.ts).
import { BrowserWindow } from 'electron'

// Per-tab status (idle/exited) is shown for sessions the renderer isn't attached to, so changes
// are broadcast as a content-free ping; the panel re-pulls term:list to get fresh meta.
export function broadcastStatus(): void {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('term:status')
}

// Workflow gate / run-done notices for the renderer bell (docs/next 14 P3); the memory-proposal
// gate reuses the same channel.
export function broadcastWorkflowNotice(taskId: string, kind: 'gate' | 'run-done', title: string): void {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('workflow:notice', { taskId, kind, title })
  broadcastStatus()
}

import type { NodePlugin } from '@acorn/plugin-api/node'

export const gitPlugin = (): NodePlugin => {
  let dispose: (() => void) | null = null
  return {
    name: 'git', label: 'Git',
    emits: [
      { verb: 'review-notes-changed', description: 'A task’s local review notes or delivery state changed' },
    ],
    // The Changes tab's review notes. The host resolves the chain from this module's own URL
    // (docs/data-layer/migrations.md § Migrations).
    migrationsModule: import.meta.url,
    async init(ctx) { dispose = await (await import('../server/registerGit')).registerGit(ctx) },
    // Capabilities and timers only; the host drains the SQLite handle right after this returns.
    dispose: () => dispose?.(),
  }
}

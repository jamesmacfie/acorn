import type { NodePlugin } from '@acorn/plugin-api/node'

export const gitPlugin = (): NodePlugin => {
  let dispose: (() => void) | null = null
  return {
    name: 'git', label: 'Git',
    async init(ctx) { dispose = await (await import('../server/registerGit')).registerGit(ctx) },
    dispose: () => dispose?.(),
  }
}

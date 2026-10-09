import { expect, it } from 'vitest'

it('loads the public task draft entrypoint with its browser dependencies', async () => {
  const draft = await import('@acorn/plugin-api/client/task-draft')
  expect(typeof draft.createTaskDraftStore).toBe('function')
})

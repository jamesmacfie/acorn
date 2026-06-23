export const pullsResource = (repoId: number, state: 'open' | 'closed') => `pulls:${repoId}:${state}`
export const prResource = (repoId: number, number: number) => `pr:${repoId}:${number}`
export const filesResource = (repoId: number, number: number) => `files:${repoId}:${number}`

import { clientEvents } from '@acorn/client-core/registries/clientEvents.ts'

export type FileScrollDetail = {
  routeKey: string
  path: string
}

export function routeKey(owner: string, repo: string, number: string): string {
  return `${owner}/${repo}#${number}`
}

export function requestFileScroll(detail: FileScrollDetail): void {
  clientEvents.emit('presentation:file-scroll', detail)
}

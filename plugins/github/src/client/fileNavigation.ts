import { clientEvents } from '@acorn/plugin-api/client'

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

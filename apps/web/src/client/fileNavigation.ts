export const FILE_SCROLL_EVENT = 'aacorn:file-scroll'

export type FileScrollDetail = {
  routeKey: string
  path: string
}

export function routeKey(owner: string, repo: string, number: string): string {
  return `${owner}/${repo}#${number}`
}

export function requestFileScroll(detail: FileScrollDetail): void {
  window.dispatchEvent(new CustomEvent<FileScrollDetail>(FILE_SCROLL_EVENT, { detail }))
}

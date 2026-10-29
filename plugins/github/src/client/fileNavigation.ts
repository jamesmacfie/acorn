export function routeKey(owner: string, repo: string, number: string): string {
  return `${owner}/${repo}#${number}`
}

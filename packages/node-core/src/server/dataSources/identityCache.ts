import type { DataSourceIdentity } from '@acorn/protocol/dataSources.ts'

type Entry = { updatedAt: number; answer: DataSourceIdentity }
const answers = new Map<string, Entry>()
const key = (pluginId: string, connectionId: string) => `${pluginId}:${connectionId}`

export function cachedSourceIdentity(pluginId: string, connectionId: string, updatedAt: number): DataSourceIdentity | undefined {
  const cached = answers.get(key(pluginId, connectionId))
  return cached?.updatedAt === updatedAt ? cached.answer : undefined
}

export function rememberSourceIdentity(pluginId: string, connectionId: string, updatedAt: number, answer: DataSourceIdentity): void {
  if (answers.size > 200) answers.clear()
  answers.set(key(pluginId, connectionId), { updatedAt, answer })
}

export function clearSourceIdentity(connectionId: string): void {
  for (const key of answers.keys()) if (key.endsWith(`:${connectionId}`)) answers.delete(key)
}

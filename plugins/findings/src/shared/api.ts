import type { FindingListOptions } from '../contract/records'

export const findingsListRoute = (taskId: string, options: FindingListOptions = {}): string => {
  const query = new URLSearchParams()
  if (options.cursor) query.set('cursor', options.cursor)
  if (options.limit !== undefined) query.set('limit', String(options.limit))
  if (options.state) query.set('state', options.state)
  const suffix = query.size ? `?${query}` : ''
  return `/v2/p/findings/tasks/${encodeURIComponent(taskId)}/observations${suffix}`
}

export const findingsGetRoute = (taskId: string, observationId: string): string =>
  `/v2/p/findings/tasks/${encodeURIComponent(taskId)}/observations/${encodeURIComponent(observationId)}`

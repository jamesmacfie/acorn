import { ApiError, apiError, writeJson } from '../apiClient'
import {
  type ConnectIntegrationRequest,
  type Integration,
  integrationRoute,
  integrationsRoute,
  integrationTestRoute,
} from '../../shared/api'

const post = <T>(url: string, body?: unknown): Promise<T> =>
  writeJson<T>(url, {
    method: 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

export const connectIntegration = (providerId: string, credentials: Record<string, string>) =>
  post<{ integration: Integration }>(
    integrationsRoute,
    { providerId, credentials } satisfies ConnectIntegrationRequest,
  )

export const rotateIntegration = (id: string, credentials: Record<string, string>) =>
  writeJson<{ integration: Integration }>(integrationRoute(id), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credentials }),
  })

export const testIntegration = (id: string) =>
  post<{ integration: Integration }>(integrationTestRoute(id))

export const setIntegrationDisabled = (id: string, disabled: boolean) =>
  writeJson<{ integration: Integration }>(integrationRoute(id), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ disabled }),
  })

export const deleteIntegration = async (id: string): Promise<void> => {
  const response = await fetch(integrationRoute(id), { method: 'DELETE' })
  if (!response.ok) throw new ApiError(await apiError(response, `${response.status}`), response.status)
}

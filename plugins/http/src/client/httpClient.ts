// Typed wrapper over the /api/http routes. Goes through core's readJson/writeJson so the CSRF
// envelope and ApiError decoding stay in one place.
import { readJson, writeJson } from '@acorn/client-core/apiClient.ts'
import {
  httpRequestRoute,
  httpRequestsRoute,
  httpSendRoute,
  httpVariableRoute,
  httpVariablesRoute,
  type HttpRequest,
  type HttpSendInput,
  type HttpVariable,
  type SendResult,
} from '../shared/model'

// The stored-request write shape retains `taskId` because it owns filing. Sending uses
// HttpSendInput instead, whose executionTaskId comes from the panel context.
export type RequestPayload = Omit<HttpRequest, 'id' | 'repoOwner' | 'repoName' | 'createdAt' | 'updatedAt'>

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export const listRequests = (owner: string, repo: string, taskId?: string): Promise<HttpRequest[]> =>
  readJson(`${httpRequestsRoute(owner, repo)}${taskId ? `?taskId=${encodeURIComponent(taskId)}` : ''}`)

export const createRequest = (owner: string, repo: string, body: RequestPayload): Promise<HttpRequest> =>
  writeJson(httpRequestsRoute(owner, repo), json('POST', body))

export const updateRequest = (owner: string, repo: string, id: string, body: RequestPayload): Promise<HttpRequest> =>
  writeJson(httpRequestRoute(owner, repo, id), json('PUT', body))

export const deleteRequest = async (owner: string, repo: string, id: string): Promise<void> => {
  const res = await fetch(httpRequestRoute(owner, repo, id), { method: 'DELETE' })
  if (!res.ok) throw new Error(`Could not delete request (${res.status})`)
}

export const listVariables = (owner: string, repo: string): Promise<HttpVariable[]> => readJson(httpVariablesRoute(owner, repo))

export const createVariable = (owner: string, repo: string, body: Omit<HttpVariable, 'id' | 'updatedAt'>): Promise<HttpVariable> =>
  writeJson(httpVariablesRoute(owner, repo), json('POST', body))

export const updateVariable = (owner: string, repo: string, id: string, body: Omit<HttpVariable, 'id' | 'updatedAt'>): Promise<HttpVariable> =>
  writeJson(httpVariableRoute(owner, repo, id), json('PUT', body))

export const deleteVariable = async (owner: string, repo: string, id: string): Promise<void> => {
  const res = await fetch(httpVariableRoute(owner, repo, id), { method: 'DELETE' })
  if (!res.ok) throw new Error(`Could not delete variable (${res.status})`)
}

export const sendRequest = (owner: string, repo: string, body: HttpSendInput): Promise<SendResult> =>
  writeJson(httpSendRoute(owner, repo), json('POST', body))

// The response body arrives base64'd so binary survives the JSON hop. Decode as UTF-8 for display;
// callers that know it's binary use the byte array.
export function decodeBody(bodyBase64: string): { text: string; bytes: Uint8Array } {
  const bytes = Uint8Array.from(atob(bodyBase64), (ch) => ch.charCodeAt(0))
  return { text: new TextDecoder().decode(bytes), bytes }
}

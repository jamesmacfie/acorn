// Typed wrapper over the /v2/p/http routes. Goes through core's readJson/writeJson so the CSRF
// envelope and ApiError decoding stay in one place.
import { readJson, sendJson, writeJson, type WriteInit } from '@acorn/client-core/apiClient.ts'
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
export type RequestPayload = Omit<HttpRequest, 'id' | 'projectId' | 'createdAt' | 'updatedAt'>

const json = (method: string, body: unknown): WriteInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export const listRequests = (projectId: string, taskId?: string): Promise<HttpRequest[]> =>
  readJson(`${httpRequestsRoute(projectId)}${taskId ? `?taskId=${encodeURIComponent(taskId)}` : ''}`)

export const createRequest = (projectId: string, body: RequestPayload): Promise<HttpRequest> =>
  writeJson(httpRequestsRoute(projectId), json('POST', body))

export const updateRequest = (projectId: string, id: string, body: RequestPayload): Promise<HttpRequest> =>
  writeJson(httpRequestRoute(projectId, id), json('PUT', body))

export const deleteRequest = (projectId: string, id: string): Promise<void> =>
  sendJson<void>(httpRequestRoute(projectId, id), { method: 'DELETE' }, 'Could not delete request')

export const listVariables = (projectId: string): Promise<HttpVariable[]> => readJson(httpVariablesRoute(projectId))

export const createVariable = (projectId: string, body: Omit<HttpVariable, 'id' | 'updatedAt'>): Promise<HttpVariable> =>
  writeJson(httpVariablesRoute(projectId), json('POST', body))

export const updateVariable = (projectId: string, id: string, body: Omit<HttpVariable, 'id' | 'updatedAt'>): Promise<HttpVariable> =>
  writeJson(httpVariableRoute(projectId, id), json('PUT', body))

export const deleteVariable = (projectId: string, id: string): Promise<void> =>
  sendJson<void>(httpVariableRoute(projectId, id), { method: 'DELETE' }, 'Could not delete variable')

export const sendRequest = (projectId: string, body: HttpSendInput): Promise<SendResult> =>
  writeJson(httpSendRoute(projectId), json('POST', body))

// The response body arrives base64'd so binary survives the JSON hop. Decode as UTF-8 for display;
// callers that know it's binary use the byte array.
export function decodeBody(bodyBase64: string): { text: string; bytes: Uint8Array } {
  const bytes = Uint8Array.from(atob(bodyBase64), (ch) => ch.charCodeAt(0))
  return { text: new TextDecoder().decode(bytes), bytes }
}

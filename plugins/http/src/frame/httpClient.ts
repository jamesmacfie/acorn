// Typed wrapper over the /v2/p/http routes, now over the frame bridge rather than core's fetch helpers.
//
// A frame has no network at all (`connect-src 'none'`), so there is no `readJson` to reach for and
// no CSRF envelope to share: every call is a message on the one MessagePort, and the host checks the
// path against this plugin's own namespace before forwarding it
// (client-core/plugins/frames/scopes.ts).
import { connect } from '@acorn/plugin-api/ui/sdk'
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

const api = async () => (await connect()).api

export const listRequests = async (projectId: string, taskId?: string): Promise<HttpRequest[]> =>
  (await api()).get(`${httpRequestsRoute(projectId)}${taskId ? `?taskId=${encodeURIComponent(taskId)}` : ''}`)

export const createRequest = async (projectId: string, body: RequestPayload): Promise<HttpRequest> =>
  (await api()).post(httpRequestsRoute(projectId), body)

export const updateRequest = async (projectId: string, id: string, body: RequestPayload): Promise<HttpRequest> =>
  (await api()).put(httpRequestRoute(projectId, id), body)

export const deleteRequest = async (projectId: string, id: string): Promise<void> => {
  await (await api()).del(httpRequestRoute(projectId, id))
}

export const listVariables = async (projectId: string): Promise<HttpVariable[]> =>
  (await api()).get(httpVariablesRoute(projectId))

export const createVariable = async (projectId: string, body: Omit<HttpVariable, 'id' | 'updatedAt'>): Promise<HttpVariable> =>
  (await api()).post(httpVariablesRoute(projectId), body)

export const updateVariable = async (projectId: string, id: string, body: Omit<HttpVariable, 'id' | 'updatedAt'>): Promise<HttpVariable> =>
  (await api()).put(httpVariableRoute(projectId, id), body)

export const deleteVariable = async (projectId: string, id: string): Promise<void> => {
  await (await api()).del(httpVariableRoute(projectId, id))
}

export const sendRequest = async (projectId: string, body: HttpSendInput): Promise<SendResult> =>
  (await api()).post(httpSendRoute(projectId), body)

// The response body arrives base64'd so binary survives the JSON hop. Decode as UTF-8 for display;
// callers that know it's binary use the byte array.
export function decodeBody(bodyBase64: string): { text: string; bytes: Uint8Array } {
  const bytes = Uint8Array.from(atob(bodyBase64), (ch) => ch.charCodeAt(0))
  return { text: new TextDecoder().decode(bytes), bytes }
}

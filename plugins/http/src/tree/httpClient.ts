// Typed wrapper over the /v1/p/http routes, over the frame bridge rather than core's fetch helpers.
//
// A frame has no network (`connect-src 'none'`), so there is no `readJson` and no CSRF envelope.
// Every call is a message on the mounted tree's bridge, and the host checks the path against this
// plugin's own namespace before forwarding it (client-core/host/frames/scopes.ts).
//
// Built from the bridge the tree was mounted with, never from module-level `connect()`. In a tree
// worker that one is the bundle's shared port, which the host refuses for any bundle whose SDK hands
// each tree its own bridge (client-core/host/tree/workerHost.ts).
import type { AcornBridge } from '@acorn/plugin-api/ui/sdk'
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

export type HttpClient = ReturnType<typeof httpClient>

export const httpClient = ({ api }: AcornBridge) => ({
  listRequests: (projectId: string, taskId?: string): Promise<HttpRequest[]> =>
    api.get(`${httpRequestsRoute(projectId)}${taskId ? `?taskId=${encodeURIComponent(taskId)}` : ''}`),

  createRequest: (projectId: string, body: RequestPayload): Promise<HttpRequest> =>
    api.post(httpRequestsRoute(projectId), body),

  updateRequest: (projectId: string, id: string, body: RequestPayload): Promise<HttpRequest> =>
    api.put(httpRequestRoute(projectId, id), body),

  deleteRequest: async (projectId: string, id: string): Promise<void> => {
    await api.del(httpRequestRoute(projectId, id))
  },

  listVariables: (projectId: string): Promise<HttpVariable[]> =>
    api.get(httpVariablesRoute(projectId)),

  createVariable: (projectId: string, body: Omit<HttpVariable, 'id' | 'updatedAt'>): Promise<HttpVariable> =>
    api.post(httpVariablesRoute(projectId), body),

  updateVariable: (projectId: string, id: string, body: Omit<HttpVariable, 'id' | 'updatedAt'>): Promise<HttpVariable> =>
    api.put(httpVariableRoute(projectId, id), body),

  deleteVariable: async (projectId: string, id: string): Promise<void> => {
    await api.del(httpVariableRoute(projectId, id))
  },

  sendRequest: (projectId: string, body: HttpSendInput): Promise<SendResult> =>
    api.post(httpSendRoute(projectId), body),
})

// The response body arrives base64'd so binary survives the JSON hop. Decode as UTF-8 for display;
// callers that know it's binary use the byte array.
export function decodeBody(bodyBase64: string): { text: string; bytes: Uint8Array } {
  const bytes = Uint8Array.from(atob(bodyBase64), (ch) => ch.charCodeAt(0))
  return { text: new TextDecoder().decode(bytes), bytes }
}

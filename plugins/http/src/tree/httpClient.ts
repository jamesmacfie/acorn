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

export function createHttpClient(captured: AcornBridge['api'] | (() => AcornBridge['api']), scope?: string, nodeId?: string) {
  const api = typeof captured === 'function' ? captured : () => captured

  const listRequests = async (projectId: string, taskId?: string, signal?: AbortSignal): Promise<HttpRequest[]> =>
    api().get(`${httpRequestsRoute(projectId)}${taskId ? `?taskId=${encodeURIComponent(taskId)}` : ''}`, { signal })

  const createRequest = async (projectId: string, body: RequestPayload, signal?: AbortSignal): Promise<HttpRequest> =>
    api().post(httpRequestsRoute(projectId), body, { signal })

  const updateRequest = async (projectId: string, id: string, body: RequestPayload, signal?: AbortSignal): Promise<HttpRequest> =>
    api().put(httpRequestRoute(projectId, id), body, { signal })

  const deleteRequest = async (projectId: string, id: string, signal?: AbortSignal): Promise<void> => {
    await api().del(httpRequestRoute(projectId, id), { signal })
  }

  const listVariables = async (projectId: string, signal?: AbortSignal): Promise<HttpVariable[]> =>
    api().get(httpVariablesRoute(projectId), { signal })

  const createVariable = async (projectId: string, body: Omit<HttpVariable, 'id' | 'updatedAt'>, signal?: AbortSignal): Promise<HttpVariable> =>
    api().post(httpVariablesRoute(projectId), body, { signal })

  const updateVariable = async (projectId: string, id: string, body: Omit<HttpVariable, 'id' | 'updatedAt'>, signal?: AbortSignal): Promise<HttpVariable> =>
    api().put(httpVariableRoute(projectId, id), body, { signal })

  const deleteVariable = async (projectId: string, id: string, signal?: AbortSignal): Promise<void> => {
    await api().del(httpVariableRoute(projectId, id), { signal })
  }

  const sendRequest = async (projectId: string, body: HttpSendInput, signal?: AbortSignal): Promise<SendResult> =>
    api().post(httpSendRoute(projectId), body, { signal })

  return { scope, nodeId, listRequests, createRequest, updateRequest, deleteRequest, listVariables, createVariable, updateVariable, deleteVariable, sendRequest }
}

// The response body arrives base64'd so binary survives the JSON hop. Decode as UTF-8 for display;
// callers that know it's binary use the byte array.
export function decodeBody(bodyBase64: string): { text: string; bytes: Uint8Array } {
  // HTML's forgiving base64 rules match atob: ASCII whitespace, optional padding, and loose
  // trailing bits. Native decoding also accepts URL alphabets unless validated here.
  let normalized = bodyBase64.replace(/[\t\n\f\r ]/g, '')
  if (normalized.length % 4 === 0) normalized = normalized.replace(/={1,2}$/, '')
  if (normalized.length % 4 === 1 || /[^A-Za-z0-9+/]/.test(normalized)) atob(bodyBase64)
  const native = (Uint8Array as typeof Uint8Array & { fromBase64?: (value: string) => Uint8Array }).fromBase64
  let bytes: Uint8Array
  if (native) bytes = native(normalized)
  else {
    const binary = atob(bodyBase64)
    bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  }
  return { text: new TextDecoder().decode(bytes), bytes }
}

export type HttpClient = ReturnType<typeof createHttpClient>

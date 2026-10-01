// Ownership belongs to the transport, rather than the public plugin API. A request context lends
// authority for one invocation; registration and lifecycle context values retain realm ownership.
const invocationValues = new WeakSet<object>()

export function invocationOwned<T extends object>(value: T): T {
  invocationValues.add(value)
  return value
}

export const isInvocationOwned = (value: object): boolean => invocationValues.has(value)

export type RpcFunctionLifetime = {
  scopedArguments?: boolean
  resultTerminal?: string
  persistentResult?: boolean
}

/** Published visitors finish before their host operation returns. All other callback arguments
 * retain realm ownership, including route registrations, subscriptions, and capabilities. */
export function pluginRpcFunctionLifetime(path: string, requestRoot?: string): RpcFunctionLifetime {
  if (requestRoot && path === `${requestRoot}.providers.withConnections`) return { scopedArguments: true, persistentResult: true }
  const contextMethod = path.match(/^plugin\.(?:init|ready)\.args\[0\]\.(.+)$/)?.[1]
  if (!contextMethod) return {}
  if (/^(?:providers\.withConnection|core\.secrets\.use(?:Optional)?|telemetry\.measure)$/.test(contextMethod)) {
    return { scopedArguments: true, persistentResult: true }
  }
  if (contextMethod === 'telemetry.startSpan') return { resultTerminal: 'end' }
  return {}
}

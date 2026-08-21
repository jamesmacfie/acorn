// "Saved HTTP requests" in the agent composer, as the two routes the manifest's `agentContexts`
// descriptor names (docs/http-client.md § Client).
//
// The rows here come straight out of this plugin's SQLite with the ciphertext already opened: real
// bearer tokens, real bodies, real variable values. The redaction lives in its own module with its
// own test rather than inline in a handler. The shape below is an allowlist: every field named is
// one a reader decided an agent may see. Adding a field is an explicit act.
//
// What the host does not let this file decide: `source` (bound from the plugin id), the capture
// time, and the byte measurement the 512 KiB composer ceiling is checked against. The only thing
// that can go wrong here is disclosure.
import { MAX_PLUGIN_AGENT_CONTEXT_OPTIONS } from '@acorn/protocol/agentContext.ts'
import type { AgentContextOption, PluginAgentContextSnapshotBody } from '@acorn/protocol/agentContext.ts'
import type { HttpRequest } from '../shared/model'

// The composer's option list is capped by the host's parser at 200; bound it here as well so a project
// with thousands of saved requests answers a list rather than one the host silently rejects whole.
export const MAX_CONTEXT_REQUESTS = MAX_PLUGIN_AGENT_CONTEXT_OPTIONS

export const requestOption = (request: HttpRequest): AgentContextOption => ({
  id: request.id,
  label: request.name,
  description: `${request.method} ${redactUrl(request.url)}`,
})

// A `{{NAME}}` reference and nothing else. That is the one query value worth keeping: it names a variable
// rather than carrying one, and it is the difference between "this endpoint takes a token" and the token.
const TEMPLATE_ONLY = /^\{\{[A-Za-z0-9_.-]+\}\}$/

/**
/**
 * The URL with its query values redacted and its keys kept.
 *
 * The path is shape and stays; a query value is data and does not, because `?token=sk-live-...` is a
 * perfectly ordinary way for someone to have saved a request, and there is no way to recognise which
 * literal is a secret. Keys survive, so an agent still learns the endpoint takes `token`.
 *
 * Stricter than the renderer contribution it replaced, which sent the whole URL and leaked exactly
 * this way (docs/third-party/README.md § "http has moved").
 *
 * String surgery rather than `new URL()`: the stored URL is frequently a template
 * (`{{BASE_URL}}/users`) and would not parse.
 */
export function redactUrl(url: string): string {
  const cut = url.indexOf('?')
  if (cut === -1) return url
  const [query, ...fragment] = url.slice(cut + 1).split('#')
  const redacted = query
    .split('&')
    .filter(Boolean)
    .map((pair) => {
      const eq = pair.indexOf('=')
      if (eq === -1) return pair
      const key = pair.slice(0, eq)
      const value = pair.slice(eq + 1)
      if (!value || TEMPLATE_ONLY.test(value)) return pair
      return `${key}=•••`
    })
    .join('&')
  const tail = fragment.length ? `#${fragment.join('#')}` : ''
  return `${url.slice(0, cut)}${redacted ? `?${redacted}` : ''}${tail}`
}

/**
/**
 * One saved request as markdown an agent can learn the API's shape from (docs/http-client.md §
 * Client). Method, URL, folder, auth mode, body mode, and header names survive; everything
 * credential-bearing does not.
 */
export const requestSnapshot = (request: HttpRequest): PluginAgentContextSnapshotBody => {
  const headerNames = request.headers.filter((header) => header.enabled).map((header) => header.name).join(', ')
  return {
    // Stable rather than time-stamped: the composer replaces a snapshot by contextId, so re-capturing
    // the same request should update it instead of attaching it twice. The host prefixes the plugin id.
    contextId: request.id,
    label: `HTTP · ${request.name}`,
    content: [
      `# Saved HTTP request: ${request.name}`,
      `- ${request.method} ${redactUrl(request.url)}`,
      `  folder: ${request.folder || '/'}; auth: ${request.auth.mode}; body: ${request.bodyMode}`,
      `  header names: ${headerNames || 'none'}`,
      '',
      'All authorization values, header values, variables and request bodies are redacted.',
    ].join('\n'),
    resourceId: request.id,
    provenance: 'Saved request metadata with credential-bearing fields redacted',
    deepLink: { pane: 'http' },
    freshness: 'live',
    sensitivity: 'private',
  }
}

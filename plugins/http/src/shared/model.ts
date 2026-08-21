export type KeyValue = { name: string; value: string; enabled: boolean }

export const httpMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const
export type HttpMethod = (typeof httpMethods)[number]

export const bodyModes = ['none', 'json', 'text', 'form'] as const
export type BodyMode = (typeof bodyModes)[number]

export type AuthConfig =
  | { mode: 'none' }
  | { mode: 'basic'; username: string; password: string }
  | { mode: 'bearer'; token: string }
  | { mode: 'apikey'; key: string; value: string; placement: 'header' | 'query' }

export const authModes = ['none', 'basic', 'bearer', 'apikey'] as const
export type AuthMode = AuthConfig['mode']

export type HttpRequest = {
  id: string
  // Project is the renderer identity. GitHub is an optional facet on the Project and is not a
  // second storage key for HTTP data.
  projectId: string
  folder: string // slash path, '' = tree root
  taskId: string | null // set = ad-hoc request owned by a task
  name: string
  method: string
  url: string
  headers: KeyValue[]
  bodyMode: BodyMode
  body: string
  auth: AuthConfig
  vars: Record<string, string>
  createdAt: number
  updatedAt: number
}

export type VariableKind = 'value' | 'secret' | 'command'
export const variableKinds = ['value', 'secret', 'command'] as const

// `value` is masked to '' by the server for secret rows: plaintext never reaches the renderer.
export type HttpVariable = {
  id: string
  name: string
  kind: VariableKind
  value: string
  enabled: boolean
  updatedAt: number
}

export type TimelineEntry = { label: string; detail: string }

// Sending has its own task context (docs/http-client.md § Data model): `taskId` says where an
// ad-hoc request is stored, `executionTaskId` says which task worktree supplies builtins and runs
// command variables.
export type HttpSendInput = Pick<HttpRequest, 'method' | 'url' | 'headers' | 'bodyMode' | 'body' | 'auth' | 'vars'> & {
  executionTaskId: string | null
}

export type SendSuccess = {
  ok: true
  status: number
  statusText: string
  url: string // final URL after any redirects
  redirected: boolean
  headers: [string, string][]
  bodyBase64: string
  size: number // bytes actually received
  truncated: boolean // body hit the size cap
  durationMs: number
  timeline: TimelineEntry[]
}

// `fetch` rejects only when no HTTP response exists (DNS, connection, TLS, timeout, and similar
// transport failures). HTTP 4xx/5xx responses are SendSuccess values and retain their body/headers.
export type SendFailure = {
  ok: false
  error: string
  code: string | null
  detail: string | null
  url: string
  durationMs: number
  timeline: TimelineEntry[]
}

export type SendResult = SendSuccess | SendFailure

const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g

export const interpolate = (input: string, vars: Record<string, string>): string =>
  input.replace(PLACEHOLDER, (match, name: string) => vars[name] ?? match)

export const missingVars = (input: string, vars: Record<string, string>): string[] => {
  const out: string[] = []
  for (const m of input.matchAll(PLACEHOLDER)) if (!(m[1] in vars)) out.push(m[1])
  return out
}

// --- auth ---------------------------------------------------------------------------------

export type AuthApplied = { headers: KeyValue[]; queryParams: KeyValue[] }

// btoa is Latin-1 only and throws on any character above U+00FF, so UTF-8 encode first. Buffer
// isn't an option here: this module also runs in the renderer.
const base64Utf8 = (s: string): string => {
  const bytes = new TextEncoder().encode(s)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

// One flat switch, modelled on Bruno's codegen path rather than its runtime path (which duplicates
// the same switch for collection-level and request-level auth and has drifted between them).
export function applyAuth(auth: AuthConfig): AuthApplied {
  switch (auth.mode) {
    case 'basic': {
      const token = base64Utf8(`${auth.username}:${auth.password}`)
      return { headers: [{ name: 'Authorization', value: `Basic ${token}`, enabled: true }], queryParams: [] }
    }
    case 'bearer':
      return { headers: [{ name: 'Authorization', value: `Bearer ${auth.token}`, enabled: true }], queryParams: [] }
    case 'apikey': {
      const kv: KeyValue = { name: auth.key, value: auth.value, enabled: true }
      return auth.placement === 'query' ? { headers: [], queryParams: [kv] } : { headers: [kv], queryParams: [] }
    }
    case 'none':
      return { headers: [], queryParams: [] }
  }
}

// --- query string -------------------------------------------------------------------------

// Split by hand rather than via `new URL`: a {{var}} placeholder is not a legal URL and the WHATWG
// parser percent-encodes the braces. Bruno hides placeholders behind a hash and restores them
// afterwards for the same reason.
export function splitUrl(url: string): { base: string; params: KeyValue[] } {
  const at = url.indexOf('?')
  if (at < 0) return { base: url, params: [] }
  const base = url.slice(0, at)
  const params = url
    .slice(at + 1)
    .split('&')
    .filter(Boolean)
    .map((pair) => {
      const eq = pair.indexOf('=')
      const name = eq < 0 ? pair : pair.slice(0, eq)
      const value = eq < 0 ? '' : pair.slice(eq + 1)
      return { name: decodeURIComponent(name), value: decodeURIComponent(value), enabled: true }
    })
  return { base, params }
}

export function joinUrl(base: string, params: KeyValue[]): string {
  const active = params.filter((p) => p.enabled && p.name)
  if (!active.length) return base
  // Leave {{var}} unencoded so the placeholder survives into the saved URL; everything else is
  // encoded normally.
  const enc = (s: string) =>
    s
      .split(/(\{\{[^}]*\}\})/)
      .map((part) => (part.startsWith('{{') ? part : encodeURIComponent(part)))
      .join('')
  return `${base}?${active.map((p) => `${enc(p.name)}=${enc(p.value)}`).join('&')}`
}

// --- curl ---------------------------------------------------------------------------------

const shellQuote = (s: string): string => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`)

export function toCurl(req: Pick<HttpRequest, 'method' | 'url' | 'headers' | 'bodyMode' | 'body' | 'auth'>): string {
  const { headers: authHeaders, queryParams } = applyAuth(req.auth)
  let url = req.url
  if (queryParams.length) {
    const { base, params } = splitUrl(req.url)
    url = joinUrl(base, [...params, ...queryParams])
  }
  const parts = [`curl -X ${req.method} ${shellQuote(url)}`]
  for (const h of [...req.headers, ...authHeaders]) {
    if (h.enabled && h.name) parts.push(`-H ${shellQuote(`${h.name}: ${h.value}`)}`)
  }
  const body = serializeBody(req.bodyMode, req.body)
  if (body !== undefined) parts.push(`-d ${shellQuote(body)}`)
  return parts.join(' \\\n  ')
}

// Value-taking curl flags we understand. Anything else is skipped (with its value, when it takes
// one) rather than guessed at.
const CURL_VALUE_FLAGS = new Set(['-X', '--request', '-H', '--header', '-d', '--data', '--data-raw', '--data-binary', '--data-ascii', '-u', '--user', '--url', '-A', '--user-agent', '-b', '--cookie', '-e', '--referer'])

export type ParsedCurl = { method: string; url: string; headers: KeyValue[]; bodyMode: BodyMode; body: string; auth: AuthConfig }

export function fromCurl(input: string): ParsedCurl | null {
  const tokens = tokenizeShell(input.replace(/\\\r?\n/g, ' '))
  if (!tokens.length || !/^curl$/i.test(tokens[0])) return null

  let method = ''
  let url = ''
  let body = ''
  const headers: KeyValue[] = []
  let auth: AuthConfig = { mode: 'none' }

  for (let i = 1; i < tokens.length; i++) {
    const tok = tokens[i]
    if (!tok.startsWith('-')) {
      if (!url) url = tok
      continue
    }
    // --header=value as well as --header value
    const eq = tok.indexOf('=')
    const flag = eq > 1 && tok.startsWith('--') ? tok.slice(0, eq) : tok
    const inlineValue = eq > 1 && tok.startsWith('--') ? tok.slice(eq + 1) : undefined
    if (!CURL_VALUE_FLAGS.has(flag)) continue // -L, --compressed, -k, -s, -i … nothing to carry over
    const value = inlineValue ?? tokens[++i] ?? ''

    switch (flag) {
      case '-X':
      case '--request':
        method = value.toUpperCase()
        break
      case '--url':
        url = value
        break
      case '-H':
      case '--header': {
        const colon = value.indexOf(':')
        if (colon > 0) headers.push({ name: value.slice(0, colon).trim(), value: value.slice(colon + 1).trim(), enabled: true })
        break
      }
      case '-A':
      case '--user-agent':
        headers.push({ name: 'User-Agent', value, enabled: true })
        break
      case '-b':
      case '--cookie':
        headers.push({ name: 'Cookie', value, enabled: true })
        break
      case '-e':
      case '--referer':
        headers.push({ name: 'Referer', value, enabled: true })
        break
      case '-u':
      case '--user': {
        const colon = value.indexOf(':')
        auth = { mode: 'basic', username: colon < 0 ? value : value.slice(0, colon), password: colon < 0 ? '' : value.slice(colon + 1) }
        break
      }
      default:
        body = body ? `${body}&${value}` : value // -d and friends concatenate, as curl does
    }
  }

  if (!url) return null
  const contentType = headers.find((h) => h.name.toLowerCase() === 'content-type')?.value ?? ''
  const bodyMode: BodyMode = !body ? 'none' : contentType.includes('form-urlencoded') ? 'form' : looksLikeJson(body) || contentType.includes('json') ? 'json' : 'text'
  return {
    method: method || (body ? 'POST' : 'GET'),
    url,
    headers,
    bodyMode,
    body: bodyMode === 'form' ? JSON.stringify(splitUrl(`?${body}`).params) : body,
    auth,
  }
}

const looksLikeJson = (s: string): boolean => {
  const t = s.trim()
  if (!t.startsWith('{') && !t.startsWith('[')) return false
  try {
    JSON.parse(t)
    return true
  } catch {
    return false
  }
}

// Minimal POSIX-ish tokenizer: single quotes are literal, double quotes honour backslash escapes,
// unquoted backslash escapes the next character. Enough for pasted curl commands; it is not a shell.
export function tokenizeShell(input: string): string[] {
  const out: string[] = []
  let cur = ''
  let quote: "'" | '"' | null = null
  let started = false
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    if (quote === "'") {
      if (ch === "'") quote = null
      else cur += ch
    } else if (quote === '"') {
      if (ch === '"') quote = null
      else if (ch === '\\' && i + 1 < input.length) cur += input[++i]
      else cur += ch
    } else if (ch === "'" || ch === '"') {
      quote = ch
      started = true
    } else if (ch === '\\' && i + 1 < input.length) {
      cur += input[++i]
      started = true
    } else if (/\s/.test(ch)) {
      if (started) out.push(cur)
      cur = ''
      started = false
    } else {
      cur += ch
      started = true
    }
  }
  if (started) out.push(cur)
  return out
}

// --- body ---------------------------------------------------------------------------------

// Returns undefined when there is no body to send at all.
export function serializeBody(mode: BodyMode, body: string): string | undefined {
  if (mode === 'none' || !body) return undefined
  if (mode !== 'form') return body
  const pairs = parseFormBody(body)
  return pairs
    .filter((p) => p.enabled && p.name)
    .map((p) => `${encodeURIComponent(p.name)}=${encodeURIComponent(p.value)}`)
    .join('&')
}

export function parseFormBody(body: string): KeyValue[] {
  try {
    const parsed: unknown = JSON.parse(body || '[]')
    return Array.isArray(parsed) ? (parsed as KeyValue[]) : []
  } catch {
    return []
  }
}

export const defaultContentType = (mode: BodyMode): string | null => {
  switch (mode) {
    case 'json':
      return 'application/json'
    case 'text':
      return 'text/plain'
    case 'form':
      return 'application/x-www-form-urlencoded'
    case 'none':
      return null
  }
}

// --- routes -------------------------------------------------------------------------------

const projectScope = (projectId: string) => `/v2/p/http/projects/${encodeURIComponent(projectId)}`
export const httpRequestsRoute = (projectId: string): string => `${projectScope(projectId)}/requests`
export const httpRequestRoute = (projectId: string, id: string): string => `${projectScope(projectId)}/requests/${encodeURIComponent(id)}`
export const httpVariablesRoute = (projectId: string): string => `${projectScope(projectId)}/vars`
export const httpVariableRoute = (projectId: string, id: string): string => `${projectScope(projectId)}/vars/${encodeURIComponent(id)}`
export const httpSendRoute = (projectId: string): string => `${projectScope(projectId)}/send`

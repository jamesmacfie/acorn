// Shared host grammar and URL policy for host-owned plugin webviews. The manifest parser, renderer
// broker and Electron redirect guard all call this independently; changing the grant in one layer
// therefore cannot silently widen another.
export const WEBVIEW_HOST_MAX_LENGTH = 253
export const WEBVIEW_HOST_MAX_COUNT = 32

const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i
const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1'])

const unbracket = (host: string): string => host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host

export function normalizeWebviewHost(pattern: string): string {
  if (!pattern.length || pattern.length > WEBVIEW_HOST_MAX_LENGTH) {
    throw new Error(`webview host must be 1-${WEBVIEW_HOST_MAX_LENGTH} characters`)
  }
  const lowered = pattern.toLowerCase()
  const wildcard = lowered.startsWith('*.')
  const rawHost = wildcard ? lowered.slice(2) : lowered
  const host = unbracket(rawHost)
  if (!host || host.includes('*') || /[/?#@]/.test(host)) throw new Error('webview host is not a literal host')
  if (LOOPBACK.has(host)) {
    if (wildcard) throw new Error('loopback webview hosts cannot use a wildcard')
    return host
  }
  if (IPV4.test(host)) {
    if (wildcard || host.split('.').some((part) => Number(part) > 255)) throw new Error('webview host has an invalid IPv4 address')
    return host
  }
  if (!host.includes('.') || host.split('.').some((label) => !HOST_LABEL.test(label))) {
    throw new Error('webview host has an invalid literal host')
  }
  return wildcard ? `*.${host}` : host
}

export const isLoopbackWebviewHost = (hostname: string): boolean => LOOPBACK.has(unbracket(hostname.toLowerCase()))

export function webviewHostMatches(hostname: string, pattern: string): boolean {
  let normalized: string
  try {
    normalized = normalizeWebviewHost(pattern)
  } catch {
    return false
  }
  const candidate = unbracket(hostname.toLowerCase())
  if (!normalized.startsWith('*.')) return candidate === normalized
  const suffix = normalized.slice(2)
  return candidate === suffix || candidate.endsWith(`.${suffix}`)
}

export function isAllowedWebviewUrl(value: string, hosts: readonly string[]): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.username || url.password) return false
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopbackWebviewHost(url.hostname))) return false
  return hosts.some((host) => webviewHostMatches(url.hostname, host))
}

// Preview-browser page-rule helpers (docs/panes.md): JSON parse/validate for the workspaces
// `browser_rules` column and the URL matcher. Pure — shared by the Hono PATCH route (validate on
// write), the main-process preview service (parse + match on page load), and the settings editor.
import type { BrowserRule } from './api'

// Validate a renderer-supplied rule at the route boundary (and filter stored rows on read).
export function isValidBrowserRule(v: unknown): v is BrowserRule {
  if (!v || typeof v !== 'object') return false
  const r = v as Partial<BrowserRule>
  if (typeof r.id !== 'string' || !r.id) return false
  if (typeof r.enabled !== 'boolean') return false
  if (typeof r.urlPattern !== 'string' || !r.urlPattern.trim()) return false
  if (r.trigger !== 'load') return false
  const a = r.action
  return !!a && a.type === 'fill' && typeof a.selector === 'string' && !!a.selector.trim() && typeof a.value === 'string'
}

// Defensive parse — a malformed DB value degrades to [] rather than throwing into a route.
export function parseBrowserRules(text: string | null | undefined): BrowserRule[] {
  if (!text) return []
  try {
    const v = JSON.parse(text)
    return Array.isArray(v) ? v.filter(isValidBrowserRule) : []
  } catch {
    return []
  }
}

// Substring match against the full page URL; '*' is a wildcard, and a trailing '$' anchors to the
// end of the URL (so 'localhost:3000/$' — or '*/$' when the host/port varies — matches only root,
// not '/login'). Otherwise the pattern matches anywhere in the URL.
export function matchesUrlPattern(url: string, pattern: string): boolean {
  const p = pattern.trim()
  if (!p) return false
  const anchored = p.endsWith('$')
  const body = anchored ? p.slice(0, -1) : p
  if (!body) return false
  if (!body.includes('*')) return anchored ? url.endsWith(body) : url.includes(body)
  const re = body.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')
  return new RegExp(anchored ? `(?:${re})$` : re).test(url)
}

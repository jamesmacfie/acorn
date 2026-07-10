import type { ToolRisk } from './api'

export type { ToolRisk }
export type ToolCeiling = { allow?: string[]; maxRisk?: ToolRisk }

export const RISK_ORDER: Record<ToolRisk, number> = { read: 0, write: 1, execute: 2 }

export function normalizeToolCeiling(ceiling: ToolCeiling | undefined): ToolCeiling {
  const allow = ceiling?.allow ? [...new Set(ceiling.allow.map((value) => value.trim()).filter(Boolean))] : undefined
  return { ...(allow ? { allow } : {}), ...(ceiling?.maxRisk ? { maxRisk: ceiling.maxRisk } : {}) }
}

export function riskWithinCeiling(risk: ToolRisk, ceiling: ToolCeiling | undefined): boolean {
  return !ceiling?.maxRisk || RISK_ORDER[risk] <= RISK_ORDER[ceiling.maxRisk]
}

// The one allowlist + risk check every ceiling consumer (workflow engine, MCP projection, tool
// routes) must agree on.
export function isToolWithinCeiling(tool: { name: string; risk: ToolRisk }, ceiling: ToolCeiling | undefined): boolean {
  const normalized = normalizeToolCeiling(ceiling)
  if (normalized.allow && !normalized.allow.includes(tool.name)) return false
  return riskWithinCeiling(tool.risk, normalized)
}

export function encodeToolCeiling(ceiling: ToolCeiling): string {
  return Buffer.from(JSON.stringify(normalizeToolCeiling(ceiling)), 'utf8').toString('base64url')
}

export function decodeToolCeiling(raw: string | undefined): ToolCeiling | undefined {
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as ToolCeiling
    if (!parsed || typeof parsed !== 'object') return undefined
    if (parsed.maxRisk && !['read', 'write', 'execute'].includes(parsed.maxRisk)) return undefined
    if (parsed.allow && (!Array.isArray(parsed.allow) || parsed.allow.some((id) => typeof id !== 'string'))) return undefined
    return normalizeToolCeiling(parsed)
  } catch {
    return undefined
  }
}

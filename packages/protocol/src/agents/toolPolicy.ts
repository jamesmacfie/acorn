import type { ToolRisk } from '../transport/api'
import { z } from 'zod'

export type { ToolRisk }
export type ToolCeiling = { allow?: string[]; maxRisk?: ToolRisk }
export const toolCeilingSchema = z.object({
  allow: z.array(z.string()).optional(),
  maxRisk: z.enum(['read', 'write', 'execute']).optional(),
})

export const RISK_ORDER: Record<ToolRisk, number> = { read: 0, write: 1, execute: 2 }

export function normalizeToolCeiling(ceiling: ToolCeiling | undefined): ToolCeiling {
  const allow = ceiling?.allow ? [...new Set(ceiling.allow.map((value) => value.trim()).filter(Boolean))] : undefined
  return { ...(allow ? { allow } : {}), ...(ceiling?.maxRisk ? { maxRisk: ceiling.maxRisk } : {}) }
}

/** Parse an untrusted persisted or transport value into the one normalized ceiling shape. */
export function parseToolCeiling(value: unknown): ToolCeiling | undefined {
  const parsed = toolCeilingSchema.safeParse(value)
  return parsed.success ? normalizeToolCeiling(parsed.data) : undefined
}

function riskWithinCeiling(risk: ToolRisk, ceiling: ToolCeiling | undefined): boolean {
  return !ceiling?.maxRisk || RISK_ORDER[risk] <= RISK_ORDER[ceiling.maxRisk]
}

// The one allowlist + risk check every ceiling consumer (workflow engine, MCP projection, tool
// routes) must agree on.
export function isToolWithinCeiling(tool: { name: string; risk: ToolRisk }, ceiling: ToolCeiling | undefined): boolean {
  const normalized = normalizeToolCeiling(ceiling)
  if (normalized.allow && !normalized.allow.includes(tool.name)) return false
  return riskWithinCeiling(tool.risk, normalized)
}

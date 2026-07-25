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

// --- renderer-side projections of the workflow rows ---
// These mirror the persisted rows (plugins/workflows/main/workflowContracts.ts derives its own from
// drizzle) but are declared structurally so the renderer never imports a node-side module. They live
// in core/shared because both the workflows and agents features read them.

// A committed/user workflow definition as loadWorkflowFiles returns it (docs/workflows.md): what the
// palette launches and the settings inspector lists. `source` is the layer it was found in.
export type WorkflowDefSummary = {
  id: string
  name: string
  source: 'repo' | 'user'
  posture?: 'gated' | 'autonomous'
  steps: { name: string; kind?: string }[]
}

export type WorkflowRunRow = {
  id: string
  taskId: string
  name: string
  status: 'running' | 'gated' | 'cancelling' | 'done' | 'failed' | 'safety-rail' | 'cancelled'
  posture: string
  error: string | null
  createdAt: number
  updatedAt: number
}

export type WorkflowStepRow = {
  id: string
  runId: string
  idx: number
  name: string
  kind: string
  mode: string
  profileId: string | null
  model: string | null
  status: 'pending' | 'running' | 'waiting-gate' | 'done' | 'failed' | 'skipped' | 'safety-rail' | 'cancelled'
  resultJson: string | null
  structuredJson: string | null
  sessionId: string | null
  costUsd: number | null
  iteration: number
  error: string | null
  createdAt: number
  updatedAt: number
  resumeCommand?: string | null
}

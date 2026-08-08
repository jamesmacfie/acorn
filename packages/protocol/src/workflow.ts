import type { ToolRisk } from './api'
import { z } from 'zod'

export type { ToolRisk }
export type ToolCeiling = { allow?: string[]; maxRisk?: ToolRisk }
const toolCeilingSchema = z.object({
  allow: z.array(z.string()).optional(),
  maxRisk: z.enum(['read', 'write', 'execute']).optional(),
})

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

// base64url via web-standard APIs rather than Buffer. Protocol is the one package both runtimes
// import, so it may not depend on Node globals — today's callers happen to be node-side, but a
// renderer importing this would have hit `Buffer is not defined` at runtime. btoa/atob and
// TextEncoder/TextDecoder exist in both Node and the browser.
function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(raw: string): string {
  const b64 = raw.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '='))
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

export function encodeToolCeiling(ceiling: ToolCeiling): string {
  return toBase64Url(JSON.stringify(normalizeToolCeiling(ceiling)))
}

export function decodeToolCeiling(raw: string | undefined): ToolCeiling | undefined {
  if (!raw) return undefined
  try {
    const parsed = toolCeilingSchema.safeParse(JSON.parse(fromBase64Url(raw)))
    return parsed.success ? normalizeToolCeiling(parsed.data) : undefined
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
  agentSessionId: string | null
  costUsd: number | null
  iteration: number
  error: string | null
  createdAt: number
  updatedAt: number
  resumeCommand?: string | null
}

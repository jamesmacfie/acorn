import { normalizeToolCeiling, RISK_ORDER, type ToolCeiling, type ToolRisk } from '../../../core/shared/workflow'
export { decodeToolCeiling, encodeToolCeiling, isToolWithinCeiling } from '../../../core/shared/workflow'

export function narrowsToolCeiling(parent: ToolCeiling | undefined, child: ToolCeiling | undefined): boolean {
  if (!child) return true
  const p = normalizeToolCeiling(parent)
  const c = normalizeToolCeiling(child)
  if (p.allow && c.allow?.some((id) => !p.allow!.includes(id))) return false
  if (p.maxRisk && c.maxRisk && RISK_ORDER[c.maxRisk] > RISK_ORDER[p.maxRisk]) return false
  return true
}

export function intersectToolCeilings(...ceilings: (ToolCeiling | undefined)[]): ToolCeiling {
  let allow: string[] | undefined
  let maxRisk: ToolRisk | undefined
  for (const raw of ceilings) {
    const ceiling = normalizeToolCeiling(raw)
    if (ceiling.allow) allow = allow ? allow.filter((id) => ceiling.allow!.includes(id)) : ceiling.allow
    if (ceiling.maxRisk && (!maxRisk || RISK_ORDER[ceiling.maxRisk] < RISK_ORDER[maxRisk])) maxRisk = ceiling.maxRisk
  }
  return { ...(allow ? { allow } : {}), ...(maxRisk ? { maxRisk } : {}) }
}

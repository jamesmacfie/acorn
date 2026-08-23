import { z } from 'zod'

// What a contributed harness's optional probe routes answer with (docs/plugin-authoring.md § Harnesses).
//
// Parsed, not cast: a plugin's own node half wrote these bytes, and the host hands them over as
// `unknown` (node-core/server/plugin/harnesses.ts), so this is the boundary that checks them.
//
// Both shapes are narrower than what the built-in probes produce, on purpose. `cost` needs the owner's
// pricing table and `daily` comes out of one specific CLI's JSONL, so neither is a harness's to answer.
// acorn derives the health and the capture time from what is left.

export const harnessUsageProbeSchema = z.object({
  plan: z.string().max(120).nullish(),
  quotas: z.array(z.object({
    // Use `session` for the one the compact indicator shows; anything else is a second row in the pane.
    id: z.string().min(1).max(64),
    label: z.string().min(1).max(80),
    percentRemaining: z.number(),
    // A timestamp when the harness knows one, otherwise the sentence it would print. acorn prefers the
    // timestamp and turns it into a live countdown.
    resetsAt: z.number().int().nullish(),
    resetText: z.string().max(200).nullish(),
  })).max(8).default([]),
  account: z.object({
    email: z.string().max(320).nullish(),
    organization: z.string().max(200).nullish(),
  }).nullish(),
})

export const harnessAuthProbeSchema = z.object({
  // `null` means "cannot tell", which the health row shows differently from `false`.
  authenticated: z.boolean().nullish(),
  diagnostic: z.string().max(200).optional(),
})

export type HarnessUsageProbeAnswer = z.infer<typeof harnessUsageProbeSchema>
export type HarnessAuthProbeAnswer = z.infer<typeof harnessAuthProbeSchema>

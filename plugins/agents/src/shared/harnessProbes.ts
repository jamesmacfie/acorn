import { z } from 'zod'

// What a contributed harness's optional probe routes answer with (docs/plugin-authoring.md § Harnesses).
//
// Parsed rather than cast, because these are bytes a plugin's own node half wrote: the host fetched
// them and deliberately handed them over as `unknown` (node-core/server/plugin/harnesses.ts), so this
// is the boundary that has to check them.
//
// Both shapes are narrower than what the built-in probes produce, and that is the point. `cost` needs
// the owner's pricing table and `daily` is read out of one specific CLI's JSONL; neither is something a
// harness can answer about itself. What is left — the plan name and how much of each quota remains — is
// what a plan-usage display is actually made of, and acorn derives the health and the capture time.

export const harnessUsageProbeSchema = z.object({
  plan: z.string().max(120).nullish(),
  quotas: z.array(z.object({
    // Use `session` for the one the compact indicator shows; anything else is a second row in the pane.
    id: z.string().min(1).max(64),
    label: z.string().min(1).max(80),
    percentRemaining: z.number(),
    // A timestamp when the harness knows one, otherwise the sentence it would print. Acorn prefers the
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
  // `null` for "cannot tell", which is different from `false` and reads differently in the health row.
  authenticated: z.boolean().nullish(),
  diagnostic: z.string().max(200).optional(),
})

export type HarnessUsageProbeAnswer = z.infer<typeof harnessUsageProbeSchema>
export type HarnessAuthProbeAnswer = z.infer<typeof harnessAuthProbeSchema>

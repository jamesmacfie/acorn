import AgentConcurrencySettings from './AgentConcurrencySettings'
import AgentPricingSettings from './AgentPricingSettings'

// Settings → Agents → Limits and cost: how many turns this node runs at once, and what it prices a
// turn at. Two pages until the settings redesign, one now, because both answer how much agents may
// spend. The old ids `agent-concurrency` and `agent-pricing` are aliases on the registration in
// `../index.ts`, so a link to either still lands on its section here. Each half keeps its own reads and
// writes; this file only puts them on one page.
export default function AgentLimitsSettings() {
  return (
    <>
      <AgentConcurrencySettings />
      <AgentPricingSettings />
    </>
  )
}

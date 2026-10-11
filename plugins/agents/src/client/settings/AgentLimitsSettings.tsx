import AgentConcurrencySettings from './AgentConcurrencySettings'
import AgentPricingSettings from './AgentPricingSettings'

// Settings → Agents → Limits and cost: how many turns this node runs at once, and what it prices a
// turn at, on one page because both answer how much agents may spend. Each half keeps its own reads and
// writes; this file only puts them on one page.
export default function AgentLimitsSettings() {
  return (
    <>
      <AgentConcurrencySettings />
      <AgentPricingSettings />
    </>
  )
}

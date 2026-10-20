import { createSignal, Show } from 'solid-js'
import type { DatasetSummary } from '@acorn/protocol/datasets.ts'
import { readJson } from '../../infra/node/apiClient'
import { clientCapability } from '../../infra/node/clientCapabilities'
import { Button } from '../../kit/components/primitives'
import { Inline } from '../../kit/components/layout/Inline'
import { Text } from '../../kit/components/content/Text'
import { toast } from '../notifications/toast'
import { refreshPrompt } from './keepUpdated'
import { AGENT_ASK } from './refreshCapabilities'

/** A panel over a dataset an agent keeps up to date: when it last wrote rows, and a way to ask for fresh
 *  ones in the task that kept it (docs/dashboards/supplied-rows.md § Keeping it up to date). */
export default function KeptOrigin(props: {
  nodeId: string | null
  workspaceId: string
  datasetId: string
  refreshedAt?: number
}) {
  const agents = clientCapability(AGENT_ASK)
  const [asking, setAsking] = createSignal(false)
  const refreshed = () =>
    props.refreshedAt === undefined
      ? 'Kept up to date by an agent'
      : `Refreshed by an agent, ${new Date(props.refreshedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`
  const ask = async () => {
    setAsking(true)
    try {
      const { datasets } = await readJson<{ datasets: DatasetSummary[] }>(
        `/v1/core/datasets?workspaceId=${encodeURIComponent(props.workspaceId)}`,
        { nodeId: props.nodeId },
      )
      const dataset = datasets.find((item) => item.id === props.datasetId)
      if (!dataset?.refresh) throw new Error("This dataset doesn't name a task to ask.")
      await agents!.ask({
        taskId: dataset.refresh.taskId,
        title: `Refresh ${dataset.name}`,
        prompt: refreshPrompt(dataset.id, dataset.name, dataset.refresh.origin),
      })
      toast(`Asked an agent to refresh ${dataset.name}.`)
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't ask an agent. Try again.", { tone: 'danger' })
    } finally {
      setAsking(false)
    }
  }
  return (
    <Inline spread>
      <Text tone="muted" wrap>
        {refreshed()}
      </Text>
      <Show when={agents}>
        <Button size="xs" variant="ghost" busy={asking()} onPress={() => void ask()}>
          Ask an agent to refresh
        </Button>
      </Show>
    </Inline>
  )
}

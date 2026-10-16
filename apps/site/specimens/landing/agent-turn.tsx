import { Card, Stack, Text } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimen'

export const meta: SpecimenMeta = {
  title: 'An agent turn',
  caption: "An agent's steps in the task's worktree, one card each.",
  terminal: { columns: 60, rows: 14 },
  width: 480,
}

// Cards in a Stack, not a Timeline: the kit's Timeline puts cards straight inside an `ol`, which axe
// refuses, and the landing page's accessibility check covers its specimens.
export default function AgentTurn() {
  return (
    <Stack gap="row">
      <Card>
        <Text>Read billing/webhooks/deliver.py</Text>
      </Card>
      <Card>
        <Text>Changed billing/webhooks/backoff.py</Text>
      </Card>
      <Card>
        <Text>Ran uv run pytest tests/test_deliver.py: 4 passed</Text>
      </Card>
    </Stack>
  )
}

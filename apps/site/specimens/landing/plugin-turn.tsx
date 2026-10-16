import { Badge, Card, Inline, Stack, Text } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimen'

export const meta: SpecimenMeta = {
  title: 'An agent writing a plugin',
  caption: "An agent's turn after you ask for a pane that lists the task's TODO comments.",
  terminal: { columns: 60, rows: 19 },
  width: 480,
}

// The steps docs/plugins/agent-install.md describes, in the files `npm create acorn-plugin` writes.
// Cards in a Stack, as in agent-turn.tsx, for the same accessibility reason. A card's text is one line,
// so each step stays short.
export default function PluginTurn() {
  return (
    <Stack gap="row">
      <Card>
        <Text>Called plugin_authoring</Text>
      </Card>
      <Card>
        <Text>Wrote todo-comments/acorn-plugin.json</Text>
      </Card>
      <Card>
        <Text>Wrote todo-comments/client.js</Text>
      </Card>
      <Card>
        <Inline gap="inline">
          <Text>Asked to install todo-comments</Text>
          <Badge tone="warn">waiting for you</Badge>
        </Inline>
      </Card>
    </Stack>
  )
}

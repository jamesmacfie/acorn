import { For } from 'solid-js'
import { Card, Stack, Text } from '@acorn/plugin-api/ui'

// The pictures under the welcome step's two answers. Made-up projects, the same three in both, so
// the only difference between the pictures is the grouping.
const PROJECTS = ['storefront-web', 'payments-api', 'marketing-site']
const WORKSPACES = [
  { name: 'Northwind Shop', projects: ['storefront-web', 'payments-api'] },
  { name: 'Marketing', projects: ['marketing-site'] },
]

const ProjectBox = (props: { name: string }) => (
  <Card pad="sm">
    <Text>{props.name}</Text>
  </Card>
)

export function SeparateProjects() {
  return (
    <Stack gap="row">
      <For each={PROJECTS}>{(name) => <ProjectBox name={name} />}</For>
    </Stack>
  )
}

export function GroupedProjects() {
  return (
    <Stack gap="row">
      <For each={WORKSPACES}>
        {(workspace) => (
          <Card pad="sm">
            <Stack gap="row">
              <Text emphasis="strong">{workspace.name}</Text>
              <For each={workspace.projects}>{(name) => <ProjectBox name={name} />}</For>
            </Stack>
          </Card>
        )}
      </For>
    </Stack>
  )
}

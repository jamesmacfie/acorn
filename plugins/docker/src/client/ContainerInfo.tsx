import { For, Show } from 'solid-js'
import {
  Button,
  Chip,
  ChipRow,
  Facts,
  Section,
  Stack,
  Table,
  TableCell,
  TableHead,
  TableRow,
  Text,
} from '@acorn/plugin-api/ui'
import type { DockerContainerDetail, DockerPort } from '../shared/model'

export default function ContainerInfo(props: {
  detail: DockerContainerDetail
  showEnv: boolean
  onToggleEnv(): void
  onCopyPort(port: DockerPort): void
}) {
  const d = () => props.detail
  return (
    <Stack gap="section">
      <Section label="Container">
        <Facts
          grouping="rows"
          items={[
            { label: 'ID', value: d().id, mono: true },
            { label: 'Image', value: d().image, mono: true },
            { label: 'Command', value: d().command, mono: true },
            {
              label: 'State',
              value: `${d().state}${d().exitCode !== null && d().state === 'exited' ? ` (exit ${d().exitCode})` : ''}`,
            },
            ...(d().startedAt ? [{ label: 'Started', value: new Date(d().startedAt!).toLocaleString() }] : []),
            ...(d().restartCount ? [{ label: 'Restarts', value: String(d().restartCount) }] : []),
          ]}
        />
      </Section>
      <Show when={d().composeProject}>
        <Section label="Compose">
          <Facts
            grouping="rows"
            items={[
              { label: 'Project', value: d().composeProject, mono: true },
              ...(d().composeService ? [{ label: 'Service', value: d().composeService, mono: true }] : []),
              ...(d().composeWorkingDir
                ? [{ label: 'Working directory', value: d().composeWorkingDir, mono: true }]
                : []),
            ]}
          />
        </Section>
      </Show>
      <Show when={d().ports.length || d().networks.length}>
        <Section label="Networking">
          <Stack gap="row">
            <ChipRow ariaLabel="Published ports">
              <For each={d().ports}>
                {(port) => (
                  <Chip
                    title={port.hostPort ? `Copy http://localhost:${port.hostPort}` : 'Not published'}
                    {...(port.hostPort ? { onPress: () => props.onCopyPort(port) } : {})}
                  >
                    {port.hostPort ? `${port.hostPort} → ` : ''}
                    {port.containerPort}/{port.protocol}
                  </Chip>
                )}
              </For>
            </ChipRow>
            <For each={d().networks}>
              {(network) => (
                <Text emphasis="mono" wrap>
                  {network}
                </Text>
              )}
            </For>
          </Stack>
        </Section>
      </Show>
      <Show when={d().mounts.length}>
        <Section label="Mounts" count={d().mounts.length}>
          <Table size="sm">
            <TableRow head>
              <TableHead>Type</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Destination</TableHead>
              <TableHead>Access</TableHead>
            </TableRow>
            <For each={d().mounts}>
              {(mount) => (
                <TableRow>
                  <TableCell>{mount.type}</TableCell>
                  <TableCell>
                    <Text emphasis="mono" wrap>
                      {mount.source}
                    </Text>
                  </TableCell>
                  <TableCell>
                    <Text emphasis="mono" wrap>
                      {mount.destination}
                    </Text>
                  </TableCell>
                  <TableCell>{mount.rw ? 'Read/write' : 'Read only'}</TableCell>
                </TableRow>
              )}
            </For>
          </Table>
        </Section>
      </Show>
      <Show when={d().env.length}>
        <Section
          label="Environment"
          count={d().env.length}
          actions={
            <Button size="sm" onPress={props.onToggleEnv}>
              {props.showEnv ? 'Hide variables' : 'Show variables'}
            </Button>
          }
        >
          <Show when={props.showEnv}>
            <Table size="sm">
              <TableRow head>
                <TableHead>Variable</TableHead>
                <TableHead>Value</TableHead>
              </TableRow>
              <For each={d().env}>
                {(line) => {
                  const at = line.indexOf('=')
                  return (
                    <TableRow>
                      <TableCell>
                        <Text emphasis="mono" wrap>
                          {at < 0 ? line : line.slice(0, at)}
                        </Text>
                      </TableCell>
                      <TableCell>
                        <Text emphasis="mono" wrap>
                          {at < 0 ? '' : line.slice(at + 1)}
                        </Text>
                      </TableCell>
                    </TableRow>
                  )
                }}
              </For>
            </Table>
          </Show>
        </Section>
      </Show>
    </Stack>
  )
}

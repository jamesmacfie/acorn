import { createMemo, For, Show } from 'solid-js'
import { clientEvents } from '@acorn/plugin-api/client'
import { Alert, Badge, Button, Card, Facts, Fold, Heading, Inline, Stack, Text } from '@acorn/plugin-api/ui'
import type { SecurityDiagnostics, SecurityFinding } from '../../shared/securityDiagnostics'

type FindingGroup = 'attention' | 'settings' | 'unchecked' | 'limits'
type CheckDescription = { title: string; description: string; action?: { label: string; tab: string } }

const checks: Record<string, CheckDescription> = {
  'instructions.checks': {
    title: 'Instruction protections',
    description: 'Choose whether agents should stop for hidden characters or changed instruction files.',
    action: { label: 'Change instruction checks', tab: 'security#agent-instructions' },
  },
  'instructions.approval': {
    title: 'Instruction approval',
    description:
      'This check does not open instruction files to verify your approval. Use the instruction review to check them.',
    action: { label: 'Review instruction files', tab: 'security#agent-instructions' },
  },
  'instructions.latest': {
    title: 'Last instruction check',
    description: 'No recent instruction check is available. Acorn checks instructions when an agent is about to act.',
    action: { label: 'Review instruction files', tab: 'security#agent-instructions' },
  },
  'plugins.grants': {
    title: 'Plugin permissions',
    description:
      'Acorn could not verify the permissions of installed plugins. Review the installed list before using an unfamiliar plugin.',
    action: { label: 'Review installed plugins', tab: 'plugins' },
  },
  'agent-tools.grants': {
    title: 'Acorn tool access',
    description: 'Review which Acorn tools agents can use to read information, make changes, or run commands.',
    action: { label: 'Review tool permissions', tab: 'agent-tools' },
  },
  'mcp.managed': {
    title: 'MCP servers',
    description: 'Acorn could not read the settings for your MCP servers. No server was started.',
    action: { label: 'Review MCP servers', tab: 'agent-mcp-servers' },
  },
  'project.package-policy': {
    title: 'Package installation rules',
    description:
      'The project’s package rules could not be fully checked. Review its configuration and dependency changes.',
  },
}

function checkDescription(finding: SecurityFinding): CheckDescription {
  if (finding.id.startsWith('mcp.managed.'))
    return {
      title: 'MCP server',
      description: 'Review this server’s command, version, consent, and tool approvals before using it.',
      action: { label: 'Review MCP servers', tab: 'agent-mcp-servers' },
    }
  if (finding.id === 'project.package-policy' && finding.projectId)
    return {
      ...checks['project.package-policy']!,
      action: { label: 'Open project settings', tab: `project/${finding.projectId}` },
    }
  return (
    checks[finding.id] ?? {
      title: 'Additional check',
      description: 'Read the technical details to understand this check.',
    }
  )
}

function findingGroup(finding: SecurityFinding): FindingGroup {
  if (['host.limit', 'mcp.unmanaged'].includes(finding.id)) return 'limits'
  if (finding.state === 'failed') return 'attention'
  if (finding.state === 'unknown' || finding.state === 'unsupported') return 'unchecked'
  return finding.severity === 'warning' ? 'attention' : 'settings'
}

function includedInCards(finding: SecurityFinding, report: SecurityDiagnostics): boolean {
  return report.projectId !== null || finding.id !== 'project.package-policy'
}

function ResultCard(props: { finding: SecurityFinding }) {
  const description = () => checkDescription(props.finding)
  const group = () => findingGroup(props.finding)
  return (
    <Card pad="sm" stripe={group() === 'attention' ? 'warn' : undefined}>
      <Stack gap="row">
        <Inline spread wrap>
          <Text emphasis="strong">{props.finding.title ?? description().title}</Text>
          <Badge tone={group() === 'attention' ? 'warn' : 'neutral'}>
            {props.finding.state === 'failed'
              ? 'Check failed'
              : group() === 'attention'
                ? 'Review recommended'
                : group() === 'unchecked'
                  ? 'Not verified'
                  : props.finding.state === 'configured_only'
                    ? 'Saved settings'
                    : 'Recorded by Acorn'}
          </Badge>
        </Inline>
        <Text wrap>
          {props.finding.state === 'failed'
            ? 'Acorn could not check these settings. Try the check again, or review them using the link below.'
            : (props.finding.description ?? description().description)}
        </Text>
        <Show when={props.finding.facts?.length}>
          <Facts items={props.finding.facts!} grouping="rows" size="sm" />
        </Show>
        <Show when={description().action}>
          {(action) => (
            <Button
              size="sm"
              variant="ghost"
              onPress={() => clientEvents.emit('presentation:open-settings', { tab: action().tab })}
            >
              {action().label}
            </Button>
          )}
        </Show>
        <Fold label="Technical details" defaultOpen={false}>
          <Stack gap="row">
            <Text wrap>{props.finding.summary}</Text>
            <Text emphasis="muted" wrap>
              {props.finding.limits}
            </Text>
            <Facts
              grouping="rows"
              size="sm"
              items={[
                { label: 'Evidence', value: props.finding.state.replace('_', ' ') },
                { label: 'Source', value: props.finding.source },
                { label: 'Check', value: props.finding.id },
              ]}
            />
          </Stack>
        </Fold>
      </Stack>
    </Card>
  )
}

export default function SecurityDiagnosticsResults(props: { report: SecurityDiagnostics }) {
  const grouped = createMemo(() => {
    const groups: Record<FindingGroup, SecurityFinding[]> = { attention: [], settings: [], unchecked: [], limits: [] }
    for (const finding of props.report.findings) {
      if (includedInCards(finding, props.report)) groups[findingGroup(finding)].push(finding)
    }
    return groups
  })
  return (
    <Stack gap="section">
      <Stack gap="row">
        <Heading level={3}>Your security check</Heading>
        <Alert variant="banner" tone={grouped().attention.length ? 'warn' : 'muted'}>
          {grouped().attention.length
            ? `${grouped().attention.length} ${grouped().attention.length === 1 ? 'item needs' : 'items need'} your attention.`
            : grouped().settings.length
              ? 'No warnings were reported by the checks that completed.'
              : 'No settings could be verified. Try again or review the unavailable checks.'}{' '}
          This is a review of settings, not a guarantee that code is safe to run.
        </Alert>
        <Show when={grouped().unchecked.length}>
          <Text emphasis="muted">
            {grouped().unchecked.length} {grouped().unchecked.length === 1 ? 'check could' : 'checks could'} not be
            verified. Expand Not verified below for next steps.
          </Text>
        </Show>
        <Text emphasis="muted" wrap>
          Checked at {new Date(props.report.checkedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.
          Results are kept for five minutes.
          {!props.report.projectId ? ' No project was included.' : ''}
        </Text>
      </Stack>
      <Show when={grouped().attention.length}>
        <Stack gap="row">
          <Heading level={3}>Needs attention</Heading>
          <For each={grouped().attention}>{(finding) => <ResultCard finding={finding} />}</For>
        </Stack>
      </Show>
      <Show when={grouped().settings.length}>
        <Stack gap="row">
          <Heading level={3}>Your settings</Heading>
          <For each={grouped().settings}>{(finding) => <ResultCard finding={finding} />}</For>
        </Stack>
      </Show>
      <Show when={grouped().unchecked.length}>
        <Fold label="Not verified" count={grouped().unchecked.length} defaultOpen={false}>
          <Stack gap="row">
            <Text emphasis="muted" wrap>
              These checks need more information. Missing information does not mean a setting is unsafe.
            </Text>
            <For each={grouped().unchecked}>{(finding) => <ResultCard finding={finding} />}</For>
          </Stack>
        </Fold>
      </Show>
      <Fold label="What this check cannot tell you" defaultOpen={false}>
        <Stack gap="row">
          <Text wrap>
            This check reads Acorn’s records. It does not run your agents, test their restrictions, or inspect all of
            their personal configuration.
          </Text>
          <Text wrap>
            You and programs running as you still have access to your computer. Review unfamiliar code before running
            it.
          </Text>
          <For each={grouped().limits}>
            {(finding) => (
              <Fold
                label={finding.id === 'mcp.unmanaged' ? 'Servers outside Acorn' : 'Access to your computer'}
                defaultOpen={false}
              >
                <Text wrap>{finding.summary}</Text>
                <Text emphasis="muted" wrap>
                  {finding.limits}
                </Text>
              </Fold>
            )}
          </For>
        </Stack>
      </Fold>
    </Stack>
  )
}

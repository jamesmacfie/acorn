import { Show } from 'solid-js'
import {
  Alert,
  Badge,
  ChipRow,
  CodeBlock,
  Facts,
  Heading,
  IconButton,
  Section,
  Stack,
  Text,
  Toolbar,
  ToolbarSpacer,
} from '@acorn/plugin-api/ui/tree'
import type { SentryEvent, SentryIssueDetail } from '../shared/api'
import { eventTitle, levelWord, relativeTime, statusWord, traceText } from './model'

export function SentryIssueView(props: {
  issue: SentryIssueDetail
  refreshing: boolean
  refreshError: string
  onRefresh(): void
  onOpen(url: string): void
}) {
  const issue = () => props.issue

  return (
    <Stack gap="section">
      <Toolbar variant="bar">
        <Heading level={2} eyebrow={`${issue().connectionLabel} · ${issue().shortId}`}>
          {issue().title}
        </Heading>
        <ToolbarSpacer />
        <Show when={issue().url}>
          {(url) => <IconButton icon="arrow-up-right" label="Open in Sentry" onPress={() => props.onOpen(url())} />}
        </Show>
        <IconButton
          icon="refresh-cw"
          label="Refresh issue"
          busy={props.refreshing}
          disabled={props.refreshing}
          onPress={props.onRefresh}
        />
      </Toolbar>

      <Show when={props.refreshError}>
        {(detail) => (
          <Alert variant="banner" title="Couldn't refresh this issue. Showing the last data we got.">
            {detail()}
          </Alert>
        )}
      </Show>

      <ChipRow ariaLabel="Issue status">
        <Badge tone={levelWord(issue().level).tone} size="xs">
          {levelWord(issue().level).label}
        </Badge>
        <Show when={issue().status}>
          {(status) => (
            <Badge tone={statusWord(status()).tone} size="xs">
              {statusWord(status()).label}
            </Badge>
          )}
        </Show>
      </ChipRow>

      {/* Mono only for the culprit, the one value here that is code. */}
      <Facts
        items={[
          { label: 'Events', value: issue().count.toLocaleString() },
          { label: 'Users', value: issue().userCount.toLocaleString() },
          { label: 'First seen', value: relativeTime(issue().firstSeen) },
          { label: 'Last seen', value: relativeTime(issue().lastSeen) },
          ...(issue().culprit ? [{ label: 'Culprit', value: issue().culprit!, mono: true, wide: true }] : []),
        ]}
      />

      <Section label="Latest event">
        <Show
          when={issue().latestEvent}
          fallback={<Text tone="muted">Sentry has no event to show for this issue.</Text>}
        >
          {(event) => <LatestEvent event={event()} />}
        </Show>
      </Section>
    </Stack>
  )
}

function LatestEvent(props: { event: SentryEvent }) {
  const event = () => props.event
  return (
    <Stack gap="row">
      <Text wrap>{eventTitle(event())}</Text>
      <Text tone="muted">
        {[relativeTime(event().occurredAt), event().environment, event().release].filter(Boolean).join(' · ')}
      </Text>
      <Show when={event().frames.length}>
        <CodeBlock size="xs" wrap>
          {traceText(event().frames)}
        </CodeBlock>
      </Show>
      <Show when={event().truncated}>
        <Text tone="muted">acorn left out part of this event to keep it small.</Text>
      </Show>
    </Stack>
  )
}

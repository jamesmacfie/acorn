import { createMemo, For, Show } from 'solid-js'
import { Alert, Badge, Button, Card, Fold, Heading, Inline, Stack, StackedDiff, Text } from '@acorn/plugin-api/ui'
import type { InstructionFinding, InstructionReview } from '../../shared/instructionReview'

const categories: Record<InstructionFinding['category'], string> = {
  command: 'Command to review', domain: 'Website link', 'sensitive-path': 'Private files or credentials',
  permission: 'Permissions or security', override: 'Conflicting instructions',
  'hidden-character': 'Hidden character', unsupported: 'Not fully checked',
}
const statuses = { added: 'Added', changed: 'Changed', removed: 'Removed', retargeted: 'Link changed' }

function patchHunks(patch: string | null): string | null {
  if (!patch) return null
  const start = patch.search(/^@@ /m)
  return start === -1 ? null : patch.slice(start)
}

export default function InstructionReviewResults(props: { review: InstructionReview; busy: boolean; onApprove: () => void }) {
  const findingsByFile = createMemo(() => {
    const files = new Map<string, InstructionFinding[]>()
    for (const finding of props.review.findings) {
      const entries = files.get(finding.file) ?? []
      entries.push(finding)
      files.set(finding.file, entries)
    }
    return files
  })
  const changes = createMemo(() => [...props.review.changes].sort((a, b) =>
    Number(findingsByFile().has(b.path)) - Number(findingsByFile().has(a.path))))
  return <Show when={!props.review.approved} fallback={
    <Alert variant="banner" tone="ok" title="No changes since your approval">
      These instructions are already approved. No action is needed.
    </Alert>
  }>
    <Stack gap="row">
      <Card pad="sm">
        <Stack gap="row">
          <Inline spread wrap>
            <Heading level={3}>{props.review.baseline ? 'Review instructions before agents use them' : 'Review instruction changes'}</Heading>
            <Badge tone="warn">{props.review.baseline ? 'First review' : 'Approval needed'}</Badge>
          </Inline>
          <Text wrap>{props.review.changes.length} {props.review.changes.length === 1 ? 'file' : 'files'} to review.{' '}
            {props.review.findings.length ? `${props.review.findings.length} ${props.review.findings.length === 1 ? 'item' : 'items'} to look at.` : 'No review highlights were found.'}</Text>
          <Text emphasis="muted" wrap>Read the files before approving. Highlights can be legitimate instructions; check their context.</Text>
          <Show when={!props.review.changes.length}>
            <Text wrap>{props.review.baseline ? 'No instruction files were found. Approve this first review to allow agents to continue.'
              : 'The review coverage changed. Approve the current instructions again, even though their text is unchanged.'}</Text>
          </Show>
        </Stack>
      </Card>
      <For each={changes()}>{(change) => <Card pad="sm" stripe={findingsByFile().has(change.path) ? 'warn' : undefined}>
        <Stack gap="row">
          <Inline spread wrap><Text emphasis="strong" wrap>{change.path}</Text><Badge>{statuses[change.status]}</Badge></Inline>
          <For each={findingsByFile().get(change.path)}>{(finding) => <Stack gap="row">
            <Inline wrap><Text emphasis="strong">{categories[finding.category]}</Text>
              <Show when={finding.line}><Text emphasis="muted">Line {finding.line}</Text></Show></Inline>
            <Text wrap>{finding.detail}</Text>
          </Stack>}</For>
          <Fold label={change.status === 'added' ? 'Read file' : 'View changes'} defaultOpen={false}>
            <Stack gap="row">
              <Show when={change.status === 'retargeted'}><Text wrap>Link target: {change.beforeCanonical} → {change.afterCanonical}</Text></Show>
              <Show when={patchHunks(change.patch)} fallback={<Text>Text preview is unavailable. Read this file in your project before approving.</Text>}>{(patch) =>
                <StackedDiff path={change.path} patch={patch()} />}
              </Show>
            </Stack>
          </Fold>
        </Stack>
      </Card>}</For>
      <Inline wrap><Button busy={props.busy} onPress={props.onApprove}>Approve instructions</Button>
        <Text emphasis="muted" wrap>Acorn will ask again if these files change.</Text></Inline>
      <Fold label="What was checked" defaultOpen={false}>
        <Stack gap="row">
          <Text wrap>Project instruction files and skills. Plugin permissions and executable project configuration have separate approvals.</Text>
          <Text emphasis="muted" wrap>{props.review.scope}</Text>
          <Text emphasis="muted" wrap>{props.review.limits}</Text>
        </Stack>
      </Fold>
    </Stack>
  </Show>
}

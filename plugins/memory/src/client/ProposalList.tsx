import { createSignal, For, Show } from 'solid-js'
import { memoryApi, type MemoryProposalRow } from './memoryClient'
import { Alert, Badge, Button, Card, Field, Heading, Inline, Input, Markdown, Select, Stack, Text, Textarea, Toolbar } from '@acorn/plugin-api/ui'

// The human gate over auto-generated memory (docs/notes-and-memory.md § Memory). Accept, with an
// optional edit to the description, writes the file and indexes it; reject leaves no trace.
//
// Shared by the two surfaces that draw a proposal, so they cannot drift: the Memory page, which lists
// every pending proposal on the node, and the Context pane's memory section, which lists one task's.
// The caller owns the fetch, because the two ask the node different questions.
//
// Both outcomes land on the card that was pressed rather than in a banner above the list. A page can
// hold a dozen proposals from a dozen tasks, and "the task worktree is gone" at the top of that does
// not say whose.
export default function ProposalList(props: {
  proposals: MemoryProposalRow[]
  onResolved: () => void
  // A proposal to select and scroll to, set when the reader arrived from its notification row.
  highlightId?: string
}) {
  const [edits, setEdits] = createSignal<Record<string, Pick<MemoryProposalRow, 'name' | 'type' | 'description' | 'body'>>>({})
  const [open, setOpen] = createSignal<string | null>(props.highlightId ?? null)
  const [errors, setErrors] = createSignal<Record<string, string>>({})
  const [busy, setBusy] = createSignal<string | null>(null)

  const fail = (id: string, message: string) => setErrors((prev) => ({ ...prev, [id]: message }))

  async function resolve(id: string, approved: boolean) {
    if (busy()) return
    setBusy(id)
    setErrors((prev) => ({ ...prev, [id]: '' }))
    try {
      const proposal = props.proposals.find((candidate) => candidate.id === id)
      const edited = edits()[id]
      const res = await memoryApi().resolveProposal(
        id,
        approved,
        approved && proposal && edited && JSON.stringify(edited) !== JSON.stringify({ name: proposal.name, type: proposal.type, description: proposal.description, body: proposal.body })
          ? edited
          : undefined,
      )
      // A refusal answers 200 with `ok: false`, so it is a value rather than a throw and needs saying
      // out loud: the commonest one is a worktree that has been removed since the proposal was raised.
      if (!res.ok) return fail(id, res.reason ?? 'The node refused, and said nothing about why.')
      props.onResolved()
    } catch (error) {
      // The route is gated, the bridge can be down and the write can fail, and every one of those
      // throws out of the client rather than answering. Swallowing it is what made the button read as
      // dead: the row stayed, nothing moved, and nothing said why.
      fail(id, error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Stack gap="row">
      <For each={props.proposals}>
        {(proposal) => (
          // `focus` is the kit's "put the reader on this card": it scrolls the card into view and
          // focuses it, which is what a notification row clicked from the bell is asking for. Only the
          // named card gets it, so nothing moves on an ordinary visit.
          <Card selected={proposal.id === props.highlightId} focus={proposal.id === props.highlightId}>
            <Stack gap="row">
              <Inline gap="inline" wrap>
                <Text emphasis="muted">{proposal.type}</Text>
                <Text emphasis="strong">{proposal.name}</Text>
              </Inline>
              <Text>{proposal.description}</Text>
              {/* Verification flags (structural `flags`, docs/notes-and-memory.md): warning badges
                  beside the proposal, never folded into the description text. */}
              <Show when={proposal.flags.length}>
                <Inline gap="inline" wrap>
                  <For each={proposal.flags}>{(flag) => <Badge tone="warn" shape="pill">⚠ {flag}</Badge>}</For>
                </Inline>
              </Show>
              <Show when={open() === proposal.id} fallback={<Button size="sm" onPress={() => setOpen(proposal.id)}>View change</Button>}>
                <Stack gap="row">
                  <Heading level={3}>Full proposed memory</Heading>
                  <Field label="Name"><Input value={edits()[proposal.id]?.name ?? proposal.name} onInput={(name) => setEdits((prev) => ({ ...prev, [proposal.id]: { name, type: prev[proposal.id]?.type ?? proposal.type, description: prev[proposal.id]?.description ?? proposal.description, body: prev[proposal.id]?.body ?? proposal.body } }))} /></Field>
                  <Field label="Type"><Select value={edits()[proposal.id]?.type ?? proposal.type} options={['convention', 'architecture', 'decision', 'fix', 'reference', 'feedback', 'task', 'user'].map((type) => ({ value: type, label: type }))} onChange={(type) => setEdits((prev) => ({ ...prev, [proposal.id]: { name: prev[proposal.id]?.name ?? proposal.name, type: type as MemoryProposalRow['type'], description: prev[proposal.id]?.description ?? proposal.description, body: prev[proposal.id]?.body ?? proposal.body } }))} /></Field>
                  <Field label="Description"><Input value={edits()[proposal.id]?.description ?? proposal.description} onInput={(description) => setEdits((prev) => ({ ...prev, [proposal.id]: { name: prev[proposal.id]?.name ?? proposal.name, type: prev[proposal.id]?.type ?? proposal.type, description, body: prev[proposal.id]?.body ?? proposal.body } }))} /></Field>
                  <Field label="Body"><Textarea mono rows={8} value={edits()[proposal.id]?.body ?? proposal.body} onInput={(body) => setEdits((prev) => ({ ...prev, [proposal.id]: { name: prev[proposal.id]?.name ?? proposal.name, type: prev[proposal.id]?.type ?? proposal.type, description: prev[proposal.id]?.description ?? proposal.description, body } }))} /></Field>
                  <Text tone="muted">{proposal.projectId ? 'Applies to this project' : 'Applies across projects'}</Text>
                  <Markdown text={edits()[proposal.id]?.body ?? proposal.body} images="placeholder" copy />
                  <Show when={errors()[proposal.id]}>{(message) => <Alert>{message()}</Alert>}</Show>
                  <Toolbar variant="actions" size="sm"><Button size="sm" busy={busy() === proposal.id} disabled={!!busy()} onPress={() => void resolve(proposal.id, true)}>Approve</Button><Button size="sm" disabled={!!busy()} onPress={() => void resolve(proposal.id, false)}>Dismiss</Button></Toolbar>
                </Stack>
              </Show>
            </Stack>
          </Card>
        )}
      </For>
    </Stack>
  )
}

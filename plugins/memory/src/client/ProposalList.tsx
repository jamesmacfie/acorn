import { createSignal, For, Show } from 'solid-js'
import { memoryApi, type MemoryProposalRow } from './memoryClient'
import { Alert, Badge, Button, Card, Inline, Input, Stack, Text, Toolbar } from '@acorn/plugin-api/ui'

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
  const [edits, setEdits] = createSignal<Record<string, string>>({})
  const [errors, setErrors] = createSignal<Record<string, string>>({})
  const [busy, setBusy] = createSignal<string | null>(null)

  const fail = (id: string, message: string) => setErrors((prev) => ({ ...prev, [id]: message }))

  async function resolve(id: string, approved: boolean) {
    if (busy()) return
    setBusy(id)
    setErrors((prev) => ({ ...prev, [id]: '' }))
    try {
      const proposal = props.proposals.find((candidate) => candidate.id === id)
      const description = edits()[id]
      const res = await memoryApi().resolveProposal(
        id,
        approved,
        approved && proposal && description && description !== proposal.description
          ? { name: proposal.name, type: proposal.type, description, body: proposal.body }
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
              <Input
                label={`Description for ${proposal.name}`}
                value={edits()[proposal.id] ?? proposal.description}
                onInput={(value) => setEdits((prev) => ({ ...prev, [proposal.id]: value }))}
              />
              {/* Verification flags (structural `flags`, docs/notes-and-memory.md): warning badges
                  beside the proposal, never folded into the description text. */}
              <Show when={proposal.flags.length}>
                <Inline gap="inline" wrap>
                  <For each={proposal.flags}>{(flag) => <Badge tone="warn" shape="pill">⚠ {flag}</Badge>}</For>
                </Inline>
              </Show>
              <Show when={errors()[proposal.id]}>{(message) => <Alert>{message()}</Alert>}</Show>
              <Toolbar variant="actions" size="sm">
                <Button size="sm" busy={busy() === proposal.id} disabled={!!busy()} onPress={() => void resolve(proposal.id, true)}>Accept</Button>
                <Button size="sm" disabled={!!busy()} onPress={() => void resolve(proposal.id, false)}>Reject</Button>
              </Toolbar>
            </Stack>
          </Card>
        )}
      </For>
    </Stack>
  )
}

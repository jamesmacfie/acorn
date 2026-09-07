import { useParams } from '@solidjs/router'
import { createMemo, createResource, createSignal, For, onCleanup, Show } from 'solid-js'
import { Badge, Card, DetailColumn, EmptyState, Heading, Icon, Inline, Input, ListDetail, Stack, Text } from '@acorn/plugin-api/ui'
import { memoryApi, type MemoryProposalRow } from './memoryClient'
import { highlightedProposal, clearHighlightedProposal } from './proposalTarget'
import ProposalList from './ProposalList'

// The routed project's proposals, plus the ones that name no project at all.
//
// That second half is the same rule the node applies to memories (`listMemories` keeps private rows
// in every project's list), and it is deliberate on the proposal side too: an agent whose task will
// not resolve proposes unscoped so that a reviewer still sees it (../server/agentTools.ts). Filtering
// those out here would leave them with nowhere to be reviewed from at all.
//
// No routed project means no scope to apply, which happens when the page is opened from a surface
// that carries none. Everything, rather than nothing.
export const proposalsForProject = (rows: MemoryProposalRow[], projectId: string | undefined): MemoryProposalRow[] =>
  projectId ? rows.filter((row) => row.projectId === projectId || row.projectId === null) : rows

// The Memory rail source: what this project has learned, and what an agent has proposed it should.
//
// A page rather than a fold in the Context pane, because a proposal is not task-scoped even though it
// records the task that raised it. Accepting one resolves the task's worktree and falls back to the
// project folder (../server/knowledgeChannel.ts), and archiving a task nulls its worktree path, so a
// proposal outlives the task by design. The Context pane's section still draws one task's proposals
// where the reader is already working; this is where the rest of them live, and where the "Review
// memory" notification lands.
//
// One column, no list beside it, so the source declares `component` and not `regions`. Both halves of
// a split would be about the same thing here (docs/frontend.md § Registries and plugins).
export default function MemoryCenter() {
  const params = useParams()
  // Every pending proposal on the node, scoped on the device rather than at the route: the node's
  // list has no project filter and the reader switches project more often than an agent proposes.
  const [allProposals, { refetch }] = createResource(
    async () => (await memoryApi().proposals()).filter((proposal) => proposal.status === 'pending'),
    { initialValue: [] },
  )
  const proposals = createMemo(() => proposalsForProject(allProposals(), params.projectId))
  const [memories, { refetch: refetchMemories }] = createResource(
    () => params.projectId ?? '',
    async (projectId) => {
      const rows = await memoryApi().list(projectId || undefined)
      return 'error' in rows ? [] : rows
    },
    { initialValue: [] },
  )
  // The highlight belongs to one arrival from the bell, not to the page. Left set, a later visit would
  // scroll the reader to a proposal they had already dealt with once.
  onCleanup(clearHighlightedProposal)
  const [filter, setFilter] = createSignal('')
  // Filtered on the device rather than through the node's index: this is a list already in hand, and
  // the full-text search is a separate question the palette's "Search memory" answers.
  const shown = createMemo(() => {
    const needle = filter().trim().toLowerCase()
    if (!needle) return memories()
    return memories().filter((memory) =>
      memory.name.toLowerCase().includes(needle) || memory.description.toLowerCase().includes(needle))
  })

  // No `list` on the split, so it draws one full-width column: this page has nothing to put beside its
  // content, and `DetailColumn scroll` makes the whole page one scroll region. Agent Center is the
  // same shape.
  return (
    <ListDetail>
      <DetailColumn scroll>
        <Stack gap="section">
          <Show when={proposals().length}>
            <Stack gap="row">
              <Heading level={2} eyebrow="Waiting on you">Proposals</Heading>
              <Text emphasis="muted">Auto-generated from agent sessions. Nothing is written until you accept it.</Text>
              <ProposalList
                proposals={proposals()}
                highlightId={highlightedProposal()}
                onResolved={() => {
                  // The highlight named one proposal, and it has just been answered.
                  clearHighlightedProposal()
                  void refetch()
                  // And the list below, because an accepted proposal becomes a memory in it. Without
                  // this the row vanishes from the top of the page and nothing takes its place, which
                  // reads as though the accept did nothing.
                  void refetchMemories()
                }}
              />
            </Stack>
          </Show>

          <Stack gap="row">
            <Heading level={2}>Memories</Heading>
            <Input label="Filter memories" placeholder="Filter by name or description…" value={filter()} onInput={setFilter} />
            <Show
              when={shown().length}
              fallback={(
                <EmptyState icon={<Icon name="brain" />} title={memories().length ? 'Nothing matches that filter.' : 'No memories yet.'}>
                  <Show when={!memories().length}>
                    Agents propose these as they work, and you can add one by hand from a task's Context pane.
                  </Show>
                </EmptyState>
              )}
            >
              <For each={shown()}>
                {(memory) => (
                  <Card>
                    <Stack gap="row">
                      <Inline gap="inline" wrap>
                        <Badge shape="pill">{memory.type}</Badge>
                        <Text emphasis="strong">{memory.name}</Text>
                        <Show when={memory.scope === 'private'}><Badge tone="warn" shape="pill">private</Badge></Show>
                      </Inline>
                      <Text>{memory.description}</Text>
                      <Text emphasis="muted">{memory.path}</Text>
                    </Stack>
                  </Card>
                )}
              </For>
            </Show>
          </Stack>
        </Stack>
      </DetailColumn>
    </ListDetail>
  )
}

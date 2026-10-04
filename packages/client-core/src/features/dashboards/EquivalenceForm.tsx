import { createMemo, createSignal, Show } from 'solid-js'
import type { PanelPlan } from '@acorn/protocol/dashboards.ts'
import { Button, Select } from '../../kit/components/primitives'
import { Stack } from '../../kit/components/layout/Stack'

type Source = PanelPlan['sources'][number]
type Column = PanelPlan['columns'][number]
type Relation = NonNullable<PanelPlan['relations']>[number]

/** Exact identifiers only. Each selected column must bind a described field in both sources. */
export default function EquivalenceForm(props: { sources: readonly Source[]; columns: readonly Column[]; onAdd: (relation: Relation) => void }) {
  const primary = () => props.sources.filter(source => source.role === 'primary')
  const [from, setFrom] = createSignal(primary()[0]?.id ?? '')
  const [to, setTo] = createSignal(primary()[1]?.id ?? '')
  const [provider, setProvider] = createSignal('')
  const [account, setAccount] = createSignal('')
  const [container, setContainer] = createSignal('')
  const [identity, setIdentity] = createSignal('')
  const common = createMemo(() => props.columns.filter(column => {
    const left = column.bind[from()], right = column.bind[to()]
    return left && right && 'field' in left && 'field' in right
  }))
  const options = () => [{ value: '', label: 'Choose a column' }, ...common().map(column => ({ value: column.id, label: column.label }))]
  const key = (id: string, scope: Relation['keys'][number]['scope']): Relation['keys'][number] | undefined => {
    const column = common().find(candidate => candidate.id === id)
    const left = column?.bind[from()], right = column?.bind[to()]
    return left && right && 'field' in left && 'field' in right ? { from: left.field, to: right.field, scope } : undefined
  }
  const add = (): void => {
    const keys = [key(provider(), 'provider'), key(account(), 'account'), key(identity(), 'identity'), ...(container() ? [key(container(), 'container')] : [])]
    if (keys.some(item => !item)) return
    props.onAdd({ id: `equivalence${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`, from: from(), to: to(),
      kind: 'equivalence', cardinality: 'one-to-one', keys: keys as Relation['keys'], unmatched: 'keep', maxMatches: 5000 })
  }
  return <Show when={primary().length >= 2}><Stack gap="row">
    <Select label="Equivalent source" size="sm" value={from()} options={primary().map(source => ({ value: source.id, label: source.label }))} onChange={setFrom} />
    <Select label="Mirrored source" size="sm" value={to()} options={primary().filter(source => source.id !== from()).map(source => ({ value: source.id, label: source.label }))} onChange={setTo} />
    <Select label="Provider key" size="sm" value={provider()} options={options()} onChange={setProvider} />
    <Select label="Account key" size="sm" value={account()} options={options()} onChange={setAccount} />
    <Select label="Item identifier" size="sm" value={identity()} options={options()} onChange={setIdentity} />
    <Select label="Container key, if needed" size="sm" value={container()} options={options()} onChange={setContainer} />
    <Button size="sm" disabled={!provider() || !account() || !identity() || from() === to()} onPress={add}>Add equivalence</Button>
  </Stack></Show>
}

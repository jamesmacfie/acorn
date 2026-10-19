import { createContext, createMemo, Show, useContext, type JSX } from 'solid-js'
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  Field,
  Heading,
  Inline,
  Input,
  Select,
  Stack,
  Text,
  Textarea,
} from '@acorn/plugin-api/ui'
import { PlanPanel } from '@acorn/plugin-api/ui/dashboards'
import { createStateField, FormScope, useFormName, useOpenUI, type ComponentRenderer } from '@acorn/openui-solid'
import type { PanelPlan } from '@acorn/protocol/dashboards.ts'
import { appLibrary } from '../shared/library'
import { plainData, plainText } from './plainData'

// The client half of the library: each component drawn with a kit component through
// `@acorn/plugin-api/ui`, which the terminal build resolves to its own kit, so one binding draws in
// both clients. `Panel` draws a plan with the dashboard's own panel. Bindings read props inside JSX or
// a memo, never at the top of the component, which Solid runs once; and read context at the top, never
// in a prop getter, which the terminal can read from a key handler outside the component.

/** What the card hands its program's components. */
export type AppHost = {
  appId: string
  workspaceId: string
  plans: Record<string, unknown>
  /** An older revision drawn by Show: nothing in it acts. */
  readOnly: boolean
  /** Whether the card is on screen, so its panels pause when it isn't. */
  active: () => boolean
}
export const AppHostContext = createContext<AppHost>()
const useHost = () => useContext(AppHostContext)!
// A Card standing in a row is as wide as its content rather than the row.
const InRow = createContext<() => boolean>(() => false)

type Props = Record<string, any>
const text = plainText

const act = (label: () => string, action: () => unknown) => {
  const runtime = useOpenUI()
  const form = useFormName()
  const host = useHost()
  return () => {
    if (!host.readOnly) void runtime.triggerAction(label(), form, action() as never)
  }
}

const StackBinding: ComponentRenderer<Props> = (p) => {
  const row = () => p.props.direction === 'row'
  return (
    <InRow.Provider value={row}>
      <Show when={row()} fallback={<Stack gap={p.props.gap ?? 'stack'}>{p.renderNode(p.props.children)}</Stack>}>
        <Inline gap={p.props.gap ?? 'inline'} wrap>
          {p.renderNode(p.props.children)}
        </Inline>
      </Show>
    </InRow.Provider>
  )
}

const CardBinding: ComponentRenderer<Props> = (p) => {
  const inRow = useContext(InRow)
  return (
    <Card fit={inRow()}>
      <InRow.Provider value={() => false}>
        <Stack gap="row">
          <Show when={p.props.title}>{(title) => <Heading level={3}>{title()}</Heading>}</Show>
          {p.renderNode(p.props.children)}
        </Stack>
      </InRow.Provider>
    </Card>
  )
}

const ButtonBinding: ComponentRenderer<Props> = (p) => {
  const { readOnly } = useHost()
  const press = act(
    () => text(p.props.label),
    () => p.props.action,
  )
  return (
    <Button
      variant={p.props.variant === 'solid' ? 'solid' : p.props.variant === 'ghost' ? 'ghost' : 'outline'}
      disabled={readOnly}
      onPress={press}
    >
      {text(p.props.label)}
    </Button>
  )
}

const CheckboxBinding: ComponentRenderer<Props> = (p) => {
  const { readOnly } = useHost()
  const field = createStateField(
    () => text(p.props.name),
    () => p.props.checked,
  )
  const press = act(
    () => text(p.props.label),
    () => p.props.action,
  )
  return (
    <Checkbox
      label={text(p.props.label)}
      hint={p.props.hint ?? undefined}
      checked={!!field.value()}
      disabled={readOnly}
      onChange={(checked) => (p.props.action ? press() : field.setValue(checked, 'Checkbox'))}
    />
  )
}

const InputBinding: ComponentRenderer<Props> = (p) => {
  const { readOnly } = useHost()
  const field = createStateField(
    () => text(p.props.name),
    () => p.props.value,
  )
  return (
    <Field label={text(p.props.label)}>
      <Input
        value={text(field.value())}
        placeholder={p.props.placeholder}
        readOnly={readOnly}
        onInput={(value) => field.setValue(value, 'Input')}
      />
    </Field>
  )
}

const TextareaBinding: ComponentRenderer<Props> = (p) => {
  const { readOnly } = useHost()
  const field = createStateField(
    () => text(p.props.name),
    () => p.props.value,
  )
  return (
    <Field label={text(p.props.label)}>
      <Textarea
        value={text(field.value())}
        rows={p.props.rows ?? 4}
        readOnly={readOnly}
        onInput={(value) => field.setValue(value, 'Textarea')}
      />
    </Field>
  )
}

const SelectBinding: ComponentRenderer<Props> = (p) => {
  const { readOnly } = useHost()
  const field = createStateField(
    () => text(p.props.name),
    () => p.props.value,
  )
  const options = createMemo(() =>
    ((p.props.items ?? []) as unknown[]).flat().flatMap((item) => {
      const props = (item as { typeName?: string; props?: Props } | null)?.props
      return (item as { typeName?: string })?.typeName === 'SelectItem' && props
        ? [{ value: text(props.value), label: text(props.label) }]
        : []
    }),
  )
  return (
    <Field label={text(p.props.label)}>
      <Select
        options={options()}
        value={text(field.value())}
        disabled={readOnly}
        onChange={(value) => field.setValue(value, 'Select')}
      />
    </Field>
  )
}

const FormBinding: ComponentRenderer<Props> = (p) => (
  <FormScope name={text(p.props.name)}>
    <Stack gap="stack">{p.renderNode(p.props.children)}</Stack>
  </FormScope>
)

const ListBinding: ComponentRenderer<Props> = (p) => (
  <Show
    when={((p.props.items ?? []) as unknown[]).flat().length}
    fallback={<EmptyState size="sm">{text(p.props.empty ?? 'Nothing here.')}</EmptyState>}
  >
    <Stack gap="row">{p.renderNode(p.props.items)}</Stack>
  </Show>
)

const ListItemBinding: ComponentRenderer<Props> = (p) => (
  <Inline spread wrap>
    <Stack gap="row">
      <Text emphasis="strong" wrap>
        {text(p.props.title)}
      </Text>
      <Show when={p.props.description}>
        {(description) => (
          <Text tone="muted" wrap>
            {text(description())}
          </Text>
        )}
      </Show>
    </Stack>
    <Inline gap="inline" wrap>
      {p.renderNode(p.props.badges)}
      {p.renderNode(p.props.actions)}
    </Inline>
  </Inline>
)

const PanelBinding: ComponentRenderer<Props> = (p) => {
  const host = useHost()
  const plan = () => host.plans[text(p.props.plan)] as PanelPlan | undefined
  // A copy, read whole, so a picked value reaches the run and nothing holds the program's store.
  const inputs = createMemo(() => plainData(p.props.inputs) as Props | undefined)
  return (
    <Show when={plan()} fallback={<Alert tone="warn">{`This app has no plan called ${text(p.props.plan)}.`}</Alert>}>
      {(plan) => (
        <PlanPanel
          id={`${host.appId}:${text(p.props.plan)}`}
          plan={plan()}
          workspaceId={host.workspaceId}
          inputs={inputs()}
          active={host.active()}
        />
      )}
    </Show>
  )
}

const BINDINGS: Record<string, ComponentRenderer<Props>> = {
  Stack: StackBinding,
  Card: CardBinding,
  Heading: (p) => <Heading level={3}>{text(p.props.text)}</Heading>,
  Text: (p) => (
    <Text
      tone={p.props.tone === 'muted' ? 'muted' : undefined}
      emphasis={p.props.tone === 'mono' ? 'mono' : undefined}
      wrap
    >
      {text(p.props.text)}
    </Text>
  ),
  Badge: (p) => <Badge tone={p.props.tone}>{text(p.props.text)}</Badge>,
  Alert: (p) => <Alert tone={p.props.tone ?? 'muted'}>{text(p.props.text)}</Alert>,
  Empty: (p) => <EmptyState size="sm">{text(p.props.text)}</EmptyState>,
  Button: ButtonBinding,
  Checkbox: CheckboxBinding,
  Input: InputBinding,
  Textarea: TextareaBinding,
  Select: SelectBinding,
  // Drawn by its Select.
  SelectItem: () => null as unknown as JSX.Element,
  Form: FormBinding,
  List: ListBinding,
  ListItem: ListItemBinding,
  Panel: PanelBinding,
}

export const library = appLibrary((name) => BINDINGS[name]!)

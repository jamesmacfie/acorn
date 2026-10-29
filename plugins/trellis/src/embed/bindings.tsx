import { createContext, createMemo, Show, useContext, type Component, type JSX } from 'solid-js'
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
import { createStateField, FormScope, useFormName, useOpenUI, type ComponentRenderer } from '@acorn/openui-solid'
import { appLibrary } from '../shared/library'
import { plainData, plainText } from './plainData'

// The client half of the library: each component drawn with a kit component through
// `@acorn/plugin-api/ui`, which the terminal and the browser extension resolve to their own kits, so one
// binding draws in every client. `Panel` draws with the client's own panel. Bindings read props inside JSX or
// a memo, never at the top of the component, which Solid runs once; and read context at the top, never
// in a prop getter, which the terminal can read from a key handler outside the component.

/** What a program's `Panel` draws with: one of the app's plans, named and already checked, with the
 *  inputs copied to plain data. Each client draws it with its own dashboard views. */
export type AppPanelProps = { plan: string; inputs: Record<string, unknown> | undefined; active: boolean }

/** What the runtime hands its program's components. */
export type AppScope = {
  plans: readonly string[]
  /** An older revision drawn by Show: nothing in it acts. */
  readOnly: boolean
  /** Whether the card is on screen, so its panels pause when it isn't. */
  active: () => boolean
  Panel: Component<AppPanelProps>
}
export const AppScopeContext = createContext<AppScope>()
const useScope = () => useContext(AppScopeContext)!
// A Card standing in a row is as wide as its content rather than the row.
const InRow = createContext<() => boolean>(() => false)

type Props = Record<string, any>
const text = plainText

const act = (label: () => string, action: () => unknown) => {
  const runtime = useOpenUI()
  const form = useFormName()
  const scope = useScope()
  return () => {
    if (!scope.readOnly) void runtime.triggerAction(label(), form, action() as never)
  }
}

const StackBinding: ComponentRenderer<Props> = (p) => {
  const row = () => p.props.direction === 'row'
  // A row of only Cards is equal columns of even height. Anything else, such as a row of buttons, keeps
  // its content width. A fitted card still fills its column on the web, and the terminal ignores `even`.
  const cards = () => {
    const children = [p.props.children].flat(Infinity) as { typeName?: string }[]
    return children.length > 0 && children.every((child) => child?.typeName === 'Card')
  }
  return (
    <InRow.Provider value={row}>
      <Show when={row()} fallback={<Stack gap={p.props.gap ?? 'stack'}>{p.renderNode(p.props.children)}</Stack>}>
        <Inline gap={p.props.gap ?? 'inline'} wrap even={cards()}>
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
  const { readOnly } = useScope()
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
  const { readOnly } = useScope()
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
  const { readOnly } = useScope()
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
  const { readOnly } = useScope()
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
  const { readOnly } = useScope()
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
  const scope = useScope()
  const plan = () => text(p.props.plan)
  // A copy, read whole, so a picked value reaches the run and nothing holds the program's store.
  const inputs = createMemo(() => plainData(p.props.inputs) as Props | undefined)
  return (
    <Show
      when={scope.plans.includes(plan())}
      fallback={<Alert tone="warn">{`This app has no plan called ${plan()}.`}</Alert>}
    >
      <scope.Panel plan={plan()} inputs={inputs()} active={scope.active()} />
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

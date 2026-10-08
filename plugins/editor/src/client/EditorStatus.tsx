import { Show } from 'solid-js'
import { Button, Menu, Text, Toolbar } from '@acorn/plugin-api/ui'
import type { Indentation } from './editorPresentation'

export default function EditorStatus(props: {
  path: string
  position?: string
  selection?: number
  language?: string
  indentation?: Indentation
  defaultIndentation: Indentation
  save?: string
  preview?: boolean
  external?: boolean
  wrap?: boolean
  defaultWrap?: boolean
  onToggleWrap: () => void
  onDefaultWrap: (value: boolean) => void
  onCopy: () => void
  onReveal: () => void
  onIndentation: (value: Indentation) => void
  onDefaultIndentation: (value: Indentation) => void
  onRetry: () => void
}) {
  const displayedPath = () => props.path.length > 42 ? `…${props.path.slice(-41)}` : props.path
  return <Toolbar size="sm" ariaLabel="File status">
    <Text emphasis="mono" tip={props.path}>{displayedPath()}</Text>
    <Button size="sm" variant="bare" onPress={props.onCopy}>Copy path</Button>
    <Show when={props.position}><Text emphasis="mono">{props.position}</Text></Show>
    <Show when={props.language}><Text emphasis="muted">{props.language}</Text></Show>
    <Show when={props.indentation}>{(value) => <Text emphasis="muted">{value().mode === 'spaces' ? 'Spaces' : 'Tabs'}: {value().width}</Text>}</Show>
    <Show when={props.selection}><Text emphasis="muted">{props.selection} selected</Text></Show>
    <Show when={props.save}>
      <Text tone={props.save === 'Save failed' || props.save === 'Changed on disk' || props.save === 'Deleted on disk' || props.save === 'Recovered draft' ? 'warn' : undefined}>{props.save}</Text>
    </Show>
    <Show when={props.external}><Text>External editor</Text></Show>
    <Show when={props.preview}><Text>Read-only preview</Text></Show>
    <Menu ariaLabel="File status details" maxVisibleRows={8} trigger={({ toggle }) => <Button size="sm" variant="bare" onPress={toggle}>Details</Button>}>
      {(menu) => <>
        <Menu.Item context={menu} onSelect={props.onReveal}>Reveal in file tree</Menu.Item>
        <Menu.Item context={menu} onSelect={props.onCopy}>Copy relative path</Menu.Item>
        <Show when={props.language}><Menu.Item context={menu} disabled onSelect={() => {}}>{props.language}</Menu.Item></Show>
        <Show when={props.selection}><Menu.Item context={menu} disabled onSelect={() => {}}>{props.selection} selected characters</Menu.Item></Show>
        <Show when={props.indentation}>{(indentation) => <>
          <Menu.Separator />
          <Menu.Item context={menu} kind="checkbox" checked={props.wrap} onSelect={props.onToggleWrap}>Word wrap</Menu.Item>
          <Menu.Item context={menu} kind="checkbox" checked={props.defaultWrap} onSelect={() => props.onDefaultWrap(!props.defaultWrap)}>Wrap by default on this device</Menu.Item>
          <Menu.Separator />
          {(['spaces', 'tabs'] as const).flatMap((mode) => ([2, 4, 8] as const).map((width) =>
            <Menu.Item context={menu} kind="radio" checked={indentation().mode === mode && indentation().width === width} onSelect={() => props.onIndentation({ mode, width })}>
              {mode === 'spaces' ? 'Spaces' : 'Tabs'}: {width}
            </Menu.Item>,
          ))}
          <Menu.Item context={menu} onSelect={() => props.onDefaultIndentation(indentation())}>Use this indentation by default on this device</Menu.Item>
        </>}</Show>
        <Show when={props.save === 'Save failed'}><Menu.Item context={menu} onSelect={props.onRetry}>Retry save</Menu.Item></Show>
      </>}
    </Menu>
  </Toolbar>
}

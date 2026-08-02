import { For, Show, createSignal } from 'solid-js'
import { Badge, Button, Field, Input, Row, SectionHeader, Select, Spinner, Textarea } from '../ui/primitives'
import { STYLES } from './uiStyles'
import { THEMES } from './themes'

// Dev-only style gallery: one instance of every primitive × variant × tone, plus the surfaces the
// packs restyle most. It exists to make authoring a style pack a tight loop — switch the pack here
// and see the whole vocabulary move at once, instead of hunting the app for an affected surface.
//
// The pickers below write to the DOM attributes directly rather than to prefs, so previewing does
// not clobber the user's real appearance settings. Closing settings restores them, because
// appStartup's effect re-applies from prefs on the next change.
export default function StyleGallery() {
  const [style, setStyle] = createSignal(document.documentElement.dataset.style ?? 'terminal')
  const [theme, setTheme] = createSignal(document.documentElement.dataset.theme ?? 'light')
  const [busy, setBusy] = createSignal(false)

  const applyStyle = (id: string) => { setStyle(id); document.documentElement.dataset.style = id }
  const applyTheme = (id: string) => { setTheme(id); document.documentElement.dataset.theme = id }

  return (
    <div class="gallery">
      <p class="settings-hint muted">
        Preview only — these pickers set the DOM attributes without saving, so your real Appearance
        settings are untouched.
      </p>

      <div class="gallery-pickers">
        <Field label="Style" layout="row">
          <Select value={style()} onChange={(e) => applyStyle(e.currentTarget.value)}>
            <For each={STYLES()}>{([v, l]) => <option value={v}>{l}</option>}</For>
          </Select>
        </Field>
        <Field label="Theme" layout="row">
          <Select value={theme()} onChange={(e) => applyTheme(e.currentTarget.value)}>
            <For each={THEMES()}>{([v, l]) => <option value={v}>{l}</option>}</For>
          </Select>
        </Field>
      </div>

      <SectionHeader level="sub">Buttons</SectionHeader>
      <div class="gallery-row">
        <For each={['solid', 'outline', 'ghost', 'bare'] as const}>
          {(variant) => <Button variant={variant}>{variant}</Button>}
        </For>
      </div>
      <div class="gallery-row">
        <For each={['neutral', 'accent', 'danger', 'warn'] as const}>
          {(tone) => <Button tone={tone}>{tone}</Button>}
        </For>
        <Button size="sm">small</Button>
        <Button disabled>disabled</Button>
        <Button busy={busy()} onClick={() => { setBusy(true); setTimeout(() => setBusy(false), 1500) }}>
          {busy() ? 'working' : 'click me'}
        </Button>
      </div>

      <SectionHeader level="sub">Badges</SectionHeader>
      <div class="gallery-row">
        <For each={['neutral', 'accent', 'add', 'del', 'warn'] as const}>
          {(tone) => <Badge tone={tone}>{tone}</Badge>}
        </For>
        <Badge shape="pill">pill</Badge>
        <Badge size="xs">xs</Badge>
        <Badge dashed>+ add</Badge>
        <Spinner />
      </div>

      <SectionHeader level="sub">Form controls</SectionHeader>
      <Field label="Text input" hint="A hint sits under the control.">
        <Input placeholder="Type here…" />
      </Field>
      <Field label="Invalid" error="Something is wrong.">
        <Input value="bad value" invalid />
      </Field>
      <Field label="Textarea">
        <Textarea rows="2" placeholder="Monospace, because it holds code." />
      </Field>

      <SectionHeader level="sub">Rows</SectionHeader>
      <div class="gallery-rows">
        <Row leading={<span class="glyph">◇</span>} meta="2h">First row</Row>
        <Row leading={<span class="glyph">◷</span>} meta="4h" selected>Selected row</Row>
        <Row leading={<span class="glyph">◍</span>} meta="1d" onActivate={() => {}}>Clickable row</Row>
        <Row leading={<span class="glyph">▦</span>} nested density="compact">Nested compact row</Row>
        <Row leading={<span class="glyph">⎇</span>} density="roomy" trailing={<Badge tone="add">+12</Badge>}>Roomy row</Row>
      </div>

      <SectionHeader level="sub">Section headers</SectionHeader>
      <SectionHeader count={7} actions={<Button variant="bare">⟳</Button>}>Pane header</SectionHeader>
      <SectionHeader level="group">Group heading</SectionHeader>

      <SectionHeader level="sub">Code surfaces (monospace in every pack)</SectionHeader>
      <div class="gallery-code">
        <div class="diff-row diff-add"><span class="diff-marker">+</span><span class="diff-code">const added = true</span></div>
        <div class="diff-row diff-del"><span class="diff-marker">−</span><span class="diff-code">const removed = false</span></div>
        <pre class="gallery-term">$ acorn --version{'\n'}1.0.0</pre>
      </div>

      <Show when={false}><span /></Show>
    </div>
  )
}

import { For, createSignal } from 'solid-js'
import { Badge, Button, Checkbox, Field, Input, Row, SectionHeader, SegmentedControl, Select, Spinner, Textarea } from '../../kit/components/primitives'
import { Tabs } from '../../kit/components/layout/Tabs'
import { SettingRow } from '../../kit/components/layout/SettingRow'
import { SettingsSection } from '../../kit/components/layout/SettingsSection'
import { Text } from '../../kit/components/content/Text'
import { STYLES } from './uiStyles'
import { THEMES } from './builtInThemes'

// Dev-only style gallery: one instance of every primitive × variant × tone, plus the surfaces the
// packs restyle most. It exists to make authoring a style pack a tight loop: switch the pack here and
// see the whole vocabulary move at once, instead of hunting the app for an affected surface.
//
// The pickers below write to the DOM attributes directly rather than to prefs, so previewing does not
// clobber the user's real appearance settings. Closing settings restores them, because appStartup's
// effect re-applies from prefs on the next change.
export default function StyleGallery() {
  const [style, setStyle] = createSignal(document.documentElement.dataset.style ?? 'terminal')
  const [theme, setTheme] = createSignal(document.documentElement.dataset.theme ?? 'light')
  const [busy, setBusy] = createSignal(false)
  // Local state for the settings sample, so its controls move without saving anything.
  const [on, setOn] = createSignal(true)
  const [size, setSize] = createSignal('13')
  const [density, setDensity] = createSignal<'compact' | 'comfortable'>('comfortable')
  const [tab, setTab] = createSignal('general')

  const applyStyle = (id: string) => { setStyle(id); document.documentElement.dataset.style = id }
  const applyTheme = (id: string) => { setTheme(id); document.documentElement.dataset.theme = id }

  return (
    <div class="gallery">
      <Text emphasis="muted" wrap>Preview only. Nothing here is saved.</Text>

      <div class="gallery-pickers">
        <Field label="Style" layout="row">
          <Select value={style()} options={STYLES().map(([value, label]) => ({ value, label }))} onChange={(value) => applyStyle(value)} />
        </Field>
        <Field label="Theme" layout="row">
          <Select value={theme()} options={THEMES().map(([value, label]) => ({ value, label }))} onChange={(value) => applyTheme(value)} />
        </Field>
      </div>

      {/* What a settings page is made of, so a pack author sees rows, sections and the save state. */}
      <SettingsSection id="gallery-settings" label="A settings section" description="A section's one line of description." help="The help text, behind the mark.">
        <SettingRow label="An inline row" description="Its control sits on the right.">
          <Select label="An inline row" value={size()} options={['12', '13', '14'].map((value) => ({ value, label: `${value} px` }))} onChange={setSize} />
        </SettingRow>
        <SettingRow label="A switch row" help="A row can carry a help mark too.">
          <Checkbox switch ariaLabel="A switch row" checked={on()} onChange={setOn} />
        </SettingRow>
        <SettingRow label="A changed row" onReset={() => setSize('13')}>
          <SegmentedControl
            ariaLabel="A changed row"
            value={density()}
            options={[{ value: 'compact', label: 'Compact' }, { value: 'comfortable', label: 'Comfortable' }]}
            onChange={setDensity}
          />
        </SettingRow>
        <SettingRow label="A stacked row" description="Its control takes the full width under the words." layout="stacked">
          <Textarea rows={2} placeholder="A script or a long value" />
        </SettingRow>
      </SettingsSection>
      <Tabs
        idPrefix="gallery-tabs"
        ariaLabel="Sample tabs"
        active={tab()}
        onChange={setTab}
        tabs={[{ id: 'general', label: 'General' }, { id: 'advanced', label: 'Advanced', count: 3 }]}
      />

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
        <Button busy={busy()} onPress={() => { setBusy(true); setTimeout(() => setBusy(false), 1500) }}>
          {busy() ? 'working' : 'click me'}
        </Button>
      </div>

      <SectionHeader level="sub">Badges</SectionHeader>
      <div class="gallery-row">
        <For each={['neutral', 'accent', 'ok', 'danger', 'warn'] as const}>
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
        <Textarea rows={2} placeholder="Monospace, because it holds code." />
      </Field>

      <SectionHeader level="sub">Rows</SectionHeader>
      <div class="gallery-rows">
        <Row leading={<span class="glyph">◇</span>} meta="2h">First row</Row>
        <Row leading={<span class="glyph">◷</span>} meta="4h" selected>Selected row</Row>
        <Row leading={<span class="glyph">◍</span>} meta="1d" onPress={() => {}}>Clickable row</Row>
        <Row leading={<span class="glyph">▦</span>} nested density="compact">Nested compact row</Row>
        <Row leading={<span class="glyph">⎇</span>} density="roomy" trailing={<Badge tone="ok">+12</Badge>}>Roomy row</Row>
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

    </div>
  )
}

import { createSignal, Show } from 'solid-js'
import type { PluginInstallSource } from '@acorn/protocol/api.ts'
import { canPickFolder, pickFolder } from '../../../infra/platform'
import { Alert, Button, Input, Select } from '../../../kit/components/primitives'
import { Inline } from '../../../kit/components/layout/Inline'
import { SettingRow } from '../../../kit/components/layout/SettingRow'
import { SettingsSection } from '../../../kit/components/layout/SettingsSection'
import { useSettingsDetail } from '../settingsDetail'
import { useUnsavedChanges } from '../unsavedChanges'

// Install…: one flow for both places a plugin can live (docs/plugins/activation.md § Installing). The
// person names the source once and says where it goes. A node runs the package's server code in its own
// isolated realm and offers its interface to this device, which asks for trust before any of it runs. This
// device alone can hold a client-only package, which also asks for trust. Each target stores exactly what
// its own form stored before, through the same call.
//
// No browse-and-discover list, because anything acorn could offer there would be unreviewed
// (docs/extensibility.md § Some decisions that look like gaps).

export type InstallTarget = 'node' | 'device'
type SourceKind = 'github' | 'npm' | 'url' | 'path'

const PLACEHOLDER: Record<SourceKind, string> = {
  github: 'owner/repo, or owner/repo@v1.2.0',
  npm: 'package-name, or package-name@1.2.0',
  url: 'https://example.com/acorn-plugin.tgz',
  path: '/absolute/path/to/the/plugin',
}

// `name@version` is one field because that is how everyone writes it. The split is on the last `@`
// past position 0, so a scoped npm name keeps its own.
export function buildInstallSource(kind: SourceKind, raw: string): PluginInstallSource {
  const text = raw.trim()
  if (kind === 'url') return { url: text }
  if (kind === 'path') return { path: text }
  const at = text.lastIndexOf('@')
  const name = at > 0 ? text.slice(0, at) : text
  const suffix = at > 0 ? text.slice(at + 1) : ''
  return kind === 'github'
    ? { github: name, ...(suffix ? { tag: suffix } : {}) }
    : { npm: name, ...(suffix ? { version: suffix } : {}) }
}

export function InstallPlugin(props: {
  nodeLabel: string
  /** Whether the node in the header is this computer's own. The folder picker browses this device, so a
   *  path picked for a remote node would mean something else there; a remote node keeps the text field. */
  nodeIsLocal: boolean
  install: (target: InstallTarget, source: PluginInstallSource) => Promise<void>
  onClose: () => void
}) {
  const [target, setTarget] = createSignal<InstallTarget>('node')
  const [kind, setKind] = createSignal<SourceKind>('github')
  const [spec, setSpec] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')
  useUnsavedChanges(() => !!spec().trim() && !busy())
  const hostDrawsBack = useSettingsDetail(() => 'Install a plugin', props.onClose)

  // A device folder is read by this device, so it is offered only where there is a picker. A node reads
  // its own path, typed or picked.
  const kinds = () => [
    { value: 'github', label: 'GitHub release' },
    { value: 'npm', label: 'npm package' },
    { value: 'url', label: 'Tarball URL' },
    ...(target() === 'node' || canPickFolder() ? [{ value: 'path', label: 'Local folder' }] : []),
  ]
  const canBrowse = () => kind() === 'path' && canPickFolder() && (target() === 'device' || props.nodeIsLocal)
  const pickTarget = (next: InstallTarget) => {
    setTarget(next)
    if (next === 'device' && kind() === 'path' && !canPickFolder()) setKind('github')
  }

  const submit = async () => {
    if (!spec().trim()) return
    setError('')
    setBusy(true)
    try {
      await props.install(target(), buildInstallSource(kind(), spec()))
      setSpec('')
      props.onClose()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={(event) => { event.preventDefault(); void submit() }}>
      <Show when={!hostDrawsBack}>
        <Inline><Button variant="bare" size="sm" onPress={props.onClose}>‹ Installed</Button></Inline>
      </Show>
      <SettingsSection id="install" label="Package">
        <SettingRow
          label="Install on"
          help={target() === 'node'
            ? "Its server code runs on the node with only the permissions it asks for. This computer asks you again before it runs any of the plugin's screens."
            : 'A plugin on this computer has no server code. You approve every new version.'}
        >
          <Select
            label="Install on"
            value={target()}
            options={[{ value: 'node', label: `Node: ${props.nodeLabel}` }, { value: 'device', label: 'This device' }]}
            onChange={(value) => pickTarget(value as InstallTarget)}
          />
        </SettingRow>
        <SettingRow label="Source" layout="stacked">
          <Select label="Source" value={kind()} options={kinds()} onChange={(value) => setKind(value as SourceKind)} />
          <Input label="Package" value={spec()} placeholder={PLACEHOLDER[kind()]} disabled={busy()} onInput={setSpec} />
          <Show when={canBrowse()}>
            <Button variant="ghost" disabled={busy()} onPress={() => void pickFolder().then((path) => { if (path) setSpec(path) })}>Choose…</Button>
          </Show>
        </SettingRow>
        {/* A folder is linked, not copied, so it is the one install whose bytes keep changing after the
            fact (docs/security/plugin-install.md § Installing from a folder). */}
        <Show when={kind() === 'path' && target() === 'node'}>
          <Alert tone="warn">
            acorn links to this folder instead of copying it. Whatever is in it when the node starts is what runs, so acorn
            can't check it the way it checks a download.
          </Alert>
        </Show>
        <Show when={error()}><Alert>{error()}</Alert></Show>
        <Inline gap="row">
          <Button submit variant="solid" tone="accent" busy={busy()} disabled={!spec().trim()}>Install</Button>
          <Button variant="ghost" disabled={busy()} onPress={props.onClose}>Cancel</Button>
        </Inline>
      </SettingsSection>
    </form>
  )
}

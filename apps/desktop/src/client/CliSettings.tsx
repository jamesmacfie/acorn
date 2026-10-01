import { createResource, createSignal, Show } from 'solid-js'
import { cliInstaller, type CliInstallState } from '@acorn/client-core/infra/platform'
import { Button, EmptyState } from '@acorn/client-core/kit/components/primitives.tsx'
import { Text } from '@acorn/client-core/kit/components/content'
import { SettingRow, SettingsSection } from '@acorn/client-core/kit/components/layout'

// What the install button says, by what is at the location. Undefined when there is nothing to
// press: another program holds the name, or the location could not be read.
const actionLabel = (state: CliInstallState): string | undefined => {
  if (state.installed) return 'Installed'
  if (!state.available) return undefined
  return state.outdated ? 'Update the acorn command' : 'Add acorn to PATH'
}

// The desktop owns the local command location and packaged runtime. The Node selected in the UI is
// unrelated: a shell command chooses its Node when it runs, through the CLI's custody store.
export default function CliSettings() {
  const installer = cliInstaller()
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')
  // Caught into the page's error, so a status read that fails is said rather than taking the page down.
  const [status, { refetch }] = createResource(async () => {
    try {
      return await installer?.status()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      return undefined
    }
  })

  async function install() {
    if (!installer) return
    setBusy(true)
    setError('')
    try {
      await installer.install()
      await refetch()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsSection
      id="command"
      label="acorn command"
      description="Run acorn from your terminal."
      help="Adds an acorn command to a folder on your shell's PATH. It runs with this app, so it stays in step when the app updates."
    >
      <Show when={installer} fallback={<EmptyState align="start" size="sm">Command installation is available in the desktop app.</EmptyState>}>
        <Show
          when={status()}
          fallback={
            <Show when={error()} fallback={<EmptyState align="start" size="sm" busy>Checking…</EmptyState>}>
              {(message) => <Text tone="danger" wrap>{message()}</Text>}
            </Show>
          }
        >
          {(current) => (
            <SettingRow label="Location" layout="stacked" error={error() || undefined}>
              <Show when={current().location}>{(location) => <Text emphasis="mono" wrap>{location()}</Text>}</Show>
              {/* A status rather than the row's description, so a screen reader hears it change
                  after an install. */}
              <div role="status"><Text emphasis="muted" wrap>{current().message}</Text></div>
              <Show when={actionLabel(current())}>
                {(label) => (
                  <Button onPress={() => void install()} disabled={current().installed} busy={busy()}>{label()}</Button>
                )}
              </Show>
            </SettingRow>
          )}
        </Show>
      </Show>
    </SettingsSection>
  )
}

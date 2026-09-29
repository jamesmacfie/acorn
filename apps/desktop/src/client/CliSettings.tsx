import { createResource, createSignal, Show } from 'solid-js'
import { cliInstaller } from '@acorn/client-core/infra/platform'
import { Button } from '@acorn/client-core/kit/components/primitives.tsx'
import { SettingRow, SettingsSection } from '@acorn/client-core/kit/components/layout'

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
      description="Install the headless acorn command in a directory on your login shell PATH. It uses this app's CLI and Node runtime. Development builds use the current checkout."
    >
      <Show when={installer} fallback={<p class="muted">Command installation is available in the desktop app.</p>}>
        <Show when={status()} fallback={<p class="muted">{error() || 'Checking the command location…'}</p>}>
          {(current) => (
            <SettingRow label="Command location" layout="stacked" error={error() || undefined}>
              <Show when={current().location}><code>{current().location}</code></Show>
              {/* A status rather than the row's description, so a screen reader hears it change
                  after an install. */}
              <span class="muted" role="status">{current().message}</span>
              <Button onPress={() => void install()} disabled={!current().available || current().installed} busy={busy()}>
                {current().installed ? 'Installed' : 'Add acorn to PATH'}
              </Button>
            </SettingRow>
          )}
        </Show>
      </Show>
    </SettingsSection>
  )
}

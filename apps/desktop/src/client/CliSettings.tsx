import { createResource, createSignal, Show } from 'solid-js'
import { cliInstaller } from '@acorn/client-core/infra/platform'
import { Button } from '@acorn/client-core/kit/components/primitives.tsx'

// The desktop owns the local command location and packaged runtime. The Node selected in the UI is
// unrelated: a shell command chooses its Node when it runs, through the CLI's custody store.
export default function CliSettings() {
  const installer = cliInstaller()
  const [status, { refetch }] = createResource(() => installer?.status())
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')

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
    <div class="settings-section">
      <p class="muted settings-hint">Install the headless <code>acorn</code> command in a directory on your login shell PATH. It uses this app's CLI and Node runtime. Development builds use the current checkout.</p>
      <Show when={installer} fallback={<p class="muted">Command installation is available in the desktop app.</p>}>
        <Show when={status()} fallback={<p class="muted">Checking the command location…</p>}>
          {(current) => (
            <div class="settings-field">
              <span class="settings-label">Command location</span>
              <Show when={current().location}><code>{current().location}</code></Show>
              <span class="muted settings-hint" role="status">{current().message}</span>
              <div class="settings-actions">
                <Button onPress={() => void install()} disabled={!current().available || current().installed} busy={busy()}>
                  {current().installed ? 'Installed' : 'Add acorn to PATH'}
                </Button>
                <Show when={error()}><span role="alert">{error()}</span></Show>
              </div>
            </div>
          )}
        </Show>
      </Show>
    </div>
  )
}

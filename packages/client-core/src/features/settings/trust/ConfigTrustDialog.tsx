import { Portal } from 'solid-js/web'
import { createEffect, createSignal, For, Show } from 'solid-js'
import { diffLines } from 'diff'
import { readJson, writeJson } from '../../../infra/node/apiClient'
import { repoConfigTrustRoute, type RepoConfigTrustReview } from '@acorn/protocol/api.ts'
import { closeRepoConfigTrust, configTrustRequest } from './configTrust'
import './config-trust.css'
import { Alert, Button } from '../../../kit/components/primitives'
import { Modal } from '../../../kit/components/overlays/Modal'

export default function ConfigTrustDialog() {
  const [review, setReview] = createSignal<RepoConfigTrustReview | null>(null)
  const [error, setError] = createSignal('')
  const [saving, setSaving] = createSignal(false)

  createEffect(() => {
    const request = configTrustRequest()
    setReview(null)
    setError('')
    if (!request) return
    void readJson<RepoConfigTrustReview>(repoConfigTrustRoute(request.taskId)).then(setReview).catch((e) => setError(e instanceof Error ? e.message : 'Could not load repo configuration.'))
  })

  const trustAndRun = async () => {
    const request = configTrustRequest()
    const current = review()?.current
    if (!request || !current) return
    setSaving(true)
    setError('')
    try {
      const next = await writeJson<RepoConfigTrustReview>(repoConfigTrustRoute(request.taskId), {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ hash: current.hash }),
      })
      if (!next.trusted) throw new Error('The configuration was not acknowledged.')
      closeRepoConfigTrust()
      await request.retry?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not trust repo configuration.')
      // A 409 means the file changed while the dialog was open; reload so the user sees the new diff.
      void readJson<RepoConfigTrustReview>(repoConfigTrustRoute(request.taskId)).then(setReview).catch(() => {})
    } finally {
      setSaving(false)
    }
  }

  const changes = () => {
    const value = review()
    return value?.current && value.previous ? diffLines(value.previous.text, value.current.text) : []
  }

  // An `alertdialog`, so focus starts on **Not now** rather than on the button that runs commands.
  // One primary: the button says **Trust and run** when a run is waiting on the answer, and
  // **Trust configuration** when the person opened the review from a notice.
  return (
    <Portal>
    <Show when={configTrustRequest()}>
      <Modal title="Review project configuration" size="lg" role="alertdialog" onDismiss={closeRepoConfigTrust}>
        <Modal.Body>
          <p>
            This project has settings in its repository that can run commands on this computer. Only
            trust them if you've read them.
          </p>
          <Show when={error()}><Alert>{error()}</Alert></Show>
          <Show when={review()?.current} fallback={<p class="muted">Loading configuration…</p>}>
            <Show
              when={review()?.previous}
              fallback={
                <For each={review()?.current?.files ?? []}>
                  {(file) => (
                    <section class="config-trust-file">
                      <h3>{file.path}</h3>
                      <pre>{file.content}</pre>
                    </section>
                  )}
                </For>
              }
            >
              <p class="muted">These settings changed since you last trusted them.</p>
              <pre class="config-trust-diff">
                <For each={changes()}>{(part) => <span classList={{ added: part.added, removed: part.removed }}>{part.value}</span>}</For>
              </pre>
            </Show>
          </Show>
        </Modal.Body>
        <Modal.Actions>
          <Button variant="ghost" onPress={closeRepoConfigTrust}>Not now</Button>
          <Button variant="solid" disabled={saving() || !review()?.current} onPress={() => void trustAndRun()}>
            {saving() ? 'Trusting…' : configTrustRequest()?.retry ? 'Trust and run' : 'Trust configuration'}
          </Button>
        </Modal.Actions>
      </Modal>
    </Show>
    </Portal>
  )
}

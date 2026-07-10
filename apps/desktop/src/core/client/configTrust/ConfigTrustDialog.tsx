import { createEffect, createSignal, For, Show } from 'solid-js'
import { diffLines } from 'diff'
import { readJson, writeJson } from '../apiClient'
import { repoConfigTrustRoute, type RepoConfigTrustReview } from '../../shared/api'
import { closeRepoConfigTrust, configTrustRequest } from './configTrust'
import './config-trust.css'

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

  return (
    <Show when={configTrustRequest()}>
      <div class="overlay-backdrop" onClick={closeRepoConfigTrust}>
        <section class="overlay config-trust-dialog" role="alertdialog" aria-modal="true" aria-labelledby="config-trust-title" onClick={(event) => event.stopPropagation()}>
          <div class="overlay-title" id="config-trust-title">Review repo configuration</div>
          <div class="overlay-body config-trust-body">
            <p>
              <strong>{review()?.repo ?? 'This repo'}</strong> contains committed configuration that can run commands on this machine.
              Trust only text you have reviewed.
            </p>
            <Show when={error()}><div class="action-error" role="alert">{error()}</div></Show>
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
                <p class="muted">This configuration changed since it was last trusted. Review the exact diff:</p>
                <pre class="config-trust-diff">
                  <For each={changes()}>{(part) => <span classList={{ added: part.added, removed: part.removed }}>{part.value}</span>}</For>
                </pre>
              </Show>
            </Show>
          </div>
          <div class="overlay-actions">
            <button type="button" class="overlay-btn overlay-btn-ghost" onClick={closeRepoConfigTrust}>Not now</button>
            <button type="button" class="overlay-btn" disabled={saving() || !review()?.current} onClick={() => void trustAndRun()}>
              {saving() ? 'Trusting…' : configTrustRequest()?.retry ? 'Trust and run' : 'Trust configuration'}
            </button>
          </div>
        </section>
      </div>
    </Show>
  )
}

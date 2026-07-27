// The API rail Source. Source components take no props (App.tsx renders them via <Dynamic> with
// nothing passed), so the repo comes from the route — the same way RollbarBrowse scopes itself.
// With no repo routed yet, offer the picker rather than a dead end.
import { createQuery } from '@tanstack/solid-query'
import { useNavigate, useParams } from '@solidjs/router'
import { createMemo, Show } from 'solid-js'
import RepoPicker from '../../../core/client/ui/RepoPicker'
import { pinsOptions, reposOptions } from '../../../core/client/queries'
import HttpPanel from './HttpPanel'
import './http.css'

export default function HttpBrowse() {
  const params = useParams()
  const navigate = useNavigate()
  const repos = createQuery(() => reposOptions(true))
  const pins = createQuery(() => pinsOptions(true))
  // Neither an owner nor a repo name can contain '/', so one string is a safe carrier — and with
  // `keyed` below it makes the panel rebuild on a repo switch rather than leaking the previous
  // repo's draft and response into the new one.
  const target = createMemo(() => (params.owner && params.repo ? `${params.owner}/${params.repo}` : null))

  return (
    <Show
      when={target()}
      keyed
      fallback={
        <div class="http-choose-repo">
          <h2>API</h2>
          <p class="http-hint">Saved requests belong to a repo. Pick one to get started.</p>
          <RepoPicker
            repos={repos.data ?? []}
            pinned={pins.data ?? []}
            selected=""
            onSelect={(value) => navigate(`/${value}`)}
          />
        </div>
      }
    >
      {(key) => {
        const [owner, repo] = key.split('/')
        return <HttpPanel owner={owner} repo={repo} />
      }}
    </Show>
  )
}

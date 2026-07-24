// Settings → Docker: daemon availability readout + behaviour toggles + the [docker] config
// reference (per-repo matcher overrides live in .acorn/config.toml, not here).
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { createResource, Show } from 'solid-js'
import { prefsOptions } from '../../../core/client/queries'
import type { DockerInfo } from '../shared/model'
import { fetchDockerInfo } from './dockerClient'
import { readDockerPrefs, saveDockerPrefs, type DockerPrefs } from './dockerPrefs'
import './docker.css'

const infoText = (info: DockerInfo): string =>
  info.available
    ? `Connected — engine ${info.version}, context ${info.context ?? 'default'}.`
    : `Unavailable — ${info.detail}`

export default function DockerSettings() {
  const qc = useQueryClient()
  const prefs = createQuery(() => prefsOptions(true))
  const current = () => readDockerPrefs(prefs.data)

  const [info] = createResource(fetchDockerInfo)
  const toggle = (key: keyof DockerPrefs) => void saveDockerPrefs(qc, { ...current(), [key]: !current()[key] })

  return (
    <>
      <p class="muted">
        <Show when={info()} fallback={'Checking the daemon…'}>{(i) => infoText(i())}</Show>
      </p>

      <label class="settings-field">
        <span class="settings-label">
          <input type="checkbox" checked={current().confirmDestructive} onChange={() => toggle('confirmDestructive')} />
          {' '}Ask twice before destructive actions (remove, prune, compose down)
        </span>
      </label>
      <label class="settings-field">
        <span class="settings-label">
          <input type="checkbox" checked={current().showStopped} onChange={() => toggle('showStopped')} />
          {' '}Show stopped containers in the Docker source
        </span>
      </label>

      <p class="muted">
        Task↔container linking is automatic for compose stacks started in a task worktree. Repos can
        tune the matcher in <code>.acorn/config.toml</code>:
      </p>
      <pre class="docker-settings-code">{`[docker]
compose_project = "myproject"   # always link this compose project's containers
match_labels = ["acorn.task"]   # label keys whose value equals the task's branch slug
match_name = true               # allow the branch-slug-in-name fallback`}</pre>
      <p class="muted">
        Stack commands (start/stop/dev servers) belong in <code>[scripts.run.*]</code> run targets —
        they get the trust gate and the run buttons on the task.
      </p>
    </>
  )
}

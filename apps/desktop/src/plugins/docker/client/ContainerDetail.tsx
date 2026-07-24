// Shared container detail panel (docs/ui-design.md): Info + live Logs + live Stats tabs, used by
// the browse right pane and the task pane — one component, two hosts (the RollbarItemPanel split).
import { createEffect, createResource, createSignal, For, on, onCleanup, Show, type JSX } from 'solid-js'
import { writeJson } from '../../../core/client/apiClient'
import { requestTerminalFocusIntent } from '../../../core/client/registries/clientEvents'
import { terminalSessionsRoute } from '../../../core/shared/api'
import { wsDockerAttach } from '../../../core/client/wsClient'
import type { DockerStatsSample } from '../../../core/shared/docker'
import type { DockerContainerAction, DockerContainerDetail, DockerPort } from '../shared/model'
import { containerAction, fetchContainerDetail, removeContainer } from './dockerClient'
import { refreshDocker } from './dockerStore'
import DockerExecTerminal from './DockerExecTerminal'

// Try bash, fall back to sh — works across alpine/debian-ish images.
const execCommand = (ref: string): string => `docker exec -it ${ref} sh -c 'command -v bash >/dev/null && exec bash || exec sh'`

type Tab = 'info' | 'logs' | 'stats' | 'terminal'

const MAX_LOG_CHARS = 512 * 1024 // ponytail: char-capped ring; virtualize if huge logs ever matter

const portLabel = (p: DockerPort): string =>
  p.hostPort ? `${p.hostPort} → ${p.containerPort}/${p.protocol}` : `${p.containerPort}/${p.protocol}`

export default function ContainerDetail(props: { target: string; taskId?: string; onRemoved?: () => void; actions?: JSX.Element }) {
  const [tab, setTab] = createSignal<Tab>('info')
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')
  const [confirmRm, setConfirmRm] = createSignal(false)
  const [copied, setCopied] = createSignal('')
  const [showEnv, setShowEnv] = createSignal(false)

  const [detail, { refetch }] = createResource(() => props.target, fetchContainerDetail)

  // Live logs: attach while the tab is open (docker itself replays the tail on attach).
  const [logText, setLogText] = createSignal('')
  const [logEnded, setLogEnded] = createSignal(false)
  const [follow, setFollow] = createSignal(true)
  let logEl: HTMLPreElement | undefined
  createEffect(on(() => (tab() === 'logs' ? props.target : null), (ref) => {
    setLogText('')
    setLogEnded(false)
    if (!ref) return
    const off = wsDockerAttach('logs', ref, (event) => {
      if (event.kind === 'log') {
        setLogText((t) => (t + event.data).slice(-MAX_LOG_CHARS))
        // Scroll after the reactive flush has rendered the appended text.
        if (follow()) queueMicrotask(() => {
          if (follow() && logEl) logEl.scrollTop = logEl.scrollHeight
        })
      } else if (event.kind === 'end') setLogEnded(true)
    })
    onCleanup(off)
  }))

  // Live stats: one sample per docker tick; keep a short history for the text readout.
  const [stats, setStats] = createSignal<DockerStatsSample | null>(null)
  const [statsEnded, setStatsEnded] = createSignal(false)
  createEffect(on(() => (tab() === 'stats' ? props.target : null), (ref) => {
    setStats(null)
    setStatsEnded(false)
    if (!ref) return
    const off = wsDockerAttach('stats', ref, (event) => {
      if (event.kind === 'stats') setStats(event.sample)
      else if (event.kind === 'end') setStatsEnded(true)
    })
    onCleanup(off)
  }))

  async function act(action: DockerContainerAction) {
    setBusy(true)
    setError('')
    try {
      await containerAction(props.target, action)
      await Promise.all([refetch(), refreshDocker()])
    } catch (e) {
      setError(e instanceof Error ? e.message : `${action} failed`)
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!confirmRm()) {
      setConfirmRm(true)
      setTimeout(() => setConfirmRm(false), 3000)
      return
    }
    setBusy(true)
    setError('')
    try {
      await removeContainer(props.target, detail()?.state === 'running')
      await refreshDocker()
      props.onRemoved?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'remove failed')
    } finally {
      setBusy(false)
      setConfirmRm(false)
    }
  }

  function copyPort(p: DockerPort) {
    if (!p.hostPort) return
    const url = `http://localhost:${p.hostPort}`
    void navigator.clipboard.writeText(url)
    setCopied(url)
    setTimeout(() => setCopied(''), 1500)
  }

  // Exec into the container. With a task in scope, open it as a session in the task's terminal
  // drawer (plain HTTP + the core focus intent — no terminal-plugin import). Without one, copy the
  // command for any terminal.
  async function openExec(name: string) {
    if (!props.taskId) {
      void navigator.clipboard.writeText(execCommand(name))
      setCopied('exec command')
      setTimeout(() => setCopied(''), 1500)
      return
    }
    setError('')
    try {
      const session = await writeJson<{ id: string }>(terminalSessionsRoute, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ taskId: props.taskId, command: execCommand(name), title: `docker: ${name}` }),
      })
      requestTerminalFocusIntent(props.taskId, session.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not open a terminal session')
    }
  }

  const running = () => detail()?.state === 'running'

  return (
    <div class="docker-detail">
      <Show when={detail()} fallback={<p class="placeholder">{detail.error ? 'Container not found.' : 'Loading…'}</p>}>
        {(d) => (
          <>
            <header class="docker-detail-header">
              <span class="docker-dot" data-state={d().state} />
              <span class="docker-detail-name" title={d().name}>{d().name}</span>
              <span class="docker-detail-actions">
                <Show when={!running()}>
                  <button type="button" class="overlay-btn" disabled={busy()} onClick={() => void act('start')}>Start</button>
                </Show>
                <Show when={running()}>
                  <button type="button" class="overlay-btn" disabled={busy()} onClick={() => void act('stop')}>Stop</button>
                  <button type="button" class="overlay-btn" disabled={busy()} onClick={() => void act('restart')}>Restart</button>
                  <button
                    type="button"
                    class="overlay-btn"
                    title={props.taskId ? 'Open a shell in this container in the task terminal' : 'Copy a docker exec command'}
                    onClick={() => void openExec(d().name)}
                  >
                    {props.taskId ? 'Terminal' : 'Copy exec'}
                  </button>
                </Show>
                <button type="button" class="overlay-btn docker-danger" disabled={busy()} onClick={() => void remove()}>
                  {confirmRm() ? 'Sure?' : 'Remove'}
                </button>
                {props.actions}
              </span>
            </header>
            <div class="docker-detail-sub muted">
              {d().image} · {d().status}{d().health ? ` · ${d().health}` : ''}
              <Show when={copied()}><span role="status"> · copied {copied()}</span></Show>
            </div>
            <Show when={error()}><div class="action-error" role="alert">{error()}</div></Show>

            <nav class="docker-tabs">
              <button type="button" classList={{ active: tab() === 'info' }} onClick={() => setTab('info')}>Info</button>
              <button type="button" classList={{ active: tab() === 'logs' }} onClick={() => setTab('logs')}>Logs</button>
              <button type="button" classList={{ active: tab() === 'stats' }} onClick={() => setTab('stats')}>Stats</button>
              <Show when={running()}>
                <button type="button" classList={{ active: tab() === 'terminal' }} onClick={() => setTab('terminal')}>Terminal</button>
              </Show>
            </nav>

            <Show when={tab() === 'info'}>
              <dl class="docker-info">
                <dt>ID</dt><dd class="mono">{d().id}</dd>
                <dt>Command</dt><dd class="mono" title={d().command}>{d().command}</dd>
                <dt>State</dt><dd>{d().state}{d().exitCode !== null && d().state === 'exited' ? ` (exit ${d().exitCode})` : ''}</dd>
                <Show when={d().startedAt}><dt>Started</dt><dd>{new Date(d().startedAt!).toLocaleString()}</dd></Show>
                <Show when={d().restartCount > 0}><dt>Restarts</dt><dd>{d().restartCount}</dd></Show>
                <Show when={d().composeProject}>
                  <dt>Compose</dt><dd class="mono">{d().composeProject}{d().composeService ? ` / ${d().composeService}` : ''}</dd>
                </Show>
                <Show when={d().composeWorkingDir}><dt>Working dir</dt><dd class="mono" title={d().composeWorkingDir!}>{d().composeWorkingDir}</dd></Show>
                <Show when={d().ports.length}>
                  <dt>Ports</dt>
                  <dd class="docker-ports">
                    <For each={d().ports}>
                      {(p) => (
                        <button
                          type="button"
                          class="docker-port-chip"
                          disabled={!p.hostPort}
                          title={p.hostPort ? `Copy http://localhost:${p.hostPort}` : 'Not published'}
                          onClick={() => copyPort(p)}
                        >
                          {portLabel(p)}
                        </button>
                      )}
                    </For>
                    <Show when={copied()}><span class="muted" role="status">copied {copied()}</span></Show>
                  </dd>
                </Show>
                <Show when={d().mounts.length}>
                  <dt>Mounts</dt>
                  <dd>
                    <ul class="docker-mounts">
                      <For each={d().mounts}>
                        {(m) => <li class="mono" title={`${m.source} → ${m.destination}`}>{m.type}: {m.destination}{m.rw ? '' : ' (ro)'}</li>}
                      </For>
                    </ul>
                  </dd>
                </Show>
                <Show when={d().networks.length}><dt>Networks</dt><dd class="mono">{d().networks.join(', ')}</dd></Show>
                <Show when={d().env.length}>
                  <dt>Env</dt>
                  <dd>
                    <Show when={showEnv()} fallback={<button type="button" class="overlay-btn" onClick={() => setShowEnv(true)}>Show {d().env.length} variables</button>}>
                      <ul class="docker-env mono"><For each={d().env}>{(line) => <li>{line}</li>}</For></ul>
                    </Show>
                  </dd>
                </Show>
              </dl>
            </Show>

            <Show when={tab() === 'logs'}>
              <div class="docker-logs-bar">
                <label class="docker-follow">
                  <input type="checkbox" checked={follow()} onChange={(e) => setFollow(e.currentTarget.checked)} /> Follow
                </label>
                <span class="muted">{logEnded() ? 'stream ended' : 'live · last 300 lines replayed'}</span>
              </div>
              <pre
                class="docker-logs mono"
                ref={logEl}
                onScroll={() => {
                  if (!logEl) return
                  // Manual scroll-up pauses follow; scrolling back to the bottom resumes it.
                  setFollow(logEl.scrollTop + logEl.clientHeight >= logEl.scrollHeight - 8)
                }}
              >{logText() || 'Waiting for log output…'}</pre>
            </Show>

            <Show when={tab() === 'terminal' && running()}>
              <DockerExecTerminal containerRef={d().name} />
            </Show>

            <Show when={tab() === 'stats'}>
              <Show when={stats()} fallback={<p class="placeholder">{statsEnded() ? 'Stats stream ended (container stopped?).' : running() ? 'Sampling…' : 'Container is not running.'}</p>}>
                {(s) => (
                  <dl class="docker-info docker-stats">
                    <dt>CPU</dt>
                    <dd><meter class="docker-meter" min="0" max="100" value={Math.min(s().cpuPercent, 100)} /> {s().cpuPercent.toFixed(1)}%</dd>
                    <dt>Memory</dt>
                    <dd><meter class="docker-meter" min="0" max="100" value={Math.min(s().memPercent, 100)} /> {s().memUsage} ({s().memPercent.toFixed(1)}%)</dd>
                    <dt>Network I/O</dt><dd class="mono">{s().netIO}</dd>
                    <dt>Block I/O</dt><dd class="mono">{s().blockIO}</dd>
                    <dt>PIDs</dt><dd>{s().pids}</dd>
                  </dl>
                )}
              </Show>
            </Show>
          </>
        )}
      </Show>
    </div>
  )
}

// Shared container detail panel (docs/ui-design.md): Info + live Logs + live Stats tabs, used by
// the browse right pane and the task pane. One component, two hosts, the same split as
// RollbarItemPanel.
import { createEffect, createMemo, createResource, createSignal, For, on, onCleanup, Show, type JSX } from 'solid-js'
import { requestTerminalFocusIntent, toast, writeJson } from '@acorn/plugin-api/client'
import { terminalSessionsRoute } from '@acorn/plugin-terminal/contract/routes.ts'
import { wsDockerAttach } from './wsChannel'
import type { DockerStatsSample } from '../shared/wsFrames'
import type { DockerContainerAction, DockerPort } from '../shared/model'
import { containerAction, fetchContainerDetail, removeContainer } from './dockerClient'
import { refreshDocker } from './dockerStore'
import { dockerLogBuffer, type DockerLogBuffer } from './dockerLogStore'
import { containerTone, dockerDetailState, rememberDockerDetailState, type DockerDetailTab as Tab } from './dockerViewState'
import DockerExecTerminal from './DockerExecTerminal'
import { Alert, Button, Checkbox, Chip, DescriptionList, EmptyState, FindBar, Meter, StatusDot, Tabs, createArmedConfirm } from '@acorn/plugin-api/ui'

  // Try bash, fall back to sh. Works across alpine/debian-ish images.
const execCommand = (ref: string): string => `docker exec -it ${ref} sh -c 'command -v bash >/dev/null && exec bash || exec sh'`

const portLabel = (p: DockerPort): string =>
  p.hostPort ? `${p.hostPort} → ${p.containerPort}/${p.protocol}` : `${p.containerPort}/${p.protocol}`

export default function ContainerDetail(props: { target: string; taskId?: string; onRemoved?: () => void; actions?: JSX.Element }) {
  const initialView = dockerDetailState(props.taskId, props.target)
  const [tab, setTab] = createSignal<Tab>(initialView?.tab ?? 'info')
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')
  const armed = createArmedConfirm()
  const [showEnv, setShowEnv] = createSignal(false)

  const [detail, { refetch }] = createResource(() => props.target, fetchContainerDetail)

  // Live logs: a session-scoped buffer (dockerLogStore) that outlives this component, so
  // navigating away and back lands on the same content; view state (tab/scroll/follow/find) is
  // restored per container via dockerViewState.
  const [logBuf, setLogBuf] = createSignal<DockerLogBuffer | null>(null)
  const [follow, setFollow] = createSignal(initialView?.logFollow ?? true)
  const [logQuery, setLogQuery] = createSignal(initialView?.logQuery ?? '')
  const [matchIdx, setMatchIdx] = createSignal(0)
  let logEl: HTMLPreElement | undefined
  let logScrollTop = initialView?.logScrollTop ?? 0 // captured in onScroll; a detached <pre> reads 0
  const logText = () => logBuf()?.text() ?? ''
  const logEnded = () => logBuf()?.ended() ?? false

  // Remembered eagerly on every mutation (tab/scroll/follow/find), so no unmount hook is needed.
  const rememberView = () => rememberDockerDetailState(props.taskId, props.target, {
    tab: tab(), logScrollTop, logFollow: follow(), logQuery: logQuery(),
  })
  const switchTab = (t: Tab) => {
    setTab(t)
    rememberView()
  }

  // Chip switches change props.target without remounting. Restore the new container's view state.
  createEffect(on(() => props.target, (target) => {
    const saved = dockerDetailState(props.taskId, target)
    setTab(saved?.tab ?? 'info')
    setFollow(saved?.logFollow ?? true)
    setLogQuery(saved?.logQuery ?? '')
    setMatchIdx(0)
    logScrollTop = saved?.logScrollTop ?? 0
  }, { defer: true }))

  createEffect(on(() => (tab() === 'logs' ? props.target : null), (ref) => {
    if (!ref) return setLogBuf(null)
    setLogBuf(dockerLogBuffer(ref))
    // Land back on the remembered spot (follow mode pins to the bottom via the effect below).
    if (!follow()) queueMicrotask(() => {
      if (logEl) logEl.scrollTop = logScrollTop
    })
  }))

  // Scroll after the reactive flush has rendered appended output.
  createEffect(on(logText, () => {
    if (follow()) queueMicrotask(() => {
      if (follow() && logEl) logEl.scrollTop = logEl.scrollHeight
    })
  }))
  // Find-in-logs: case-insensitive substring over the visible buffer, rendered as <mark> segments.
  const MAX_MATCHES = 5000 // mark-render cap; incremental match tracking if it ever binds
  const logMatches = createMemo(() => {
    const q = logQuery().toLowerCase()
    if (!q) return []
    const text = logText().toLowerCase()
    const out: number[] = []
    let i = text.indexOf(q)
    while (i !== -1 && out.length < MAX_MATCHES) {
      out.push(i)
      i = text.indexOf(q, i + q.length)
    }
    return out
  })
  const currentMatch = () => (logMatches().length ? Math.min(matchIdx(), logMatches().length - 1) : -1)
  const logSegments = createMemo(() => {
    const q = logQuery()
    if (!q) return null
    const text = logText()
    const parts: { text: string; match?: number }[] = []
    let last = 0
    logMatches().forEach((start, i) => {
      if (start > last) parts.push({ text: text.slice(last, start) })
      parts.push({ text: text.slice(start, start + q.length), match: i })
      last = start + q.length
    })
    parts.push({ text: text.slice(last) })
    return parts
  })
  function navMatch(dir: 1 | -1) {
    const n = logMatches().length
    if (!n) return
    setFollow(false)
    setMatchIdx(((currentMatch() + dir) % n + n) % n)
    queueMicrotask(() => logEl?.querySelector('mark.current')?.scrollIntoView({ block: 'center' }))
  }

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
    if (!armed.request('remove')) return
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
      armed.disarm()
    }
  }

  function copyPort(p: DockerPort) {
    if (!p.hostPort) return
    const url = `http://localhost:${p.hostPort}`
    void navigator.clipboard.writeText(url)
    toast(`Copied ${url}`)
  }

  // Exec into the container. With a task in scope, open it as a session in the task's terminal
  // drawer (plain HTTP plus the core focus intent, no terminal-plugin import). Without one, copy
  // the command for any terminal.
  async function openExec(name: string) {
    if (!props.taskId) {
      void navigator.clipboard.writeText(execCommand(name))
      toast('Copied exec command')
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
      <Show when={detail()} fallback={<EmptyState align="start" busy={!detail.error}>{detail.error ? 'Container not found.' : 'Loading…'}</EmptyState>}>
        {(d) => (
          <>
            <header class="docker-detail-header">
              <StatusDot tone={containerTone(d().state)} />
              <span class="docker-detail-name" title={d().name}>{d().name}</span>
              <span class="docker-detail-actions">
                <Show when={!running()}>
                  <Button disabled={busy()} onClick={() => void act('start')}>Start</Button>
                </Show>
                <Show when={running()}>
                  <Button disabled={busy()} onClick={() => void act('stop')}>Stop</Button>
                  <Button disabled={busy()} onClick={() => void act('restart')}>Restart</Button>
                  <Button
                    title={props.taskId ? 'Open a shell in this container in the task terminal' : 'Copy a docker exec command'}
                    onClick={() => void openExec(d().name)}
                  >
                    {props.taskId ? 'Terminal' : 'Copy exec'}
                  </Button>
                </Show>
                <Button tone="danger" disabled={busy()} onClick={() => void remove()}>
                  {armed.armed() ? 'Sure?' : 'Remove'}
                </Button>
                {props.actions}
              </span>
            </header>
            <div class="docker-detail-sub muted">
              {d().image} · {d().status}{d().health ? ` · ${d().health}` : ''}
            </div>
            <Show when={error()}><Alert>{error()}</Alert></Show>

            {/* Terminal is conditional, so the tab list is derived rather than a module constant. */}
            <Tabs
              tabs={[
                { id: 'info', label: 'Info' },
                { id: 'logs', label: 'Logs' },
                { id: 'stats', label: 'Stats' },
                ...(running() ? [{ id: 'terminal', label: 'Terminal' }] : []),
              ]}
              active={tab()}
              onChange={(id) => switchTab(id as Tab)}
              idPrefix="docker-detail"
              ariaLabel="Container detail"
            />

            <Show when={tab() === 'info'}>
              <DescriptionList class="docker-info" size="sm">
                <DescriptionList.Item label="ID" mono>{d().id}</DescriptionList.Item>
                <DescriptionList.Item label="Command" mono>{d().command}</DescriptionList.Item>
                <DescriptionList.Item label="State">{d().state}{d().exitCode !== null && d().state === 'exited' ? ` (exit ${d().exitCode})` : ''}</DescriptionList.Item>
                <Show when={d().startedAt}><DescriptionList.Item label="Started">{new Date(d().startedAt!).toLocaleString()}</DescriptionList.Item></Show>
                <Show when={d().restartCount > 0}><DescriptionList.Item label="Restarts">{d().restartCount}</DescriptionList.Item></Show>
                <Show when={d().composeProject}>
                  <DescriptionList.Item label="Compose" mono>{d().composeProject}{d().composeService ? ` / ${d().composeService}` : ''}</DescriptionList.Item>
                </Show>
                <Show when={d().composeWorkingDir}><DescriptionList.Item label="Working dir" mono>{d().composeWorkingDir}</DescriptionList.Item></Show>
                <Show when={d().ports.length}>
                  <DescriptionList.Item label="Ports">
                    <span class="docker-ports">
                      <For each={d().ports}>
                        {(p) => (
                          <Chip
                            class="docker-port-chip"
                            title={p.hostPort ? `Copy http://localhost:${p.hostPort}` : 'Not published'}
                            {...(p.hostPort ? { onActivate: () => copyPort(p) } : {})}
                          >
                            {portLabel(p)}
                          </Chip>
                        )}
                      </For>
                    </span>
                  </DescriptionList.Item>
                </Show>
                <Show when={d().mounts.length}>
                  <DescriptionList.Item label="Mounts">
                    <ul class="list-reset">
                      <For each={d().mounts}>
                        {(m) => <li class="mono" title={`${m.source} → ${m.destination}`}>{m.type}: {m.destination}{m.rw ? '' : ' (ro)'}</li>}
                      </For>
                    </ul>
                  </DescriptionList.Item>
                </Show>
                <Show when={d().networks.length}><DescriptionList.Item label="Networks" mono>{d().networks.join(', ')}</DescriptionList.Item></Show>
                <Show when={d().env.length}>
                  <DescriptionList.Item label="Env">
                    <Show when={showEnv()} fallback={<Button onClick={() => setShowEnv(true)}>Show {d().env.length} variables</Button>}>
                      <ul class="docker-env list-reset mono"><For each={d().env}>{(line) => <li>{line}</li>}</For></ul>
                    </Show>
                  </DescriptionList.Item>
                </Show>
              </DescriptionList>
            </Show>

            <Show when={tab() === 'logs'}>
              {/* The three surfaces that had a find strip disagreed on the keyboard contract;
                  FindBar owns it (⏎ next, ⇧⏎ prev, Esc close) and the count is announced. */}
              <FindBar
                class="docker-logs-bar"
                placeholder="Find in logs"
                query={logQuery()}
                onQuery={(query) => {
                  setLogQuery(query)
                  setMatchIdx(0)
                  rememberView()
                }}
                count={logQuery() ? { current: currentMatch() + 1, total: logMatches().length } : undefined}
                onNext={() => navMatch(1)}
                onPrev={() => navMatch(-1)}
                onClose={() => setLogQuery('')}
                status={logEnded() ? 'stream ended' : 'live'}
                toggles={
                  <>
                    <Checkbox
                      class="docker-follow"
                      label="Follow"
                      checked={follow()}
                      onChange={(e) => {
                        setFollow(e.currentTarget.checked)
                        rememberView()
                      }}
                    />
                    <Button
                      variant="bare"
                      size="sm"
                      data-tip="Clear the current log view"
                      data-tip-sub="The stream keeps appending"
                      onClick={() => logBuf()?.clear()}
                    >
                      Clear
                    </Button>
                  </>
                }
              />
              <pre
                class="docker-logs mono"
                ref={logEl}
                onScroll={() => {
                  if (!logEl) return
                  logScrollTop = logEl.scrollTop
                  // Manual scroll-up pauses follow; scrolling back to the bottom resumes it.
                  setFollow(logEl.scrollTop + logEl.clientHeight >= logEl.scrollHeight - 8)
                  rememberView()
                }}
              >
                <Show when={logSegments()} fallback={logText() || 'Waiting for log output…'}>
                  {(parts) => (
                    <For each={parts()}>
                      {(p) => (p.match === undefined ? p.text : <mark class="ui-find-mark" {...(p.match === currentMatch() ? { 'data-current': '' } : {})}>{p.text}</mark>)}
                    </For>
                  )}
                </Show>
              </pre>
            </Show>

            <Show when={tab() === 'terminal' && running()}>
              <DockerExecTerminal containerRef={d().name} />
            </Show>

            <Show when={tab() === 'stats'}>
              <Show when={stats()} fallback={<EmptyState align="start" busy={!statsEnded() && running()}>{statsEnded() ? 'Stats stream ended (container stopped?).' : running() ? 'Sampling…' : 'Container is not running.'}</EmptyState>}>
                {(s) => (
                  <DescriptionList class="docker-info docker-stats" size="sm">
                    <DescriptionList.Item label="CPU">
                      <Meter class="docker-meter" tone="auto" label="CPU" value={s().cpuPercent / 100} /> {s().cpuPercent.toFixed(1)}%
                    </DescriptionList.Item>
                    <DescriptionList.Item label="Memory">
                      <Meter class="docker-meter" tone="auto" label="Memory" value={s().memPercent / 100} /> {s().memUsage} ({s().memPercent.toFixed(1)}%)
                    </DescriptionList.Item>
                    <DescriptionList.Item label="Network I/O" mono>{s().netIO}</DescriptionList.Item>
                    <DescriptionList.Item label="Block I/O" mono>{s().blockIO}</DescriptionList.Item>
                    <DescriptionList.Item label="PIDs">{s().pids}</DescriptionList.Item>
                  </DescriptionList>
                )}
              </Show>
            </Show>
          </>
        )}
      </Show>
    </div>
  )
}

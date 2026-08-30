// Shared container detail panel (docs/docker.md): Info + live Logs + live Stats tabs, used by the
// browse right pane and the task pane. One component, two hosts, the same split as RollbarItemPanel.
import { createEffect, createMemo, createResource, createSignal, For, on, onCleanup, Show, type JSX } from 'solid-js'
import { requestTerminalFocusIntent, toast, writeJson } from '@acorn/plugin-api/client'
import { terminalSessionsRoute } from '@acorn/plugin-terminal/contract/routes.ts'
import { wsDockerAttach } from './wsChannel'
import type { DockerStatsSample } from '../shared/wsFrames'
import type { DockerContainerAction, DockerPort } from '../shared/model'
import { containerAction, fetchContainerDetail, removeContainer } from './dockerClient'
import { refreshDocker } from './dockerStore'
import { dockerLogBuffer, type DockerLogBuffer } from './dockerLogStore'
import { containerTone, dockerDetailState, rememberDockerDetailState, type DockerDetailTab as Tab } from './dockerViewStore'
import DockerExecTerminal from './DockerExecTerminal'
import { STATS_BESIDE_POINT } from './extensionPoints'
import {
  Alert, Button, Checkbox, Chip, ChipRow, ConfirmButton, EmptyState, Facts, FindBar, Heading, Inline,
  Log, Meter, Stack, StatusDot, TabPanel, Tabs, Text, Toolbar,
} from '@acorn/plugin-api/ui'
import { Slot } from '@acorn/plugin-api/ui/host'

  // Try bash, fall back to sh. Works across alpine/debian-ish images.
const execCommand = (ref: string): string => `docker exec -it ${ref} sh -c 'command -v bash >/dev/null && exec bash || exec sh'`

const portLabel = (p: DockerPort): string =>
  p.hostPort ? `${p.hostPort} → ${p.containerPort}/${p.protocol}` : `${p.containerPort}/${p.protocol}`

export default function ContainerDetail(props: { target: string; taskId?: string; onRemoved?: () => void; actions?: JSX.Element }) {
  const initialView = dockerDetailState(props.taskId, props.target)
  const [tab, setTab] = createSignal<Tab>(initialView?.tab ?? 'info')
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')
  const [showEnv, setShowEnv] = createSignal(false)

  const [detail, { refetch }] = createResource(() => props.target, fetchContainerDetail)

  // Live logs: a session-scoped buffer (dockerLogStore) that outlives this component, so
  // navigating away and back lands on the same content; view state (tab/follow/find) is restored per
  // container via dockerViewState. The scroll position is `Log`'s to keep now — the kit owns the
  // follow behaviour, so the pane no longer holds a `<pre>` ref to read one off.
  const [logBuf, setLogBuf] = createSignal<DockerLogBuffer | null>(null)
  const [follow, setFollow] = createSignal(initialView?.logFollow ?? true)
  const [logQuery, setLogQuery] = createSignal(initialView?.logQuery ?? '')
  const [matchIdx, setMatchIdx] = createSignal(0)
  const logText = () => logBuf()?.text() ?? ''
  const logEnded = () => logBuf()?.ended() ?? false
  const logLines = createMemo(() => logText().split('\n'))

  // Remembered eagerly on every mutation (tab/follow/find), so no unmount hook is needed.
  const rememberView = () => rememberDockerDetailState(props.taskId, props.target, {
    tab: tab(), logScrollTop: 0, logFollow: follow(), logQuery: logQuery(),
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
  }, { defer: true }))

  createEffect(on(() => (tab() === 'logs' ? props.target : null), (ref) => {
    setLogBuf(ref ? dockerLogBuffer(ref) : null)
  }))

  // Find-in-logs: case-insensitive substring over the visible buffer. The count and the keyboard
  // contract are FindBar's; which lines match is this pane's, because it holds the buffer.
  const MAX_MATCHES = 5000
  const logMatches = createMemo(() => {
    const q = logQuery().toLowerCase()
    if (!q) return []
    const out: number[] = []
    logLines().forEach((line, index) => {
      if (out.length < MAX_MATCHES && line.toLowerCase().includes(q)) out.push(index)
    })
    return out
  })
  const currentMatch = () => (logMatches().length ? Math.min(matchIdx(), logMatches().length - 1) : -1)
  function navMatch(dir: 1 | -1) {
    const n = logMatches().length
    if (!n) return
    setFollow(false)
    setMatchIdx(((currentMatch() + dir) % n + n) % n)
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
    <Stack gap="row">
      <Show when={detail()} fallback={<EmptyState align="start" busy={!detail.error}>{detail.error ? 'Container not found.' : 'Loading…'}</EmptyState>}>
        {(d) => (
          <>
            <Toolbar ariaLabel="Container">
              <StatusDot tone={containerTone(d().state)} />
              <Heading level={3}>{d().name}</Heading>
              <Toolbar.Spacer />
              <Show when={!running()}>
                <Button size="sm" disabled={busy()} onPress={() => void act('start')}>Start</Button>
              </Show>
              <Show when={running()}>
                <Button size="sm" disabled={busy()} onPress={() => void act('stop')}>Stop</Button>
                <Button size="sm" disabled={busy()} onPress={() => void act('restart')}>Restart</Button>
                <Button
                  size="sm"
                  title={props.taskId ? 'Open a shell in this container in the task terminal' : 'Copy a docker exec command'}
                  onPress={() => void openExec(d().name)}
                >
                  {props.taskId ? 'Terminal' : 'Copy exec'}
                </Button>
              </Show>
              <ConfirmButton size="sm" tone="danger" label="Remove" disabled={busy()} onConfirm={() => void remove()}>Remove</ConfirmButton>
              {props.actions}
            </Toolbar>
            <Text emphasis="muted">{d().image} · {d().status}{d().health ? ` · ${d().health}` : ''}</Text>
            <Show when={error()}>{(text) => <Alert>{text()}</Alert>}</Show>

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

            <TabPanel id="info" active={tab()} idPrefix="docker-detail">
              {/* Rows, not tiles: half of these are a long mono string — an id, a command, a working
                  directory — and this pane is often one narrow column of a task row, where a tile grid
                  gives each of them 150px and wraps it to four lines. */}
              <Facts
                size="sm"
                grouping="rows"
                items={[
                  { label: 'ID', value: d().id, mono: true },
                  { label: 'Command', value: d().command, mono: true },
                  { label: 'State', value: `${d().state}${d().exitCode !== null && d().state === 'exited' ? ` (exit ${d().exitCode})` : ''}` },
                  ...(d().startedAt ? [{ label: 'Started', value: new Date(d().startedAt!).toLocaleString() }] : []),
                  ...(d().restartCount > 0 ? [{ label: 'Restarts', value: String(d().restartCount) }] : []),
                  ...(d().composeProject
                    ? [{ label: 'Compose', value: `${d().composeProject}${d().composeService ? ` / ${d().composeService}` : ''}`, mono: true }]
                    : []),
                  ...(d().composeWorkingDir ? [{ label: 'Working dir', value: d().composeWorkingDir!, mono: true }] : []),
                  ...(d().ports.length
                    ? [{
                      label: 'Ports',
                      value: (
                        <ChipRow ariaLabel="Published ports">
                          <For each={d().ports}>
                            {(p) => (
                              <Chip
                                title={p.hostPort ? `Copy http://localhost:${p.hostPort}` : 'Not published'}
                                {...(p.hostPort ? { onPress: () => copyPort(p) } : {})}
                              >
                                {portLabel(p)}
                              </Chip>
                            )}
                          </For>
                        </ChipRow>
                      ),
                    }]
                    : []),
                  ...(d().mounts.length
                    ? [{
                      label: 'Mounts',
                      value: (
                        <Stack gap="none">
                          <For each={d().mounts}>
                            {(m) => <Text emphasis="mono">{m.type}: {m.destination}{m.rw ? '' : ' (ro)'}</Text>}
                          </For>
                        </Stack>
                      ),
                    }]
                    : []),
                  ...(d().networks.length ? [{ label: 'Networks', value: d().networks.join(', '), mono: true }] : []),
                  ...(d().env.length
                    ? [{
                      label: 'Env',
                      value: (
                        <Show when={showEnv()} fallback={<Button size="sm" onPress={() => setShowEnv(true)}>Show {d().env.length} variables</Button>}>
                          <Stack gap="none">
                            <For each={d().env}>{(line) => <Text emphasis="mono">{line}</Text>}</For>
                          </Stack>
                        </Show>
                      ),
                    }]
                    : []),
                ]}
              />
            </TabPanel>

            <TabPanel id="logs" active={tab()} idPrefix="docker-detail">
              {/* The three surfaces that had a find strip disagreed on the keyboard contract;
                  FindBar owns it (⏎ next, ⇧⏎ prev, Esc close) and the count is announced. */}
              <Log
                ariaLabel={`${d().name} logs`}
                lines={logLines()}
                follow={follow()}
                find={
                  <FindBar
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
                          label="Follow"
                          checked={follow()}
                          onChange={(checked) => {
                            setFollow(checked)
                            rememberView()
                          }}
                        />
                        <Button
                          variant="bare"
                          size="sm"
                          tip="Clear the current log view"
                          tipSub="The stream keeps appending"
                          onPress={() => logBuf()?.clear()}
                        >
                          Clear
                        </Button>
                      </>
                    }
                  />
                }
              />
            </TabPanel>

            <TabPanel id="terminal" active={running() ? tab() : ''} idPrefix="docker-detail">
              {/* The exec session draws its own `Rectangle kind="pty"` (./DockerExecTerminal.tsx). */}
              <DockerExecTerminal containerRef={d().name} label={`${d().name} shell`} />
            </TabPanel>

            <TabPanel id="stats" active={tab()} idPrefix="docker-detail">
              <Show when={stats()} fallback={<EmptyState align="start" busy={!statsEnded() && running()}>{statsEnded() ? 'Stats stream ended (container stopped?).' : running() ? 'Sampling…' : 'Container is not running.'}</EmptyState>}>
                {(s) => (
                  <Inline gap="section" wrap>
                    <Facts
                      size="sm"
                      items={[
                        {
                          label: 'CPU',
                          value: <Inline gap="inline"><Meter tone="auto" label="CPU" value={s().cpuPercent / 100} /><Text>{s().cpuPercent.toFixed(1)}%</Text></Inline>,
                        },
                        {
                          label: 'Memory',
                          value: <Inline gap="inline"><Meter tone="auto" label="Memory" value={s().memPercent / 100} /><Text>{s().memUsage} ({s().memPercent.toFixed(1)}%)</Text></Inline>,
                        },
                        { label: 'Network I/O', value: s().netIO, mono: true },
                        { label: 'Block I/O', value: s().blockIO, mono: true },
                        { label: 'PIDs', value: String(s().pids) },
                      ]}
                    />
                    {/* Room beside the numbers for somebody else's: a graph plugin, a cost estimate.
                        `stack`, so every plugin that has something gets a column. */}
                    <Slot point={STATS_BESIDE_POINT} taskId={props.taskId} props={() => ({ container: props.target })} />
                  </Inline>
                )}
              </Show>
            </TabPanel>
          </>
        )}
      </Show>
    </Stack>
  )
}

// Shared container detail panel (docs/docker.md): Info + live Logs + live Stats tabs, used by the
// browse right pane and the task pane. One component, two hosts, the same split as RollbarItemPanel.
import { createEffect, createMemo, createResource, createSignal, on, onCleanup, Show, type JSX } from 'solid-js'
import { queryOwner, requestTerminalFocusIntent, toast, writeJson } from '@acorn/plugin-api/client'
import { useQueryClient } from '@tanstack/solid-query'
import { captureDockerScope } from './dockerScope'
import { terminalSessionsRoute } from '@acorn/plugin-terminal/contract/api.ts'
import { wsDockerAttach } from './wsChannel'
import type { DockerStatsSample } from '../shared/wsFrames'
import type { DockerContainerAction, DockerPort } from '../shared/model'
import { containerAction, fetchContainerDetail, removeContainer } from './dockerClient'
import { refreshDocker } from './dockerStore'
import { dockerLogBuffer, type DockerLogBuffer } from './dockerLogStore'
import { containerTone, dockerDetailState, rememberDockerDetailState, type DockerDetailTab as Tab } from './dockerViewStore'
import DockerExecTerminal from './DockerExecTerminal'
import ContainerInfo from './ContainerInfo'
import { STATS_BESIDE_POINT } from './extensionPoints'
import {
  Alert, Button, Checkbox, ConfirmButton, EmptyState, Facts, FindBar, Icon, IconButton, Inline,
  Log, Meter, Stack, StatusDot, TabPanel, Tabs, Text, Toolbar,
} from '@acorn/plugin-api/ui'
import { Slot } from '@acorn/plugin-api/ui/host'

// Try bash, fall back to sh. Works across alpine/debian-ish images.
const execCommand = (ref: string): string => `docker exec -it ${ref} sh -c 'command -v bash >/dev/null && exec bash || exec sh'`

type ContainerDetailProps = { target: string; taskId?: string; onRemoved?: () => void; actions?: JSX.Element }

export default function ContainerDetail(props: ContainerDetailProps) {
  const view = createMemo(() => ({ target: props.target, taskId: props.taskId }))
  return <Show when={view()} keyed>{(document) => (
    <ContainerDetailView target={document.target} taskId={document.taskId} onRemoved={props.onRemoved} actions={props.actions} />
  )}</Show>
}

function ContainerDetailView(props: ContainerDetailProps) {
  const owner = captureDockerScope(queryOwner(useQueryClient()))
  let mounted = true
  onCleanup(() => { mounted = false })
  const document = createMemo(() => ({ target: props.target, taskId: props.taskId }))
  const captureView = () => {
    const view = document()
    return { ...view, current: () => mounted && owner.current() && view === document() }
  }
  const initialView = dockerDetailState(props.taskId, props.target)
  const [tab, setTab] = createSignal<Tab>(initialView?.tab ?? 'info')
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')
  const [showEnv, setShowEnv] = createSignal(initialView?.showEnv ?? false)

  const [detail, { refetch }] = createResource(() => props.target, target => fetchContainerDetail(target, owner.nodeId))

  // Live logs: a session-scoped buffer (dockerLogStore) that outlives this component, so
  // navigating away and back lands on the same content; view state (tab/follow/find) is restored per
  // container via dockerViewStore. The pane owns the reading place; Log restores it and owns
  // the scroller and follow behaviour.
  const [logBuf, setLogBuf] = createSignal<DockerLogBuffer | null>(null)
  const [follow, setFollow] = createSignal(initialView?.logFollow ?? true)
  const [logQuery, setLogQuery] = createSignal(initialView?.logQuery ?? '')
  const [matchIdx, setMatchIdx] = createSignal(0)
  const logText = () => logBuf()?.text() ?? ''
  const logEnded = () => logBuf()?.ended() ?? false
  const logLines = createMemo(() => logText().split('\n'))

  // Remembered eagerly on every mutation (tab/follow/find), so no unmount hook is needed.
  const rememberView = () => {
    if (!owner.current()) return
    rememberDockerDetailState(props.taskId, props.target, {
      ...dockerDetailState(props.taskId, props.target),
      tab: tab(), logScrollTop: dockerDetailState(props.taskId, props.target)?.logScrollTop ?? 0,
      logFollow: follow(), logQuery: logQuery(), showEnv: showEnv(),
    })
  }
  const rememberPanel = (panel: Tab, offset: number) => {
    if (!owner.current()) return
    const saved = dockerDetailState(props.taskId, props.target)!
    rememberDockerDetailState(props.taskId, props.target, { ...saved, panelOffsets: { ...saved.panelOffsets, [panel]: offset } })
  }
  createEffect(rememberView)
  const switchTab = (t: Tab) => {
    setTab(t)
    rememberView()
  }

  createEffect(on(() => (tab() === 'logs' ? props.target : null), (ref) => {
    setLogBuf(owner.current() && ref ? dockerLogBuffer(ref) : null)
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
    rememberView()
  }

  // Live stats: one sample per docker tick; keep a short history for the text readout.
  const [stats, setStats] = createSignal<DockerStatsSample | null>(null)
  const [statsEnded, setStatsEnded] = createSignal(false)
  createEffect(on(() => (tab() === 'stats' ? props.target : null), (ref) => {
    setStats(null)
    setStatsEnded(false)
    if (!ref || !owner.current()) return
    const off = wsDockerAttach('stats', ref, (event) => {
      if (event.kind === 'stats') setStats(event.sample)
      else if (event.kind === 'end') setStatsEnded(true)
    })
    onCleanup(off)
  }))

  async function act(action: DockerContainerAction) {
    const view = captureView()
    if (!view.current()) return
    setBusy(true)
    setError('')
    try {
      await containerAction(view.target, action, owner.nodeId)
      if (!view.current()) return
      await Promise.all([refetch(), refreshDocker(true)])
    } catch (e) {
      if (view.current()) setError(e instanceof Error ? e.message : `${action} failed`)
    } finally {
      if (view.current()) setBusy(false)
    }
  }

  async function remove() {
    const view = captureView()
    if (!view.current()) return
    setBusy(true)
    setError('')
    try {
      await removeContainer(view.target, detail()?.state === 'running', owner.nodeId)
      if (!view.current()) return
      await refreshDocker(true)
      if (view.current()) props.onRemoved?.()
    } catch (e) {
      if (view.current()) setError(e instanceof Error ? e.message : 'remove failed')
    } finally {
      if (view.current()) setBusy(false)
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
    const view = captureView()
    if (!view.current()) return
    if (!view.taskId) {
      void navigator.clipboard.writeText(execCommand(name))
      toast('Copied the shell command')
      return
    }
    setError('')
    try {
      const session = await writeJson<{ id: string }>(terminalSessionsRoute, {
        nodeId: owner.nodeId,
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ taskId: view.taskId, command: execCommand(name), title: `docker: ${name}` }),
      })
      if (view.current()) requestTerminalFocusIntent(view.taskId, session.id)
    } catch (e) {
      if (view.current()) setError(e instanceof Error ? e.message : "Couldn't open a terminal.")
    }
  }

  const running = () => detail()?.state === 'running'
  createEffect(() => {
    if (detail() && !running() && tab() === 'terminal') switchTab('info')
  })

  // `grow`, so the region gives the log its height and the log scrolls inside it. Without it the
  // column clipped the newest lines, and Follow had no scroller to follow.
  return (
    <Stack gap="none" grow>
      <Show when={detail()} fallback={<EmptyState align="start" busy={!detail.error}>{detail.error ? 'Container not found.' : 'Loading…'}</EmptyState>}>
        {(d) => (
          <>
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
              actions={
                <>
                  <IconButton icon={running() ? 'square' : 'play'} label={running() ? 'Stop' : 'Start'} title={running() ? 'Stop container' : 'Start container'} disabled={busy()} onPress={() => void act(running() ? 'stop' : 'start')} />
                  <Show when={running()}>
                    <IconButton icon="rotate-cw" label="Restart" title="Restart container" disabled={busy()} onPress={() => void act('restart')} />
                    <IconButton icon="terminal" label={props.taskId ? 'Open shell' : 'Copy shell command'} title={props.taskId ? 'Open shell' : 'Copy shell command'} onPress={() => void openExec(d().name)} />
                  </Show>
                  <ConfirmButton variant="bare" size="sm" iconOnly tone="danger" label="Remove container" confirmLabel="Remove container?" disabled={busy()} onConfirm={() => void remove()}><Icon name="trash-2" /></ConfirmButton>
                  {props.actions}
                </>
              }
            />

            <TabPanel id="info" active={tab()} idPrefix="docker-detail" padding="pane"
              scrollOffset={initialView?.panelOffsets?.info ?? 0} onChange={(offset) => rememberPanel('info', offset)}>
              <ContainerInfo detail={d()} showEnv={showEnv()} onToggleEnv={() => { setShowEnv(!showEnv()); rememberView() }} onCopyPort={copyPort} />
            </TabPanel>

            <TabPanel id="logs" active={tab()} idPrefix="docker-detail">
              {/* The three surfaces that had a find strip disagreed on the keyboard contract;
                  FindBar owns it (⏎ next, ⇧⏎ prev, Esc close) and the count is announced. */}
              <Log
                ariaLabel={`${d().name} logs`}
                lines={logLines()}
                follow={follow()}
                scrollOffset={initialView?.logScrollTop ?? 0}
                onChange={(offset) => {
                  if (owner.current() && tab() === 'logs') rememberDockerDetailState(props.taskId, props.target, {
                    ...dockerDetailState(props.taskId, props.target)!, logScrollTop: offset,
                  })
                }}
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
                    onClose={() => { setLogQuery(''); rememberView() }}
                    status={logEnded() ? 'Log stream ended' : 'Live'}
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
                          variant="ghost"
                          size="sm"
                          tip="Clear the log"
                          tipSub="New lines keep coming in."
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
              <Show when={d().id} keyed>{(id) => <DockerExecTerminal containerRef={id} label={`${d().name} shell`} />}</Show>
            </TabPanel>

            <TabPanel id="stats" active={tab()} idPrefix="docker-detail" padding="pane"
              scrollOffset={initialView?.panelOffsets?.stats ?? 0} onChange={(offset) => rememberPanel('stats', offset)}>
              <Show when={stats()} fallback={<EmptyState busy={!statsEnded() && running()}>{statsEnded() ? 'Stats stopped. The container may have stopped.' : running() ? 'Reading stats…' : "The container isn't running."}</EmptyState>}>
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
            <Toolbar variant="status" size="sm" ariaLabel="Container status"
              primary={<Text tip={d().name}>{d().name}</Text>}
              secondary={<Text emphasis="muted" tip={d().image}>{d().image}</Text>}
              essential={<Inline gap="inline"><StatusDot tone={containerTone(d().state)} /><Text>{d().state}{d().health ? ` · ${d().health}` : ''}</Text></Inline>}
            />
          </>
        )}
      </Show>
    </Stack>
  )
}

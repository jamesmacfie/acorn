import { For, Match, Show, Switch, createSignal } from 'solid-js'
import type { BridgePanel } from '@acorn/protocol/extensionBridge.ts'
import type { BrowserPanelBlock, BrowserPanelView } from '@acorn/protocol/plugin/handoffs.ts'
import Icon from '@acorn/client-core/kit/components/content/Icon.tsx'
import { Row, SectionHeader } from '@acorn/client-core/kit/components/primitives.tsx'
import { taskPaneLink } from '../acornLinks'
import { OpenInAcorn } from './OpenInAcorn'
import { State } from './state'

const TONES = { info: 'ok', pending: 'active', warn: 'warn', danger: 'bad' } as const

// Only a web address that answers opens in a tab. Anything else, such as a database address, is copied.
const opens = (link: { url: string; ready?: boolean }) =>
  link.ready !== false && (link.url.startsWith('https://') || link.url.startsWith('http://'))

// A plugin's read-only view of one task, drawn from the fixed blocks its route answered with, as text.
// Changing anything happens in the plugin's pane in Acorn. `view` is undefined while the first read is
// out, and null when the plugin has no panel for the task, which closes the panel. A failed read keeps
// the last view and says why above it. docs/browser-extension/plugin-panels.md.
export function PluginPanel(props: {
  panel: BridgePanel
  nodeId: string
  taskId: string
  view: BrowserPanelView | null | undefined
  problem: string | null
  opensLinks: boolean
  refresh(): void
  pickSource(source: string): void
}) {
  return (
    <div class="view" aria-label={props.panel.label}>
      <section>
        <div class="row">
          <span class="grow" />
          <button type="button" class="quiet" onClick={() => props.refresh()}>
            Refresh
          </button>
          <OpenInAcorn
            href={taskPaneLink(props.nodeId, props.taskId, props.panel.pane)}
            opensLinks={props.opensLinks}
          />
        </div>
      </section>
      <Show when={props.problem}>
        {(message) => (
          <p class="empty problem" role="alert">
            {message()}
          </p>
        )}
      </Show>
      <Show when={props.view}>
        {(view) => <For each={view().blocks}>{(block) => <Block block={block} pickSource={props.pickSource} />}</For>}
      </Show>
      <Show when={props.view === undefined && !props.problem}>
        <p class="empty quiet">Loading…</p>
      </Show>
    </div>
  )
}

function Block(props: { block: BrowserPanelBlock; pickSource(source: string): void }) {
  return (
    <section class="panel-block">
      <Switch>
        <Match when={props.block.kind === 'status' && props.block}>
          {(block) => (
            <>
              <State tone={TONES[block().severity]}>
                {block().label} {block().state}
              </State>
              <Show when={block().detail}>{(detail) => <pre>{detail()}</pre>}</Show>
            </>
          )}
        </Match>
        <Match when={props.block.kind === 'links' && props.block}>
          {(block) => (
            <>
              <SectionHeader level="group" count={block().links.length}>
                {block().title}
              </SectionHeader>
              <div role="list" aria-label={block().title}>
                <For each={block().links}>
                  {(link) => (
                    <Row
                      density="compact"
                      meta={
                        <Show when={opens(link)} fallback={<span class="quiet">{link.url}</span>}>
                          <a class="quiet address" href={link.url} target="_blank" rel="noreferrer">
                            {link.url}
                          </a>
                        </Show>
                      }
                      trailing={<Copy text={link.url} />}
                    >
                      {link.label}
                    </Row>
                  )}
                </For>
              </div>
            </>
          )}
        </Match>
        <Match when={props.block.kind === 'rows' && props.block}>
          {(block) => (
            <>
              <SectionHeader level="group" count={block().rows.length}>
                {block().title}
              </SectionHeader>
              <div role="list" aria-label={block().title}>
                <For each={block().rows}>
                  {(row) => (
                    <Row density="compact" meta={<State tone={TONES[row.severity]}>{row.state}</State>}>
                      {row.label}
                    </Row>
                  )}
                </For>
              </div>
            </>
          )}
        </Match>
        <Match when={props.block.kind === 'logs' && props.block}>
          {(block) => (
            <>
              <SectionHeader
                level="group"
                actions={
                  <Show when={block().sources.length}>
                    <select
                      name="log-source"
                      aria-label="Log source"
                      onChange={(event) => props.pickSource(event.currentTarget.value)}
                    >
                      <For each={block().sources}>
                        {(source) => (
                          <option value={source.id} selected={source.id === block().source}>
                            {source.label}
                          </option>
                        )}
                      </For>
                    </select>
                  </Show>
                }
              >
                {block().title}
              </SectionHeader>
              <Show when={block().lines.length} fallback={<p class="quiet">No log lines.</p>}>
                <pre class="logs">{block().lines.join('\n')}</pre>
              </Show>
            </>
          )}
        </Match>
      </Switch>
    </section>
  )
}

function Copy(props: { text: string }) {
  const [copied, setCopied] = createSignal(false)
  const copy = async () => {
    await navigator.clipboard.writeText(props.text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <button
      type="button"
      class="icon"
      aria-label={copied() ? 'Copied' : 'Copy'}
      title={copied() ? 'Copied' : 'Copy'}
      onClick={() => void copy().catch(() => {})}
    >
      <Icon name={copied() ? 'check' : 'copy'} />
    </button>
  )
}

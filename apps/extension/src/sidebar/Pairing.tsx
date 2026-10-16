import { For, Match, Show, Switch, createSignal, onCleanup, onMount } from 'solid-js'
import type { NodeProbeResult, NodeRecord } from '@acorn/protocol/broker.ts'
import type { BridgeHandoff, BridgeNodes, BridgeResults } from '@acorn/protocol/extensionBridge.ts'
import { fingerprintPhrase, fingerprintWords } from '@acorn/protocol/fingerprintWords.ts'
import type { BrowserApi } from '../browser'
import { CallFailure } from '../messages'
import type { BridgeClient } from './bridgeClient'
import { errorGuidance } from './guidance'
import { SettingsSection } from '@acorn/client-core/kit/components/layout'
import { Notifications } from './Settings'
import { SiteList } from './Sites'
import { siteRows } from './siteRows'
import { State } from './state'

// A Node has no name of its own. Every Acorn client calls the one on this computer this.
const LOCAL_NAME = 'This computer'

type Step =
  | { kind: 'choose' }
  | { kind: 'address' }
  // `local` is a Node whose certificate the bridge read from its own files.
  | { kind: 'code'; probe: NodeProbeResult; local: boolean }
  | { kind: 'done'; node: NodeRecord }

// Choose a Node, check its identity, enter the code, and offer what comes next. The Node on this
// computer needs no comparison: the bridge pins the certificate from the Node's own files. Another
// address shows identity words the person compares with what the Node shows, before the code field
// appears. That comparison is what makes pairing it safe, so it is a step rather than a field to skip.
export function Pairing(props: {
  api: BrowserApi
  client: BridgeClient
  fleet: BridgeNodes | null
  // The selected Node's handoffs, which name the sites worth allowing once it is paired.
  handoffs: readonly BridgeHandoff[]
  use(nodeId: string): void
  paired(node: NodeRecord): void
  close(): void
}) {
  const [step, setStep] = createSignal<Step>({ kind: 'choose' })
  const stepOf = <Kind extends Step['kind']>(kind: Kind) => {
    const current = step()
    return current.kind === kind ? (current as Extract<Step, { kind: Kind }>) : null
  }
  const back = () => {
    const current = step()
    if (current.kind === 'address') setStep({ kind: 'choose' })
    else if (current.kind === 'code') setStep({ kind: current.local ? 'choose' : 'address' })
    else props.close()
  }
  return (
    <div class="view" aria-label="Pair a Node">
      <div class="view-head">
        <button type="button" class="icon" aria-label="Back" onClick={back}>
          ‹
        </button>
        <span class="title">Pair this browser</span>
      </div>
      <Switch>
        <Match when={step().kind === 'choose'}>
          <Choose
            client={props.client}
            fleet={props.fleet}
            use={props.use}
            chose={(probe) => setStep({ kind: 'code', probe, local: true })}
            another={() => setStep({ kind: 'address' })}
          />
        </Match>
        <Match when={step().kind === 'address'}>
          <Address client={props.client} confirmed={(probe) => setStep({ kind: 'code', probe, local: false })} />
        </Match>
        <Match when={stepOf('code')} keyed>
          {(current) => (
            <Code
              client={props.client}
              probe={current.probe}
              local={current.local}
              paired={(node) => {
                props.paired(node)
                setStep({ kind: 'done', node })
              }}
            />
          )}
        </Match>
        <Match when={stepOf('done')} keyed>
          {(current) => (
            <>
              <section aria-label="Paired">
                <strong>Paired with {current.node.label}</strong>
                <p class="quiet">Switch Nodes in Settings.</p>
              </section>
              {/* Both optional: the same controls Settings has, so either can wait until later. */}
              <SettingsSection id="sites" label="Sites">
                <SiteList
                  api={props.api}
                  rows={siteRows({
                    handoffs: props.handoffs.filter((handoff) => handoff.anchors.length),
                    sites: [],
                    apps: [],
                    projects: [],
                  })}
                />
              </SettingsSection>
              <Notifications permissions={props.api.permissions} />
              <section>
                <button type="button" class="quiet" onClick={() => props.close()}>
                  Done
                </button>
              </section>
            </>
          )}
        </Match>
      </Switch>
    </div>
  )
}

// The Node on this computer, then the Nodes this browser already paired, then another address.
function Choose(props: {
  client: BridgeClient
  fleet: BridgeNodes | null
  use(nodeId: string): void
  chose(probe: NodeProbeResult): void
  another(): void
}) {
  const [local, setLocal] = createSignal<{ node: BridgeResults['node.local']; problem: string | null } | null>(null)
  // Asked each time this step shows, which also makes the local Node the probe `node.pair` completes.
  onMount(async () => {
    try {
      const node = await props.client.call({ op: 'node.local' })
      setLocal({ node, problem: node && !node.compatible ? incompatible(node) : null })
    } catch (failure) {
      setLocal({ node: null, problem: failure instanceof Error ? failure.message : String(failure) })
    }
  })
  const localNode = () => local()?.node ?? null
  const unpaired = () => {
    const node = localNode()
    return node?.compatible && !props.fleet?.nodes.some((paired) => paired.nodeId === node.nodeId) ? node : null
  }
  const note = () => {
    const found = local()
    if (!found) return 'Looking for a Node on this Mac…'
    if (found.problem) return found.problem
    return found.node ? "Found in this Mac's Acorn data folder." : 'No Acorn Node is running on this Mac.'
  }
  const onThisMac = (nodeId: string) => localNode()?.nodeId === nodeId

  return (
    <section aria-label="Choose a Node">
      <h2>Pair this browser</h2>
      <ul class="rows">
        <Show when={unpaired()}>
          {(node) => (
            <NodeRow
              name={LOCAL_NAME}
              endpoint={node().endpoint}
              onThisMac
              action="Continue"
              act={() => props.chose(node())}
            />
          )}
        </Show>
        <For each={props.fleet?.nodes}>
          {(node) => (
            <NodeRow
              name={node.label}
              endpoint={node.endpoint}
              onThisMac={onThisMac(node.nodeId)}
              action="Use"
              act={() => props.use(node.nodeId)}
            />
          )}
        </For>
        <li>
          <button type="button" class="row-button" onClick={() => props.another()}>
            Use another address ›
          </button>
        </li>
      </ul>
      <p class="quiet" data-testid="local-node-note">
        {note()}
      </p>
    </section>
  )
}

function NodeRow(props: { name: string; endpoint: string; onThisMac: boolean; action: string; act(): void }) {
  return (
    <li>
      <div class="grow">
        <span class="row">
          <strong>{props.name}</strong>
          <Show when={props.onThisMac}>
            <span class="tag">On this Mac</span>
          </Show>
        </span>
        <span class="quiet">{props.endpoint}</span>
      </div>
      <button type="button" class="quiet" onClick={() => props.act()}>
        {props.action}
      </button>
    </li>
  )
}

// Another address: probe it, then show the certificate it presented as words for the person to compare.
function Address(props: { client: BridgeClient; confirmed(probe: NodeProbeResult): void }) {
  const [address, setAddress] = createSignal('https://')
  const [probe, setProbe] = createSignal<NodeProbeResult | null>(null)
  const [matched, setMatched] = createSignal(false)
  const work = action()

  const check = (event: SubmitEvent) => {
    event.preventDefault()
    setProbe(null)
    setMatched(false)
    void work.run(async () => {
      setProbe(await props.client.call({ op: 'node.probe', endpoint: address().trim() }))
    })
  }

  return (
    <section aria-label="Identity">
      <form onSubmit={check}>
        <label>
          Node address
          <input
            name="address"
            type="url"
            required
            value={address()}
            onInput={(event) => setAddress(event.currentTarget.value)}
          />
        </label>
        <button type="submit" class="quiet" disabled={work.busy()}>
          Check identity
        </button>
      </form>
      <Show when={probe()}>
        {(result) => (
          <Show
            when={result().compatible}
            fallback={
              <p class="problem" role="alert">
                {incompatible(result())}
              </p>
            }
          >
            <h2>Identity</h2>
            <p>Compare these words with the ones the Node shows:</p>
            <ul class="chips" data-testid="identity-words" aria-label={fingerprintPhrase(result().fingerprint) ?? ''}>
              <For each={fingerprintWords(result().fingerprint) ?? [result().fingerprint]}>
                {(word) => <li class="chip">{word}</li>}
              </For>
            </ul>
            <p class="quiet">
              Find them in Settings › Nodes in the Acorn app, or in the banner a standalone Node prints when it starts.
            </p>
            <label class="check">
              <input
                name="confirm"
                type="checkbox"
                checked={matched()}
                onChange={(event) => setMatched(event.currentTarget.checked)}
              />
              The words match
            </label>
            <button type="button" disabled={!matched()} onClick={() => props.confirmed(result())}>
              Continue
            </button>
          </Show>
        )}
      </Show>
      <Show when={work.error()}>
        <p class="problem" role="alert">
          {work.error()}
        </p>
      </Show>
    </section>
  )
}

// How often the sidebar asks whether the owner has allowed this browser.
const COLLECT_EVERY_MS = 1_000

// The code, and the name this browser shows for the Node. `node.pair` completes the probe the bridge
// kept, so nothing here names the Node again.
//
// The Node on this computer also gets an ask (docs/api-reference/transport.md § Pairing by approval):
// Acorn shows a dialog, and this waits for the owner to allow it. The code form stays beside it, for a
// Node no paired app is watching.
function Code(props: { client: BridgeClient; probe: NodeProbeResult; local: boolean; paired(node: NodeRecord): void }) {
  const [code, setCode] = createSignal('')
  const [label, setLabel] = createSignal(props.local ? LOCAL_NAME : new URL(props.probe.endpoint).host)
  const [phrase, setPhrase] = createSignal<string | null>(null)
  const [refused, setRefused] = createSignal(false)
  const work = action()

  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  onCleanup(() => {
    stopped = true
    clearTimeout(timer)
  })
  const collect = async () => {
    if (stopped) return
    try {
      const node = await props.client.call({ op: 'node.collect', label: label().trim() || LOCAL_NAME })
      if (stopped) return
      if (node) return props.paired(node)
      timer = setTimeout(() => void collect(), COLLECT_EVERY_MS)
    } catch {
      if (!stopped) setRefused(true)
    }
  }
  onMount(async () => {
    if (!props.local) return
    try {
      setPhrase((await props.client.call({ op: 'node.ask' })).phrase)
    } catch {
      return // A Node that can't take an ask still takes a code.
    }
    void collect()
  })

  const pair = (event: SubmitEvent) => {
    event.preventDefault()
    void work.run(async () =>
      props.paired(await props.client.call({ op: 'node.pair', code: code().trim(), label: label().trim() })),
    )
  }

  return (
    <section aria-label="Pairing code">
      <h2>Identity</h2>
      <State tone="ok">
        {props.local ? "Checked against this Mac's own certificate" : 'You confirmed the identity words'}
      </State>
      <Show when={phrase()}>
        {(words) => (
          <section aria-label="Allow in Acorn">
            <h2>Allow in Acorn</h2>
            <Show
              when={!refused()}
              fallback={
                <p class="problem" role="alert">
                  The request was denied or has expired. Pair with a code instead.
                </p>
              }
            >
              <p>Acorn on this Mac asks whether to allow this browser. Allow it if it shows these words:</p>
              <ul class="chips" data-testid="request-words" aria-label={words()}>
                <For each={words().split(' ')}>{(word) => <li class="chip">{word}</li>}</For>
              </ul>
              <p class="quiet">Or pair with a code.</p>
            </Show>
          </section>
        )}
      </Show>
      <form onSubmit={pair}>
        <label>
          Pairing code
          <input
            name="pairing-code"
            required
            autocomplete="off"
            placeholder="Paste the code"
            value={code()}
            onInput={(event) => setCode(event.currentTarget.value)}
          />
        </label>
        <p class="quiet">
          In the Acorn app: Settings › Nodes › Pair a browser. A standalone Node prints one when it starts.
        </p>
        <label>
          Name in this browser
          <input name="label" required value={label()} onInput={(event) => setLabel(event.currentTarget.value)} />
        </label>
        <button type="submit" disabled={work.busy()}>
          Pair
        </button>
      </form>
      <Show when={work.error()}>
        <p class="problem" role="alert">
          {work.error()}
        </p>
      </Show>
    </section>
  )
}

const incompatible = (probe: NodeProbeResult) =>
  `${probe.endpoint} speaks Acorn protocol ${probe.protocolVersion}, which this bridge can't use. Update whichever side is older.`

// One bridge call at a time, with its failure in the person's words.
function action() {
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await work()
    } catch (failure) {
      setError(failure instanceof CallFailure ? errorGuidance(failure) : String(failure))
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, run }
}

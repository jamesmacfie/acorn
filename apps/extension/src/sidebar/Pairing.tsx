import { For, Match, Show, Switch, createEffect, createSignal, onCleanup, onMount } from 'solid-js'
import type { NodeProbeResult, NodeRecord } from '@acorn/protocol/broker.ts'
import type { BridgeHandoff, BridgeNodes, BridgeResults } from '@acorn/protocol/extensionBridge.ts'
import { fingerprintPhrase, fingerprintWords } from '@acorn/protocol/fingerprintWords.ts'
import { AcornArt } from '@acorn/client-core/kit/components/content/Acorn.tsx'
import Icon from '@acorn/client-core/kit/components/content/Icon.tsx'
import { Text } from '@acorn/client-core/kit/components/content'
import { ChipRow, Inline, SettingsSection, Stack } from '@acorn/client-core/kit/components/layout'
import {
  Alert,
  Button,
  Card,
  Chip,
  EmptyState,
  Field,
  Input,
  Row,
  Spinner,
} from '@acorn/client-core/kit/components/primitives.tsx'
import type { BrowserApi } from '../browser'
import { CallFailure } from '../messages'
import type { BridgeClient } from './bridgeClient'
import { INSTALL_COMMAND, errorGuidance } from './guidance'
import { Notifications } from './Settings'
import { SiteList } from './Sites'
import { siteRows } from './siteRows'

// Getting connected: the bridge, then a Node. Each screen does one job, in the kit's empty state.

// A Node has no name of its own. Every Acorn client calls the one on this computer this.
const LOCAL_NAME = 'This computer'

// The command that installs the bridge, as one button that copies it, over a spinner while the panel
// waits for the bridge to answer. `title` says whether it's missing or refuses this extension.
export function InstallBridge(props: { title: string }) {
  const [copied, setCopied] = createSignal(false)
  let timer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(timer))
  const copy = () =>
    navigator.clipboard.writeText(INSTALL_COMMAND).then(
      () => {
        setCopied(true)
        clearTimeout(timer)
        timer = setTimeout(() => setCopied(false), 1_500)
      },
      () => {},
    )
  return (
    <div class="connect">
      <EmptyState
        icon={<AcornArt />}
        title={props.title}
        action={
          <Stack>
            <Button label={`Copy ${INSTALL_COMMAND}`} onPress={() => void copy()}>
              <span class="install-command">
                <Text tone="muted">$</Text>
                <Text emphasis="mono">{INSTALL_COMMAND}</Text>
                <Icon name={copied() ? 'check' : 'copy'} tone="muted" />
              </span>
            </Button>
            <Waiting>Waiting for the bridge</Waiting>
          </Stack>
        }
      >
        Run this in a terminal. The extension reaches Acorn through it.
      </EmptyState>
    </div>
  )
}

type Step =
  | { kind: 'choose' }
  | { kind: 'address' }
  | { kind: 'identity'; probe: NodeProbeResult }
  // `local` is a Node whose certificate the bridge read from its own files.
  | { kind: 'code'; probe: NodeProbeResult; local: boolean }
  | { kind: 'done'; node: NodeRecord }

// Choose a Node, check its identity, pair, and offer what comes next. The Node on this computer needs
// no comparison: the bridge pins the certificate from the Node's own files. Another address shows
// identity words the person compares with what the Node shows before the code field appears. That
// comparison is what makes pairing it safe, so it is a step rather than a field to skip.
export function Pairing(props: {
  api: BrowserApi
  client: BridgeClient
  fleet: BridgeNodes | null
  // The selected Node's handoffs, which name the sites worth allowing once it is paired.
  handoffs: readonly BridgeHandoff[]
  paired(node: NodeRecord): void
  // What the top bar's Cancel does on this step, or null for none.
  showCancel(cancel: (() => void) | null): void
  close(): void
  done(): void
}) {
  const [step, setStep] = createSignal<Step>({ kind: 'choose' })
  const stepOf = <Kind extends Step['kind']>(kind: Kind) => {
    const current = step()
    return current.kind === kind ? (current as Extract<Step, { kind: Kind }>) : null
  }
  const restart = () => setStep({ kind: 'choose' })
  // A middle step goes back to the first. The first closes pairing when there's a Node to go back to.
  createEffect(() => {
    const kind = step().kind
    if (kind === 'done') props.showCancel(null)
    else if (kind !== 'choose') props.showCancel(restart)
    else props.showCancel(props.fleet?.nodes.length ? props.close : null)
  })
  return (
    <div class="view connect" aria-label="Pair a Node">
      <Switch>
        <Match when={step().kind === 'choose'}>
          <Choose
            client={props.client}
            fleet={props.fleet}
            connect={(probe) => setStep({ kind: 'code', probe, local: true })}
            another={() => setStep({ kind: 'address' })}
          />
        </Match>
        <Match when={step().kind === 'address'}>
          <Address client={props.client} found={(probe) => setStep({ kind: 'identity', probe })} />
        </Match>
        <Match when={stepOf('identity')} keyed>
          {(current) => (
            <Identity
              probe={current.probe}
              matched={() => setStep({ kind: 'code', probe: current.probe, local: false })}
              cancel={restart}
            />
          )}
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
          {(current) => <Paired api={props.api} node={current.node} handoffs={props.handoffs} done={props.done} />}
        </Match>
      </Switch>
    </div>
  )
}

// The Node on this computer as the obvious choice, unless it's missing or already paired, then
// another address.
function Choose(props: {
  client: BridgeClient
  fleet: BridgeNodes | null
  connect(probe: NodeProbeResult): void
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
  const unpaired = () => {
    const node = local()?.node
    return node?.compatible && !props.fleet?.nodes.some((paired) => paired.nodeId === node.nodeId) ? node : null
  }

  return (
    <EmptyState
      icon={<AcornArt />}
      title="Connect to Acorn"
      action={
        <Show when={local()}>
          {(found) => (
            <Stack>
              <Show when={unpaired()}>
                {(node) => (
                  <Card pad="sm">
                    <Row
                      variant="stacked"
                      leading={<Icon name="laptop" size="1.5em" tone="muted" />}
                      trailing={
                        <Button variant="solid" size="sm" onPress={() => props.connect(node())}>
                          Connect
                        </Button>
                      }
                    >
                      <Text emphasis="strong">{LOCAL_NAME}</Text>
                      <Text emphasis="mono" tone="muted">
                        {node().endpoint}
                      </Text>
                    </Row>
                  </Card>
                )}
              </Show>
              <Show when={found().problem}>{(problem) => <Alert>{problem()}</Alert>}</Show>
              <Button variant={unpaired() ? 'bare' : 'outline'} onPress={() => props.another()}>
                Connect to another Node
              </Button>
            </Stack>
          )}
        </Show>
      }
    />
  )
}

// Another address: probe it, then show the certificate it presented as words.
function Address(props: { client: BridgeClient; found(probe: NodeProbeResult): void }) {
  const [address, setAddress] = createSignal('https://')
  const [problem, setProblem] = createSignal<string | null>(null)
  const work = action()

  const check = (event: SubmitEvent) => {
    event.preventDefault()
    setProblem(null)
    void work.run(async () => {
      const probe = await props.client.call({ op: 'node.probe', endpoint: address().trim() })
      if (probe.compatible) props.found(probe)
      else setProblem(incompatible(probe))
    })
  }

  return (
    <EmptyState
      title="Connect to another Node"
      action={
        <form onSubmit={check}>
          <Field label="Address" error={problem() ?? work.error() ?? undefined}>
            <Inline>
              <Input
                name="address"
                type="url"
                required
                autofocus
                value={address()}
                onInput={(value) => setAddress(value)}
              />
              <Button variant="solid" submit busy={work.busy()}>
                Check
              </Button>
            </Inline>
          </Field>
        </form>
      }
    />
  )
}

// The words for the certificate the address presented, to compare with what the Node shows.
function Identity(props: { probe: NodeProbeResult; matched(): void; cancel(): void }) {
  return (
    <EmptyState
      title="Check its identity"
      action={
        <Stack>
          <Words
            phrase={fingerprintPhrase(props.probe.fingerprint) ?? props.probe.fingerprint}
            words={fingerprintWords(props.probe.fingerprint) ?? [props.probe.fingerprint]}
          />
          <Inline>
            <Button variant="solid" onPress={() => props.matched()}>
              They match
            </Button>
            <Button variant="ghost" onPress={() => props.cancel()}>
              Cancel
            </Button>
          </Inline>
        </Stack>
      }
    >
      {new URL(props.probe.endpoint).host} shows these words in Settings › Nodes. Continue only if they match.
    </EmptyState>
  )
}

// How often the sidebar asks whether the owner has allowed this browser.
const COLLECT_EVERY_MS = 1_000

// The Node on this computer gets an ask (docs/api-reference/transport.md § Pairing by approval): Acorn
// shows a dialog, and this waits for the owner to allow it, with the code one click away for a Node no
// paired app is watching. Another Node, or one that can't take an ask, goes straight to the code.
// `node.pair` completes the probe the bridge kept, so nothing here names the Node again.
function Code(props: { client: BridgeClient; probe: NodeProbeResult; local: boolean; paired(node: NodeRecord): void }) {
  const host = new URL(props.probe.endpoint).host
  // The name this browser shows for the Node. Settings renames it.
  const label = props.local ? LOCAL_NAME : host
  const [code, setCode] = createSignal('')
  // Whether the ask has answered, and the words Acorn's dialog shows if it took it.
  const [asked, setAsked] = createSignal(!props.local)
  const [phrase, setPhrase] = createSignal<string | null>(null)
  const [refused, setRefused] = createSignal(false)
  const [usingCode, setUsingCode] = createSignal(false)
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
      const node = await props.client.call({ op: 'node.collect', label })
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
      void collect()
    } catch {
      // A Node that can't take an ask still takes a code.
    } finally {
      setAsked(true)
    }
  })

  const pair = (event: SubmitEvent) => {
    event.preventDefault()
    void work.run(async () => props.paired(await props.client.call({ op: 'node.pair', code: code().trim(), label })))
  }
  const codeForm = () => (
    <form onSubmit={pair}>
      <Field
        label="Pairing code"
        hint={
          props.local ? 'In Acorn: Settings › Nodes › Pair a browser' : `On ${host}: Settings › Nodes › Pair a browser`
        }
        error={work.error() ?? undefined}
      >
        <Inline>
          <Input
            name="pairing-code"
            required
            autofocus
            placeholder="Paste the code"
            value={code()}
            onInput={(value) => setCode(value)}
          />
          <Button variant="solid" submit busy={work.busy()}>
            Pair
          </Button>
        </Inline>
      </Field>
    </form>
  )

  return (
    <Show when={asked()}>
      <Show when={phrase()} fallback={<EmptyState title="Enter the pairing code" action={codeForm()} />}>
        {(words) => (
          <EmptyState
            title="Approve in Acorn"
            action={
              <Stack>
                <Words phrase={words()} words={words().split(' ')} />
                <Show
                  when={!refused()}
                  fallback={<Alert>The request was denied or has expired. Pair with a code instead.</Alert>}
                >
                  <Waiting>Waiting for approval</Waiting>
                </Show>
                <Show
                  when={usingCode() || refused()}
                  fallback={
                    <Button variant="bare" onPress={() => setUsingCode(true)}>
                      Use a pairing code instead
                    </Button>
                  }
                >
                  {codeForm()}
                </Show>
              </Stack>
            }
          >
            Acorn on this Mac asks to allow this browser. Allow it if it shows these words.
          </EmptyState>
        )}
      </Show>
    </Show>
  )
}

// Paired: the sites worth allowing and notifications, both optional and both in Settings later.
function Paired(props: { api: BrowserApi; node: NodeRecord; handoffs: readonly BridgeHandoff[]; done(): void }) {
  const rows = () =>
    siteRows({
      handoffs: props.handoffs.filter((handoff) => handoff.anchors.length),
      sites: [],
      apps: [],
      projects: [],
    })
  return (
    <>
      <EmptyState icon={<Icon name="circle-check" tone="ok" size="2em" />} title={`Connected to ${props.node.label}`} />
      <Show when={rows().length}>
        <SettingsSection id="sites" label="Allow on these sites">
          <SiteList api={props.api} rows={rows()} />
        </SettingsSection>
      </Show>
      <Notifications permissions={props.api.permissions} />
      <section>
        <Button variant="solid" onPress={() => props.done()}>
          Done
        </Button>
      </section>
    </>
  )
}

// Words the person compares with what another screen shows.
function Words(props: { phrase: string; words: readonly string[] }) {
  return (
    <ChipRow ariaLabel={props.phrase}>
      <For each={props.words}>{(word) => <Chip>{word}</Chip>}</For>
    </ChipRow>
  )
}

function Waiting(props: { children: string }) {
  return (
    <Inline>
      <Spinner label={props.children} />
      <Text tone="muted">{props.children}</Text>
    </Inline>
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

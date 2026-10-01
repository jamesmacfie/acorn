import { Portal } from 'solid-js/web'
import { createMemo, createSignal, For, Show } from 'solid-js'
import { nodes } from '../../infra/node/fleet'
import Icon from '../../kit/components/content/Icon'
import { createDismissable } from '../../kit/lib/controls/dismissable'
import { distribution, pendingTrust, resolvePendingTrust, type PluginTrustRequest } from '../plugins/distribution'
import { recordTrustDecision, TIER_LABEL, trustTiers, type TierKey } from './trustModel'
import './plugin-trust.css'
import { Alert, Badge, Button, Kbd } from '../../kit/components/primitives'

// The consent surface for running code a node handed this device
// (docs/plugins.md).
//
// Modelled on ConfigTrustDialog: same overlay slot, same alertdialog semantics, same "not now"
// escape. The difference is scope. Config trust binds a project to the hash of a config the node will
// execute; this binds a plugin to the hash of a bundle this device will execute, which is why the
// acknowledgement lives beside the device token rather than in the node's database and why pairing a
// new laptop asks again.
//
// Three groups, and the split between them is the whole point (docs/security.md § Design rules,
// rule 6). `Enforced` is a fence held by the UI bridge and isolated node realm. `Declared`
// describes plugin-authored unattended behavior whose intent cannot be verified. `Web pages` is
// enforced by the shell but reaches the live internet, so it is neither of
// the other two. The vocabulary is defined once in the legend rather than being spelled out on every
// heading, and the groups may never be rendered as one list: a strong claim must not lend
// credibility to a weaker one sitting next to it.

export default function PluginTrustDialog() {
  const [saving, setSaving] = createSignal(false)
  const [error, setError] = createSignal('')

  const request = (): PluginTrustRequest | undefined => pendingTrust()[0]
  const nodeLabel = (nodeId: string) => nodes().find((node) => node.nodeId === nodeId)?.label ?? nodeId

  const tiers = createMemo(() => trustTiers(request()))

  const has = (key: TierKey) => tiers().some((tier) => tier.key === key && tier.lines.length > 0)
  // What an update is actually about. Leading with it is the reason an update re-prompts at all.
  const addedLines = createMemo(() => tiers().flatMap((tier) => tier.lines.filter((line) => line.added)))
  const keptTiers = createMemo(() =>
    tiers()
      .map((tier) => ({ ...tier, lines: tier.lines.filter((line) => !line.added) }))
      .filter((tier) => tier.lines.length > 0),
  )
  const previousVersion = () => request()?.previous?.version
  const sameBundleReview = () => request()?.previous?.hash === request()?.hash
  const changedDeclaration = () => sameBundleReview() && !!request()?.previous?.declaration
  const previousStillActive = () => {
    const current = request()
    if (!current?.previous || current.relation !== 'installed') return false
    if (current.source?.kind === 'device') return false
    return current.sourceNodeIds.every((nodeId) =>
      distribution().selectionsByNode.get(nodeId)?.get(current.row.name)?.hash === current.previous?.hash)
  }
  const fallbackCopy = () => {
    const current = request()
    if (!current) return ''
    if (current.source?.kind === 'device') return 'This device plugin stays unavailable until you accept this version.'
    if (previousStillActive()) return 'The current version keeps working until the node activates this update.'
    if (current.relation === 'installed' && !current.previous) return 'Accepting now allows this interface to appear after the node starts this plugin.'
    return "This plugin's interface stays unavailable on the affected node until you accept this version or the node runs an accepted version."
  }

  const decide = async (decision: 'accepted' | 'rejected') => {
    const current = request()
    if (!current) return
    setSaving(true)
    setError('')
    try {
      await recordTrustDecision(current, decision)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record the decision.')
    } finally {
      setSaving(false)
    }
  }

  let dialog!: HTMLElement
  // Escape is "not now", and it records nothing. It used to call decide('rejected'), which is a
  // remembered answer (@acorn/custody/plugins/pluginTrustStore.ts: a rejection is kept so a turned-away plugin does not
  // ask every boot), so a stray keypress permanently disabled a plugin, with no surface anywhere to
  // undo it. Dropping the queue entry leaves the bundle undecided, which is what brings it back at the
  // next boot pass, and is what the footer promises.
  const dismiss = createDismissable({
    onDismiss: () => {
      const current = request()
      if (current) resolvePendingTrust(current.row.name, current.hash)
    },
    container: () => dialog,
  })

  return (
    <Portal>
    <Show when={request()}>
      {(current) => (
        <div class="overlay-backdrop">
          <section
            ref={(el) => {
              dialog = el
              // This prompt appears on its own at the end of a boot pass rather than from a click, so
              // nothing has moved focus into it, and Escape is handled on this element, as is the Tab
              // trap. Without this the footer's promise is simply false and Tab walks the page behind.
              // Bare `autofocus` is unreliable under Solid; queueMicrotask is the pattern that holds.
              queueMicrotask(() => el.focus())
            }}
            tabindex="-1"
            class="overlay plugin-trust-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="plugin-trust-title"
            onClick={dismiss.onContainerClick}
            onKeyDown={dismiss.onKeyDown}
          >
            <div class="overlay-title">{sameBundleReview() ? changedDeclaration() ? 'Plugin declaration changed' : 'Review plugin declaration' : previousVersion() ? 'Plugin update' : 'Plugin trust'}</div>
            <div class="overlay-body plugin-trust-body">
              <header class="plugin-trust-identity">
                <span class="plugin-trust-glyph" aria-hidden="true">{current().row.name.slice(0, 1).toUpperCase()}</span>
                <div>
                  <h2 id="plugin-trust-title">
                    <code>{current().row.name}</code>
                    {sameBundleReview() ? changedDeclaration() ? ' changed what it asks for' : ' needs another review' : previousVersion() ? (addedLines().length ? ' was updated — it asks for more' : ' was updated') : ' wants to run in acorn'}
                  </h2>
                  <p class="plugin-trust-meta">
                    <Badge size="xs">{sameBundleReview() ? current().row.installed?.version : previousVersion() ? `${previousVersion()} → ${current().row.installed?.version}` : current().row.installed?.version}</Badge>
                    <Badge size="xs">
                      <Icon name="monitor" /> {current().source?.kind === 'device'
                        ? current().sourceLabel?.startsWith('path:')
                          ? `installed on this device from ${current().sourceLabel}; a folder pins nothing`
                          : `installed on this device from ${current().sourceLabel ?? 'a package'}`
                        : `from ${current().sourceNodeIds.map(nodeLabel).join(', ')}`}
                    </Badge>
                    <Show when={!previousVersion()}><Badge size="xs">first time</Badge></Show>
                  </p>
                </div>
              </header>

              <p class="muted plugin-trust-intro">
                <Show
                  when={previousVersion() && !sameBundleReview()}
                  fallback={sameBundleReview()
                    ? changedDeclaration()
                      ? 'The client code is the same, but this node changed its declaration. Acorn has withheld its interface until you review these permissions and contributions again.'
                      : 'Acorn needs an approval that binds this client code to its current permissions and contributions. Its interface is withheld until you review them.'
                    : 'None of its code has run yet. Review what it asks for below — acorn asks again if the bundle changes.'}
                >
                  {(version) => (
                    <Show
                      when={addedLines().length}
                      fallback={`You last approved ${version()}. This version asks for nothing new — its code changed, which is why you’re being asked again.`}
                    >
                      {`You last approved ${version()}. This version asks for ${addedLines().length === 1 ? 'one thing' : `${addedLines().length} things`} it did not have before; everything else is unchanged.`}
                    </Show>
                  )}
                </Show>
              </p>
              <p class="muted plugin-trust-intro">{fallbackCopy()}</p>

              <Show when={error()}><Alert>{error()}</Alert></Show>

              <Show when={addedLines().length}>
                <section class="plugin-trust-group" data-tier="new">
                  <h3><span class="plugin-trust-dot" aria-hidden="true" />New in this version</h3>
                  <ul class="plugin-trust-permissions" data-tier="new">
                    <For each={addedLines()}>
                      {(line) => (
                        <li class="added" classList={{ high: line.high }}>
                          <Icon name={line.icon} />
                          <span>{line.text}</span>
                          <Badge size="xs" tone={line.tier === 'declared' ? 'warn' : 'accent'}>
                            {TIER_LABEL[line.tier]}
                          </Badge>
                        </li>
                      )}
                    </For>
                  </ul>
                </section>
              </Show>

              {/* On an update the unchanged grants fold away, so the two lines that changed are not
                  buried in the twenty that did not. On a first install there is nothing to fold. */}
              <Show
                when={addedLines().length}
                fallback={<For each={keptTiers()}>{(tier) => <TierGroup tier={tier} />}</For>}
              >
                <Show when={keptTiers().length}>
                  <details class="plugin-trust-unchanged">
                    <summary>Everything {previousVersion()} already had — unchanged</summary>
                    <For each={keptTiers()}>{(tier) => <TierGroup tier={tier} />}</For>
                  </details>
                </Show>
              </Show>

              {/* The vocabulary, once, matching docs/security.md § Node-half plugin security. */}
              <p class="muted plugin-trust-legend">
                <Show when={has('enforced')}>
                  <span><strong>Enforced</strong> — {current().source?.kind === 'device'
                    ? 'acorn checks these in the sandboxed interface; anything not listed is refused.'
                    : 'acorn checks these in the sandboxed interface and isolated server realm; anything not listed is refused.'}</span>
                </Show>
                <Show when={has('declared')}>
                  <span>
                    <strong>Declared</strong> — plugin-authored scheduled and check behavior. Acorn confines when and where it runs, but cannot verify what the code intends to do.
                  </span>
                </Show>
                <Show when={has('web')}>
                  <span><strong>Web pages</strong> — these load from the internet with their own cookies and logins. The plugin cannot read them or type into them.</span>
                </Show>
              </p>
            </div>
            <div class="ui-modal-actions plugin-trust-actions plugin-trust-actions-with-hint">
              <p class="plugin-trust-escape">
                Press <Kbd size="xs">Esc</Kbd> to decide later. Acorn asks again next launch.
              </p>
              <div class="plugin-trust-buttons">
                <Button variant="ghost" disabled={saving()} onPress={() => {
                  const pending = request()
                  if (pending) resolvePendingTrust(pending.row.name, pending.hash)
                }}>Not now</Button>
                <Button variant="ghost" disabled={saving()} onPress={() => void decide('rejected')}>
                  {previousVersion() ? 'Reject update' : 'Reject plugin'}
                </Button>
                <Button disabled={saving()} onPress={() => void decide('accepted')}>
                  {saving() ? 'Saving…' : previousVersion() ? 'Accept update' : `Accept ${current().row.name} ${current().row.installed?.version}`}
                </Button>
              </div>
            </div>
          </section>
        </div>
      )}
    </Show>
    </Portal>
  )
}

function TierGroup(props: { tier: { key: TierKey; lines: readonly { text: string; icon: string; high: boolean }[] } }) {
  return (
    <section class="plugin-trust-group" data-tier={props.tier.key}>
      <h3><span class="plugin-trust-dot" aria-hidden="true" />{TIER_LABEL[props.tier.key]}</h3>
      <ul class="plugin-trust-permissions" data-tier={props.tier.key}>
        <For each={props.tier.lines}>
          {(line) => (
            <li classList={{ high: line.high }}>
              <Icon name={line.icon} />
              <span>{line.text}</span>
            </li>
          )}
        </For>
      </ul>
    </section>
  )
}

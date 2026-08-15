import { createMemo, createSignal, For, Show } from 'solid-js'
import { nodes } from '../node/fleet'
import Icon from '../ui/Icon'
import { createDismissable } from '../ui/dismissable'
import { pendingTrust, resolvePendingTrust, type PluginTrustRequest } from './distribution'
import { recordTrustDecision, TIER_LABEL, trustTiers, type TierKey } from './trustModel'
import './plugin-trust.css'
import { Alert, Kbd } from '../ui/primitives'

// The consent surface for running code a node handed this device
// (docs/plugins.md).
//
// Modelled on ConfigTrustDialog: same overlay slot, same alertdialog semantics, same "not now"
// escape. The difference is scope. Config trust binds a project to the hash of a config the NODE will
// execute; this binds a plugin to the hash of a bundle THIS DEVICE will execute, which is why the
// acknowledgement lives beside the device token rather than in the node's database and why pairing a
// new laptop asks again.
//
// Three groups, and the split between them is the whole point (docs/security.md § Design rules,
// rule 6). `Enforced` is a fence: the UI bridge refuses anything undeclared. `Declared` is a
// disclosure and nothing more — that code shares the node's process and can ignore its manifest
// entirely. `Web pages` is enforced by Electron but reaches the live internet, so it is neither of
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
  // Escape is "not now", and it records NOTHING. It used to call decide('rejected'), which is a
  // remembered answer (main/pluginTrustStore.ts: a rejection is kept so a turned-away plugin does not
  // ask every boot) — so a stray keypress permanently disabled a plugin, with no surface anywhere to
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
    <Show when={request()}>
      {(current) => (
        <div class="overlay-backdrop">
          <section
            ref={(el) => {
              dialog = el
              // This prompt appears on its own at the end of a boot pass rather than from a click, so
              // nothing has moved focus into it — and Escape is handled ON this element, as is the Tab
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
            <div class="overlay-title">{previousVersion() ? 'Plugin update' : 'Plugin trust'}</div>
            <div class="overlay-body plugin-trust-body">
              <header class="plugin-trust-identity">
                <span class="plugin-trust-glyph" aria-hidden="true">{current().row.name.slice(0, 1).toUpperCase()}</span>
                <div>
                  <h2 id="plugin-trust-title">
                    <code>{current().row.name}</code>
                    {previousVersion() ? (addedLines().length ? ' was updated — it asks for more' : ' was updated') : ' wants to run in acorn'}
                  </h2>
                  <p class="plugin-trust-meta">
                    <span class="ui-badge" data-size="xs">
                      {previousVersion() ? `${previousVersion()} → ${current().row.installed?.version}` : current().row.installed?.version}
                    </span>
                    <span class="ui-badge" data-size="xs">
                      <Icon name="monitor" /> from {nodeLabel(current().nodeId)}
                    </span>
                    <Show when={!previousVersion()}><span class="ui-badge" data-size="xs">first time</span></Show>
                  </p>
                </div>
              </header>

              <p class="muted plugin-trust-intro">
                <Show
                  when={previousVersion()}
                  fallback="None of its code has run yet. Review what it asks for below — you’ll only be asked once for this version."
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
                          <span class="ui-badge" data-size="xs" data-tone={line.tier === 'declared' ? 'warn' : 'accent'}>
                            {TIER_LABEL[line.tier]}
                          </span>
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

              {/* The vocabulary, once. `Declared` is the honest half and says so here rather than in a
                  heading nobody reads twice (docs/security.md § Node-half plugin security).

                  The second sentence on that line is canonical and must not be softened or dropped:
                  it is the whole truth about the list above, and the one thing standing between an
                  owner and a plugin that reads ~/.ssh. It is drawn at full contrast for the same
                  reason — the strongest statement in this dialog must not also be its faintest. */}
              <p class="muted plugin-trust-legend">
                <Show when={has('enforced')}>
                  <span><strong>Enforced</strong> — acorn checks these; its interface runs in a sandbox and anything not listed is refused.</span>
                </Show>
                <Show when={has('declared')}>
                  <span>
                    <strong>Declared</strong> — the plugin’s own description of what it touches; acorn can’t check it.{' '}
                    <span class="plugin-trust-plain">This plugin’s server code runs with the same access as acorn itself.</span>
                  </span>
                </Show>
                <Show when={has('web')}>
                  <span><strong>Web pages</strong> — these load from the internet with their own cookies and logins. The plugin cannot read them or type into them.</span>
                </Show>
              </p>
            </div>
            <div class="ui-modal-actions plugin-trust-actions">
              <p class="plugin-trust-escape">
                Not sure? Press <Kbd size="xs">Esc</Kbd> — {previousVersion() ? `${previousVersion()} keeps running and ` : ''}acorn asks again next launch.
              </p>
              <button type="button" class="ui-btn" data-variant="ghost" disabled={saving()} onClick={() => void decide('rejected')}>
                {previousVersion() ? `Keep ${previousVersion()}` : 'Don’t run it'}
              </button>
              <button type="button" class="ui-btn" disabled={saving()} onClick={() => void decide('accepted')}>
                {saving() ? 'Saving…' : previousVersion() ? 'Trust the update' : `Trust ${current().row.name} ${current().row.installed?.version}`}
              </button>
            </div>
          </section>
        </div>
      )}
    </Show>
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

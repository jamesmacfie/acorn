/** @jsxImportSource @opentui/solid */
import { createMemo, createSignal, For, Show } from 'solid-js'
import type { BoxRenderable } from '@opentui/core'
import { nodes } from '@acorn/client-core/infra/node/fleet.ts'
import { pendingTrust, resolvePendingTrust } from '@acorn/client-core/host/plugins/distribution.ts'
import { recordTrustDecision, TIER_LABEL, trustTiers } from '@acorn/client-core/host/trust/trustModel.ts'
import { Modal, ModalBody, SectionHeader } from '../kit/grouping'
import { Alert, Row, Rows } from '../kit/showing'
import { Line } from '../kit/cells'
import { takeFocus } from '../keys/regions'

// "Do you want to run this?", in a terminal.
//
// Nothing in the prompt is terminal-specific (docs/tui.md § The trust prompt).
// The three tiers, the sentence per grant and the "what this version gained" diff are
// `client-core/host/trust/trustModel.ts`, which is a plain module with a test, and answering is its
// `recordTrustDecision`. What is here is the arrangement: a `Modal` where the pane would go, drawn
// with the kit.
//
// The tier split is a security claim and the three lists may never be merged (docs/security.md §
// Design rules, rule 6): `Enforced` is a fence the bridge holds, `Declared` is a disclosure the
// plugin can ignore entirely, and a strong claim must not lend credibility to a weaker one beside it.
//
// Escape is "not now" and records nothing, exactly as on the desktop: a rejection is remembered, so a
// stray keypress must not permanently disable a plugin with no surface anywhere to undo it.

const CHOICES = [
  { key: 'accepted', label: 'Run it' },
  { key: 'rejected', label: "Don't run it" },
] as const

export function TrustPrompt() {
  const [saving, setSaving] = createSignal(false)
  const [error, setError] = createSignal('')

  const request = () => pendingTrust()[0]
  const nodeLabel = (nodeId: string) => nodes().find((node) => node.nodeId === nodeId)?.label ?? nodeId
  const tiers = createMemo(() => trustTiers(request()))
  // What an update is actually about. Leading with it is the reason an update re-prompts at all.
  const added = createMemo(() => tiers().flatMap((tier) => tier.lines.filter((line) => line.added)))
  const kept = createMemo(() =>
    tiers()
      .map((tier) => ({ ...tier, lines: tier.lines.filter((line) => !line.added) }))
      .filter((tier) => tier.lines.length > 0),
  )

  const dismiss = () => {
    const current = request()
    if (current) resolvePendingTrust(current.row.name, current.hash)
  }

  const decide = (key: string): void => {
    const current = request()
    if (!current || saving()) return
    setSaving(true)
    setError('')
    void recordTrustDecision(current, key === 'accepted' ? 'accepted' : 'rejected')
      .catch((problem: unknown) => setError(problem instanceof Error ? problem.message : 'Could not record the decision.'))
      .finally(() => setSaving(false))
  }

  return (
    <Show when={request()}>
      {(current) => (
        <Modal onDismiss={dismiss} role="alertdialog" title={`Run ${current().row.name}?`} size="wide">
          <ModalBody>
            <Line role="muted">
              {`${current().row.installed?.version ?? '?'} from ${nodeLabel(current().nodeId)}${current().previous ? `, an update from ${current().previous!.version}` : ''}`}
            </Line>
            <Show when={added().length}>
              <SectionHeader level="group">What this version asks for that the last one did not</SectionHeader>
              <For each={added()}>{(line) => <Line tone={line.high ? 'warn' : undefined}>{`  ${line.icon} ${line.text}`}</Line>}</For>
            </Show>
            {/* One block per tier, never one list. */}
            <For each={kept()}>
              {(tier) => (
                <>
                  <SectionHeader level="group">{TIER_LABEL[tier.key]}</SectionHeader>
                  <For each={tier.lines}>{(line) => <Line tone={line.high ? 'warn' : undefined}>{`  ${line.icon} ${line.text}`}</Line>}</For>
                </>
              )}
            </For>
            <Show when={error()}><Alert>{error()}</Alert></Show>
            <box flexDirection="column" ref={(element: BoxRenderable) => takeFocus(element)}>
              <Rows id="plugins.trust" ariaLabel="Run this plugin?" items={[...CHOICES]} onActivate={decide}>
                {(row, item) => <Row item={item}>{row.label}</Row>}
              </Rows>
            </box>
            <Line role="muted">Escape asks again next time.</Line>
          </ModalBody>
        </Modal>
      )}
    </Show>
  )
}

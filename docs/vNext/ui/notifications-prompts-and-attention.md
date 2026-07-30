# Notifications, prompts and attention

Status: Normative<br>
Requirement prefix: `UI-NOTIFY`

Notifications report facts; attention collects actionable items; prompts request an immediate
owner decision. The host owns all three surfaces and aggregates them without losing Node identity.

## Notices

- **UI-NOTIFY-001:** A notice has ID, Node, source installation, kind, severity, title, bounded text,
  occurred/received time, deduplication key, target intent, actions, sensitivity, expiry and read
  state.
- **UI-NOTIFY-002:** Allowed severities are `info`, `warning`, `error`, and `security`. Plugins
  cannot emit `security`; core derives it from trusted policy/health events.
- **UI-NOTIFY-003:** Toast eligibility is declared by notice kind and host policy. Rate limit is
  three plugin toasts per minute per installation with coalescing; security prompts are not toasts.
- **UI-NOTIFY-004:** The notice center groups by Node and time, retains a bounded client projection,
  marks task notices read on explicit task activation, and never hides unread errors merely because
  a duplicate informational notice arrived.
- **UI-NOTIFY-005:** Notice actions use declared commands or navigation intents and reauthorize at
  invocation. Notice text cannot embed active links or executable markup.

## Attention inbox

- **UI-NOTIFY-006:** An attention item has stable identity, Node, subject resource, reason kind,
  priority, created/updated time, owner-visible summary, available actions, source freshness and
  resolution status.
- **UI-NOTIFY-007:** Electron merges bounded per-Node snapshots/events and sorts by security,
  blocking approvals, failing active work, explicit priority and recency. Node disconnection marks
  its items stale instead of deleting them.
- **UI-NOTIFY-008:** Resolving an item is a Node command on its subject. Client dismissal is a
  device-local presentation action unless the source contract defines shared acknowledgement.
- **UI-NOTIFY-009:** Agent approvals, plugin permission requests, setup blocks, quarantine,
  disconnected active tasks, workflow failures and requested review are standard attention kinds.

## Prompts

- **UI-NOTIFY-010:** Prompts are host-owned modal or sheet interactions with authenticated Node,
  requesting actor/plugin, exact operation, affected resource, risk, choices, expiry and focus
  return.
- **UI-NOTIFY-011:** Permission, secret, external-send, native execution, destructive, Git push,
  terminal input, agent approval, trust and quarantine prompts use unique host chrome that bespoke
  UI cannot imitate, cover or position above.
- **UI-NOTIFY-012:** Prompt approval is operation-bound, expires, uses one-time identity and cannot
  be replayed for another input, resource, plugin, Node or command version.
- **UI-NOTIFY-013:** Disconnect, expiration, stale resource version and concurrent resolution close
  the prompt without approval and explain the outcome.

## Native OS notifications

- **UI-NOTIFY-014:** OS notifications are opt-in by kind, never include confidential content by
  default, identify Acorn and safe Node label, and navigate only after Electron revalidates target.
- **UI-NOTIFY-015:** A plugin cannot choose arbitrary notification sounds, actions, icons or deep
  links. Electron maps semantic kind to platform policy.

## Acceptance

- **UI-NOTIFY-016:** Tests MUST cover duplicate/rate storms, mixed Nodes, stale offline items,
  sensitive redaction, concurrent prompt resolution, replay, keyboard/screen-reader operation,
  spoofing attempts and OS notification navigation after revocation.

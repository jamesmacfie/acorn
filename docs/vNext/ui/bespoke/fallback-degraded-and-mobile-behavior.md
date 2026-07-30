# Bespoke fallback, degraded and mobile behavior

Status: Normative<br>
Requirement prefix: `UI-BESPOKE-FALLBACK`

Bespoke UI cannot be assumed available. Every contribution defines a safe state for missing
artifact, unsupported platform/capability, failed verification, guest crash/hang, bridge failure,
Node disconnect, permission loss and future mobile clients.

## Fallback contract

- **UI-BESPOKE-FALLBACK-001:** A contribution declares either a compatible semantic UI document
  reference or `unsupported` metadata containing title, explanation, continuing Node behavior,
  safe status projection and available recovery/navigation actions.
- **UI-BESPOKE-FALLBACK-002:** Fallback MUST preserve critical owner needs: identify resource/
  plugin/Node, inspect status, understand failure, reach settings/plugin management, disable/
  uninstall/report, and complete any safety-critical prompt through host UI.
- **UI-BESPOKE-FALLBACK-003:** A fallback cannot grant actions or expose data absent from the
  bespoke view's current view-session/grants.
- **UI-BESPOKE-FALLBACK-004:** Fallback is verified and opened independently; a failed bespoke guest
  cannot supply its own recovery markup after failure.

## Failure mapping

| Condition | Host behavior |
| --- | --- |
| artifact absent/incompatible | fallback plus Install/Update Client Artifact |
| verification/revocation failure | security state; no Reload; Review/Disable/Uninstall |
| guest crash | fallback; Reload creates clean guest |
| hang/rate/protocol failure | destroy bridge/guest; fallback; health evidence |
| Node offline | last authorized fallback summary marked stale; no mutation |
| grant revoked | discard confidential view; permission-denied fallback |
| plugin disabled/quarantined | lifecycle fallback with recovery actions |
| renderer size unsupported | alternate semantic size class or explicit desktop-required |

- **UI-BESPOKE-FALLBACK-005:** Repeated reload failure follows health thresholds and offers no
  infinite automatic crash loop.
- **UI-BESPOKE-FALLBACK-006:** Last guest DOM/screenshot is not used as fallback after authorization
  or integrity failure. Authorized semantic cached data follows normal cache policy.
- **UI-BESPOKE-FALLBACK-007:** Fallback changes are announced, preserve host focus when possible and
  expose a textual correlation ID for support.

## Future mobile

- **UI-BESPOKE-FALLBACK-008:** Mobile is not a V2 deliverable. The contract treats bespoke UI as
  unsupported unless a future mobile sandbox capability explicitly negotiates the artifact.
- **UI-BESPOKE-FALLBACK-009:** Mobile fallback is one of compatible semantic view, read-only
  semantic summary, or desktop-required state. It never downloads/runs Electron web artifacts.
- **UI-BESPOKE-FALLBACK-010:** Node background behavior continues when mobile cannot render the
  view. Required setup or safety action advertises that an Electron owner client is needed.

## Acceptance

- **UI-BESPOKE-FALLBACK-011:** A matrix test MUST inject every table condition on expanded, medium,
  compact and unsupported-mobile clients and prove recovery access, no stale confidential DOM, no
  unintended authority and accurate Node/plugin identity.

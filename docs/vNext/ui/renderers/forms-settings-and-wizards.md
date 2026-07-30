# Forms, settings and wizards

Status: Normative<br>
Requirement prefix: `UI-FORM`

Forms edit bounded view/session input; settings persist scoped Node or client values; wizards
advance Node-owned setup state. The host owns validation display, secret entry and risk prompts.

## Controls

| Control | Value | Bounds/behavior |
| --- | --- | --- |
| `checkbox` | boolean | standalone or field |
| `switch` | boolean | immediate setting only when effect is safe |
| `textField` | string | 0–64 KiB, input purpose, trim policy |
| `textArea` | string | 0–1 MiB, visible character count |
| `numberField` | integer/number | finite min/max/step |
| `select` | scalar option ID | 1–1,000 static/paged options |
| `multiSelect` | unique option IDs | explicit maximum selection |
| `radioGroup` | scalar option ID | 2–20 options |
| `dateTime` | ISO value | locale display/time-zone policy |
| `duration` | integer milliseconds | units/min/max |
| `keybinding` | canonical chord or null | host conflict checker |
| `resourcePicker` | canonical resource reference | authorized Node query |
| `providerPicker` | connection reference | no credential value |
| `secretField` | write-only secret input | host secure control |
| `filePickerIntent` | resource handle | host native picker when granted |

- **UI-FORM-001:** Every field has stable ID, label, type, required state, description, validation,
  autocomplete/input purpose and sensitivity. Placeholder is never the only label.
- **UI-FORM-002:** Client performs schema validation for feedback; Node repeats validation and
  authorization before persistence or effect.
- **UI-FORM-003:** Field errors are associated with fields and form summary; focus moves to the
  first invalid field only after explicit submit.
- **UI-FORM-004:** Disabled values are not silently dropped. The action input mapping explicitly
  includes or excludes them.
- **UI-FORM-005:** Options use stable IDs and text labels. A submitted ID is revalidated even if it
  appeared in an authorized option page.

## Secret fields

- **UI-FORM-006:** Secret entry is rendered by Electron host chrome outside bespoke guest DOM,
  stored only in protected view memory until submission, sent through the mutually authenticated
  Node channel, written to the Node vault and immediately cleared.
- **UI-FORM-007:** Existing secret state displays `not configured`, `configured`, `unhealthy`, or
  `access unavailable`; never value, prefix, length, last characters, clipboard or browser password
  persistence.
- **UI-FORM-008:** Failed submission discards plaintext after showing a safe retry state. Logs,
  analytics, screenshots and crash reports redact the control and request.

## Forms and settings

- **UI-FORM-009:** A form declares draft owner, dirty behavior, submit/reset/cancel actions,
  concurrency revision and navigation-close policy.
- **UI-FORM-010:** Closing a dirty form uses host confirmation. Secret input is always discarded on
  close; non-secret draft persistence requires an explicit encrypted client-session policy.
- **UI-FORM-011:** Settings show effective scope and provenance, changed effect (`live`, runtime/
  view restart, setup, reinstall), save status, conflict and reset-to-inherited versus
  reset-to-default.
- **UI-FORM-012:** Permission settings use the dedicated grant renderer, not generic switches.

## Wizard renderer

- **UI-FORM-013:** Wizard chrome contains trusted plugin identity, Node, purpose, progress,
  Back/Continue/Cancel/Close rules, safe help and connection state. Plugin content cannot cover or
  restyle it.
- **UI-FORM-014:** The renderer supports all standard steps: information, permission, form, secret,
  OAuth/device authorization, resource selection, validation, async operation, confirmation and
  result.
- **UI-FORM-015:** Step transition sends wizard instance/step revision and validated answer; the
  next step is chosen by the Node state machine, not client code.
- **UI-FORM-016:** Back is allowed only when the definition identifies a reversible predecessor and
  shows whether completed external effects persist.
- **UI-FORM-017:** Closing a resumable wizard leaves its Node state and adds an attention item.
  Cancel invokes the definition's explicit cancellation transition.
- **UI-FORM-018:** Async steps show phase, monotonic progress when known, elapsed time, cancellation
  state, safe diagnostics and reconnect behavior. Indeterminate progress has no fabricated percent.
- **UI-FORM-019:** OAuth shows provider and target Node, opens system browser or device flow, and
  never embeds a provider login inside plugin bespoke UI.

## Acceptance

- **UI-FORM-020:** Tests MUST cover each field and step, invalid/stale submission, two-client edit
  conflicts, options substitution, dirty close, secret redaction, password-manager resistance,
  OAuth replay/timeout, async reconnect/cancel and keyboard/screen-reader completion.

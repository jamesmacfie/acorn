# Health, observability and quarantine

Status: Normative<br>
Requirement prefix: `PLUG-HEALTH`

Plugin telemetry is operational evidence, not authority. Health is computed by core from bounded
signals and determines restart, degradation and quarantine.

## Signals

| Signal | Examples |
| --- | --- |
| readiness | required exports registered, subscriptions attached, migrations current |
| liveness | heartbeat, responsive worker/process, scheduler progress |
| correctness | schema-valid responses, declared event types, idempotency behavior |
| resource | CPU/fuel, memory, disk quota, process count, stream/event/network rates |
| dependency | required/optional dependency health and compatibility |
| security | integrity, sandbox denial, capability abuse, invalid signature, policy violation |
| UX | repeated contribution render/patch/action failures |

- **PLUG-HEALTH-001:** Core owns health state and reason codes. A plugin may report diagnostics but
  cannot mark itself ready, healthy or recovered without host probes succeeding.
- **PLUG-HEALTH-002:** Health is installation/generation scoped and one of `starting`, `healthy`,
  `degraded`, `unhealthy`, `quarantined`, `stopped` or `unknown`.
- **PLUG-HEALTH-003:** Every transition records safe reason, first/last occurrence, count, affected
  capability/contribution, dependency, retry action and correlation. Sensitive payloads are absent.
- **PLUG-HEALTH-004:** Owner UI distinguishes disconnected Node, stopped plugin, degraded optional
  feature, unhealthy required feature and security quarantine.

## Restart and circuit breaking

- **PLUG-HEALTH-005:** Crashes and transient liveness failure use exponential backoff with jitter,
  maximum five automatic restarts in ten minutes, then `unhealthy`.
- **PLUG-HEALTH-006:** Contract-invalid responses, repeated deadlines and overload open a
  per-export circuit breaker. Unrelated exports remain available when isolation is safe.
- **PLUG-HEALTH-007:** Readiness timeout fails activation and preserves or rolls back the previous
  generation. It MUST NOT leave the new generation selected but unusable.
- **PLUG-HEALTH-008:** Resource ceilings terminate or throttle the offending work first. Repeated
  exhaustion degrades or quarantines according to risk; core survival takes priority over plugin
  completion.

## Quarantine

- **PLUG-HEALTH-009:** Immediate quarantine triggers include artifact integrity failure after
  install, verified sandbox escape attempt, executable substitution, signature revocation marked
  critical, secret-exfiltration policy violation and protocol impersonation.
- **PLUG-HEALTH-010:** Repeated capability violations, archive corruption, contract violations,
  crash loops or resource abuse may quarantine after policy threshold.
- **PLUG-HEALTH-011:** Quarantine stops runtimes, revokes handles, unregisters active contributions,
  blocks background work and preserves data/artifacts/audit for diagnosis. It does not silently
  purge evidence or secrets.
- **PLUG-HEALTH-012:** Recovery requires an owner to review reason and choose verified update,
  reduced permissions, reset data, export diagnostics, disable or uninstall. Confirmed integrity or
  publisher revocation cannot be bypassed by Restart.
- **PLUG-HEALTH-013:** A quarantined provider makes required dependants `blocked_dependency` and
  disables optional dependent contributions; it does not quarantine dependants without their own
  evidence.

## Logs, metrics and traces

- **PLUG-HEALTH-014:** Logs are structured with timestamp, severity, installation, generation,
  operation/correlation and stable message code. Plugin-provided text is untrusted, length-bounded,
  newline-safe and tagged as plugin content.
- **PLUG-HEALTH-015:** Credentials, secret values/references beyond opaque ID, authorization
  headers, cookies, terminal input, file bodies, agent prompts, provider raw payloads and bespoke UI
  messages are excluded or redacted before persistence.
- **PLUG-HEALTH-016:** Default metrics include starts, crashes, readiness time, command count/error/
  deadline, event lag/redelivery/dead-letter, view failures, CPU/memory/storage and broker egress.
  Labels MUST NOT contain unbounded resource, path, URL, prompt or user content.
- **PLUG-HEALTH-017:** Traces preserve correlation across command, broker, plugin, dependency,
  provider and resulting event while applying sensitivity redaction at each boundary.
- **PLUG-HEALTH-018:** Diagnostic export is owner-initiated, previews included classes, redacts by
  default, produces an encrypted bounded archive and never includes databases or secrets wholesale.

## Acceptance

- **PLUG-HEALTH-019:** Fault injection MUST cover crash, hang, invalid response, event poison
  message, resource exhaustion, dependency outage, renderer error, integrity failure and sandbox
  violation.
- **PLUG-HEALTH-020:** Tests MUST prove secret-safe logs, bounded labels, core survival, restart
  limits, circuit recovery, quarantine containment, dependant behavior and owner recovery paths.

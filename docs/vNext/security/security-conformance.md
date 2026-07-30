# Security Conformance

Status: normative
Requirement prefix: `SEC-TEST`

These are release-blocking behavioral tests, not a claim of certification.
Tests MUST exercise the production boundary with hostile inputs and MUST fail
when the control is removed. Synthetic credentials and repositories are used;
fixtures, snapshots, logs, and CI artifacts MUST contain no live secrets.

Every Critical or High threat in
[threat-model.md](./threat-model.md) requires all mapped tests to pass on every
supported platform/runtime. Platform-native sandbox tests run on packaged
artifacts, not only mocks.

## Identity and pairing

| Test | Covers | Required scenario and assertion |
| --- | --- | --- |
| SEC-TEST-ID-001 | SEC-ID-001–005; THREAT-ID-001 | Verify UUIDv7 Node ID plus Node identity/CA/device identities are distinct, private keys are unavailable to renderer/plugins, fingerprint derives from Node identity SPKI, SAN bindings are exact, and a certificate for another Node/device is rejected. |
| SEC-TEST-ID-002 | SEC-ID-006–009; CON-PAIR-008–012; THREAT-ID-001 | Using only published PairingClaim fields/test vectors, independently alter session, secret proof, challenge, Node ID/key/fingerprint, normalized endpoint, protocol, owner confirmation, CSR/digest/key proof, nonce and transcript digest; replay consumed and exchange concurrent sessions. Every case fails before certificate/device/owner commit with one uniform error. |
| SEC-TEST-ID-002A | CON-BOOT-001–006; UX-FIRST-004A; THREAT-ID-001 | In packaged and development modes substitute descriptor/pipe, binary digest/signature and peer PID; race two bootstraps, replay proofs, kill parent/child and crash at every persisted transition. Exactly one owner credential results or a clean unpaired root remains, with no reusable bootstrap secret. |
| SEC-TEST-ID-003 | SEC-ID-007–009; THREAT-ID-001 | Verify QR/text contain 128-bit secret, fingerprint and full-owner warning are trusted chrome, and numeric-only or client-only remote approval is impossible. |
| SEC-TEST-ID-004 | SEC-ID-006–009; THREAT-ID-001 | Exceed per-source/global attempts, race two consumers, restart mid-pair, and alter endpoint/version; verify rate limit, one winner, fail-closed recovery, and transcript rejection. |
| SEC-TEST-ID-005 | SEC-ID-010–013; THREAT-ID-002, THREAT-ID-024 | Revoke an active device during HTTP, WebSocket, stream, view, and pending command; verify new denial, socket/token closure, pre-commit cancellation, and durable committed result only. |
| SEC-TEST-ID-006 | SEC-ID-014–016; THREAT-ID-002, THREAT-ID-023, THREAT-ID-024 | Attempt destructive recovery without OS/paired reauth and with lost keys; verify ceremony, no silent key replacement, preserved unreadable root, and complete audit. |
| SEC-TEST-ID-007 | SEC-ID-005, SEC-ID-014–016; THREAT-ID-002, THREAT-ID-023, THREAT-ID-024 | Test renewal, expiry, normal and emergency Node rotation, old/new signatures, and restored Node; verify serial revocation and mandatory re-pair where specified. |
| SEC-TEST-ID-008 | SEC-ID-017; CON-ROTATE-001–003; THREAT-ID-002, THREAT-ID-024 | Attempt new-key use before commit and old-key use after commit; race rotations, alter generations/CSR/challenge, replay proofs, lose responses and crash at every journal point. Exactly one ordinary active generation remains and recovery uses the durably stored new credential. |
| SEC-TEST-ID-009 | SEC-ID-018; CON-RECOVER-001–003; THREAT-ID-002, THREAT-ID-023 | Claim expired/replayed/wrong-Node/wrong-epoch packages, rotate Node identity, exhaust rate limits and recover after all clients are revoked. Only OS-present local administration or a valid encrypted package creates one replacement owner, revokes prior devices and advances the epoch. |

## Transport and replay

| Test | Covers | Required scenario and assertion |
| --- | --- | --- |
| SEC-TEST-TRANS-001 | SEC-TRANS-001–003; THREAT-ID-004 | Scan direct listener; only TLS 1.3 approved suites work, 0-RTT/compression/plaintext/TLS 1.2 fail. |
| SEC-TEST-TRANS-002 | SEC-TRANS-002, SEC-TRANS-004; THREAT-ID-004 | Use valid public CA/wrong pin, valid cert/wrong device, renderer key request, and expired/revoked cert; all fail before dispatch. |
| SEC-TEST-TRANS-003 | SEC-TRANS-005–007; THREAT-ID-004 | Test default binds, exposure ceremony, bad Host/SNI/Origin/content type/method/size, permissive CORS, and error leakage; verify fail-closed bounded responses. |
| SEC-TEST-TRANS-004 | SEC-TRANS-001–007; THREAT-ID-004 | Run automated TLS/header configuration checks against packaged local and standalone Node modes with identical logical authentication. |
| SEC-TEST-TRANS-005 | SEC-TRANS-003; THREAT-ID-004 | Remove every allowed cipher/suite intersection and offer deprecated suites; verify stable incompatible-security error and no downgrade. |
| SEC-TEST-TRANS-006 | SEC-TRANS-002; THREAT-ID-004 | Change DNS/endpoint certificates while retaining and then changing Node key; verify retained pin accepts only valid endpoint policy and changed key requires explicit ceremony. |
| SEC-TEST-TRANS-006A | SEC-TRANS-004A; ARCH-TOPO-010; THREAT-ID-004 | Place layer-four pass-through and then a TLS-terminating proxy in front of the Node; pass-through preserves both certificates/exporter/pin, while termination, forwarded identity, replay and a revoked forwarded client fail before dispatch. |
| SEC-TEST-TRANS-007 | SEC-TRANS-008–012; THREAT-ID-005, THREAT-ID-026 | Duplicate command IDs/idempotency keys with same and different bodies; verify one side effect, cached identical result, and conflict on changed input. |
| SEC-TEST-TRANS-008 | SEC-TRANS-009–016; THREAT-ID-005, THREAT-ID-021, THREAT-ID-026 | Replay expired/future/wrong-Node commands and relay frames with repeated counters/session/direction; verify rejection and connection closure. |
| SEC-TEST-TRANS-009 | SEC-TRANS-011–012; THREAT-ID-005, THREAT-ID-026 | Drop, duplicate, reorder, and exceed product-event retention; verify bounded reordering behavior, replay gap, snapshot, and authority re-read. |
| SEC-TEST-TRANS-010 | SEC-TRANS-008–012; THREAT-ID-005, THREAT-ID-026 | Race cancellation/revocation with command commit; assert the documented commit point and no ambiguous second side effect. |
| SEC-TEST-TRANS-011 | SEC-TRANS-013–024; THREAT-ID-021 | Using a relay harness, MITM Noise handshake, alter identity binding, inject/duplicate/reorder frames, force rekey/resume, and inspect relay storage; no plaintext/key or accepted forgery. |
| SEC-TEST-TRANS-012 | SEC-TRANS-018–025; THREAT-ID-021 | Verify opaque rotating routing IDs/wake payloads, quotas, metadata documentation, offline degradation, and no insecure direct fallback. |
| SEC-TEST-TRANS-012A | SEC-TRANS-026–030; DEC-026; THREAT-ID-021 | Use published vectors for duplicate/reordered/delayed/cross-session/counter-boundary/rekey/resume frames and pre-revocation/pre-rotation trust generations; substitute routing metadata and exceed queue bounds. Endpoints agree on the 4,096-frame bitmap, reject stale epochs/tokens and V2 exposes no relay enablement. |

## Keys and credentials

| Test | Covers | Required scenario and assertion |
| --- | --- | --- |
| SEC-TEST-KEY-001 | SEC-KEY-001–009; THREAT-ID-006 | Inspect files, environment, renderer IPC, plugin imports, crash/log output, and backups; identity/master/DEK plaintext is absent and domains are distinct. |
| SEC-TEST-KEY-002 | SEC-KEY-003–007; THREAT-ID-006 | Validate HKDF context separation, random DEKs/nonces, associated-data binding, and rejection after ciphertext/nonce/tag/context mutation. |
| SEC-TEST-KEY-003 | SEC-KEY-010–015; THREAT-ID-006 | Crash provisioning/rotation at each journal step; verify no network/plugin start on partial root, resumable rewrap, and no premature old-key deletion. |
| SEC-TEST-KEY-004 | SEC-KEY-011, SEC-KEY-015; THREAT-ID-006 | Remove/lock/wrong-key the OS credential; verify recovery mode, no replacement key, no partial plaintext, and high-friction crypto-erasure. |
| SEC-TEST-KEY-005 | SEC-KEY-012–014; THREAT-ID-006 | Rotate normally and for compromise across all domains; verify new writes use new version and old ciphertext is fully re-encrypted for compromise rotation. |
| SEC-TEST-KEY-006 | SEC-KEY-001–015; THREAT-ID-006 | Static/dynamic scan confirms keys are not reused across TLS, artifacts, audit, credential, field, client, and backup domains. |
| SEC-TEST-KEY-007 | SEC-KEY-016–020; THREAT-ID-007 | List/get/event/cache/view/export secret metadata and instrument secret entry; verify only opaque refs, no value persistence, and no plugin access. |
| SEC-TEST-KEY-008 | SEC-KEY-021–023; THREAT-ID-007 | Invoke broker with wrong plugin, chain, purpose, grant version, resource, or secret; verify denial occurs before decrypt/use and response is non-oracular. |
| SEC-TEST-KEY-009 | SEC-KEY-029–032; SEC-AUTH-030–031; THREAT-ID-007 | Request raw secret access from every plugin tier/runtime; all are denied. Exercise a fixed-purpose core helper while separately granting direct network, DNS redirects, children, writable files, inherited handles, diagnostics and debugger; every toxic combination is rejected for the helper lifetime, revocation terminates it, and audit remains redacted. |
| SEC-TEST-KEY-010 | SEC-KEY-024–028, SEC-AUTH-013–015; THREAT-ID-016 | Exercise HTTP/HTTPS/non-HTTP schemes, userinfo, alternate IP forms, DNS rebinding, private/link-local/metadata/Unix targets; verify SSRF denial before credential injection. |
| SEC-TEST-KEY-011 | SEC-KEY-024–028, SEC-AUTH-013–015; THREAT-ID-016 | Redirect same-origin/cross-origin/scheme/private IP and inspect every hop; verify reauthorization and stripping of all credentials on origin change. |
| SEC-TEST-KEY-012 | SEC-KEY-027–028, SEC-AUTH-013–015; THREAT-ID-016 | Return oversized, slow, compressed-bomb, wrong-content-type, malformed-schema provider responses; verify bounded rejection before plugin delivery. |
| SEC-TEST-KEY-013 | SEC-KEY-021–032; THREAT-ID-007, THREAT-ID-016 | Capture broker network/audit/log/error traffic using synthetic secrets; credential appears only at the exact authorized provider boundary and nowhere else. |

## Authorization and broker boundaries

| Test | Covers | Required scenario and assertion |
| --- | --- | --- |
| SEC-TEST-AUTH-001 | SEC-AUTH-001–006C; THREAT-ID-008 | Schema-reject unknown constraints/missing bindings, then omit/forge/expire/revoke/substitute artifact digest, publisher, installation generation, operation, purpose, destination, resource, permission digest or grant version. Broker denies immediately before side effect and remains denied after restart. |
| SEC-TEST-AUTH-002 | SEC-AUTH-001–006; THREAT-ID-008 | Verify install/update UI shows exact scopes and permission expansion cannot be hidden, bundled, or carried forward. |
| SEC-TEST-AUTH-003 | SEC-AUTH-016–019, SEC-AUTH-018A–018B; THREAT-ID-008 | Exercise direct, two-hop and three-hop delegation with a broader callee; revoke during nested call, replay to another audience/resource, forge caller/hops/grants and cancel root. Effective authority remains the original intersection and redacted audit/event attribution identifies every ordered hop/grant version. |
| SEC-TEST-AUTH-004 | SEC-AUTH-019; THREAT-ID-008 | Deliver forged/stale event then revoke authority before handler; consumer re-reads state and refuses side effect. |
| SEC-TEST-AUTH-005 | SEC-AUTH-007–012; THREAT-ID-017 | Fuzz absolute/traversal/NUL/device/ADS/Unicode/case/symlink/junction paths and race links; no operation escapes descriptor-bound workspace. |
| SEC-TEST-AUTH-006 | SEC-AUTH-011–012; THREAT-ID-017 | Inject shell metacharacters, executable substitution, inherited environment/descriptors, and ungranted terminal input; verify argv/scope confinement. |
| SEC-TEST-AUTH-007 | SEC-AUTH-016–020; THREAT-ID-008, THREAT-ID-028 | Compile/runtime checks attempt direct import, private endpoint, shared object, socket, environment credential, and cross-plugin DB; all are unavailable. |
| SEC-TEST-AUTH-008 | SEC-AUTH-016–020; THREAT-ID-008, THREAT-ID-028 | Spoof plugin/install/publisher/call-chain identity on broker IPC; authenticated channel and audience-bound delegation reject it. |
| SEC-TEST-AUTH-009 | SEC-AUTH-021–026; THREAT-ID-018 | Change each executable repository field and provenance; trust digest invalidates and exact diff/capabilities are shown. |
| SEC-TEST-AUTH-010 | SEC-AUTH-024–026; THREAT-ID-018 | Deny/expire trust during agent workflow; stable `needs-trust`, attention item, no fallback, auto-resume, or agent approval. |
| SEC-TEST-AUTH-011 | SEC-AUTH-021–026; THREAT-ID-018 | Trust declarative repository data and then request ungranted execution/network/secret authority; repository trust does not grant it. |
| SEC-TEST-AUTH-011A | SEC-AUTH-026A; CUR-DOCKER-010A, CUR-DOCKER-011A–011B, CUR-DOCKER-017A; THREAT-ID-018 | Mutate Compose include/override/.env/env-file/symlink/bind/socket/privileged/device/host-network/Dockerfile/build-context between preview and execution. The exact plan digest invalidates and every high-risk host effect requires its own current grant. |
| SEC-TEST-AUTH-012 | SEC-AUTH-027, SEC-AUTH-029; THREAT-ID-029 | Attempt preview-tunnel use against Node API, metadata, another task/port/address, post-DNS-rebind redirect, another view/device, expired/revoked handle and cross-origin credential; every request is denied or the tunnel closes. |
| SEC-TEST-AUTH-013 | SEC-AUTH-028–029; THREAT-ID-008, THREAT-ID-029 | Broadcast, replay, retarget or answer `client.operation.*` from another device/view; race approval/grant/view revocation and disconnect; no operation is dispatched, reassigned or replayed. |

## Plugin isolation

| Test | Covers | Required scenario and assertion |
| --- | --- | --- |
| SEC-TEST-PLUG-001 | SEC-PLUG-011–016; THREAT-ID-009 | Malicious WASI component probes filesystem, socket, DNS, env, clock, random, stdio, process, host imports, and forged handles; only declared broker operations exist. |
| SEC-TEST-PLUG-002 | SEC-PLUG-014–016; THREAT-ID-009 | Attempt path escape, stale/foreign handles, oversized WIT values, invalid UTF-8, deep recursion, and numeric overflow; host rejects safely. |
| SEC-TEST-PLUG-003 | SEC-PLUG-015; THREAT-ID-009 | Attempt raw and inherited network plus broker SSRF; direct network unavailable and broker policy still applies. |
| SEC-TEST-PLUG-004 | SEC-PLUG-019–022; THREAT-ID-009 | Trap, corrupt compiled cache, change runtime security minimum, and inspect errors; no sensitive details or execution of stale cache/runtime. |
| SEC-TEST-PLUG-005 | SEC-PLUG-017–020; THREAT-ID-009, THREAT-ID-019 | Exhaust memory, CPU, host-call time, handles, calls, worker wakeups, logs, and event payload; terminate/quarantine without Node failure. |
| SEC-TEST-PLUG-006 | SEC-PLUG-017–022; THREAT-ID-009, THREAT-ID-019 | Run multiple installations under load; quotas and identities remain isolated and higher limits require explicit resource grant. |
| SEC-TEST-PLUG-007 | SEC-PLUG-023–030; THREAT-ID-010 | Packaged native sandbox probes data roots, home, devices, processes, debugger, direct sockets, child spawn, credentials, environment, and writable code; denied except exact grants. |
| SEC-TEST-PLUG-008 | SEC-PLUG-023; THREAT-ID-010 | Disable/degrade each platform sandbox control; activation fails rather than claiming sandboxed operation. |
| SEC-TEST-PLUG-009 | SEC-PLUG-026–030; THREAT-ID-010 | Attempt mount/path escape, library injection, writable executable mapping, unexpected dependency, IPC spoof, and sibling-install access; all fail. |
| SEC-TEST-PLUG-010 | SEC-PLUG-031–033; THREAT-ID-010 | Exhaust native resources, violate sandbox, crash loop, and inspect diagnostic output; quarantine is isolated and contains no memory/secrets. |
| SEC-TEST-PLUG-011 | SEC-PLUG-034–035; THREAT-ID-010 | Attempt to enable unrestricted native remotely/from plugin/repo/update and after digest change; only repeated local typed ceremony succeeds. |
| SEC-TEST-PLUG-012 | SEC-PLUG-023–035; THREAT-ID-010 | Run the full native probe on every supported OS/architecture release artifact; absent coverage blocks that target. |
| SEC-TEST-PLUG-013 | SEC-PLUG-001–010; THREAT-ID-011, THREAT-ID-028 | Add nonallowlisted in-process plugin/private import/ambient route/IPC/listener; static and runtime boundary gates fail. |
| SEC-TEST-PLUG-014 | SEC-PLUG-001–010; THREAT-ID-011, THREAT-ID-028 | Feed hostile external input through each System plugin privileged contribution; validation and core broker ownership remain intact. |

## Bespoke and standard UI

| Test | Covers | Required scenario and assertion |
| --- | --- | --- |
| SEC-TEST-UI-001 | SEC-UI-001–007; THREAT-ID-003, THREAT-ID-012 | Node attempts to send UI code and package loads remote/extra/mismatched files; client independently verifies or renders trusted unsupported state. |
| SEC-TEST-UI-002 | SEC-UI-002–007, SEC-UI-025–028; THREAT-ID-003, THREAT-ID-012, THREAT-ID-025 | Probe cookies/storage/service workers/network/popups/downloads/Node/Electron/DevTools/active Markdown/terminal escapes; all unavailable or mediated. |
| SEC-TEST-UI-003 | SEC-UI-004–007; THREAT-ID-012 | Automated CSP/header/origin/session test verifies unique origins, no unsafe directives, no shared state, no MIME sniffing, and sandboxed packaged renderer. |
| SEC-TEST-UI-004 | SEC-UI-008–019; THREAT-ID-003, THREAT-ID-012 | Forge origin/nonce/session/install/contribution/sequence/type/schema/delegation and replay messages; bridge closes with trusted error and no action. |
| SEC-TEST-UI-005 | SEC-UI-014–019; THREAT-ID-003, THREAT-ID-012, THREAT-ID-025 | Plugin imitates/overlays permission and navigation UI, opens dangerous links/files, or requests OS access; trusted chrome and mediation cannot be bypassed. |
| SEC-TEST-UI-006 | SEC-UI-010–019; THREAT-ID-003, THREAT-ID-012, THREAT-ID-025 | Revoke permission, disconnect Node, update artifact, navigate, expire session, and destroy window during an action/stream; tokens close and no broader fallback appears. |
| SEC-TEST-UI-007 | SEC-UI-008–013; THREAT-ID-012 | Fuzz bridge schemas with unknown keys, extreme numbers, invalid UTF-8, prototypes, cycles, and hostile action names; deterministic bounded rejection. |
| SEC-TEST-UI-008 | SEC-UI-011–016; THREAT-ID-012 | Request credential, filesystem root, hidden setting, sibling data, owner token, and protected ceremony; no sensitive value enters view. |
| SEC-TEST-UI-009 | SEC-UI-002, SEC-UI-007, SEC-UI-010, SEC-UI-020–021A; THREAT-ID-012 | Install the same coordinate on two Nodes/generations; open simultaneous preview/production views and attempt origin/cache/storage/process crossover. Exercise just below/above 15-minute idle, eight-hour absolute, 256-KiB message, 60-message/s, 2-MiB/s, 16-in-flight and 32-MiB live-data limits; isolation is pairwise and negotiated values only decrease. |
| SEC-TEST-UI-009A | CON-PREVIEW-005–009; CUR-PREVIEW-098A; UI-MEDIA-024; THREAT-ID-012, THREAT-ID-029 | Attack remote preview cross-Node/view/origin, stale/guessed port/token, malicious local page, Host/Origin, service worker, cookie/cache, redirect/DNS rebinding, forbidden headers/methods, body limits, late frames, selected Client and teardown. Only the exact active preview partition succeeds and no authority survives closure. |
| SEC-TEST-UI-010 | SEC-UI-020–024; THREAT-ID-019 | Exceed message/depth/string/rate/concurrency/live-data/stream/resource limits; only view is terminated/quarantined and Acorn remains responsive. |
| SEC-TEST-UI-011 | SEC-UI-020–024; THREAT-ID-012 | Trigger CSP, schema, crash, and navigation violation loop; trusted health UI appears without automatic crash loop. |
| SEC-TEST-UI-012 | SEC-UI-025–028; THREAT-ID-025 | Corpus-test Markdown, ANSI/OSC, filenames, diff content, media bombs, malformed codecs, links, and browser redirects; no host side effect or unsafe render. |
| SEC-TEST-UI-013 | SEC-UI-025–028; THREAT-ID-012, THREAT-ID-025 | Verify standard editor/diff/terminal/preview renderers do not load repository extensions/scripts and active preview has a separate session/capability. |
| SEC-TEST-UI-014 | SEC-AUTH-027–029; THREAT-ID-003, THREAT-ID-029 | Drive a remote Node-only preview through the opaque Client origin, then attack tunnel routing, partition storage/cookies, Client-operation identity, size/rate bounds and teardown; no Acorn credential, other target or stale native view is reachable. |

## Marketplace and artifacts

| Test | Covers | Required scenario and assertion |
| --- | --- | --- |
| SEC-TEST-SUPPLY-001 | SEC-SUPPLY-001–010; THREAT-ID-011, THREAT-ID-013 | Verify TUF threshold/expiry/version/root rotation, trusted/community root separation, publisher namespace, transparency, and revocation. |
| SEC-TEST-SUPPLY-002 | SEC-SUPPLY-003–010; THREAT-ID-013 | Use wrong/expired/revoked publisher, changed identity, missing review attestation, Community-to-trusted attempt, and confusable name; no promotion/activation. |
| SEC-TEST-SUPPLY-003 | SEC-SUPPLY-011–020; THREAT-ID-013 | Mutate each logical artifact/manifest/SBOM/provenance/dependency after signing and try Node-to-client code delivery; independent verification fails. |
| SEC-TEST-SUPPLY-004 | SEC-SUPPLY-001–024; THREAT-ID-011, THREAT-ID-013 | Freeze/rollback marketplace metadata and package version, revoke active System/Verified code, and verify block/quarantine/security notification. |
| SEC-TEST-SUPPLY-005 | SEC-SUPPLY-017–024; THREAT-ID-013 | Create dependency cycles, mutable/unresolved deps, permission expansion, publisher/trust/runtime/UI changes, and concurrent update; resolution/approval/lock gates hold. |
| SEC-TEST-SUPPLY-006 | SEC-SUPPLY-021–024; THREAT-ID-013 | Crash at every stage/migration/health/atomic-switch journal point; prior nonrevoked version or visible resumable partial install remains. |
| SEC-TEST-SUPPLY-007 | SEC-SUPPLY-007; THREAT-ID-013 | Fuzz listing text/screenshots/links/changelog as untrusted content; standard renderer policy prevents active content/navigation. |
| SEC-TEST-SUPPLY-008 | SEC-SUPPLY-025–033; THREAT-ID-014 | Archive corpus covers absolute/traversal/Unicode/case/duplicate/link/device/ADS/permission/path attacks; extraction never escapes or creates unsafe types. |
| SEC-TEST-SUPPLY-009 | SEC-SUPPLY-025–033; THREAT-ID-014 | Exercise compressed/expanded/entry/count/ratio/path/schema/reference limits and cancellation; bounded staging cleanup with no activation. |
| SEC-TEST-SUPPLY-010 | SEC-SUPPLY-026–033; THREAT-ID-014 | Race digest verification, staging mutation, concurrent install, executable permission, dynamic dependency, and crash recovery; final active bytes equal signed digests. |
| SEC-TEST-SUPPLY-011 | SEC-SUPPLY-034–040; THREAT-ID-015 | Developer source uses branch/tag/short SHA/submodule drift/hook/install script; exact-lock and script-free policy reject it. |
| SEC-TEST-SUPPLY-012 | SEC-SUPPLY-035–040; THREAT-ID-015 | Builder probes credentials, SSH agent, metadata, home/worktree/network after fetch, and host paths; isolation holds and output remains Developer Source. |
| SEC-TEST-SUPPLY-013 | SEC-SUPPLY-034–040; THREAT-ID-015 | Update commit/digest/permissions and unrestricted-native output; require rebuild, review, local provenance, and repeated execution ceremony. |

## Data, backup, and restore

| Test | Covers | Required scenario and assertion |
| --- | --- | --- |
| SEC-TEST-DATA-001 | SEC-DATA-016–020; THREAT-ID-020 | Mutate header, manifest, chunk, nonce, order, size, AEAD, signature, recovery key, and Argon2 parameters; restore rejects before staging activation. |
| SEC-TEST-DATA-002 | SEC-DATA-021–030; THREAT-ID-020 | Snapshot plugin timeout/crash/concurrent writes; backup reports exact exclusions or produces a consistent complete snapshot, never false success. |
| SEC-TEST-DATA-003 | SEC-DATA-022–025; THREAT-ID-020 | Inspect backup for identity/pairing/session/native approval and test optional credentials/large data; always-excluded fields absent and selections exact. |
| SEC-TEST-DATA-004 | SEC-DATA-026–030; THREAT-ID-020 | Interrupt output, fill disk, choose unsafe destination, and corrupt after write; incomplete file is unusable and success requires authenticated reread. |
| SEC-TEST-DATA-005 | SEC-DATA-031–038; THREAT-ID-020 | Restore over running/V1 roots and with old IDs/grants/certs/revocations; new root/identity, re-pair, pending grants, and current policy are mandatory. |
| SEC-TEST-DATA-006 | SEC-DATA-034–038; THREAT-ID-020 | Restore missing/revoked/incompatible plugins and disabled credentials; data remains sealed/exportable and no runtime/secret use activates. |
| SEC-TEST-DATA-007 | SEC-DATA-016–038; THREAT-ID-014, THREAT-ID-020 | Backup archive/path/parser corpus attempts traversal, link, device, collision, bomb, excessive counts/depth, and schema abuse; staging stays bounded. |
| SEC-TEST-DATA-008 | SEC-DATA-031–038; THREAT-ID-014, THREAT-ID-020 | Crash each restore/migration journal step; original backup and inactive new root remain recoverable and old running root is unchanged. |
| SEC-TEST-DATA-009 | SEC-DATA-031–038; THREAT-ID-014 | Race staging files and active pointer; only verified same-filesystem atomic state can become active. |
| SEC-TEST-DATA-010 | SEC-DATA-016–030; THREAT-ID-014 | Attempt plugin-controlled backup path, archive entry, preview secret, and output mutation; trusted core retains all path/content authority. |
| SEC-TEST-DATA-011 | SEC-DATA-018–020, SEC-DATA-031–038; THREAT-ID-020 | Recover with correct/incorrect key/passphrase, untrusted exporter signature, and old policy; integrity is mandatory and trust warning cannot bypass current security. |
| SEC-TEST-DATA-012 | SEC-DATA-033–038; THREAT-ID-020 | Restore then attempt old client/secret/plugin authority before confirmation; all are denied and audited. |
| SEC-TEST-DATA-013 | SEC-DATA-038; THREAT-ID-020 | Restore a backup predating critical revocations/minimum runtime/protocol; current revocations and minimums win. |
| SEC-TEST-DATA-014 | SEC-DATA-008–015; THREAT-ID-027 | Feed identical resource IDs from two Nodes into cache/search/layout/event/action; all remain partitioned and mutations target the correct Node. |
| SEC-TEST-DATA-015 | SEC-DATA-010–015; THREAT-ID-027 | Unpair during offline/cache/view/queued command state; Node partition and certificate are removed and no queued security/destructive command survives. |
| SEC-TEST-DATA-016 | SEC-DATA-011–013; THREAT-ID-027 | Mark synthetic fields sensitive and inspect cache/search/notification/clipboard/crash; sensitive values absent and malicious Node content stays inert. |
| SEC-TEST-DATA-017 | SEC-DATA-001–007; THREAT-ID-006, THREAT-ID-027 | Test disk-encryption disabled/unknown/attested/volume-changed, broad filesystem modes, temp crash, sensitive-label downgrade, and deletion; production-root refusal, memory-only client behavior, attestation, repair, and fail-closed rules hold. |
| SEC-TEST-DATA-018 | SEC-DATA-024A–024F; SEC-KEY-015A; THREAT-ID-006, THREAT-ID-020 | Export/restore credentials with wrong key/passphrase, swapped record/purpose/destination, modified manifest, duplicate archive and crash/cancel at every record transition. A new disabled reference is re-encrypted under the new Node; no old master key, plaintext file, duplicate record or pre-confirmation broker use exists. |
| SEC-TEST-DATA-019 | CON-EVT-006A–006C; DATA-CLIENT-004; THREAT-ID-027 | Submit unknown schema/wrong digest, duplicate/conflicting URI, mixed Node, stale/new source sequence, changed authorization, expired result, oversized/deep payload and partial plugin failure; crash each group install boundary. Invalid groups preserve the old partition, complete groups switch atomically and the cursor advances only after a valid snapshot commit. |

## Audit, abuse, and incident recovery

| Test | Covers | Required scenario and assertion |
| --- | --- | --- |
| SEC-TEST-AUD-001 | SEC-AUD-001–007; THREAT-ID-022 | Perform every security operation and verify required actor/resource/outcome/order/checkpoint fields, monotonic sequence despite clock rollback, and chain validity. |
| SEC-TEST-AUD-002 | SEC-AUD-005–013; THREAT-ID-022 | Tamper, delete, reorder, truncate, rotate, and restart audit segments; integrity incident and signed export detect it while declared retention remains enforceable. |
| SEC-TEST-AUD-003 | SEC-AUD-003–011; THREAT-ID-007, THREAT-ID-022 | Inject synthetic secrets/control chars/large provider bodies into all audited paths, diagnostics, crashes, and exports; allowlist/redaction/bounds prevent disclosure. |
| SEC-TEST-AUD-004 | SEC-AUD-008–010; THREAT-ID-022 | Plugin forges/writes/reads global audit or another plugin logs; core denies, installation scoping and quotas hold. |
| SEC-TEST-AUD-005 | SEC-AUD-005, SEC-AUD-012; THREAT-ID-022 | Exceed time/size retention and verify checkpointed range marker, no product-event policy confusion, and no silent gap. |
| SEC-TEST-AUD-005A | SEC-AUD-013A–013E; THREAT-ID-022 | Validate fixed record/checkpoint/range fixtures with an independent verifier; modify, delete, reorder, duplicate, truncate and cross-Node splice records, rotate keys, restart clocks and compare live versus signed export. Every alteration fails and valid retained prefixes verify without sensitive payloads. |
| SEC-TEST-AUD-006 | SEC-AUD-006–013; THREAT-ID-022 | Export then verify with wrong Node key and altered records/checkpoints; verification identifies exact invalid range without exposing content. |
| SEC-TEST-AUD-007 | SEC-AUD-014–021; THREAT-ID-023 | Exhaust each admission/rate/resource dimension and inject persistent auth/schema/sandbox/integrity failures; bounded containment, no unsafe retries, correct health state. |
| SEC-TEST-AUD-008 | SEC-AUD-020–026; THREAT-ID-023 | Trigger identity, key, artifact, sandbox, audit, and secret incidents; verify required quarantine/recovery state, trusted UI, revoked sessions, and preserved evidence. |
| SEC-TEST-AUD-009 | SEC-AUD-022–026; THREAT-ID-023 | Plugin attempts to hide/resolve its incident; only reauthenticated owner/core runbook can close it and closure does not restore authority. |
| SEC-TEST-AUD-010 | SEC-AUD-023–026; THREAT-ID-023 | Exercise every required runbook with crash/retry; containment and recovery actions are idempotent, audited, and end with affected conformance reruns/residual risk. |

## Tooling and release evidence

The release pipeline MUST:

1. validate all JSON Schema, OpenAPI, AsyncAPI, WIT, manifest, artifact, and
   example files with pinned parsers;
2. run dependency vulnerability, license, secret, malware, native-signature,
   provenance, SBOM, and forbidden-install-script checks;
3. run static boundary rules for cross-plugin imports, Electron privilege,
   unsafe URL/process/path primitives, direct secret access, and ambient network;
4. run dynamic protocol fuzzing, archive/parser corpora, credential leakage
   capture, Electron CSP/origin tests, WASI escape probes, and packaged native
   sandbox probes;
5. preserve signed, secret-free test summaries keyed by source commit, build
   provenance, platform, runtime, and artifact digest.

A skipped platform security test is a failure for that release target.
Flakiness does not waive a security gate. Any accepted Medium gap is recorded
with owner, compensating control, expiry, and threat ID; Critical and High gaps
cannot be accepted for release.

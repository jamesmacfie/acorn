# V2 Security Threat Model

Status: normative<br>
Requirement prefix: `THREAT-ID` / `SEC-OBJ`<br>
Audience: Acorn Node, Electron client, plugin runtime, marketplace, and test implementers

This document defines the security boundary of Acorn V2. It does not claim that
Acorn can make intentionally executed code harmless. A terminal is a facility
for code execution, and an unsandboxed Developer Source plugin is unrestricted
local code execution. Acorn MUST make those choices explicit, prevent ambient
or drive-by execution, and contain every lower-trust principal to its granted
authority.

## Security objectives

- **SEC-OBJ-001:** Only a physically or already-authorized owner can pair a new
  full-authority client with a Node.
- **SEC-OBJ-002:** A network attacker, relay, marketplace, repository, provider,
  or untrusted plugin cannot impersonate a Node, client, publisher, or another
  plugin.
- **SEC-OBJ-003:** Confidential data remains confidential in transit, in
  backups, and in application-managed secret storage.
- **SEC-OBJ-004:** Plugins receive no authority that is not declared, shown to
  the owner, granted, and enforced at the privileged operation boundary.
- **SEC-OBJ-005:** A compromised plugin or bespoke view cannot use the authority
  of its caller, host, dependency, or sibling without an explicit delegation.
- **SEC-OBJ-006:** Security-relevant state changes are attributable, redacted,
  detectable, and recoverable.
- **SEC-OBJ-007:** Security failures are fail-closed without silently destroying
  data or replacing keys needed to recover it.
- **SEC-OBJ-008:** A fresh V2 installation exposes no V1 token, session, listener,
  database, plugin, or credential to V2.

Availability is an objective against accidental faults and bounded abuse, not
against the machine owner, a root/administrator compromise, or a plugin the
owner deliberately authorized to consume unbounded system resources.

## Assets

| Asset | Classification | Authoritative owner |
| --- | --- | --- |
| Node identity private key | critical secret | OS credential store on that Node |
| Paired-client private key and per-Node certificate | critical secret | OS credential store on that client |
| Node master encryption key | critical secret | OS credential store or approved hardware-backed provider |
| Provider credentials and plugin secrets | secret | credential broker on the owning Node |
| Backup recovery key/passphrase | critical secret | owner, outside the backup |
| Worktrees, source, patches, terminal content | sensitive | owning Node |
| Agent prompts, transcripts, notes, memory | sensitive | owning Node/plugin database |
| Plugin packages and UI artifacts | executable | content-addressed artifact stores |
| Permission grants and plugin lock | security configuration | owning Node |
| Client fleet catalog, layouts, and caches | sensitive | Electron client |
| Security audit records | sensitive integrity data | Node security audit store |
| Product event log | sensitive operational data | Node core database |

## Principals and trust boundaries

1. **Machine owner:** controls the OS account and can intentionally execute
   arbitrary code. Acorn cannot protect against that owner.
2. **Acorn Node:** authoritative for its workspaces, commands, product events,
   plugin grants, secrets, and durable domain state.
3. **Paired Electron client:** receives full owner authority for that Node. There
   are no V2 read-only or limited client roles.
4. **System plugin:** reviewed, shipped with Acorn, and allowed in-process only
   where the system-plugin specification says so. It is still authenticated as
   a distinct principal at broker boundaries.
5. **Acorn Verified plugin:** publisher-identified and reviewed; it receives only
   granted capabilities and does not inherit System authority.
6. **Community plugin:** signed but unreviewed. It is declarative, WASI, or
   sandboxed bespoke UI only.
7. **Developer Source plugin:** locally sourced and pinned. Unsandboxed native
   mode is equivalent to arbitrary code execution.
8. **Bespoke UI document:** hostile web content even when its package is
   Verified; it runs in a unique origin and communicates only through its
   view-session bridge.
9. **Repository and worktree:** untrusted input. Configuration, file names,
   links, build scripts, terminal escape sequences, and rendered content can be
   malicious.
10. **Marketplace, publisher, source host, provider, relay, and network:** all
    are untrusted inputs. Signatures establish identity and integrity, not
    benign behavior.

The client-side Fleet is an aggregation, not a central authorization server.
Each Node is an independent trust domain and pairs each client independently.

## Assumptions and exclusions

- The Node and Electron host OS are supported, patched, and protected by
  full-disk encryption. A known-unencrypted production data volume is refused.
  When the platform cannot report encryption state, the local owner must attest
  it and remote exposure remains blocked until that attestation is recorded.
- Root/administrator compromise, kernel compromise, hardware implants,
  same-user process memory scraping, and deliberate owner exfiltration are out
  of scope. Application encryption still limits offline disk and backup theft.
- The future relay may observe timing, peer identifiers needed to route, and
  ciphertext sizes. It MUST NOT receive content keys or plaintext.
- Provider-side misuse after Acorn intentionally sends data to an authorized
  provider is governed by the provider, not Acorn. Acorn remains responsible
  for destination binding, minimization, and audit.
- Denial of service by unrestricted Developer Source code is an accepted
  consequence of the explicit execution decision.

## Risk scale

Critical means remote or low-interaction compromise of owner authority or
critical secrets. High means meaningful code execution, broad data disclosure,
or persistent integrity loss. Medium means constrained disclosure, integrity,
or availability impact. Low means defense-in-depth failure with limited direct
impact. Critical and High failures block release.

## Threat register

Every threat has normative mitigations elsewhere in this directory and a
required conformance test in
[security-conformance.md](./security-conformance.md).

| Threat | Risk | Attack | Required mitigations | Required tests | Residual risk |
| --- | --- | --- | --- | --- | --- |
| THREAT-ID-001 | Critical | Attacker pairs a client using an intercepted or guessed code. | SEC-ID-001–009 | SEC-TEST-ID-001–004 | Owner can approve the wrong fingerprint; ceremony makes this visible but cannot correct inattentiveness. |
| THREAT-ID-002 | Critical | Lost/stolen paired client exercises full owner authority. | SEC-ID-010–016, SEC-AUD-001 | SEC-TEST-ID-005–007 | An unlocked stolen device remains authorized until revoked. |
| THREAT-ID-003 | High | A malicious Node lies to the client or sends hostile content. | SEC-ID-004, SEC-UI-001–012, SEC-DATA-013 | SEC-TEST-UI-001–006 | The Node legitimately controls its workspace data; a paired client must treat all content as untrusted. |
| THREAT-ID-004 | Critical | MITM impersonates a Node/client or downgrades protocol/crypto. | SEC-TRANS-001–012 | SEC-TEST-TRANS-001–006 | Compromise of a trusted identity private key permits impersonation until revocation/rotation. |
| THREAT-ID-005 | High | Captured commands, events, pairing messages, or relay frames are replayed. | SEC-ID-006, SEC-TRANS-008–015 | SEC-TEST-TRANS-007–010 | Application retries may repeat an idempotent request, but cannot repeat its side effect. |
| THREAT-ID-006 | High | Offline disk theft exposes secrets or sensitive fields. | SEC-KEY-001–015, SEC-DATA-001–007 | SEC-TEST-KEY-001–006 | Ordinary worktree and cache contents rely on OS disk encryption. |
| THREAT-ID-007 | Critical | Plugin, view, log, crash report, or error envelope leaks a credential. | SEC-KEY-016–032, SEC-UI-008, SEC-AUD-006–009 | SEC-TEST-KEY-007–013, SEC-TEST-AUD-003 | A credential sent intentionally to its bound provider is visible to that provider. |
| THREAT-ID-008 | Critical | Confused deputy lets a plugin use broader caller/callee authority. | SEC-AUTH-001–020 | SEC-TEST-AUTH-001–008 | A capability intentionally granted to a plugin remains powerful. |
| THREAT-ID-009 | High | Malicious WASI component escapes its sandbox or obtains ambient I/O. | SEC-PLUG-011–022 | SEC-TEST-PLUG-001–006 | Runtime/kernel vulnerabilities can defeat containment; revocation and patching remain necessary. |
| THREAT-ID-010 | Critical | Native plugin escapes an incomplete sandbox. | SEC-PLUG-023–035 | SEC-TEST-PLUG-007–012 | A platform sandbox or kernel vulnerability remains; unsupported hosts must refuse activation. |
| THREAT-ID-011 | Critical | Compromised System plugin abuses in-process access. | SEC-PLUG-001–010, SEC-SUPPLY-001–016 | SEC-TEST-PLUG-013–014, SEC-TEST-SUPPLY-001–004 | System code is part of Acorn's trusted computing base. |
| THREAT-ID-012 | Critical | Bespoke UI obtains Electron/Node APIs, cookies, network, shared storage, or unsafe navigation. | SEC-UI-001–028 | SEC-TEST-UI-001–013 | Browser-engine vulnerabilities may escape a renderer sandbox. |
| THREAT-ID-013 | Critical | Marketplace, publisher, account, signing key, or update channel supplies a malicious package. | SEC-SUPPLY-001–040 | SEC-TEST-SUPPLY-001–013 | Signatures prove provenance, not safety; Community and Developer Source remain unreviewed. |
| THREAT-ID-014 | High | Crafted artifact or backup escapes extraction root or overwrites files. | SEC-SUPPLY-025–033, SEC-DATA-021–030 | SEC-TEST-SUPPLY-008–010, SEC-TEST-DATA-007–010 | Parser/runtime defects remain possible within bounded staging. |
| THREAT-ID-015 | High | Source build script steals credentials or modifies the host. | SEC-SUPPLY-034–040 | SEC-TEST-SUPPLY-011–013 | Compiler/toolchain compromise can poison output; provenance exposes but cannot prevent all such attacks. |
| THREAT-ID-016 | High | Plugin/provider URL causes SSRF, redirect escape, or credential forwarding. | SEC-KEY-021–028, SEC-AUTH-015 | SEC-TEST-KEY-010–013 | An owner-approved broad destination pattern increases exposure and must be shown as high risk. |
| THREAT-ID-017 | High | Path traversal, symlink race, archive entry, or file URL escapes workspace/grant. | SEC-AUTH-009–010, SEC-SUPPLY-027 | SEC-TEST-AUTH-005–006, SEC-TEST-SUPPLY-008 | Same-user replacement after validation remains possible unless descriptor-relative operations are used. |
| THREAT-ID-018 | High | Malicious repository config triggers commands or widens plugin authority. | SEC-AUTH-021–026 | SEC-TEST-AUTH-009–011 | Once explicitly trusted, repository code can act within the selected execution grant. |
| THREAT-ID-019 | Medium | Plugin/view/client exhausts CPU, memory, disk, handles, broker, or event queues. | SEC-PLUG-017–022, SEC-UI-020–024, SEC-AUD-014 | SEC-TEST-PLUG-005–006, SEC-TEST-UI-010 | Owner-authorized intensive tasks can resemble abuse; policy permits explicit overrides. |
| THREAT-ID-020 | Critical | Tampered, rolled-back, or mismatched backup corrupts state or restores revoked authority. | SEC-DATA-016–038 | SEC-TEST-DATA-001–013 | Restoring old domain content may intentionally reintroduce old data, but never credentials or pairing grants. |
| THREAT-ID-021 | Medium | Future relay reads content, injects frames, replays, or correlates users. | SEC-TRANS-013–025 | SEC-TEST-TRANS-008–012 | Relay necessarily sees routing identifiers, timing, and ciphertext sizes. |
| THREAT-ID-022 | Medium | Audit records expose content/secrets or are silently altered. | SEC-AUD-001–013 | SEC-TEST-AUD-001–006 | Machine owner/root can alter local logs; logs are tamper-evident, not externally immutable. |
| THREAT-ID-023 | High | Incident recovery silently replaces keys, strands encrypted data, or keeps compromised clients active. | SEC-ID-012–016, SEC-KEY-010–015, SEC-AUD-015–026 | SEC-TEST-ID-006–007, SEC-TEST-AUD-007–010 | Recovery deliberately favors data confidentiality over automatic availability. |
| THREAT-ID-024 | Critical | A malicious but valid paired client performs destructive owner operations. | SEC-ID-010–016, SEC-AUD-001–005 | SEC-TEST-ID-005–007 | This is inherent in the single-owner/full-authority model; no fine-grained client roles exist in V2. |
| THREAT-ID-025 | High | Provider/repository content exploits Markdown, terminal, editor, media, or browser rendering. | SEC-UI-002–007, SEC-UI-025–028 | SEC-TEST-UI-002–006, SEC-TEST-UI-012–013 | Engine vulnerabilities and user-opened external links remain. |
| THREAT-ID-026 | High | Dropped/reordered/forged events hide a security state change or produce stale authority. | SEC-TRANS-008–012, SEC-AUTH-019 | SEC-TEST-TRANS-007–010 | Product-event retention is finite; security state is always re-read authoritatively after a gap. |
| THREAT-ID-027 | Medium | Stolen or cross-Node client cache discloses data or applies an action to the wrong Node. | SEC-DATA-008–015 | SEC-TEST-DATA-014–017 | General cached content relies on client full-disk encryption. |
| THREAT-ID-028 | High | Plugin bypasses broker via direct import, private endpoint, shared object, or cross-plugin SQL. | SEC-AUTH-016–020, SEC-PLUG-004–010 | SEC-TEST-AUTH-007–008, SEC-TEST-PLUG-013–014 | System plugins remain in the TCB, but still use typed core contribution points. |
| THREAT-ID-029 | Critical | A malicious Node, preview page, plugin or Agent turns the preview tunnel or ephemeral Client-operation channel into SSRF, wrong-device native control, credential access or a replayable deputy. | SEC-AUTH-027–029, SEC-UI-025–028 | SEC-TEST-AUTH-012–013, SEC-TEST-UI-014 | A paired malicious Node controls its own content; Electron containment and explicit owner delegation remain the trust boundary. |

## Release disposition

- **Must fix before release:** every unimplemented mitigation for a Critical or
  High threat; any failing `SEC-TEST-*` attached to one.
- **Must resolve or explicitly accept:** Medium threat gaps, with owner,
  expiration date, and compensating control in the decision ledger.
- **Accepted product risks:** full authority of every paired client; intentional
  terminal execution; unsandboxed Developer Source execution after explicit
  ceremony; metadata visible to a future relay; dependence of ordinary local
  data on full-disk encryption; and the trusted computing base represented by
  Acorn core and System plugins.

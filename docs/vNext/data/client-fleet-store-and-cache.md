# Client fleet store and cache

Status: **Normative**
Requirement prefix: `DATA-CLIENT`

Electron owns `fleet.sqlite` in its user-data root and private keys in the OS credential store.
This database is never synchronized to a Node and never becomes product authority.

## Tables

| Table | Key | Content |
| --- | --- | --- |
| `client_meta` | singleton | schema version, client device instance ID |
| `nodes` | `node_id` | label, fingerprint, status, selected protocol, last connected/observed |
| `node_endpoints` | `(node_id,endpoint)` | priority, source, last success/failure |
| `device_credentials` | `node_id` | OS key-store reference, certificate chain/serial/expiry |
| `event_cursors` | `(node_id,channel)` | highest contiguous applied sequence, updated time |
| `resource_cache` | `(node_id,resource_uri,revision)` | schema digest, encrypted/safe payload, observed/expiry times |
| `query_cache` | `(node_id,query_id,input_hash,cursor)` | response, snapshot sequence, observed/expiry |
| `layouts` | `(node_id,resource_uri,layout_id)` | client-owned semantic pane/layout state |
| `preferences` | `(scope,key)` | client-device presentation settings |
| `fleet_policies` | `(plugin_coordinate,setting_id)` | desired owner baseline, revision and per-Node apply/acknowledgement state |
| `ui_artifacts` | `(coordinate,version,digest)` | verification/trust/quarantine state and content-store ref |
| `drafts` | `draft_id` | explicitly local unsent content, target revision and classification |

- **DATA-CLIENT-001** Every Node-derived row is partitioned by `node_id`; query keys include exact
  normalized input and negotiated schema version. Cross-Node key collision is impossible.
- **DATA-CLIENT-002** Cached payloads carry `observedAt`, Node status and source sequence. UI MUST
  show stale/offline state and MUST NOT infer successful mutations from cache.
- **DATA-CLIENT-003** Event cursor advances only in the same client transaction that applies all
  preceding events to caches. Gaps, schema failures or authorization changes stop advancement.
- **DATA-CLIENT-004** Snapshot recovery deletes Node-derived caches for the authorized scope,
  installs each complete owner/type group and records its source sequence atomically. The outer
  cursor advances only after all accepted group transactions and snapshot metadata commit.
  Invalid/degraded/omitted groups preserve the previous partition as visibly stale under
  `CON-EVT-006A` through `CON-EVT-006C`; a malformed group can never poison another partition.

## Encryption and cleanup

Private repository payloads, prompts, paths and drafts are sensitive and encrypted using a
client-data key wrapped by OS user protection. Artifact binaries are content addressed and signed,
not secret. Endpoint/fingerprint metadata is internal. Certificate private keys never enter SQLite.

Removing a Node:

1. optionally requests device revocation while connected;
2. deletes device key/certificate references;
3. removes Node endpoints, cursors, resource/query caches and Node layouts;
4. preserves only an opt-in exported local draft; and
5. records a local non-sensitive removal audit.

- **DATA-CLIENT-005** Cache defaults are 24 hours for query/resource data and seven days for offline
  explicitly pinned data, bounded by 2 GiB per Node. LRU eviction never removes unsent drafts.
- **DATA-CLIENT-006** Client migrations are independent of Node migrations and MUST preserve pinned
  fingerprints/device references or fail closed.
- **DATA-CLIENT-007** `fleet_policies` is authoritative only for Client presentation and desired
  fan-out intent. Each targeted Node independently authorizes and persists behavior-affecting
  settings; divergence and failed application remain visible until retried, changed or abandoned.

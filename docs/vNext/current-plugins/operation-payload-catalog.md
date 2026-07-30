# Current-plugin operation payload catalog

**Status:** Normative<br>
**Requirement prefix:** `CUR-PAYLOAD`

This catalog fixes the payload fields that the operation inventory and plugin dossiers describe.
It prevents an implementation from inventing a second request shape while authoring the immutable
JSON Schemas. Envelope fields (`commandId`, target, revision, deadline, session revision and query
cursor metadata) are never duplicated inside plugin input.

The schema notation from
[the core operation registry](../contracts/core-operation-registry.md#schema-notation) applies.
Every input and result is a closed object. `page<T>`, `ack<T>`, `accepted`, `ExternalRef`,
`ArtifactResult={artifact:uri<artifact>,mediaType:string[1..160],length:integer[0..2147483648],
digest:string[71..71]}` and
`StreamResult={stream:uri<stream>,mediaType:string[1..160],replayFrom:decimal|null}` are shared
shapes. Provider-, file-, diff-, transcript- and terminal-content bodies use object/stream transfer,
not an unconstrained JSON field.

## System plugins

### Agents

Query inputs are exact:

| Query suffix | Input beyond envelope target | Success data |
| --- | --- | --- |
| `providers.list` | `{probe?:boolean=false}` | `{items:array<AgentProvider>[0..100],observedAt:timestamp}` |
| `sessions.list` | `{workspace?:uri<workspace>,task?:uri<task>,archived?:boolean,attentionOnly?:boolean,cursor?:string[1..4096],limit?:integer[1..100]=50}` | `page<AgentSessionSummary>` |
| `sessions.search` | `{workspace?:uri<workspace>,task?:uri<task>,query:string[1..500],cursor?:string[1..4096],limit?:integer[1..100]=50}` | `page<AgentSearchHit>` |
| `sessions.snapshot` | `{after?:decimal="0",limit?:integer[1..2000]=500}` | `{session:AgentSessionDetail,turns:array<AgentTurn>[0..2000],requests:array<AgentRequest>[0..500],events:array<AgentEvent>[0..2000],nextAfter:decimal|null,snapshotSequence:decimal}` |
| `sessions.events` | `{after?:decimal="0",limit?:integer[1..2000]=500}` | `{events:array<AgentEvent>[0..2000],nextAfter:decimal|null,snapshotSequence:decimal}` |
| `attachments.get` | `{}` | `{attachment:AgentAttachment,content:StreamResult|null}` |
| `artifacts.list` | `{cursor?:string[1..4096],limit?:integer[1..100]=50}` | `page<AgentArtifact>` |
| `artifacts.get` | `{}` | `{artifact:AgentArtifact,content:StreamResult|null,navigationIntent:NavigationIntent|null}` |
| `usage.get` | `{provider?:string[1..127]}` | `{providers:array<AgentUsage>[0..100],observedAt:timestamp,freshness:"live"|"stale"|"offline"}` |
| `webhooks.list` | `{task?:uri<task>,cursor?:string[1..4096],limit?:integer[1..100]=50}` | `page<AgentWebhookSummary>` |

Command inputs are exact:

| Command suffix | Input |
| --- | --- |
| `session.create` | `{provider:string[1..127],profile:string[1..127],title?:string[1..240],model?:string[1..160],mode?:"managed"|"interactive"="managed"}` |
| `transcript.import` | `{format:"json"|"jsonl"|"markdown",object:uri<object>,title?:string[1..240],provider?:string[1..127]}` |
| `import.verify-resume` | `{provider:string[1..127],profile:string[1..127]}` |
| `attachment.upload` | `{upload:uri<object>,filename:string[1..255],mediaType:string[1..160],length:integer[1..10485760]}` |
| `attachment.delete` | `{}` |
| `turn.enqueue` | `{parts:array<AgentInputPart>[1..32],delivery?:"now"|"after-ready"="now"}` |
| `turn.update-queued` | `{parts:array<AgentInputPart>[1..32]}` |
| `turn.cancel` | `{reason?:string[0..300]}` |
| `request.resolve` | `{resolution:AgentRequestResolution}` validated by the provider-advertised closed resolution schema |
| `session.update` | `{title?:string[1..240],model?:string[1..160],read?:boolean}` with at least one field |
| `session.fork` | `{throughTurn?:uri<agent-turn>,title?:string[1..240]}` |
| `session.compact` | `{throughTurn?:uri<agent-turn>}` |
| `session.handoff-terminal` | `{terminalProfile?:string[1..127]}` |
| `session.resume-managed` | `{provider:string[1..127],profile:string[1..127]}` |
| `session.archive` / `session.delete` | `{}` |
| `session.export` | `{format:"json"|"markdown",includeArtifacts?:boolean=false}` |
| `usage.refresh` | `{provider?:string[1..127]}` |
| `pricing.update` | `{provider:string[1..127],model:string[1..160],inputPerMillion:string[1..30],outputPerMillion:string[1..30],currency:string[3..3]}` |
| `webhook.create` | `{task?:uri<task>,provider:string[1..127],events:array<string[1..100]>[1..32],secretRef:string[1..256]}` |
| `webhook.update` | `{events?:array<string[1..100]>[1..32],enabled?:boolean}` with at least one field |
| `webhook.delete` | `{}` |

Successful local mutations return `ack<agent-resource>`; asynchronous provider/process operations
return `accepted`; export returns `ArtifactResult`; usage refresh returns the same shape as
`usage.get`. `AgentInputPart` is a union of `{kind:"text",text:string[1..1048576]}`,
`{kind:"attachment",attachment:uri<agent-attachment>}` and
`{kind:"context",artifact:uri<artifact>}`.

### GitHub

The exact IDs are in the GitHub query and command catalogs. Query deltas are:
`repositories.list={cursor?,limit?,visibility?:"all"|"public"|"private",query?:string[1..200]}`,
`pulls.list={state?:"open"|"closed"|"all",cursor?,limit?:integer[1..100]=50}`,
`pulls.files={mode?:"summary"|"full"="summary",path?:string[1..4096],cursor?,limit?}`,
`pulls.batch={pulls:array<uri<github-pull>>[1..10],filesMode?:"none"|"summary"|"full"="summary"}`,
`repositories.labels={query?:string[0..100],limit?:integer[1..100]=100}`,
`repositories.branches={query?:string[0..255],limit?:integer[1..100]=100}`,
`repositories.compare={base:string[1..255],head:string[1..255]}`; all other query inputs are `{}`.
Their results are the bounded normalized records named by
[the GitHub catalog](./github/contracts-events-and-security.md#query-catalog), with
`snapshotSequence`, freshness and cursor where stated.

Command deltas are:

- create connection `{authorization:uri<authorization-session>,accountHint?:string[1..100]}`;
  disconnect `{data:"retain"|"purge"}`;
- refresh commands `{force?:boolean=false}`; pull create
  `{title:string[1..300],body?:string[0..65536],base:string[1..255],head:string[1..255],
  draft?:boolean=false}`;
- merge `{method:"merge"|"squash"|"rebase",expectedHead?:string[40..64]}`;
  auto-merge `{enabled:boolean,method?:"merge"|"squash"|"rebase"}`;
  state `{state:"open"|"closed"}`; draft `{draft:boolean}`;
- discussion/review comment `{body:string[1..65536]}` plus inline create
  `{path:string[1..4096],line:integer[1..2147483647],side:"left"|"right",
  expectedHead:string[40..64]}`;
- label/reviewer changes `{value:string[1..100]}`; file viewed
  `{path:string[1..4096],viewed:boolean}`; thread resolved `{resolved:boolean}`;
- review submit `{event:"approve"|"request-changes"|"comment",body?:string[0..65536],
  expectedHead:string[40..64]}`; rerun `{}`; repository pin
  `{pinned:boolean,position?:integer[0..10000]}`.

External mutations return normalized resource plus provider ID and revision only after the mirror
settles, or `accepted`; local viewed/pin operations return `ack`. Patch/blob/log bodies are streams.

### Terminal

Query deltas are `sessions.list={task?:uri<task>,status?:"running"|"exited"|"all",
kind?:string[1..64],cursor?,limit?:integer[1..100]=50}`; all other query inputs are `{}`.
Create input is `{profile:string[3..127],title?:string[1..240],rows?:integer[1..500]=24,
columns?:integer[1..1000]=80,lineage?:uri<agent-session>}`. Interrupt is
`{signal?:"interrupt"|"quit"="interrupt"}`, terminate `{graceMs?:integer[0..30000]=5000}`,
remove `{terminate?:boolean=false}`, resize `{rows:integer[1..500],columns:integer[1..1000],
displayGeneration:decimal}`, send `{text:string[1..65536],mode:"draft"|"now"|"after-ready"}`,
attach-controller `{agentSession:uri<agent-session>}`, release-controller `{}` and setting-update
`{key:string[1..160],value:JSONValue}`. Create/controller operations return `accepted`; send returns
`{delivery:"sent"|"queued",reason:string[1..160]|null}`; resize/interrupt return
`{applied:boolean,generation:decimal}`; destructive mutations return `ack`.

## Bundled Verified plugins

### Editor and Changes

Editor inputs are: entries list `{directory?:uri<file>,cursor?,limit?:integer[1..500]=200}`,
files list `{query?:string[0..500],cursor?,limit?:integer[1..500]=200}`, file read
`{encoding?:"utf-8"|"binary"="utf-8"}`, search
`{query:string[1..1000],mode?:"literal"|"regex"="literal",globs?:array<string[1..300]>[0..64],
cursor?,limit?:integer[1..500]=100}`, write `{content:uri<object>,encoding:"utf-8"|"binary"}`,
file/directory create `{parent:uri<file>,name:string[1..255],content?:uri<object>}`.
Root get input is `{}`. Results are root/file/entry/search records with revision and stream/object
reference; mutations return `ack<file>`.

Changes status is `{}`; diff `{scope?:"staged"|"unstaged"|"all"="all",path?:string[1..4096],
contextLines?:integer[0..1000]=3}`; blob `{path:string[1..4096],ref?:string[1..255]}`; notes list
`{path?:string[1..4096]}`. Stage/unstage/discard use
`{paths:array<string[1..4096]>[1..1000],includeUntracked?:boolean=false}`; commit
`{message:string[1..10000],amend?:boolean=false}`; push `{remote?:string[1..255],
setUpstream?:boolean=false}`; note create
`{path:string[1..4096],side:"old"|"new",line:integer[1..2147483647],body:string[1..65536],
head:string[7..64]}`; edit `{body:string[1..65536]}`; delete `{}`; review send
`{notes:array<{note:uri<change-note>,revision:decimal}>[1..100],agentSession:uri<agent-session>}`.

### Context, Notes and Memory

Context inventory is `{sectionIds?:array<string[1..127]>[0..64]}` and returns the exact bounded
section record in the Context dossier. Snapshot create is
`{sections:array<{id:string[1..127],revision:decimal,included:boolean}>[1..64],
format?:"compact"|"full"="compact"}`; send is
`{snapshot:uri<artifact>,agentSession:uri<agent-session>,delivery?:"after-ready"="after-ready"}`;
selection capture is `{sectionIds:array<string[1..127]>[1..64]}`.

Notes list is `{scope:NoteScope,cursor?,limit?:integer[1..100]=50}`, get `{}`, context section
`{budgetBytes?:integer[1..262144]=20000}`. Create is
`{scope:NoteScope,title:string[1..200],body?:string[0..1048576],kind?:string[1..64],
included?:boolean=true}`; replace `{body:string[0..1048576]}`; append
`{body:string[1..65536]}`; rename `{title:string[1..200]}`; set-included
`{included:boolean}`; delete `{}`; export `{format?:"markdown"="markdown"}`; import
`{object:uri<object>,conflict:"skip"|"replace"|"rename"}`. `NoteScope` is the closed union in the
Notes dossier.

Memory list/search inputs are `{scope?:"repo"|"private",type?:MemoryType,cursor?,limit?:integer[1..50]=10}`
plus search `query:string[1..500]`; get `{}`; proposals list
`{state?:"pending"|"accepted"|"rejected"|"flagged",cursor?,limit?:integer[1..100]=50}`;
context index `{budgetBytes?:integer[1..262144]=20000}`; launch injection
`{profile:string[1..127],budgetBytes?:integer[1..262144]=20000}`. Entry create is
`{scope:"repo"|"private",type:MemoryType,name:string[1..160],body:string[1..1048576]}`;
proposal create adds `source?:uri<resource>`; resolve
`{decision:"accept"|"reject"|"flag",name?:string[1..160]}`; reconcile `{}`; review request
`{sources:array<uri<resource>>[1..100],profile?:string[1..127]}`.

### Database, Docker and HTTP

Database metadata/list inputs are `{lease?:uri<database-lease>,schema?:string[1..255],
table?:string[1..255],cursor?,limit?:integer[1..500]=100}` as applicable. Open is
`{configurationRevision:decimal}`, close `{}`, SQL execute
`{sql:string[1..1048576],parameters:array<DbCell>[0..10000]}`, row insert
`{values:object}`, update `{primaryKey:object,expectedVersion?:string[1..200],values:object}`,
delete `{primaryKey:object,expectedVersion?:string[1..200]}`, saved upsert
`{name:string[1..160],sql:string[1..1048576],parameters:array<DbParameter>[0..100]}`, saved delete
`{}`, generate `{prompt:string[1..10000],schemaDigest:string[71..71],
savedQueries:array<{query:uri<saved-query>,revision:decimal}>[0..50]}`.

Docker list queries use `{cursor?,limit?:integer[1..500]=100}`; inspect/task queries use `{}`.
Container action `{action:"start"|"stop"|"restart"|"kill"|"pause"|"unpause"}`, remove
`{force?:boolean=false,removeVolumes?:boolean=false}`, image/volume/network remove
`{force?:boolean=false}`, prune `{scope:"containers"|"images"|"volumes"|"networks"|"builder"}`,
compose action `{action:"start"|"stop"|"restart"|"down",composeSnapshotDigest:string[71..71]}`,
teardown `{composeSnapshotDigest:string[71..71],stopLooseContainers?:boolean=true}`, logs
`{tail?:integer[0..300]=300,follow?:boolean=true}`, stats `{}`, exec
`{command:array<string[1..4096]>[1..128],interactive?:boolean=true}`. Stream-opening commands
return `StreamResult`; teardown returns `accepted`; other actions return resource state/`ack`.

HTTP list/get queries use `{cursor?,limit?:integer[1..100]=50}` as applicable; send result uses
`{operation:uri<operation>}`. Request create/replace accepts the closed request document:
`{name:string[1..160],method:HttpMethod,url:string[1..4000],headers:array<HttpHeader>[0..100],
body:HttpBody,auth:HttpAuth}`; delete `{}`. Variable create/replace is
`{name:string[1..100],kind:"plain"|"secret"|"command",value?:string[0..1048576],
secretRef?:string[1..256],enabled?:boolean=true}` with exactly one value source; delete `{}`.
Send is `{request?:uri<http-request>,draft?:HttpRequest,overrides?:array<HttpVariable>[0..100]}`;
cancel `{}`; curl import `{text:string[1..1048576],scope:"workspace"|"task"}`.

### Preview, Workflows and Onboarding

Preview configuration update is `{scope:uri<node>|uri<workspace>,settings:PreviewConfiguration}`;
rule upsert `{rule:PreviewRule}`, delete `{}`; resolve
`{task:uri<task>,candidate?:string[1..2048]}`; bind
`{client:uri<client-device>,viewSession:uri<view-session>,target:PreviewTarget}`;
unbind `{}`. Browser operations use the selected-client typed bridge schemas and never raw script.

Workflow list inputs are `{cursor?,limit?:integer[1..100]=50}` plus task/repository filters named
in the dossier; get inputs are `{}`. Rescan `{}`, run start
`{definition:uri<workflow-definition>,definitionRevision:decimal,posture?:"manual"|"gated"|
"autonomous"}`, gate resolve `{decision:"approve"|"reject"}`, cancel/kill `{reason?:string[0..300]}`,
trigger enable/disable `{}`, evaluate `{cursor?:string[1..4096]}`. Starts/rescans/evaluations return
`accepted`; gate/policy mutations return `ack`; run/step pages use their canonical records.

Onboarding status `{}`, import preview `{v1DataRootRef:string[1..128]}`, workspace configure
`{workspaceName:string[1..100],repositories:array<OnboardingRepository>[0..100]}`, import apply
`{previewDigest:string[71..71],selectedRepositories:array<string[1..128]>[0..100]}`,
default-profile ensure `{coordinates?:array<string[3..127]>[0..20]}`, complete
`{invariants:array<{id:string[1..100],revision:decimal}>[1..100]}`, reset-presentation `{}`.

## Marketplace integrations and profiles

Linear/Rollbar list queries use `{connection:uri<plugin-resource>,cursor?,limit?:integer[1..100]=50}`
and get/resolve use `{externalId?:string[1..300],counter?:integer[1..2147483647]}` with exactly one
identifier. Linear comment create is `{body:string[1..65536],parentId?:string[1..300]}`, task link
`{task:uri<task>,reference:ExternalRef}`, promote
`{workspace:uri<workspace>,titleOverride?:string[1..300]}`. Rollbar link/promote use the same task
shapes. Connection validate is `{secretRef:string[1..256]}` and returns safe account/project
identity only.

Model connection list `{}`, catalog `{provider?:string[1..127],fresh?:boolean=false}`, generate
`{provider:string[1..127],model:string[1..160],messages:array<ModelMessage>[1..100],
maxOutputTokens:integer[1..100000],temperature?:number[0..2],responseSchema?:uri<object>}`,
validate/test `{connection:uri<plugin-resource>}`. Generate returns `accepted` plus a bounded result
stream; credentials are not payload fields.

Each Aider/Claude/Codex profile uses availability/compatibility queries with `{}`; interactive
launch `{profileVersion:string[1..64],title?:string[1..240]}`; headless run
`{input:uri<object>,outputSchema?:uri<object>,limits:ExecutionLimits}`; resume
`{session:uri<agent-session>,input?:uri<object>}`; MCP registration
`{operation:uri<operation>,tools:array<string[1..160]>[0..128]}`. The profile package returns a
delegated Terminal/Agents/Workflows operation or stream and never owns raw process authority.

## Compilation and conformance

- **CUR-PAYLOAD-001:** Each release build expands the operation inventory and this field catalog
  into one immutable descriptor plus closed input/result schema pair per operation. The release
  manifest pins their canonical SHA-256 digests.
- **CUR-PAYLOAD-002:** A named record (`AgentSessionSummary`, `PreviewRule`, `HttpRequest`, and so
  on) is the exact record defined by the owning dossier. It cannot become an unbounded metadata map;
  adding a field requires a schema version and compatibility decision.
- **CUR-PAYLOAD-003:** If a dossier and this catalog disagree, the narrower bound applies and the
  build fails until both documents are made identical. Implementations do not choose one silently.
- **CUR-PAYLOAD-004:** Schema compilation must prove unknown-field rejection, default insertion,
  sensitivity classification, node/ancestry validation and one positive plus boundary/negative
  vector for every field.
- **CUR-PAYLOAD-005:** The default-profile lock is publishable only if every operation named here
  appears in exactly one owning release manifest and no manifest operation lacks a catalog row.

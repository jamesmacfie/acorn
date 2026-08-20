import type { PluginBridgeRequest } from '@acorn/protocol/pluginBridge.ts'
import type { FrameServices } from './broker'
import type { AcornBridge } from './sdk'

// The frame bridge's vocabulary, declared once so the five places that spell it cannot drift apart
// (docs/plugins.md § Loaded plugins: the client half, the paragraph on the bridge's `api` surface).
//
// A sandboxed frame's whole ability to affect the world is a small set of verbs, and until now each
// one had to be written into five modules by hand: the wire union (@acorn/protocol/pluginBridge.ts),
// the author-facing type and its implementation (sdk.ts), the host-side contract (`FrameServices`)
// and the host-side implementation (PluginFrame.tsx). TypeScript stitches some of those pairs together
// (the sdk's `api` literal is typed `AcornBridge`, so it cannot be short), but never the chain end to
// end, because the MessagePort in the middle is untyped traffic.
//
// That gap has already cost something real: `sdk.ts` records that the protocol and the broker both
// carried `PUT` from the start and only the SDK facade did not, so plugin authors simply could not
// make PUT requests, for no reason anyone had decided, until someone noticed.
//
// This module is types only, plus one list. It changes no runtime behaviour and moves no validation:
// the broker's switch stays exactly as readable and auditable as it was, which is the right trade at a
// security membrane. A table that made the denial paths implicit would be worse than the duplication
// it removed. What it buys is that a verb present on the wire and absent from either surface is a
// compile error rather than a bug report from a third-party author.

// ── The wire vocabulary, derived rather than restated ──────────────────────────────────────────────
//
// One name per thing a frame can send. `api` is keyed by method because that is the granularity the
// author surface has (and the granularity the PUT scar happened at); everything else is `kind:op`,
// or bare `kind` where there is no op.
type VerbName<R> = R extends { kind: 'api'; method: infer M extends string }
  ? `api:${M}`
  : R extends { kind: infer K extends string; op: infer O extends string }
    ? `${K}:${O}`
    : R extends { kind: infer K extends string }
      ? K
      : never

export type FrameVerb = VerbName<PluginBridgeRequest>

// Sent by the SDK on the author's behalf, never called by them: `cancel` rides an AbortSignal,
// `keydown` is forwarded from a key handler the SDK installs, and `connected` is the handshake ack the
// SDK posts the moment `connect()` resolves. They are wire verbs with no author surface, on purpose.
type SdkInternalVerb = 'cancel' | 'keydown' | 'connected'
export type AuthoredVerb = Exclude<FrameVerb, SdkInternalVerb>

// ── The two projections ───────────────────────────────────────────────────────────────────────────
//
// Each member below is a real member access. If a verb lands on the wire and the surface never grew a
// Each member below is a real member access. If a verb lands on the wire and the surface never grew a
// method for it, the reference on the right-hand side fails to compile, which is the PUT bug, made
// unwriteable. Adding a wire variant without adding a row here fails too, via the coverage checks at
// the bottom.

/** What a plugin author calls for each verb (frames/sdk.ts). */
type AuthorSurface = {
  'api:GET': AcornBridge['api']['get']
  'api:POST': AcornBridge['api']['post']
  'api:PUT': AcornBridge['api']['put']
  'api:PATCH': AcornBridge['api']['patch']
  'api:DELETE': AcornBridge['api']['del']
  subscribe: AcornBridge['events']['on']
  'state.get': AcornBridge['state']['get']
  'state.set': AcornBridge['state']['set']
  'ui:toast': AcornBridge['ui']['toast']
  'ui:copy': AcornBridge['ui']['copy']
  'ui:openPane': AcornBridge['ui']['openPane']
  'ui:openUrl': AcornBridge['ui']['openUrl']
  // The wire spelling stays `importer.*` so every shipped frame SDK keeps working; what an author
  // calls is `done()` / `close()`.
  'ui:importer.done': AcornBridge['ui']['done']
  'ui:importer.close': AcornBridge['ui']['close']
  'document:read': AcornBridge['document']['read']
  'document:write': AcornBridge['document']['write']
  'document:flush': AcornBridge['document']['flush']
  'webview:navigate': AcornBridge['webview']['navigate']
  'webview:back': AcornBridge['webview']['back']
  'webview:forward': AcornBridge['webview']['forward']
  'webview:reload': AcornBridge['webview']['reload']
}

/** What the host does for each verb (frames/broker.ts, implemented in frames/PluginFrame.tsx). */
type HostSurface = {
  'api:GET': FrameServices['fetch']
  'api:POST': FrameServices['fetch']
  'api:PUT': FrameServices['fetch']
  'api:PATCH': FrameServices['fetch']
  'api:DELETE': FrameServices['fetch']
  subscribe: FrameServices['subscribe']
  'state.get': FrameServices['stateGet']
  'state.set': FrameServices['stateSet']
  'ui:toast': FrameServices['toast']
  'ui:copy': FrameServices['copy']
  'ui:openPane': FrameServices['openPane']
  'ui:openUrl': FrameServices['openUrl']
  'ui:importer.done': FrameServices['importerDone']
  'ui:importer.close': FrameServices['importerClose']
  // Optional on the services bag, and the absence IS the permission check: a frame either shares its
  // rectangle with a host-drawn document or it does not.
  'document:read': NonNullable<FrameServices['document']>['read']
  'document:write': NonNullable<FrameServices['document']>['write']
  'document:flush': NonNullable<FrameServices['document']>['flush']
  'webview:navigate': NonNullable<FrameServices['webviewNavigate']>
  'webview:back': NonNullable<FrameServices['webviewCommand']>
  'webview:forward': NonNullable<FrameServices['webviewCommand']>
  'webview:reload': NonNullable<FrameServices['webviewCommand']>
  keydown: FrameServices['keydown']
}

// Two wire verbs ask nothing of the host's services bag. `cancel` makes the broker drop its own record of
// an in-flight request rather than asking the host to undo anything; `connected` is consumed by the broker
// as evidence the frame evaluated, which it reports through `onConnected` rather than through a service.
type HostHandledVerb = Exclude<FrameVerb, 'cancel' | 'connected'>

// ── The coverage checks ───────────────────────────────────────────────────────────────────────────

type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
type Covers<Surface, Verbs> = Exact<keyof Surface, Verbs>

// Each of these is `true` or the build fails, and the variable name is the error message. Nothing
// imports this module and nothing needs to: `tsc --noEmit` checks every file in the package, so these
// two lines are the lock. Adding a verb to the wire without adding it to a surface breaks here; adding
// it to a surface the wire does not carry breaks here too.
const AUTHOR_SURFACE_COVERS_THE_WIRE: Covers<AuthorSurface, AuthoredVerb> = true
const HOST_SURFACE_COVERS_THE_WIRE: Covers<HostSurface, HostHandledVerb> = true
void AUTHOR_SURFACE_COVERS_THE_WIRE
void HOST_SURFACE_COVERS_THE_WIRE

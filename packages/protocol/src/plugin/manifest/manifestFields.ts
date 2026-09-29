import { z } from 'zod'
import { normalizeWebviewHost, WEBVIEW_HOST_MAX_LENGTH } from '../../content/webview.ts'

// This id becomes the plugin's route namespace and `<dataRoot>/plugins/<id>.sqlite`. An architecture
// rule keeps the prefix itself out of this package; node-core/server/plugins/manifest.ts confines it.
export const ID_RE = /^[a-z][a-z0-9-]{1,31}$/

// Node-half permissions shape the host RPC context and the isolated worker's runtime grants. They are
// shown under Enforced in the trust UI; scheduled/check behavior remains separately declared.
// See docs/security.md.
const nodeEnvironmentName = z.string().min(1).max(128).regex(/^[A-Z_][A-Z0-9_]*$/, 'environment names must be uppercase identifiers')
const nodeFilePermission = z.object({
  // The host resolves the path from its own environment at worker launch. A package cannot bake one
  // machine's absolute path into a distributable manifest.
  env: nodeEnvironmentName,
  access: z.enum(['read', 'read-write']).default('read'),
})
export const nodePermissions = z.object({
  // pluginPermissions.ts validates these tokens. An unknown one means a facet this build doesn't
  // have, so it's skipped rather than treated as a bad manifest.
  core: z.array(z.string().min(1)).max(64).default([]),
  capabilities: z.array(z.string().min(1)).max(64).default([]),
  // Use-scoped credential access through ctx.core.secrets.
  secrets: z.boolean().default(false),
  // The process broker (ctx.core.proc).
  exec: z.boolean().default(false),
  // Egress hosts enforced by the worker bootstrap's fetch wrapper and raw-socket deny list.
  net: z.array(z.string().min(1)).max(64).default([]),
  // Unrestricted socket access for protocols that cannot use the hostname-scoped fetch broker.
  // This is intentionally separate from `net`: it is a broad, high-risk grant.
  sockets: z.boolean().default(false),
  // Explicit parent-environment values the worker may inherit. The default worker environment is the
  // process broker's credential-free base allowlist.
  env: z.array(nodeEnvironmentName).max(32).optional(),
  // Explicit local files configured by environment variable. Paths inside acorn's data root are
  // refused, and a read-write grant also covers one fixed atomic-write sidecar.
  files: z.array(nodeFilePermission).max(16).optional(),
})


// The plugin's logo, as one SVG path's `d` attribute rather than an SVG document, so the regex below is
// the whole check. See docs/ui-design.md § Icons.
const PATH_D_RE = /^[MmLlHhVvCcSsQqTtAaZz0-9eE,.\s+-]+$/

export const brandMark = z.object({
  // Authored in a 24x24 box, like simple-icons. The renderer hardcodes that viewBox.
  d: z.string().min(1).max(4_096).regex(PATH_D_RE, 'icon must be a single SVG path `d` string'),
  // The brand's own colour, which the mark's surfaces read as `--brand`. Six-digit hex rather than any
  // CSS colour on purpose: this string reaches a `style` attribute, and a colour slot accepts `url()`,
  // which would let a manifest make an outbound request. See docs/ui-design.md section Icons.
  color: z.string().regex(/^#[0-9a-f]{6}$/i, 'icon colour must be a six-digit hex, such as #24292f').optional(),
})

// Relative only. Rejecting `/` and `..` here keeps hostile paths away from the loader's confinement
// check.
export const entry = z.string().min(1).max(256).refine(
  (value) => !value.startsWith('/') && !value.split(/[\\/]/).includes('..'),
  'entrypoint must be a relative path inside the plugin directory',
)

// A webview host is a device grant. The surface schema uses this parser before the host records consent.
export const webviewHost = z.string().min(1).max(WEBVIEW_HOST_MAX_LENGTH).superRefine((value, ctx) => {
  try {
    normalizeWebviewHost(value)
  } catch (error) {
    ctx.addIssue({ code: 'custom', message: error instanceof Error ? error.message : String(error) })
  }
})

// A path the host will GET or POST for this plugin. The node's manifest refinement confines it to
// the plugin's route namespace, where the plugin id is available.
export const pluginRoute = z.string().min(1).max(256)

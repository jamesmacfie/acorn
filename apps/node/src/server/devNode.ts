// The plain-Node `dev:node` entry (pnpm --filter @acorn/desktop dev:node). It is a composition
// root: it registers the built-in integration providers and wires the pure-Node domain bridges,
// then starts the loopback listener over a repo-local .acorn data root. Under Electron this path is
// never taken — app/main/bootstrap.ts owns boot and installs the stateful bridges too.
import './providers' // register built-in integration providers into the core registry
import './routes' // register plugin-owned HTTP routers into the core route registry
import { devDataDir, makeRuntime, startListener } from '@acorn/node-core/main/server.ts'
import { openDataRoot } from '@acorn/node-core/main/dataRoot.ts'
import { wireServerBridges } from '../wiring/serverBridges'
import { prepareSecurityState } from '../wiring/startupSecurity'

// Takes the data root's exclusive lock, so `dev:node` and a running desktop app now refuse to share
// one root explicitly instead of racing over SQLite and colliding on the listener port.
const root = openDataRoot(devDataDir())
const dataDir = root.dir
const runtime = makeRuntime(root)
await prepareSecurityState(runtime)
await runtime.IDEMPOTENCY.cleanupExpired() // reclaim yesterday's replay rows; see service/runtime.ts
wireServerBridges(runtime.DB, dataDir) // search / editor / local-git / database / agent-usage HTTP route bridges
void startListener(runtime)

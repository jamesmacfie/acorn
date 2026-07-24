// The plain-Node `dev:node` entry (pnpm --filter @acorn/desktop dev:node). It is a composition
// root: it registers the built-in integration providers and wires the pure-Node domain bridges,
// then starts the loopback listener over a repo-local .acorn data root. Under Electron this path is
// never taken — app/main/bootstrap.ts owns boot and installs the stateful bridges too.
import './providers' // register built-in integration providers into the core registry
import './routes' // register plugin-owned HTTP routers into the core route registry
import { devDataDir, makeRuntime, startListener } from '../../core/main/server'
import { wireServerBridges } from '../main/serverBridges'

const runtime = makeRuntime(devDataDir)
wireServerBridges(runtime.DB, devDataDir) // search / editor / local-git / database / agent-usage HTTP route bridges
void startListener(runtime)

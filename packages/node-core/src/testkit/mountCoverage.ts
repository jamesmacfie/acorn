// Shared by the two mount coverage tests: core's (server/mountCoverage.test.ts) and the compiled
// plugins' (apps/node/test/integration/pluginMountCoverage.test.ts).

// Does a `.use()` mount path cover a route path? Deliberately stricter than the router: `*` here
// matches one or more further segments and never the bare path, whereas the Hono this repo pins does
// match the bare path too. The strict reading is what makes these tests demand both mount forms, so a
// gate stays correct if that behaviour moves again in a Hono upgrade. A `:param` on either side
// matches one segment, so a gate at `/tasks/:id/*` covers `/tasks/:id/run/:target/start`.
export function mountCovers(mount: string, route: string): boolean {
  const m = mount.split('/')
  const r = route.split('/')
  for (let i = 0; i < m.length; i++) {
    if (m[i] === '*') return r.length > m.length - 1
    if (i >= r.length) return false
    if (m[i] !== r[i] && !m[i].startsWith(':')) return false
  }
  return m.length === r.length
}

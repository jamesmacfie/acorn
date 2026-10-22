import { createResource, createSignal, Show } from 'solid-js'
import { render } from 'solid-js/web'
import { Route, Router } from '@solidjs/router'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { RemoteTree } from '@acorn/client-core/host/tree/RemoteTree.tsx'
import { setBundleSource } from '@acorn/client-core/host/tree'
import '@acorn/client-core/infra/styles/styles.css'

// `/app/dev/sandbox` in `pnpm dev:mobile`: draws the probe bundle through the sandbox relay with no
// account, no Node, and no custody, so the origin can be checked on its own. `main.tsx` loads this only
// in a development build, so a production build has no page that runs bytes nobody trusted.
//
//   ?probe=<origin>    where the bundle's escape attempts go. A server there should see no request.
//   ?bytes=tampered    posts one byte more than the bundle's hash names, which the relay must refuse.

const query = new URLSearchParams(location.search)

async function fixtureHash(): Promise<string> {
  const bytes = await (await fetch(`${import.meta.env.BASE_URL}dev/sandbox-fixture.js`)).arrayBuffer()
  const posted = query.get('bytes') === 'tampered' ? new Uint8Array([...new Uint8Array(bytes), 10]).buffer : bytes
  setBundleSource(async () => posted)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function SandboxFixture() {
  const [hash] = createResource(fixtureHash)
  const [failure, setFailure] = createSignal<string>()
  return (
    <Show when={hash()}>
      {(hash) => (
        <>
          <RemoteTree
            contribution={{ id: 'sandbox-fixture', pluginId: 'sandbox-fixture', hash: hash(), entry: 'probe' }}
            props={() => ({ probe: query.get('probe') ?? '' })}
            onFailed={setFailure}
          />
          <Show when={failure()}>{(reason) => <p class="sandbox-fixture-failed">The probe failed: {reason()}</p>}</Show>
        </>
      )}
    </Show>
  )
}

render(
  () => (
    <QueryClientProvider client={new QueryClient()}>
      <Router base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
        <Route path="*" component={SandboxFixture} />
      </Router>
    </QueryClientProvider>
  ),
  document.getElementById('root')!,
)

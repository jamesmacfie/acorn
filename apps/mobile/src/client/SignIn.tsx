import { Button } from '@acorn/client-core/kit/components/primitives.tsx'
import { Text } from '@acorn/client-core/kit/components/content'
import { signInUrl } from './account'

/** The one screen a phone with no account session sees. The account's own page signs the person in and
 *  brings the browser back here, with a cookie this page can't read. */
export function SignIn() {
  return (
    <main class="mobile-body mobile-sign-in">
      <Text emphasis="heading">Sign in to your account</Text>
      <Text emphasis="muted" wrap>
        Your account lists the Nodes you can reach from this phone. Sign in with the account you turned Remote access on
        with.
      </Text>
      <Button variant="solid" tone="accent" onPress={() => location.assign(signInUrl(location.pathname))}>
        Sign in
      </Button>
    </main>
  )
}

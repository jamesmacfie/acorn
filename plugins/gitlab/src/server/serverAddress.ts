import { ProviderOperationError } from '@acorn/plugin-api/node'
import { codeHostName } from '@acorn/protocol/plugin/contract.ts'
import { GITLAB_ORIGIN } from './config'

// The address a person types to connect a company server. Kept out of ./servers.ts, which runs at boot,
// so this loads with the first sign-in.

// A literal address on this machine or a private network. A name isn't resolved, so a company name that
// points at a private address passes: the check is for an address typed by mistake or on someone's
// say-so, which is where a token sent to the wrong place would hurt.
const PRIVATE_IPV4 = [/^127\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^169\.254\./, /^0\./]
const isPrivateHost = (host: string): boolean =>
  host === 'localhost' || host.endsWith('.localhost') || PRIVATE_IPV4.some((range) => range.test(host))

const refuse = (reason: string): never => {
  throw new ProviderOperationError('provider_bad_config', 400, reason)
}

/**
 * The origin the token form's address names, such as `https://gitlab.example.com`, or gitlab.com's for
 * an empty one. It must be `https` with no path, port, or sign-in, because the browser button and core's
 * host claims match a page by its host alone. A loopback or private address needs `allowPrivate`, the
 * form's confirmation.
 */
export function gitlabOrigin(address: string | undefined, allowPrivate: boolean): string {
  const typed = address?.trim()
  if (!typed) return GITLAB_ORIGIN
  let url: URL
  try {
    url = new URL(typed)
  } catch {
    return refuse(`${typed} isn't a web address. Use the one you open GitLab at, such as https://gitlab.example.com.`)
  }
  if (url.protocol !== 'https:') return refuse('Use an https address for your GitLab server.')
  if (url.username || url.password) return refuse('Leave the sign-in out of the address. Use the token field.')
  if (url.port) return refuse('Acorn connects to GitLab on the standard https port only.')
  if (url.pathname !== '/' || url.search || url.hash)
    return refuse('Use the address of the server alone, such as https://gitlab.example.com, with no path.')
  if (!codeHostName.safeParse(url.hostname).success)
    return refuse(`Acorn can't match projects on ${url.hostname}. Use the server's name.`)
  if (isPrivateHost(url.hostname) && !allowPrivate)
    return refuse(`${url.hostname} is a private address. Tick "Connect to a private address" if you meant it.`)
  return url.origin
}

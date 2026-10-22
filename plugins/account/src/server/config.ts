// The account service this Node signs in to, from `ACORN_ACCOUNT_URL`. There is no default, because
// the service has no address until one is deployed: a build without one offers no sign-in, as a build
// without a GitHub client ID offers no GitHub connection. Plain `http` is for a service on this
// machine, such as the stand-in the dev flows run, because a token must not cross a network in the
// clear.
export function accountUrl(): string {
  const text = process.env.ACORN_ACCOUNT_URL?.trim() ?? ''
  if (!text) return ''
  if (!URL.canParse(text)) throw new Error(`ACORN_ACCOUNT_URL ${text} isn't an address.`)
  const url = new URL(text)
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local))
    throw new Error('ACORN_ACCOUNT_URL must start with https://, or http:// for a service on this machine.')
  return url.origin
}

/** SHA-256 through Web Crypto, for a host with no `node:crypto`. A browser's bytes get the same hash a
 *  Node's `createHash` gives them. */
export async function webCryptoSha256(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>))
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

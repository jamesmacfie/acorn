// Snapshot of the production decoder at unit 20 admission.
export function decodeBody(bodyBase64: string): { text: string; bytes: Uint8Array } {
  const bytes = Uint8Array.from(atob(bodyBase64), (ch) => ch.charCodeAt(0))
  return { text: new TextDecoder().decode(bytes), bytes }
}

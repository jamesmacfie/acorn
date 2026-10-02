import { afterEach, expect, it, vi } from "vitest"
import { decodeBody } from "./httpClient"
const native = (Uint8Array as typeof Uint8Array & { fromBase64?: (text: string) => Uint8Array }).fromBase64
const setNative = (value: ((text: string) => Uint8Array) | undefined) => Object.defineProperty(Uint8Array, "fromBase64", { configurable: true, writable: true, value })
afterEach(() => { setNative(native); vi.restoreAllMocks() })

it.each(["native", "fallback"])("preserves atob acceptance, errors, bytes, and UTF-8 in the %s decoder", (mode) => {
  // Node 24 lacks the native API. Node 26 runs this case against the real native implementation.
  const decoder = native ?? vi.fn((text: string) => new Uint8Array(Buffer.from(text, "base64")))
  setNative(mode === "native" ? decoder : undefined)
  const allBytes = Buffer.from(Array.from({ length: 256 }, (_, index) => index)).toString("base64")
  const cases = ["", " \t\n\f\r", "Zg", "Zh", "Zh==", "Zm8", "Zm9=", "Z m\tf\nv\r", "77u/YQ==", "/wCAwA==", allBytes,
    "A", "=", "Zg=", "Zg===", "AA=A", "Zg==A", "____", "----", "Zg\u000b==", "Zg\u00a0=="]
  for (let length = 0; length < 8; length++) for (const char of ["A", "/", "=", " ", "-"]) cases.push(char.repeat(length))
  for (const encoded of cases) {
    let binary: string
    try { binary = atob(encoded) } catch (error) {
      expect(() => decodeBody(encoded)).toThrow(expect.objectContaining({ name: (error as Error).name }))
      continue
    }
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    expect(decodeBody(encoded)).toEqual({ bytes, text: new TextDecoder().decode(bytes) })
  }
})

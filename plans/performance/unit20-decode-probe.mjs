import { writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { performance } from "node:perf_hooks"
const { decodeBody } = await import(process.argv[2].startsWith("before") ? "./unit20-decoder-before.ts" : "../../plugins/http/src/tree/httpClient.ts")
const records = []
for (const mode of ["native", "fallback"]) {
  const native = Uint8Array.fromBase64
  if (mode === "native" && !native) continue
  if (mode === "fallback") Uint8Array.fromBase64 = undefined
  for (const size of [1 << 20, 5 << 20]) {
    const source = Buffer.alloc(size)
    for (let i = 0; i < size; i++) source[i] = i % 256
    const encoded = source.toString("base64")
    global.gc?.()
    const memory = process.memoryUsage(), cpu = process.cpuUsage(), start = performance.now()
    const decoded = decodeBody(encoded)
    const elapsedMs = performance.now() - start, used = process.cpuUsage(cpu), after = process.memoryUsage()
    const exactBytes = Buffer.from(decoded.bytes).equals(source)
    const exactText = decoded.text === new TextDecoder().decode(source)
    if (!exactBytes || !exactText) throw new Error("Decoder changed content")
    records.push({ mode, size, elapsedMs, cpuMs: (used.user + used.system) / 1000, heapDeltaBytes: after.heapUsed - memory.heapUsed, arrayBufferDeltaBytes: after.arrayBuffers - memory.arrayBuffers, exactBytes, exactText })
  }
  Uint8Array.fromBase64 = native
}
writeFileSync(new URL(`./unit20-decode-${process.argv[2]}.json`, import.meta.url), JSON.stringify({ runtime: process.version, sourceHash: createHash("sha256").update(decodeBody.toString()).digest("hex"), note: "Node/V8 native atob; sampled transient heap and array buffers, not retained memory or WebKit latency", records }, null, 2) + "\n")

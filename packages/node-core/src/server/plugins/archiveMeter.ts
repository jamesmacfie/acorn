import { Transform } from 'node:stream'

/** Absolute byte budget before tar parsing; hold a split prefix until compression is checked. */
export function archiveExpandedMeter(maxBytes: number): Transform {
  let expanded = 0
  let prefix = Buffer.alloc(0)
  let checkedCompression = false
  return new Transform({ transform(chunk: Buffer, _encoding, done) {
    expanded += chunk.length
    if (expanded > maxBytes) return done(new Error('That plugin archive exceeds the expanded byte limit.'))
    if (!checkedCompression) {
      prefix = Buffer.concat([prefix, chunk])
      if (prefix.length < 2) return done()
      checkedCompression = true
      // Parser also sniffs gzip. After our metered decompressor, admit tar only, so nested gzip
      // cannot activate a second decompressor that would bypass this absolute byte budget.
      if (prefix[0] === 0x1f && prefix[1] === 0x8b) return done(new Error('Nested compression is unsupported in plugin archives.'))
      done(null, prefix)
      prefix = Buffer.alloc(0)
      return
    }
    done(null, chunk)
  }, flush(done) { done(null, prefix) } })
}

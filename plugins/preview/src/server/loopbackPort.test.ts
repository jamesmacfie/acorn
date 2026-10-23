import { describe, expect, it } from 'vitest'
import { loopbackPort } from './loopbackPort'

describe('loopbackPort', () => {
  it('reads the port of an http address on a loopback name', () => {
    expect(loopbackPort('http://localhost:5173/app')).toBe(5173)
    expect(loopbackPort('http://127.0.0.1:3000')).toBe(3000)
    expect(loopbackPort('http://[::1]:8080/')).toBe(8080)
    expect(loopbackPort('http://localhost')).toBe(80)
  })

  it('has none for anything else', () => {
    expect(loopbackPort('https://localhost:5173')).toBeNull()
    expect(loopbackPort('http://192.168.1.5:5173')).toBeNull()
    expect(loopbackPort('http://localhost.evil.example:5173')).toBeNull()
    expect(loopbackPort('http://user@evil.example:5173')).toBeNull()
    expect(loopbackPort('not an address')).toBeNull()
    expect(loopbackPort(null)).toBeNull()
  })
})

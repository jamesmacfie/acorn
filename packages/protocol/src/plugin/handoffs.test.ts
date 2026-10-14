import { describe, expect, it } from 'vitest'
import { taskAddressList } from './handoffs.ts'

const address = (origin: string) => ({
  addresses: [{ taskId: 't1', origin, label: 'Runn stack', state: 'running', severity: 'info' }],
})
const accepts = (origin: string) => taskAddressList.safeParse(address(origin)).success

describe('task addresses', () => {
  it('takes an exact origin on a loopback host, port included', () => {
    expect(accepts('https://runn-05ea41.runn.localhost:5104')).toBe(true)
    expect(accepts('http://localhost:5173')).toBe(true)
    expect(accepts('http://127.0.0.1:3000')).toBe(true)
    expect(accepts('http://[::1]:8080')).toBe(true)
  })

  it("refuses another site's host, so a plugin can't tie its pages to a task", () => {
    expect(accepts('https://github.com')).toBe(false)
    expect(accepts('https://localhost.example.com')).toBe(false)
    expect(accepts('http://127.0.0.1.example.com')).toBe(false)
  })

  it('refuses a path, a spelling a browser would not report, and other schemes', () => {
    expect(accepts('https://app.localhost:5104/admin')).toBe(false)
    expect(accepts('https://app.localhost:5104/')).toBe(false)
    expect(accepts('https://app.localhost:443')).toBe(false)
    expect(accepts('ftp://localhost:21')).toBe(false)
  })
})

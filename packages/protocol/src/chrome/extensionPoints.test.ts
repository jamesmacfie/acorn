import { describe, expect, it } from 'vitest'
import { linkPreviewKey, MAX_LINK_PREVIEW_URL } from './extensionPoints'

describe('linkPreviewKey', () => {
  it('keeps the path, query and fragment as written and lowercases only the host', () => {
    expect(linkPreviewKey('https://Docs.Example.com/Guide/Intro?utm_source=x#Part-2'))
      .toBe('https://docs.example.com/Guide/Intro?utm_source=x#Part-2')
  })

  it('refuses anything but HTTPS, and any URL that carries credentials', () => {
    expect(linkPreviewKey('http://example.com/')).toBeNull()
    expect(linkPreviewKey('mailto:someone@example.com')).toBeNull()
    expect(linkPreviewKey('/t/task-1')).toBeNull()
    expect(linkPreviewKey('https://user:secret@example.com/')).toBeNull()
    expect(linkPreviewKey('https://user@example.com/')).toBeNull()
  })

  it('refuses a URL past the length cap', () => {
    const base = 'https://example.com/'
    expect(linkPreviewKey(base + 'a'.repeat(MAX_LINK_PREVIEW_URL - base.length))).not.toBeNull()
    expect(linkPreviewKey(base + 'a'.repeat(MAX_LINK_PREVIEW_URL - base.length + 1))).toBeNull()
  })
})

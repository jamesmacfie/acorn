// Linear's private file host, and the two things a frame does with it.
//
// Why this is a swap on the markdown SOURCE and not on the rendered DOM: `renderMarkdown` is a pure
// host function the frame drops through `innerHTML`, so rewriting after the fact means walking the
// container, and the container is rewritten whenever anything upstream ticks. Substituting the URL
// before the render keeps the whole thing a value, and re-renders fall out of the signal for free.
//
// Deliberately the IMAGE form only. A plain `[text](https://uploads.linear.app/…)` is a file the reader
// wants to open, not draw, and the renderer's `safeHref` allows no `data:` — swapping one would leave
// the link text with nothing behind it.
const IMAGE_RE = /!\[([^\]]*)\]\((https:\/\/uploads\.linear\.app\/[^)\s]+)\)/g

/** Every distinct upload an image in this text points at, in first-seen order. */
export const uploadImageUrls = (text: string): string[] =>
  [...new Set(Array.from(text.matchAll(IMAGE_RE), (match) => match[2]))]

/** The same text with every resolved upload replaced by its data URL. An unresolved one is left alone,
 * which renders as a broken image — honest, and what a failed fetch should look like. */
export const inlineUploadImages = (text: string, resolved: Record<string, string>): string =>
  text.replace(IMAGE_RE, (match, alt: string, url: string) =>
    resolved[url] ? `![${alt}](${resolved[url]})` : match)

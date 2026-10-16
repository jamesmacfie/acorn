// GitHub serves every account's picture at a URL built from the login, so none of the mirror's rows
// has to carry one. 36 pixels is the small avatar at twice its size, for high-density screens.
export function githubAvatarUrl(login: string | null | undefined, size = 36): string | undefined {
  const name = login?.trim()
  return name ? `https://github.com/${encodeURIComponent(name)}.png?size=${size}` : undefined
}

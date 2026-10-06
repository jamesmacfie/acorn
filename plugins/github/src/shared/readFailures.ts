// Why a GitHub read failed, in a person's words, by the code server/githubApi.ts and the data handlers
// return. The pull list says these, and so does the pull requests data source through its failure's
// `reason`, so a panel and the list give the same answer for the same cause.

const NO_ACCESS = "GitHub won't show this repository to your account. If an organisation owns it, an owner may need to approve acorn's GitHub app under Third-party access."

export const READ_SENTENCES: Readonly<Record<string, string>> = {
  repo_not_found: NO_ACCESS,
  forbidden: NO_ACCESS,
  sso: "Authorise acorn's GitHub sign-in for your organisation's single sign-on, then try again.",
  rate_limited: 'GitHub is limiting requests. Try again in a minute.',
  github_unavailable: "GitHub didn't answer.",
  reauth: "GitHub turned down acorn's sign-in.",
  github_query_failed: 'GitHub turned down the search for these pull requests.',
  connection_unavailable: "acorn can't use this GitHub account. Reconnect it in Settings.",
}

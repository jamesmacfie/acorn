// The shapes of Bitbucket Cloud's REST answers this plugin reads, trimmed to the fields it uses
// (developer.atlassian.com/cloud/bitbucket/rest).

export type BitbucketUser = {
  uuid: string
  nickname?: string | null
  display_name?: string | null
  type?: string
  links?: { avatar?: { href?: string } }
}

export type BitbucketRepositoryAnswer = {
  full_name: string
  name: string
  is_private: boolean
  mainbranch?: { name: string } | null
  updated_on?: string | null
}

type Endpoint = {
  branch?: { name: string } | null
  commit?: { hash: string } | null
  repository?: { full_name: string } | null
}

export type BitbucketPullRequest = {
  id: number
  title: string
  state: string
  draft?: boolean
  author?: BitbucketUser | null
  source: Endpoint
  destination: Endpoint
  updated_on?: string | null
  summary?: { raw?: string | null; html?: string | null } | null
  participants?: {
    user: BitbucketUser
    role: string
    approved?: boolean
    state?: string | null
    participated_on?: string | null
  }[]
}

/** A person's name in acorn: their nickname, which a workspace's people pick each other by. */
export const login = (user: BitbucketUser | null | undefined): string | null =>
  user ? user.nickname || user.display_name || null : null

export const avatarOf = (user: BitbucketUser | null | undefined): string | null => user?.links?.avatar?.href ?? null

import { MAX_REF_RESOLVE_IDENTIFIERS } from '@acorn/protocol/refResolvers.ts'

// Branch slugs use lowercase ticket keys and separators such as '/', '_' and '-'. A match is only
// a candidate: the provider must confirm it before the PR shows it as a linked issue.
export function branchReferenceCandidates(branch: string | null | undefined): string[] {
  const identifiers = new Set<string>()
  for (const match of (branch ?? '').matchAll(/(?<![a-z0-9])([a-z][a-z0-9]*-\d+)(?![a-z0-9])/gi)) {
    identifiers.add(match[1].toUpperCase())
    if (identifiers.size >= MAX_REF_RESOLVE_IDENTIFIERS) break
  }
  return [...identifiers]
}

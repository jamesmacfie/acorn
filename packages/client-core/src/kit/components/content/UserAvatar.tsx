import { Show } from 'solid-js'

type UserAvatarProps = {
  login: string | null | undefined
  /** The picture, from the person's code host. Without one the avatar draws the login's initials. */
  src?: string | null
  size?: 'sm' | 'md'
}

// Two letters, because a login is a word. The terminal client's avatar draws the same ones.
const initials = (login: string): string => {
  const parts = login.split(/[^a-zA-Z0-9]+/).filter(Boolean)
  return (parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : login.slice(0, 2)).toUpperCase()
}

export function UserAvatar(props: UserAvatarProps) {
  const login = () => props.login?.trim()
  const size = () => props.size ?? 'sm'
  const px = () => (size() === 'md' ? 24 : 18)

  return (
    <Show
      when={login()}
      fallback={<span class={`user-avatar user-avatar-${size()} user-avatar-empty`} aria-hidden="true" />}
    >
      {(name) => (
        <Show
          when={props.src}
          fallback={
            <span class={`user-avatar user-avatar-${size()} user-avatar-initials`} aria-hidden="true">
              {initials(name())}
            </span>
          }
        >
          {(src) => (
            <img
              class={`user-avatar user-avatar-${size()}`}
              src={src()}
              alt=""
              width={px()}
              height={px()}
              loading="lazy"
              decoding="async"
            />
          )}
        </Show>
      )}
    </Show>
  )
}

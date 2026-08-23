// Whether the transcript should still be glued to the bottom after a scroll event.
//
// Position alone cannot answer that. When the list shrinks, because a card collapsed or re-rendered
// shorter, the browser clamps scrollTop and fires a scroll event that by position is indistinguishable
// from the reader scrolling up. The end of a turn is when cards re-render most, so reading intent off
// position switched following off at the moment the reader most wanted it on.
//
// The two directions are not symmetric, so they are decided differently. Landing near the bottom follows
// again whoever caused it, because a clamp leaves the reader at the bottom and that is where following
// belongs. Leaving the bottom only stops following when the reader's own input caused the scroll.
export const nextFollowing = (state: {
  following: boolean
  nearBottom: boolean
  userDriven: boolean
}): boolean => state.nearBottom || (state.userDriven ? false : state.following)

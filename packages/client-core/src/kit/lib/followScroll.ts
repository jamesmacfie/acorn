// Whether a followed Timeline should still be glued to the bottom after a scroll event.
//
// Position alone cannot answer that. When the list shrinks, because a card collapsed, a filter dropped
// rows, or a card re-rendered shorter, the browser clamps scrollTop and fires a scroll event that by
// position is indistinguishable from the reader moving the view themselves. So the mode only changes on
// the reader's own gesture; a scroll event with no gesture behind it preserves the mode, whatever the
// new position is.
//
// A gesture reads the mode off position: at the bottom, follow; away from it, stop. Without a gesture the
// mode holds — a clamp that lands near the bottom does not resume following, which is what turned
// "collapse the tools" or "show chats only" into a jump to the bottom, and a clamp that lands away from
// the bottom does not stop following, which is what turned the end of a turn into a lost tail.
//
// Ceiling: on a touchscreen, momentum after the finger lifts scrolls without re-arming the gesture, so a
// hard flick that coasts to the bottom will not resume following. Desktop wheel and trackpad scrolling
// re-arm on every step, so they are unaffected; add a momentum-phase signal if a touch host needs it.
export const nextFollowing = (state: {
  following: boolean
  nearBottom: boolean
  userDriven: boolean
}): boolean => (state.userDriven ? state.nearBottom : state.following)

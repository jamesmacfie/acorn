# Ticket 3: the element's screenshot

Status: proposed, October 14, 2026. Depends on [ticket 2](./02-send.md). Read
[the context doc](./README.md) first: it holds every decision, its precedent, and the trust rules
this ticket must follow.

## Goal

The turn carries a screenshot cropped to the picked element. When the browser refuses the
screenshot, the question still goes, and the box says it went without one.

## Build

1. On `acorn:ask.open`, after the picker script has hidden its outline, call `captureVisibleTab` as
   `capturePage(api, 'screenshot')` does in `src/capture.ts`.
2. Crop to the element's `rect` times `devicePixelRatio`, clamped to the image, with 8 CSS pixels of
   padding. Use `OffscreenCanvas` and `createImageBitmap`, which both browsers' backgrounds have.
   Encode as JPEG at quality 90.
3. Hold the cropped image per pick. Drop it on `acorn:ask.cancel`.
4. On send, upload it with `attachment.upload` for the task, keep the attachment ID per pick so a
   retry doesn't upload again, and add the `image` part through `turnInput()`.
5. When the capture is refused, tell the box, which shows "This goes without a screenshot: the
   browser didn't allow one here."

## Done when

- A sent question shows a cropped image of the element in the panel's conversation.
- In Firefox, a pick from the chip menu on a granted site sends without a screenshot and says so.
- Check in Chrome whether a granted site without `activeTab` allows the screenshot.
  `docs/browser-extension/page-capture.md` says it does. Record what you find in that page.
- Tests cover the crop's clamping and the retry reusing the attachment.

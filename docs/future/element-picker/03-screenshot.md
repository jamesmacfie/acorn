# Ticket 3: the element's screenshot

## Completion note

October 14, 2026. Done, with every item in "Build".

What landed:

- `acorn:ask.open` carries the element's `rect` in CSS pixels and the page's `devicePixelRatio`. Its
  answer carries `screenshot`, false when there's no picture.
- `open()` in `askElement.ts` takes the screenshot with `capturePage(api, 'screenshot', windowId)`,
  alongside its reads, and crops it with `cropScreenshot()` in `capture.ts`. The pick holds the
  cropped capture, so `acorn:ask.cancel` drops it with the pick.
- `send()` uploads it with `attachment.upload` before the new chat, stores the attachment ID on the
  held capture, and adds the `image` part through `turnInput()`. A retry uploads again only after an
  upload the Node didn't confirm, with the composer's reason: the Node keeps one copy.
- The picker shows "This goes without a screenshot: the browser didn't allow one here." when
  `screenshot` is false.
- Tests in `background.test.ts` cover the crop and its padding, clamping at the image's edges, an
  element outside the image, a bad pixel ratio, a refused capture, and the retry reusing the
  attachment. `picker.test.ts` covers the hidden box, the `rect` it sends, and the no-screenshot line.

Decisions and deviations:

- The box stays hidden (`visibility: hidden` on the picker's host) until the background answers
  `acorn:ask.open`, and the picker waits two animation frames before sending it. Otherwise the
  screenshot catches the outline still on screen, or the box and its shadow inside the 8-pixel
  padding. The box shows, with focus in the question, once the answer arrives. It also shows for a
  refusal, with the reason.
- Every capture failure goes without a screenshot and the same line: a refusal, a page that changed,
  a crop with nothing in it, or a picture over the 5 MiB capture limit. The question can always go.
- The background refuses a screenshot when `rect` or `devicePixelRatio` isn't a finite number, or the
  ratio isn't positive. It also refuses one when the window's active tab isn't the picker's address.
- Chrome refuses the screenshot on a granted site without `activeTab`, the same as Firefox. Chrome
  155 answered "Either the '<all_urls>' or 'activeTab' permission is required." for a throwaway
  extension holding `http://127.0.0.1/*`, and an `<all_urls>` copy took the screenshot of the same
  tab. So a pick from the chip or marker menu goes without a screenshot in both browsers, unless the
  person clicked the toolbar button on that tab since it last navigated. The right-click entry grants
  `activeTab`, so its picks have one. `docs/browser-extension/page-capture.md` records the check. The
  site was listed as required host access rather than granted at a prompt, because a driver can't
  answer Chrome's prompt. Chrome reports both the same way.
- The crop steps (`fetch` of the data URL, `createImageBitmap`, `OffscreenCanvas`, `convertToBlob`,
  `btoa`) ran in a real Chrome 155 extension service worker on a 2400 × 1904 screenshot. The full
  flow wasn't run against a Node in a browser, and neither was Firefox.

For later tickets:

- Ticket 4: the README's Firefox section says only Firefox refuses a chip-menu screenshot. Both
  browsers do. Say so in the reference doc. The comment on `capture.ts`'s
  `SCREENSHOT_ACCESS_GUIDANCE` already says both.
- Still red at this base, untouched: the two oxlint and formatter items ticket 2 named, and in
  `@acorn/arch-tests` the `policyGate` citation, the two boundary lists, `docs/browser-extension.md`
  at 206 lines, and `dist` paths that need a build.

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

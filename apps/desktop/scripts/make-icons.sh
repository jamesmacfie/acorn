#!/usr/bin/env bash
# Regenerate build/icon.icns from the ASCII acorn mark (src/core/client/Acorn.tsx)
# on the light theme (#ffffff bg, #242424 text — tokens-layout.css).
# Squircle = Apple icon grid: 824pt continuous-corner rect on a 1024 canvas.
# Usage: bash scripts/make-icons.sh   (macOS only; needs swift, sips, iconutil)
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p build

swift - <<'EOF'
import AppKit

let art = #"""
   ()
 .-''-.
/::::::\
'------'
|      |
 \    /
  \  /
   \/
"""#

let canvas: CGFloat = 1024
let grid: CGFloat = 824 // Apple icon-grid squircle size at 1024
// Explicit 1024px bitmap — lockFocus() would inherit the display's Retina scale.
let rep = NSBitmapImageRep(
  bitmapDataPlanes: nil, pixelsWide: Int(canvas), pixelsHigh: Int(canvas),
  bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
  colorSpaceName: .calibratedRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
let ctx = NSGraphicsContext.current!.cgContext

let squircle = CALayer()
squircle.frame = CGRect(x: 0, y: 0, width: grid, height: grid)
squircle.backgroundColor = NSColor(srgbRed: 1, green: 1, blue: 1, alpha: 1).cgColor
squircle.cornerRadius = 185.4 // Apple's Big Sur corner radius at 824pt
squircle.cornerCurve = .continuous
ctx.saveGState()
ctx.translateBy(x: (canvas - grid) / 2, y: (canvas - grid) / 2)
squircle.render(in: ctx)
ctx.restoreGState()

let fontSize: CGFloat = 60
let font = NSFont(name: "Berkeley Mono", size: fontSize)
  ?? NSFont(name: "Menlo", size: fontSize)!
let para = NSMutableParagraphStyle()
para.minimumLineHeight = fontSize * 1.1
para.maximumLineHeight = fontSize * 1.1
let attrs: [NSAttributedString.Key: Any] = [
  .font: font,
  .foregroundColor: NSColor(srgbRed: 0x24 / 255.0, green: 0x24 / 255.0, blue: 0x24 / 255.0, alpha: 1),
  .paragraphStyle: para,
]
let text = art as NSString
let bounds = text.boundingRect(
  with: NSSize(width: canvas, height: canvas),
  options: .usesLineFragmentOrigin, attributes: attrs)
text.draw(
  in: NSRect(x: (canvas - bounds.width) / 2, y: (canvas - bounds.height) / 2,
             width: bounds.width, height: bounds.height),
  withAttributes: attrs)

NSGraphicsContext.current = nil
try! rep.representation(using: .png, properties: [:])!
  .write(to: URL(fileURLWithPath: "build/icon-1024.png"))
EOF

iconset=$(mktemp -d)/icon.iconset
mkdir -p "$iconset"
for entry in 16,16 16@2x,32 32,32 32@2x,64 128,128 128@2x,256 256,256 256@2x,512 512,512 512@2x,1024; do
  name="${entry%,*}" px="${entry#*,}"
  sips -z "$px" "$px" build/icon-1024.png --out "$iconset/icon_${name%@2x}x${name}.png" >/dev/null
done
iconutil -c icns "$iconset" -o build/icon.icns
rm -rf "$(dirname "$iconset")"
echo "wrote build/icon.icns"

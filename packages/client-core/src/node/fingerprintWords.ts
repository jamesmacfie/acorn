// A human-comparable rendering of a certificate fingerprint (docs/vNext/protocol.md § Transport and
// identity: "a human-checkable fingerprint (short hash of the cert, rendered as 6 words / grouped base32)").
//
// Pairing's security IS this comparison: the owner reads what the node prints and confirms it matches what the
// client shows. Phase 1 shipped the raw 64 hex characters on both ends, which is correct and nearly unusable —
// two 64-character hex strings differing in the middle look identical to a person, which is exactly the
// substitution an attacker wants.
//
// ## Six words from a fixed list, and the arithmetic behind "six"
//
// The list below has 256 entries, so each word carries 8 bits and six words carry 48. That is the same
// strength as comparing twelve hex characters, and the reason not to use more: a person compares a short
// phrase reliably and a long one carelessly, and a check nobody performs is worth zero bits. 48 bits of
// second-preimage resistance on a certificate the attacker must also make Chromium accept is a wide margin.
//
// The RAW HEX IS STILL SHOWN alongside it. The words are the check a person can make; the hex is the value a
// person can paste into a terminal to compare exactly, and dropping it would remove the only precise option.
//
// ## Client-side, and why the node is not changed to match
//
// The node prints hex, and this maps hex to words deterministically, so both ends describe the same
// certificate whether or not the node ever learns the encoding. Teaching the node the word list would mean
// the two ends could disagree if either shipped a changed list — a divergence with no upside, since the
// client is the only place a human reads a fingerprint during pairing.
//
// **The list is frozen.** Reordering or editing it changes every fingerprint's words, so an owner comparing
// against a node running an older build would see a mismatch on a certificate that never changed. Words are
// short, unambiguous when spoken, and deliberately not near-homophones of each other.
const WORDS: readonly string[] = [
  'able', 'acid', 'acorn', 'actor', 'agent', 'air', 'album', 'alert', 'alley', 'almond', 'amber', 'anchor',
  'angle', 'ankle', 'apple', 'apron', 'arch', 'arena', 'armour', 'arrow', 'artist', 'ash', 'aspen', 'atlas',
  'attic', 'author', 'autumn', 'axis', 'bacon', 'badge', 'bagel', 'bakery', 'balcony', 'bamboo', 'banjo', 'barley',
  'basil', 'basket', 'batch', 'beacon', 'beagle', 'beam', 'bean', 'bear', 'beech', 'beetle', 'bell', 'belt',
  'bench', 'berry', 'bicycle', 'birch', 'bishop', 'bison', 'blanket', 'blossom', 'board', 'bobbin', 'bolt', 'bonus',
  'boot', 'border', 'bottle', 'boulder', 'bracket', 'branch', 'brass', 'bread', 'brick', 'bridge', 'bronze', 'brook',
  'broom', 'brush', 'bubble', 'bucket', 'buffalo', 'bugle', 'bullet', 'bundle', 'burrow', 'butler', 'button', 'cabin',
  'cable', 'cactus', 'camel', 'candle', 'canoe', 'canvas', 'canyon', 'caper', 'carbon', 'cargo', 'carpet', 'carrot',
  'castle', 'cedar', 'cellar', 'cement', 'census', 'chalk', 'charm', 'cheese', 'cherry', 'chess', 'chimney', 'chisel',
  'cider', 'cinema', 'circus', 'citrus', 'clamp', 'clay', 'cliff', 'cloak', 'clock', 'clover', 'cobalt', 'cocoa',
  'coffee', 'collar', 'comet', 'compass', 'copper', 'coral', 'cork', 'cotton', 'crane', 'crater', 'crayon', 'cream',
  'cricket', 'crown', 'crystal', 'cube', 'cuckoo', 'cymbal', 'daisy', 'dampen', 'dart', 'dawn', 'delta', 'denim',
  'desert', 'diamond', 'diesel', 'dinner', 'dolphin', 'domino', 'donkey', 'draft', 'dragon', 'drum', 'dune', 'eagle',
  'earth', 'easel', 'echo', 'eclipse', 'elbow', 'elder', 'elm', 'ember', 'emerald', 'engine', 'envelope', 'equal',
  'ermine', 'escort', 'ether', 'exit', 'fabric', 'falcon', 'fable', 'farm', 'feather', 'fennel', 'fern', 'ferry',
  'fiddle', 'filter', 'finch', 'fjord', 'flag', 'flannel', 'flask', 'flint', 'floor', 'flute', 'foam', 'foil',
  'forest', 'forge', 'fossil', 'fountain', 'fox', 'frame', 'freight', 'fresco', 'frost', 'fuel', 'gallery', 'garden',
  'garlic', 'gate', 'gazelle', 'gear', 'gecko', 'gemstone', 'geyser', 'ginger', 'glacier', 'glass', 'glider', 'globe',
  'glove', 'gold', 'gondola', 'goose', 'gopher', 'granite', 'grape', 'graphite', 'gravel', 'grotto', 'guitar', 'gulf',
  'gully', 'gymnast', 'habitat', 'hammer', 'hamster', 'harbour', 'harp', 'harvest', 'hazel', 'heather', 'hedge', 'helium',
  'helmet', 'herald', 'heron', 'hickory', 'hinge', 'hollow', 'honey', 'hoodie', 'hopper', 'hornet', 'horse', 'hostel',
  'hurdle', 'hyacinth', 'iceberg', 'igloo',
]

const normalizeHex = (fingerprint: string): string => fingerprint.replace(/[^0-9a-f]/gi, '').toLowerCase()

// Six words, or null when the input is not a fingerprint. Null rather than a partial phrase: a truncated
// comparison string is worse than none, because it still looks checkable.
export function fingerprintWords(fingerprint: string | undefined | null, count = 6): string[] | null {
  if (!fingerprint) return null
  const hex = normalizeHex(fingerprint)
  // sha256, so 64 hex characters. Anything shorter is not a fingerprint this app produced.
  if (hex.length < count * 2) return null
  const words: string[] = []
  for (let index = 0; index < count; index++) {
    const byte = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
    if (!Number.isInteger(byte)) return null
    words.push(WORDS[byte % WORDS.length]!)
  }
  return words
}

export const fingerprintPhrase = (fingerprint: string | undefined | null): string | null =>
  fingerprintWords(fingerprint)?.join(' ') ?? null

// Exported for the test that pins the list's size and shape — the two properties every fingerprint's words
// depend on.
export const FINGERPRINT_WORD_COUNT = WORDS.length

// A certificate fingerprint rendered as words, so a human can actually compare two of them.
//
// In `protocol` rather than in the client because BOTH ends have to say the same thing: the node
// prints this phrase on its own terminal at boot and the desktop shows it on the pairing confirm
// step, and comparing those two is the entire security of pairing (docs/api-reference.md § Pairing).
// Two copies of the word list would be two things that can drift into a comparison that always
// passes.

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

// Numbers 1–10: Arabic digit and word, how an Azerbaijani speaker reads it,
// the Azerbaijani number, and a fun object to count.
//
// `strokes` are the tracing guides for writing the Arabic (Eastern Arabic)
// digit, as polylines in a 0..1 box (x to the right, y down). They are smoothed
// when drawn. Stroke order and direction don't matter for the check.

const circle = (cx, cy, rx, ry, n = 16) =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry];
  });

export const NUMBERS = [
  {
    n: 1, digit: '١', ar: 'واحد', say: 'واحِد', tr: 'vahid', az: 'bir',
    emoji: '🌞', thing: 'günəş',
    strokes: [[[0.5, 0.1], [0.5, 0.9]]],
  },
  {
    n: 2, digit: '٢', ar: 'اثنان', say: 'اِثنان', tr: 'isnan', az: 'iki',
    emoji: '🐱', thing: 'pişik',
    // one stroke: the little cup at the top (right to left), then down the stem
    strokes: [[[0.7, 0.1], [0.65, 0.21], [0.54, 0.27], [0.43, 0.23], [0.37, 0.12], [0.42, 0.5], [0.47, 0.9]]],
  },
  {
    n: 3, digit: '٣', ar: 'ثلاثة', say: 'ثَلاثة', tr: 'səlasə', az: 'üç',
    emoji: '🎈', thing: 'şar',
    // one stroke: the two bumps at the top (right to left), then down the stem
    strokes: [[[0.72, 0.1], [0.66, 0.24], [0.56, 0.25], [0.5, 0.14], [0.43, 0.26], [0.34, 0.23], [0.29, 0.11], [0.37, 0.5], [0.44, 0.9]]],
  },
  {
    n: 4, digit: '٤', ar: 'أربعة', say: 'أَربَعة', tr: 'ərbəə', az: 'dörd',
    emoji: '🍎', thing: 'alma',
    strokes: [
      [[0.66, 0.12], [0.48, 0.15], [0.4, 0.26], [0.47, 0.38], [0.62, 0.43],
        [0.44, 0.5], [0.36, 0.64], [0.42, 0.8], [0.56, 0.86], [0.7, 0.82]],
    ],
  },
  {
    n: 5, digit: '٥', ar: 'خمسة', say: 'خَمسة', tr: 'xəmsə', az: 'beş',
    emoji: '🐟', thing: 'balıq',
    strokes: [[[0.5, 0.2], [0.38, 0.38], [0.31, 0.6], [0.36, 0.8], [0.5, 0.86], [0.64, 0.8], [0.69, 0.6], [0.62, 0.38], [0.5, 0.2]]],
  },
  {
    n: 6, digit: '٦', ar: 'ستة', say: 'سِتّة', tr: 'sittə', az: 'altı',
    emoji: '🦋', thing: 'kəpənək',
    strokes: [[[0.3, 0.13], [0.44, 0.2], [0.6, 0.18], [0.61, 0.5], [0.62, 0.9]]],
  },
  {
    n: 7, digit: '٧', ar: 'سبعة', say: 'سَبعة', tr: 'səbə', az: 'yeddi',
    emoji: '⭐', thing: 'ulduz',
    strokes: [[[0.28, 0.12], [0.39, 0.5], [0.5, 0.88], [0.61, 0.5], [0.72, 0.12]]],
  },
  {
    n: 8, digit: '٨', ar: 'ثمانية', say: 'ثَمانِية', tr: 'səmaniyə', az: 'səkkiz',
    emoji: '🐞', thing: 'parabüzən',
    strokes: [[[0.28, 0.88], [0.39, 0.5], [0.5, 0.12], [0.61, 0.5], [0.72, 0.88]]],
  },
  {
    n: 9, digit: '٩', ar: 'تسعة', say: 'تِسعة', tr: 'tisə', az: 'doqquz',
    emoji: '🍓', thing: 'çiyələk',
    strokes: [
      circle(0.5, 0.29, 0.14, 0.15),
      [[0.63, 0.3], [0.62, 0.6], [0.6, 0.9]],
    ],
  },
  {
    n: 10, digit: '١٠', ar: 'عشرة', say: 'عَشَرة', tr: 'aşərə', az: 'on',
    emoji: '🐥', thing: 'cücə',
    strokes: [
      [[0.3, 0.12], [0.3, 0.88]],
      circle(0.66, 0.52, 0.09, 0.11, 12),
    ],
  },
];

// Short Azerbaijani phrases (shown, and spoken if the device has a voice for them).
export const PRAISE = ['Əla!', 'Afərin!', 'Çox gözəl!', 'Super!', 'Bravo!'];

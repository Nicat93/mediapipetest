# Ərəbcə Rəqəmlər (Arabic numbers)

A game for small Azerbaijani-speaking children (about 3–6) to learn the Arabic numbers 1–10.
The screens are in Azerbaijani; the numbers are shown as Arabic digits (١ ٢ ٣ …) and words (واحد، اثنان …),
with an Azerbaijani reading (vahid, isnan, səlasə …).

1. **Rəqəm seç** – pick a number on the map. Stars show what was done: ⭐ counted, ⭐ written.
2. **Say!** – that many fun things appear (3 balloons for ٣). Touch each one: it gets a number and the Arabic
   count is spoken (vahid, isnan, səlasə). When all are counted, the word is said again with its Azerbaijani name.
3. **Yaz!** – trace the digit on the pad. Green dots show where to start; the covered parts of the line turn yellow.
   When most of the line is covered, there's confetti and the ▶ button goes to the next number.
   A big scribble away from the line is wiped automatically with a "let's try again".
4. **Neçədir?** – a quiz: count the things and pick the right Arabic number out of three.

## Playing with hands (camera)

- **Press buttons:** hold the hand over a button until the ring fills, or make a fist on it.
- **Count:** move the hand over each thing.
- **Write:** make a fist — that's "pen down". Open the hand — "pen up".

Tracking is smoothed with a One Euro filter (steady when the hand is slow, quick when it moves fast).
The pen waits a moment after the fist closes and drops the last bit of ink before the hand opens, because
closing and opening the hand shifts it a little. The middle of the camera image maps to the whole screen.

The camera can be the PC's webcam or a phone over Wi‑Fi (pick *Phone (Wi‑Fi)* and scan the QR code; it uses
`arcade/phone.html`, with the **Upside down** option).

## Voices

The Arabic words use the device's Arabic text-to-speech voice. Microsoft Edge, Android and iPhone/iPad usually
have one; desktop Chrome on Windows often doesn't (install the Arabic speech pack in Windows settings, or use Edge).
Without one, the Azerbaijani reading (e.g. "səlasə") is spoken instead. Short instructions are spoken with an
Azerbaijani or Turkish voice if the device has one; this can be turned off under *Böyüklər üçün*. The page shows
which voices it found.

Files: `index.html`, `style.css`, `js/main.js` (game), `js/numbers.js` (numbers, words, tracing guides),
`js/hands.js` (hand tracking, smoothing, fist detection).

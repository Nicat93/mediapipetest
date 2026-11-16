// The part every camera game repeats: start screen <-> game screen, the camera
// picker (PC camera or phone over Wi-Fi), the loading overlay, waiting for the
// phone, error messages, and loading the MediaPipe tracker.
//
//   const shell = createShell({
//     lang: 'en',                                        // or 'az', or your own strings
//     tracker: (video) => new HandTracker(video),        // made on the first camera play
//     onPlay: ({ camera, arg }) => startLevel(arg),       // game screen is already showing
//     onHome: () => cleanUp(),                           // start screen is already showing
//   });
//   playButton.onclick = () => shell.play(level);       // with the camera
//   touchButton.onclick = () => shell.playTouch();      // without (optional)
//   homeButton.onclick = () => shell.home();
//   // every frame:  const hands = shell.track(now);   // [] unless playing with the camera
//
// Page contract (see docs/NEW_GAME.md): <section id="start" class="screen"> with an
// empty <div class="kit-camera"></div> where the picker goes, and
// <section id="game" class="screen hidden">. Everything else is created here.

const STRINGS = {
  en: {
    camera: 'Camera',
    loading: 'Loading…',
    opening: 'Opening the camera…',
    phone: 'Connecting to the phone…',
    hands: 'Loading hand tracking…',
    pose: 'Loading body tracking…',
    waitPhone: 'Waiting for the phone… Scan the QR code with it.',
    noCode: 'The camera code did not load. Check the internet connection and reload.',
    denied: 'Camera permission was refused.',
    notFound: 'No camera found.',
    failed: (msg) => `Couldn’t open the camera: ${msg}`,
    touchToo: 'You can play with touch instead.',
  },
  az: {
    camera: 'Kamera',
    loading: 'Yüklənir…',
    opening: 'Kamera açılır…',
    phone: 'Telefona qoşulur…',
    hands: 'Əl izləmə yüklənir…',
    pose: 'Bədən izləmə yüklənir…',
    waitPhone: 'Telefon gözlənilir… QR kodu telefonla skan edin.',
    noCode: 'Kamera kodu yüklənmədi. İnterneti yoxlayıb səhifəni yeniləyin.',
    denied: 'Kameraya icazə verilmədi.',
    notFound: 'Kamera tapılmadı.',
    failed: (msg) => `Kamera açılmadı: ${msg}`,
    touchToo: 'Toxunaraq da oynamaq olar.',
  },
};

const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
};

/**
 * @param {object} o
 * @param {'en'|'az'} [o.lang]
 * @param {object} [o.strings]   overrides for any text in STRINGS
 * @param {(video: HTMLVideoElement, preview?: HTMLCanvasElement) => object} o.tracker  makes the tracker (HandTracker / PoseTracker)
 * @param {(info: {camera: boolean, arg: any}) => void} o.onPlay
 * @param {() => void} [o.onHome]
 * @param {boolean|'corner'} [o.preview]  show a small mirrored camera picture with the skeleton while playing
 * @param {boolean} [o.touch]     the game also has a touch mode (adds "play with touch" to camera errors)
 * @param {() => void} [o.unlock] called on every play click (e.g. sound.unlock)
 * @param {(found: any[], tracker: object) => [string, boolean]} [o.badge]  text and ok-state for the preview badge
 */
export function createShell(o) {
  const t = { ...STRINGS[o.lang || 'en'], ...o.strings };
  const start = document.getElementById('start');
  const game = document.getElementById('game');

  // ---- elements the shell owns
  const slot = start.querySelector('.kit-camera') || start.appendChild(el('div', { className: 'kit-camera' }));
  const select = el('select', { id: 'camera' },
    new Option('PC camera', ''), new Option('Phone (Wi‑Fi)', 'phone'));
  const linkEl = el('div', { className: 'kit-link', id: 'link', hidden: true },
    el('span', { className: 'state' }), el('span', { className: 'url' }));
  // Messages go under the picker, or into an element with class "kit-msg" if the page has one
  // (handy when the picker sits inside a closed Grown-ups box).
  const ownMsg = start.querySelector('.kit-msg');
  const msgEl = ownMsg || el('p', { className: 'msg kit-msg', role: 'status' });
  msgEl.id ||= 'start-msg';
  slot.replaceChildren(el('label', { className: 'cam-pick' }, `${t.camera} `, select), linkEl, ...(ownMsg ? [] : [msgEl]));

  const loadingText = el('p', { textContent: t.loading });
  const loading = el('div', { className: 'kit-loading hidden', role: 'status' }, el('div', { className: 'spinner' }), loadingText);

  let preview = null;
  let previewCanvas = null;
  let badge = null;
  const video = el('video', { id: 'cam-video', playsInline: true, muted: true });
  if (o.preview) {
    previewCanvas = el('canvas');
    badge = el('div', { className: 'kit-badge', textContent: '…' });
    preview = el('div', { className: 'kit-preview hidden' }, video, previewCanvas, badge);
    document.body.append(preview);
  } else {
    video.hidden = true;
    document.body.append(video);
  }
  document.body.append(loading);

  // ---- state
  let mode = 'off'; // 'off' | 'camera' | 'touch'
  let tracker = null;
  let camera = null;
  let waiting = false;
  let pendingArg;

  const setMsg = (text) => (msgEl.textContent = text || '');
  const showLoading = (text) => {
    loadingText.textContent = text;
    loading.classList.remove('hidden');
  };
  const hideLoading = () => loading.classList.add('hidden');

  function showGame(withCamera) {
    start.classList.add('hidden');
    game.classList.remove('hidden');
    preview?.classList.toggle('hidden', !withCamera);
  }

  const cameraReady = import('./camera.js')
    .then(({ createCamera }) => {
      camera = createCamera({
        video,
        select,
        linkEl,
        isActive: () => mode === 'camera',
        onPhoneReady: () => { if (waiting) shell.play(pendingArg); },
        onError: setMsg,
      });
    })
    .catch((err) => console.warn('Camera picker unavailable', err));

  const shell = {
    video,
    strings: t,
    get mode() { return mode; },
    get tracker() { return tracker; },
    get playing() { return mode !== 'off'; },

    /** Starts with the camera. Resolves true when the game started. */
    async play(arg) {
      o.unlock?.();
      waiting = false;
      setMsg('');
      showLoading(t.loading);
      try {
        await cameraReady;
        if (!camera) throw new Error(t.noCode);
        tracker ||= await o.tracker(video, previewCanvas);
        loadingText.textContent = camera.usingPhone() ? t.phone : t.opening;
        const model = tracker.load();
        model.catch(() => {}); // reported below, after the camera
        const ready = await camera.start();
        loadingText.textContent = tracker.kind === 'pose' ? t.pose : t.hands;
        await model;
        hideLoading();
        if (!ready) {
          // Phone chosen but not connected yet: the QR code is showing; start when it connects.
          waiting = true;
          pendingArg = arg;
          setMsg(t.waitPhone);
          linkEl.closest('details')?.setAttribute('open', '');
          linkEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return false;
        }
        mode = 'camera';
        showGame(true);
        o.onPlay({ camera: true, arg });
        return true;
      } catch (err) {
        console.error(err);
        hideLoading();
        let msg = err?.message || String(err);
        if (err?.name === 'NotAllowedError') msg = t.denied;
        if (err?.name === 'NotFoundError') msg = t.notFound;
        shell.home(`${t.failed(msg)}${o.touch ? ` ${t.touchToo}` : ''}`);
        return false;
      }
    },

    /** Starts without the camera (touch / mouse). */
    playTouch(arg) {
      o.unlock?.();
      waiting = false;
      setMsg('');
      mode = 'touch';
      showGame(false);
      o.onPlay({ camera: false, arg });
    },

    /**
     * Back to the start screen (stops the camera).
     * keepGame: leave the game screen showing under the start screen and the
     * camera running (a "Game over, play again?" menu over the last frame).
     */
    home(message = '', { keepGame = false } = {}) {
      const wasPlaying = mode !== 'off';
      mode = 'off';
      waiting = false;
      window.speechSynthesis?.cancel();
      if (!keepGame) {
        camera?.stop();
        tracker?.reset();
        game.classList.add('hidden');
      }
      preview?.classList.add('hidden');
      start.classList.remove('hidden');
      setMsg(message);
      if (wasPlaying || message) o.onHome?.();
    },

    /** Call every frame: the tracker's hands / poses, or [] when not playing with the camera. */
    track(now = performance.now()) {
      if (mode !== 'camera' || !tracker) return [];
      const found = tracker.update(now);
      if (badge) {
        const icon = tracker.kind === 'pose' ? '🧍' : '✋';
        const [text, ok] = o.badge ? o.badge(found, tracker) : [`${icon} ${found.length ? '✓' : '?'}`, found.length > 0];
        if (badge.textContent !== text) badge.textContent = text;
        badge.classList.toggle('ok', ok);
      }
      return found;
    },

    setMessage: setMsg,
    /** The preview box (or null), e.g. to restyle it for a portrait phone camera. */
    preview,
  };
  return shell;
}

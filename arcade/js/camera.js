// Shared camera source for the arcade games: a <select> with "Phone (Wi-Fi)"
// (WebRTC stream from phone.html, paired with a code / QR via PeerJS, see
// phonelink.js) plus every camera the PC can see (webcams, phone USB webcam
// mode, phone-webcam apps).

export const PHONE = 'phone';
const CAM_KEY = 'mparcade.cameraId'; // shared by all arcade games

/**
 * @param {object} o
 * @param {HTMLVideoElement} o.video
 * @param {HTMLSelectElement} o.select
 * @param {HTMLElement} o.linkEl   element with .state and .url children
 * @param {() => void} o.onAttach  a new stream was attached to the video
 * @param {() => void} o.onPhoneReady  the phone connected while the phone is selected
 * @param {(text: string) => void} o.onError
 * @param {() => boolean} o.isActive  whether the game is currently using the camera
 */
export function createCamera({ video, select, linkEl, onAttach, onPhoneReady, onError, isActive }) {
  let phoneStream = null;
  let link = null; // PhoneLink, opened the first time the phone is selected
  let linkState = '';

  const stateEl = linkEl.querySelector('.state');
  const urlEl = linkEl.querySelector('.url');
  const qrEl = document.createElement('div');
  qrEl.className = 'qr';
  urlEl.before(qrEl);

  const saved = () => {
    try { return localStorage.getItem(CAM_KEY); } catch { return null; }
  };
  const usingPhone = () => select.value === PHONE;

  /** Rebuilds the camera list. `prefer` is the deviceId to select, if it's in the list. */
  async function listCameras(prefer) {
    let cams = [];
    try {
      cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    } catch {}
    const want = prefer ?? (select.value || saved() || '');
    // Before camera permission is granted, browsers hide camera names: offer one generic entry.
    const named = cams.filter((c) => c.label);
    select.replaceChildren(
      ...(named.length
        ? named.map((c) => new Option(c.label, c.deviceId))
        : [new Option('PC camera', '')]),
      new Option('Phone (Wi‑Fi)', PHONE),
    );
    select.value = [...select.options].some((o) => o.value === want) ? want : select.options[0].value;
    updateLinkInfo();
  }

  function updateLinkInfo() {
    if (!usingPhone()) { linkEl.hidden = true; return; }
    linkEl.hidden = false;
    openLink();
    const ok = !!phoneStream;
    stateEl.textContent =
      ok ? 'Phone connected ✓'
        : linkState === 'error' ? 'Couldn’t reach the pairing server. Check your internet connection and reload.'
          : !link?.code ? 'Getting a pairing code…'
            : 'Phone not connected. Scan the QR code with your phone, or open this address and enter the code:';
    linkEl.classList.toggle('ok', ok);
    qrEl.hidden = ok;
  }

  async function openLink() {
    if (link) return;
    try {
      const { PhoneLink, qrSvg } = await import('./phonelink.js');
      if (link) return;
      link = new PhoneLink();
      link.onStream = async (stream) => {
        phoneStream = stream;
        updateLinkInfo();
        if (usingPhone()) {
          await attach(stream);
          onPhoneReady?.();
        }
      };
      link.onDisconnect = () => {
        if (video.srcObject === phoneStream) video.srcObject = null;
        phoneStream = null;
        updateLinkInfo();
      };
      const code = await link.open();
      const url = link.phoneUrl;
      urlEl.innerHTML = '';
      urlEl.append(url.replace(/#.*/, ''), document.createElement('br'), `Code: ${code}`);
      updateLinkInfo();
      qrEl.innerHTML = await qrSvg(url).catch(() => '');
    } catch (err) {
      console.warn('Phone link failed', err);
      link = null;
      linkState = 'error';
      updateLinkInfo();
      linkState = '';
    }
  }

  async function attach(stream) {
    video.srcObject = stream;
    await video.play().catch(() => {});
    await new Promise((r) => (video.readyState >= 2 ? r() : (video.onloadeddata = r)));
    onAttach?.();
  }

  function stopLocal() {
    if (video.srcObject && video.srcObject !== phoneStream) {
      video.srcObject.getTracks().forEach((t) => t.stop());
    }
    video.srcObject = null;
  }

  /** Attaches the selected camera. Resolves false if we're still waiting for the phone. */
  async function start() {
    if (usingPhone()) {
      if (video.srcObject !== phoneStream) stopLocal();
      if (!phoneStream) return false;
      if (video.srcObject !== phoneStream) await attach(phoneStream);
      return true;
    }
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('Camera needs https:// or http://localhost.');
    }
    stopLocal();
    const deviceId = select.value;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'user' }),
        width: { ideal: 640 },
        height: { ideal: 480 },
      },
    });
    await attach(stream);
    // Names only become available after permission is granted; select the camera actually opened.
    await listCameras(stream.getVideoTracks()[0]?.getSettings().deviceId);
    return true;
  }

  select.addEventListener('change', async () => {
    try { localStorage.setItem(CAM_KEY, select.value); } catch {}
    updateLinkInfo();
    if (!video.srcObject && !isActive?.()) return;
    try {
      await start();
    } catch (err) {
      onError?.(`Couldn't open that camera: ${err?.message || err}`);
    }
  });
  navigator.mediaDevices?.addEventListener?.('devicechange', listCameras);
  listCameras();

  return { start, stop: stopLocal, usingPhone };
}

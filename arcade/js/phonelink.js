// WebRTC link between this page (receiver) and phone.html (sender), via PeerJS.
// PeerJS's free public server is only used to exchange connection details;
// the video itself goes directly from phone to PC over the local network.

export const PEERJS_URL = 'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js';
const QR_URL = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';
export const ID_PREFIX = 'mp-arcade-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

const scripts = new Map();
export function loadScript(src) {
  if (!scripts.has(src)) {
    scripts.set(
      src,
      new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.async = true;
        s.onload = resolve;
        s.onerror = () => {
          scripts.delete(src);
          reject(new Error(`Could not load ${src}`));
        };
        document.head.appendChild(s);
      }),
    );
  }
  return scripts.get(src);
}

function randomCode(len = 6) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
}

/** Render a QR code for `text` as an inline SVG string. */
export async function qrSvg(text) {
  await loadScript(QR_URL);
  const qr = window.qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
}

export class PhoneLink {
  constructor() {
    this.peer = null;
    this.call = null;
    this.code = '';
    this.onStream = () => {};
    this.onDisconnect = () => {};
    this.destroyed = false;
  }

  get phoneUrl() {
    // arcade/phone.html, also when another folder's page (e.g. cooking/) uses this link
    const url = new URL('../phone.html', import.meta.url);
    url.hash = this.code;
    return url.href;
  }

  /** Connect to the signaling server and wait for a phone to call. Resolves with the pairing code. */
  async open() {
    await loadScript(PEERJS_URL);
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = randomCode();
      try {
        this.peer = await openPeer(ID_PREFIX + code);
        this.code = code;
        break;
      } catch (err) {
        if (err?.type !== 'unavailable-id' || attempt === 2) throw err;
      }
    }
    const peer = this.peer;
    peer.on('call', (call) => this.handleCall(call));
    peer.on('disconnected', () => {
      // Lost the signaling server (not the video). Reconnect so the phone can rejoin later.
      if (!this.destroyed) setTimeout(() => !this.destroyed && peer.disconnected && peer.reconnect(), 1000);
    });
    peer.on('error', (err) => console.warn('PeerJS error', err.type, err));
    return this.code;
  }

  handleCall(call) {
    if (this.call && this.call !== call) {
      const old = this.call;
      this.call = null; // don't report the replaced call as a disconnect
      old.close();
    }
    this.call = call;
    let ended = false;
    const end = () => {
      if (ended || this.call !== call) return;
      ended = true;
      this.call = null;
      this.onDisconnect();
    };
    call.on('stream', (stream) => {
      if (this.call === call) this.onStream(stream);
    });
    call.on('close', end);
    call.on('error', end);
    call.answer(); // receive only: the PC sends nothing back

    const pc = call.peerConnection;
    if (pc) {
      pc.addEventListener('iceconnectionstatechange', () => {
        const s = pc.iceConnectionState;
        if (s === 'failed' || s === 'closed') end();
        if (s === 'disconnected') {
          // Often recovers by itself; give it a few seconds.
          setTimeout(() => pc.iceConnectionState === 'disconnected' && end(), 4000);
        }
      });
    }
  }

  close() {
    this.destroyed = true;
    this.call?.close();
    this.call = null;
    this.peer?.destroy();
    this.peer = null;
  }
}

function openPeer(id) {
  return new Promise((resolve, reject) => {
    const peer = new window.Peer(id, { debug: 1 });
    const fail = (err) => {
      peer.destroy();
      reject(err);
    };
    peer.once('open', () => {
      peer.off('error', fail);
      resolve(peer);
    });
    peer.once('error', fail);
  });
}

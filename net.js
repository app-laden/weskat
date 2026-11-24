/* Verbindung der drei Handys
   - online: PeerJS (Vermittlung über 0.peerjs.com, danach direkt; notfalls über TURN-Relais)
   - offline: WebRTC im lokalen Netz (Hotspot), Austausch der Verbindungsdaten per QR-Code in beide Richtungen
   - test: BroadcastChannel (drei Fenster im selben Browser) */
(function (root) {
  'use strict';
  const PREFIX = 'appladen-skat-';
  const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  function randCode(n = 4) {
    let s = ''; const a = new Uint32Array(n); crypto.getRandomValues(a);
    for (let i = 0; i < n; i++) s += CODE_CHARS[a[i] % CODE_CHARS.length];
    return s;
  }
  function mkLink(kind, sendFn, closeFn) {
    return { kind, send: sendFn, close: closeFn || (() => {}), onmsg: null, onclose: null, closed: false };
  }
  function fireClose(L) { if (L.closed) return; L.closed = true; if (L.onclose) L.onclose(); }

  // ---------- PeerJS ----------
  function wrapConn(conn) {
    const L = mkLink('peer', o => { try { if (conn.open) conn.send(o); } catch (e) { } }, () => { try { conn.close(); } catch (e) { } });
    conn.on('data', d => { if (L.onmsg) L.onmsg(d); });
    conn.on('close', () => fireClose(L));
    conn.on('error', () => fireClose(L));
    return L;
  }
  function peerHost(code, cb) {
    if (!root.Peer) { cb.onError({ type: 'nolib' }); return null; }
    const peer = new root.Peer(PREFIX + code, { debug: 0 });
    peer.on('open', () => cb.onOpen && cb.onOpen(code));
    peer.on('connection', conn => conn.on('open', () => cb.onLink(wrapConn(conn))));
    peer.on('error', e => cb.onError && cb.onError(e));
    peer.on('disconnected', () => setTimeout(() => { if (!peer.destroyed) try { peer.reconnect(); } catch (e) { } }, 1500));
    return peer;
  }
  function peerJoin(code, cb) {
    if (!root.Peer) { cb.onError({ type: 'nolib' }); return null; }
    const peer = new root.Peer({ debug: 0 });
    peer.on('open', () => {
      const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
      conn.on('open', () => cb.onLink(wrapConn(conn)));
    });
    peer.on('error', e => cb.onError && cb.onError(e));
    return peer;
  }

  // ---------- WebRTC per QR (ohne Internet) ----------
  const RTC_CFG = { iceServers: [] };
  function b64FromHex(hex) {
    const bytes = hex.split(':').map(h => parseInt(h, 16));
    return btoa(String.fromCharCode(...bytes));
  }
  function hexFromB64(b) {
    return [...atob(b)].map(c => c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')).join(':');
  }
  const TYPES = { host: 'h', srflx: 's', prflx: 'p', relay: 'r' };
  const TYPES_R = { h: 'host', s: 'srflx', p: 'prflx', r: 'relay' };
  function encodeSdp(desc) {
    const sdp = desc.sdp;
    const get = re => { const m = sdp.match(re); return m ? m[1].trim() : ''; };
    const cands = [];
    sdp.split(/\r?\n/).forEach(line => {
      const m = line.match(/^a=candidate:\S+ (\d) (udp|UDP) \d+ (\S+) (\d+) typ (\w+)/);
      if (m && m[1] === '1') {
        const k = m[3] + ',' + m[4] + ',' + (TYPES[m[5]] || 'h');
        if (!cands.includes(k)) cands.push(k);
      }
    });
    return ['S1', desc.type === 'offer' ? 'o' : 'a', get(/a=ice-ufrag:(.*)/), get(/a=ice-pwd:(.*)/),
      b64FromHex(get(/a=fingerprint:sha-256 (.*)/)), get(/a=setup:(\w+)/), get(/a=mid:(.*)/), cands.join(';')].join('|');
  }
  function decodeSdp(code) {
    const p = String(code).trim().split('|');
    if (p[0] !== 'S1' || p.length < 8) throw new Error('Kein Skat-Code');
    const [, t, ufrag, pwd, fp, setup, mid, cs] = p;
    const lines = ['v=0', 'o=- 4611731400430051336 2 IN IP4 127.0.0.1', 's=-', 't=0 0',
      'a=group:BUNDLE ' + mid, 'a=msid-semantic: WMS',
      'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 0.0.0.0'];
    (cs ? cs.split(';') : []).forEach((c, i) => {
      const [addr, port, ty] = c.split(',');
      const prio = ty === 'h' ? 2122260223 - i : 1686052607 - i;
      lines.push(`a=candidate:${i + 1} 1 udp ${prio} ${addr} ${port} typ ${TYPES_R[ty] || 'host'} generation 0`);
    });
    lines.push('a=end-of-candidates', 'a=ice-ufrag:' + ufrag, 'a=ice-pwd:' + pwd, 'a=ice-options:trickle',
      'a=fingerprint:sha-256 ' + hexFromB64(fp), 'a=setup:' + setup, 'a=mid:' + mid,
      'a=sctp-port:5000', 'a=max-message-size:262144');
    return { type: t === 'o' ? 'offer' : 'answer', sdp: lines.join('\r\n') + '\r\n' };
  }
  function iceDone(pc, ms) {
    return new Promise(res => {
      if (pc.iceGatheringState === 'complete') return res();
      const t = setTimeout(res, ms);
      pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); res(); } });
    });
  }
  function wrapChannel(pc, ch) {
    const L = mkLink('rtc', o => { if (ch.readyState === 'open') ch.send(JSON.stringify(o)); }, () => { try { ch.close(); pc.close(); } catch (e) { } });
    ch.onmessage = e => { let d; try { d = JSON.parse(e.data); } catch (x) { return; } if (L.onmsg) L.onmsg(d); };
    ch.onclose = () => fireClose(L);
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') fireClose(L);
    });
    return L;
  }
  // Tisch: Angebot für einen Mitspieler erzeugen
  async function rtcOffer() {
    const pc = new RTCPeerConnection(RTC_CFG);
    const ch = pc.createDataChannel('skat', { ordered: true });
    await pc.setLocalDescription(await pc.createOffer());
    await iceDone(pc, 2500);
    const code = encodeSdp(pc.localDescription);
    const opened = new Promise((res, rej) => {
      ch.onopen = () => res(wrapChannel(pc, ch));
      setTimeout(() => rej(new Error('timeout')), 60000);
    });
    return {
      pc, code, opened,
      accept: async answerCode => { await pc.setRemoteDescription(decodeSdp(answerCode)); return opened; }
    };
  }
  // Mitspieler: Angebot lesen, Antwort erzeugen
  async function rtcAnswer(offerCode) {
    const pc = new RTCPeerConnection(RTC_CFG);
    const opened = new Promise((res, rej) => {
      pc.ondatachannel = e => { const ch = e.channel; if (ch.readyState === 'open') res(wrapChannel(pc, ch)); else ch.onopen = () => res(wrapChannel(pc, ch)); };
      setTimeout(() => rej(new Error('timeout')), 90000);
    });
    await pc.setRemoteDescription(decodeSdp(offerCode));
    await pc.setLocalDescription(await pc.createAnswer());
    await iceDone(pc, 2500);
    return { pc, code: encodeSdp(pc.localDescription), opened };
  }

  // ---------- Test über BroadcastChannel ----------
  function testHost(cb) {
    const bc = new BroadcastChannel('skat-test');
    const links = {};
    bc.onmessage = e => {
      const d = e.data; if (d.to !== 'host') return;
      if (d.open) {
        const L = mkLink('test', o => bc.postMessage({ to: d.from, msg: o }));
        links[d.from] = L; bc.postMessage({ to: d.from, ack: 1 }); cb.onLink(L); return;
      }
      const L = links[d.from]; if (L && L.onmsg) L.onmsg(d.msg);
    };
    setTimeout(() => cb.onOpen && cb.onOpen('TEST'), 10);
    return { destroy: () => bc.close() };
  }
  function testJoin(cb) {
    const bc = new BroadcastChannel('skat-test');
    const id = randCode(8);
    const L = mkLink('test', o => bc.postMessage({ to: 'host', from: id, msg: o }));
    bc.onmessage = e => {
      const d = e.data; if (d.to !== id) return;
      if (d.ack) { cb.onLink(L); return; }
      if (L.onmsg) L.onmsg(d.msg);
    };
    bc.postMessage({ to: 'host', from: id, open: 1 });
    return { destroy: () => bc.close() };
  }

  // ---------- QR-Code ----------
  function qrSvg(text, ecl) {
    const qr = root.qrcode(0, ecl || 'M');
    qr.addData(text); qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 3, scalable: true });
  }

  // ---------- Kamera / Scanner ----------
  let keptStream = null;
  async function camera() {
    if (keptStream && keptStream.getTracks().some(t => t.readyState === 'live')) return keptStream;
    keptStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    return keptStream;
  }
  function stopCamera() { if (keptStream) { keptStream.getTracks().forEach(t => t.stop()); keptStream = null; } }
  async function scan(video, onResult, keep) {
    const stream = await camera();
    video.srcObject = stream; video.setAttribute('playsinline', ''); video.muted = true;
    try { await video.play(); } catch (e) { }
    let stopped = false, det = null;
    if ('BarcodeDetector' in root) {
      try { det = new root.BarcodeDetector({ formats: ['qr_code'] }); } catch (e) { det = null; }
    }
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const tick = async () => {
      if (stopped) return;
      try {
        if (video.readyState >= 2 && video.videoWidth) {
          let txt = null;
          if (det) {
            const r = await det.detect(video); if (r && r[0]) txt = r[0].rawValue;
          } else if (root.jsQR) {
            const w = Math.min(640, video.videoWidth), h = Math.round(video.videoHeight * w / video.videoWidth);
            canvas.width = w; canvas.height = h; ctx.drawImage(video, 0, 0, w, h);
            const img = ctx.getImageData(0, 0, w, h);
            const r = root.jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' }); if (r) txt = r.data;
          }
          if (txt && !stopped) { stop(); onResult(txt); return; }
        }
      } catch (e) { }
      setTimeout(tick, 160);
    };
    const stop = () => { stopped = true; video.srcObject = null; if (!keep) stopCamera(); };
    tick();
    return stop;
  }

  root.Net = { randCode, peerHost, peerJoin, rtcOffer, rtcAnswer, testHost, testJoin, qrSvg, scan, camera, stopCamera, encodeSdp, decodeSdp, PREFIX };
})(window);

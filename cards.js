/* WeSkat – Copyright (C) 2026 app-laden – GPL-3.0-or-later, siehe LICENSE */
/* Kartenbilder als SVG (französisches Blatt, wahlweise vierfarbig wie im Turnier) */
(function (root) {
  'use strict';
  const PIP = {
    h: 'M5 9.6C5 9.6 0 6 0 3.1A2.6 2.6 0 0 1 5 2A2.6 2.6 0 0 1 10 3.1C10 6 5 9.6 5 9.6Z',
    d: 'M5 0L9 5L5 10L1 5Z',
    s: 'M5 0C5 0 0 3.9 0 6.2A2.4 2.4 0 0 0 4.3 7.6L3.4 10H6.6L5.7 7.6A2.4 2.4 0 0 0 10 6.2C10 3.9 5 0 5 0Z',
    c: 'M5 0.2A2.35 2.35 0 0 0 3.2 4.1A2.35 2.35 0 1 0 4.4 7.6L3.4 10H6.6L5.6 7.6A2.35 2.35 0 1 0 6.8 4.1A2.35 2.35 0 0 0 5 0.2Z'
  };
  const COL4 = { c: '#151515', s: '#17803a', h: '#d3132a', d: '#e98a00' };
  const COL2 = { c: '#151515', s: '#151515', h: '#d3132a', d: '#d3132a' };
  const LABEL = { 7: '7', 8: '8', 9: '9', T: '10', J: 'B', Q: 'D', K: 'K', A: 'A' };
  const FACE_TINT = { c: '#eef0f4', s: '#e9f5ec', h: '#fdecee', d: '#fff3e0' };
  let four = true;
  const cache = new Map();

  function pip(s, x, y, size, col, flip) {
    const k = size / 10;
    const tr = flip ? `translate(${x + size / 2} ${y + size / 2}) rotate(180) translate(${-size / 2} ${-size / 2})` : `translate(${x} ${y})`;
    return `<g transform="${tr} scale(${k})"><path d="${PIP[s]}" fill="${col}"/></g>`;
  }
  const LAYOUT = {
    7: [[20, 20], [40, 20], [30, 32], [20, 45], [40, 45], [20, 70], [40, 70]],
    8: [[20, 20], [40, 20], [30, 32], [20, 45], [40, 45], [30, 58], [20, 70], [40, 70]],
    9: [[20, 20], [40, 20], [20, 37], [40, 37], [30, 45], [20, 53], [40, 53], [20, 70], [40, 70]],
    T: [[20, 20], [40, 20], [30, 29], [20, 37], [40, 37], [20, 53], [40, 53], [30, 61], [20, 70], [40, 70]]
  };
  function face(card) {
    const key = (four ? '4' : '2') + card;
    if (cache.has(key)) return cache.get(key);
    const s = card[0], r = card.slice(1), col = (four ? COL4 : COL2)[s];
    const lab = LABEL[r];
    let body = '';
    if (LAYOUT[r]) {
      for (const [x, y] of LAYOUT[r]) body += pip(s, x - 4.5, y - 4.5, 9, col, y > 46);
    } else if (r === 'A') {
      body += pip(s, 16, 31, 28, col, false);
    } else {
      // Bild: Rahmen, großer Buchstabe, Symbole, Krone
      body += `<rect x="13.5" y="13.5" width="33" height="63" rx="3" fill="${FACE_TINT[s]}" stroke="${col}" stroke-width="1.1"/>`;
      if (r === 'K' || r === 'Q') {
        const crown = r === 'K'
          ? 'M21 31L22.5 23L26 28L30 21L34 28L37.5 23L39 31Z'
          : 'M22 31Q24 24 26.5 28Q30 21 33.5 28Q36 24 38 31Z';
        body += `<path d="${crown}" fill="${col}" opacity=".9"/><rect x="21" y="31.6" width="18" height="2" rx="1" fill="${col}" opacity=".9"/>`;
      } else {
        body += `<path d="M24 31Q30 20 36 31Z" fill="${col}" opacity=".9"/><circle cx="30" cy="22.5" r="2" fill="${col}" opacity=".9"/>`;
      }
      body += `<text x="30" y="58" text-anchor="middle" font-size="24" font-weight="800" fill="${col}" font-family="Georgia,'Times New Roman',serif">${lab}</text>`;
      body += pip(s, 25, 62, 10, col, false);
    }
    const idx = (flip) => {
      const g = `<text x="0" y="0" text-anchor="middle" font-size="${lab.length > 1 ? 12.5 : 14.5}" font-weight="800" fill="${col}" font-family="-apple-system,Segoe UI,Roboto,Arial,sans-serif" letter-spacing="${lab.length > 1 ? -1 : 0}">${lab}</text>${pip(s, -4.2, 3, 8.4, col, false)}`;
      return flip ? `<g transform="translate(53.5 76) rotate(180)">${g}</g>` : `<g transform="translate(6.6 14)">${g}</g>`;
    };
    const svg = `<svg viewBox="0 0 60 90" xmlns="http://www.w3.org/2000/svg"><rect x=".5" y=".5" width="59" height="89" rx="5" fill="#fff" stroke="#b9b9b9"/>${body}${idx(false)}${idx(true)}</svg>`;
    cache.set(key, svg);
    return svg;
  }
  const BACK = `<svg viewBox="0 0 60 90" xmlns="http://www.w3.org/2000/svg"><defs><pattern id="bp" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="#1d3f8f"/><path d="M0 4H8M4 0V8" stroke="#3c63c4" stroke-width="1.4"/></pattern></defs><rect x=".5" y=".5" width="59" height="89" rx="5" fill="#fff" stroke="#9aa"/><rect x="4" y="4" width="52" height="82" rx="3" fill="url(#bp)"/><rect x="4" y="4" width="52" height="82" rx="3" fill="none" stroke="#c9a640" stroke-width="1"/><circle cx="30" cy="45" r="9" fill="#1d3f8f" stroke="#c9a640" stroke-width="1.2"/><path d="M30 39L34 45L30 51L26 45Z" fill="#c9a640"/></svg>`;
  const uri = svg => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  const urlCache = new Map();
  function faceUrl(card) {
    const key = (four ? '4' : '2') + card;
    if (!urlCache.has(key)) urlCache.set(key, uri(face(card)));
    return urlCache.get(key);
  }
  const BACK_URL = uri(BACK);
  function back() { return BACK; }
  function backUrl() { return BACK_URL; }
  function setFour(v) { four = !!v; }
  function color(s) { return (four ? COL4 : COL2)[s]; }
  function pipSvg(s, size) {
    return `<svg viewBox="0 0 10 10" width="${size}" height="${size}"><path d="${PIP[s]}" fill="${color(s)}"/></svg>`;
  }
  root.Cards = { face, back, faceUrl, backUrl, setFour, color, pipSvg, LABEL };
})(window);

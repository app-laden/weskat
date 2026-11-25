/* Skat – Oberfläche und Spielablauf zwischen den Handys */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const TEST = /[?&]test=1/.test(location.search);
  const LS = {
    get(k, d) { try { const v = localStorage.getItem('skat-' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('skat-' + k, JSON.stringify(v)); } catch (e) { } },
    del(k) { try { localStorage.removeItem('skat-' + k); } catch (e) { } }
  };
  const SS = TEST ? {
    get(k, d) { try { const v = sessionStorage.getItem('skat-' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { sessionStorage.setItem('skat-' + k, JSON.stringify(v)); } catch (e) { } },
    del(k) { try { sessionStorage.removeItem('skat-' + k); } catch (e) { } }
  } : LS;

  const me = { id: SS.get('id', null), name: SS.get('name', '') };
  if (!me.id) { me.id = Net.randCode(10); SS.set('id', me.id); }
  const prefs = Object.assign({ four: false, order: ['c', 's', 'h', 'd'], resort: true, oneTap: false, vibrate: true, conn: 'internet', size: 0 }, LS.get('prefs', {}));
  if (!prefs.v3) { prefs.four = false; prefs.v3 = 1; try { localStorage.setItem('skat-prefs', JSON.stringify(prefs)); } catch (e) { } }
  if (!Array.isArray(prefs.order) || prefs.order.length !== 4) prefs.order = prefs.order === 'alt' ? ['c', 'h', 's', 'd'] : ['c', 's', 'h', 'd'];
  Cards.setFour(prefs.four);
  const savePrefs = () => LS.set('prefs', prefs);

  const A = { screen: 'start', role: null, view: null, lobby: null };
  let H = null;  // Tisch (Host)
  let C = null;  // Mitspieler (Client)

  // ---------- kleine Helfer ----------
  let toastT;
  function toast(msg, ms) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('on');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), ms || 2600);
  }
  function vibrate(ms) { if (prefs.vibrate && navigator.vibrate) try { navigator.vibrate(ms); } catch (e) { } }
  const initial = n => (String(n || '?').trim()[0] || '?').toUpperCase();
  const signed = n => (n > 0 ? '+' : '') + n;
  const cls = n => n > 0 ? 'pos' : n < 0 ? 'neg' : '';
  function roleName(v, s) {
    const R = v.roles;
    return s === R.V ? 'Vorhand' : s === R.M ? 'Mittelhand' : 'Hinterhand · gibt';
  }
  function typeLabel(t) {
    return { c: 'Kreuz', s: 'Pik', h: 'Herz', d: 'Karo', grand: 'Grand', null: 'Null' }[t];
  }
  function mini(cards) { return '<span class="mini">' + cards.map(c => `<img src="${Cards.faceUrl(c)}" alt="">`).join('') + '</span>'; }

  // ---------- Overlay ----------
  function sheet(title, body, onOpen) {
    const ov = $('#ov');
    ov.innerHTML = `<div class="sheet"><div class="sh"><h2>${esc(title)}</h2><button class="iconbtn" data-close>✕</button></div><div class="sb">${body}</div></div>`;
    ov.classList.add('on');
    ov.onclick = e => { if (e.target === ov || e.target.closest('[data-close]')) closeSheet(); };
    if (onOpen) onOpen($('.sb', ov));
  }
  function closeSheet() { const ov = $('#ov'); ov.classList.remove('on'); ov.innerHTML = ''; if (ov._onclose) { const f = ov._onclose; ov._onclose = null; f(); } }

  // ======================================================================
  //  TISCH (Host)
  // ======================================================================
  function hostCreate(mode, resume) {
    H = {
      mode, code: resume ? resume.code : null, peer: null, status: '',
      players: resume ? resume.players.map(p => Object.assign({}, p, { local: p.id === me.id, online: p.id === me.id || !!p.bot, link: null })) : [{ id: me.id, name: me.name, local: true, online: true }],
      seats: resume ? resume.seats : null,
      match: resume ? resume.match : null,
      rules: Object.assign({}, Skat.DEFAULT_RULES, LS.get('rules', {})),
      firstDealer: 'random', pair: null
    };
    if (resume && resume.rules) H.rules = resume.rules;
    A.role = 'host'; C = null;
    if (mode === 'demo') {
      H.code = 'DEMO';
      H.players.push({ id: 'bot1', name: 'Lisa (PC)', bot: true, online: true }, { id: 'bot2', name: 'Max (PC)', bot: true, online: true });
      hostStartMatch();
      return;
    }
    if (mode === 'test') { H.code = 'TEST'; H.peer = Net.testHost({ onLink: hostOnLink }); }
    else if (mode === 'internet') hostOpenPeer(H.code || Net.randCode());
    A.screen = H.match ? 'game' : 'hostLobby';
    hostBroadcast();
  }
  function hostOpenPeer(code) {
    H.code = code; H.status = 'Verbinde mit Vermittlungsdienst …';
    if (H.peer) try { H.peer.destroy(); } catch (e) { }
    H.peer = Net.peerHost(code, {
      onOpen: () => { H.status = ''; render(); },
      onLink: hostOnLink,
      onError: e => {
        if (!H) return;
        if (e.type === 'unavailable-id') {
          if (H.match) { H.status = 'Code noch belegt – versuche erneut …'; setTimeout(() => H && hostOpenPeer(code), 4000); }
          else hostOpenPeer(Net.randCode());
        } else if (e.type === 'nolib') H.status = 'Verbindungsbibliothek fehlt';
        else if (e.type === 'peer-unavailable') { /* betrifft nur ausgehende Verbindungen */ }
        else {
          H.status = 'Keine Verbindung zum Vermittlungsdienst – neuer Versuch …';
          setTimeout(() => { if (H && H.peer && (H.peer.destroyed || H.peer.disconnected)) hostOpenPeer(H.code); }, 4000);
        }
        render();
      }
    });
  }
  function hostOnLink(L) {
    L.onmsg = m => hostMsg(L, m);
    L.onclose = () => {
      if (!H) return;
      const p = H.players.find(x => x.link === L);
      if (p) { p.link = null; p.online = false; hostBroadcast(); }
    };
  }
  const seatOf = id => H.seats ? H.seats.indexOf(id) : -1;
  function hostMsg(L, m) {
    if (!H || !m) return;
    const p = H.players.find(x => x.link === L);
    if (p) p.last = Date.now();
    switch (m.t) {
      case 'hello': {
        let q = H.players.find(x => x.id === m.id);
        if (!q) {
          if (H.match || H.players.length >= 3) { L.send({ t: 'full' }); return; }
          q = { id: m.id, name: m.name || 'Spieler' }; H.players.push(q);
        }
        if (q.local) { L.send({ t: 'full' }); return; }
        if (q.link && q.link !== L) { const old = q.link; old.onclose = null; try { old.close(); } catch (e) { } }
        q.link = L; q.online = true; q.last = Date.now();
        if (m.name) q.name = m.name;
        if (H.match) H.match.names[seatOf(q.id)] = q.name;
        if (H.pair && H.pair.waitLink === L) H.pair = null;
        hostBroadcast();
        if (A.screen === 'hostLobby' || A.screen === 'game') toast(q.name + ' ist verbunden');
        break;
      }
      case 'act': {
        if (!p || !H.match) return;
        const r = Skat.act(H.match, seatOf(p.id), m.a);
        if (r.error) L.send({ t: 'err', msg: r.error }); else hostBroadcast();
        break;
      }
      case 'ping': L.send({ t: 'pong' }); break;
    }
  }
  function lobbyInfo() {
    return {
      code: H.code, mode: H.mode, started: !!H.match, rules: H.rules,
      players: H.players.map(p => ({ id: p.id, name: p.name, online: !!(p.local || p.online || p.bot), host: !!p.local, bot: !!p.bot }))
    };
  }
  function hostSave() {
    if (!H || H.mode === 'test' || H.mode === 'demo') return;
    LS.set('host', { mode: H.mode, code: H.code, players: H.players.map(p => ({ id: p.id, name: p.name, bot: !!p.bot })), seats: H.seats, match: H.match, rules: H.rules, t: Date.now() });
  }
  function hostBroadcast() {
    if (!H) return;
    hostSave();
    const lobby = lobbyInfo();
    for (const p of H.players) {
      if (p.local) continue;
      if (!p.link) continue;
      if (H.match) p.link.send({ t: 'view', v: Skat.view(H.match, seatOf(p.id)), lobby });
      else p.link.send({ t: 'lobby', lobby });
    }
    A.lobby = lobby;
    A.view = H.match ? Skat.view(H.match, seatOf(me.id)) : null;
    if (H.match && A.screen !== 'game') A.screen = 'game';
    render();
    scheduleBots();
  }
  // Computer-Spieler im Demo-Modus
  function scheduleBots() {
    if (!H || !H.match || !H.players.some(p => p.bot)) return;
    clearTimeout(H.botT);
    const m = H.match, g = m.g;
    const bots = H.players.map((p, i) => p.bot ? seatOf(p.id) : -1).filter(s => s >= 0);
    const seat = bots.find(s => Skat.botAction(m, s));
    if (seat == null) return;
    let delay = 900;
    if (g.phase === 'play') delay = g.trick.length === 0 && g.tricks.length ? 1900 : 750;
    if (g.phase === 'done') delay = 400;
    if (g.phase === 'discard' || g.phase === 'declare') delay = 1100;
    H.botT = setTimeout(() => {
      if (!H || H.match !== m) return;
      const a = Skat.botAction(m, seat);
      if (!a) return;
      const r = Skat.act(m, seat, a);
      if (!r.error) hostBroadcast();
    }, delay);
  }
  function hostStartMatch() {
    if (H.players.length !== 3) return;
    H.seats = H.players.map(p => p.id);
    const fd = H.firstDealer === 'random' ? null : +H.firstDealer;
    H.match = Skat.newMatch(H.players.map(p => p.name), H.rules, fd);
    Skat.startGame(H.match);
    A.screen = 'game';
    hostBroadcast();
  }
  function hostEnd() {
    if (H) clearTimeout(H.botT);
    if (H && H.mode === 'demo') H.match = null;
    if (H) {
      for (const p of H.players) if (p.link) { try { p.link.send({ t: 'bye' }); } catch (e) { } }
      setTimeout(() => {
        if (!H) return;
        for (const p of H.players) if (p.link) try { p.link.close(); } catch (e) { }
        try { H.peer && H.peer.destroy && H.peer.destroy(); } catch (e) { }
        H = null;
      }, 300);
    }
    LS.del('host'); Net.stopCamera();
    A.role = null; A.view = null; A.screen = 'start'; resetTable(); render();
  }

  // Offline: Mitspieler per QR koppeln
  async function hostPair() {
    if (!H) return;
    try { await Net.camera(); } catch (e) { toast('Kamera wird zum Koppeln benötigt'); }
    let o;
    try { o = await Net.rtcOffer(); } catch (e) { toast('Verbindung konnte nicht vorbereitet werden'); return; }
    H.pair = { stage: 'offer', o };
    o.opened.then(L => {
      hostOnLink(L); H.pair = { stage: 'wait', waitLink: L };
      setTimeout(() => { if (H && H.pair && H.pair.waitLink === L) { H.pair = null; render(); } }, 4000);
      if (H.players.length >= 3 && H.players.every(p => p.local || p.online)) Net.stopCamera();
      closeSheetIfPair(); render();
    }).catch(() => { if (H && H.pair && H.pair.o === o) { H.pair = null; toast('Koppeln abgelaufen – bitte neu starten'); closeSheetIfPair(); render(); } });
    showPairSheet();
  }
  function closeSheetIfPair() { if ($('#ov .pairsheet')) closeSheet(); }
  function showPairSheet() {
    if (!H || !H.pair) return;
    const pr = H.pair;
    sheet('Mitspieler koppeln', `<div class="pairsheet">
      <p><b>1.</b> Mitspieler wählt „Platz nehmen“ → <i>Ohne Netz</i> und scannt diesen Code:</p>
      <div class="qr">${Net.qrSvg(pr.o.code, 'L')}</div>
      <p><b>2.</b> Dann zeigt sein Handy einen Antwort-Code. Den hier scannen:</p>
      <video class="scan" id="pv" playsinline muted style="display:none"></video>
      <button class="btn pri" id="pscan">Antwort scannen</button>
      <p class="hint">Alle Handys müssen im selben Hotspot sein (WLAN des Tisch-Handys).</p></div>`, sb => {
      let stop = null;
      $('#ov')._onclose = () => { if (stop) stop(); };
      $('#pscan', sb).onclick = async () => {
        const vid = $('#pv', sb); vid.style.display = 'block'; $('#pscan', sb).style.display = 'none';
        try {
          stop = await Net.scan(vid, async txt => {
            vid.style.display = 'none';
            $('#pscan', sb).style.display = 'block'; $('#pscan', sb).textContent = 'Verbinde …'; $('#pscan', sb).disabled = true;
            try { await pr.o.accept(txt); } catch (e) { toast('Das war kein passender Antwort-Code'); $('#pscan', sb).disabled = false; $('#pscan', sb).textContent = 'Antwort scannen'; }
          }, true);
        } catch (e) { toast('Kamera nicht verfügbar'); }
      };
    });
  }

  // Herzschlag (merkt Verbindungsabbrüche)
  setInterval(() => {
    const now = Date.now();
    if (H) {
      let ch = false;
      for (const p of H.players) {
        if (p.local || !p.link) continue;
        p.link.send({ t: 'ping' });
        if (p.online && p.last && now - p.last > 14000) { p.online = false; ch = true; }
        else if (!p.online && p.last && now - p.last < 6000) { p.online = true; ch = true; }
      }
      if (ch) hostBroadcast();
    }
    if (C && C.link) {
      C.link.send({ t: 'ping' });
      if (C.last && now - C.last > 14000 && C.status === 'ok') { C.status = 'lost'; render(); if (C.mode === 'internet') clientReconnect(); }
    }
  }, 4000);

  // ======================================================================
  //  MITSPIELER (Client)
  // ======================================================================
  function clientStart(mode, code) {
    if (C && C.peer) try { C.peer.destroy(); } catch (e) { }
    C = { mode, code, link: null, status: 'connecting', peer: null, last: 0, tries: 0 };
    A.role = 'client'; H = null;
    if (mode === 'internet' || mode === 'test') { A.screen = 'clientWait'; clientConnect(); LS.set('client', { mode, code, t: Date.now() }); }
    else A.screen = 'joinOffline';
    render();
  }
  function clientConnect() {
    if (!C) return;
    C.status = 'connecting';
    if (C.peer) try { C.peer.destroy(); } catch (e) { }
    if (C.mode === 'test') { C.peer = Net.testJoin({ onLink: clientAttach }); return; }
    C.peer = Net.peerJoin(C.code, {
      onLink: clientAttach,
      onError: e => {
        if (!C) return;
        C.tries++;
        C.status = e.type === 'peer-unavailable' ? 'notfound' : e.type === 'nolib' ? 'nolib' : 'neterr';
        render();
        clearTimeout(C.retryT);
        C.retryT = setTimeout(() => { if (C && !C.link) clientConnect(); }, 3500);
      }
    });
    clearTimeout(C.connT);
    C.connT = setTimeout(() => { if (C && !C.link && C.status === 'connecting') { C.status = 'slow'; render(); clientConnect(); } }, 15000);
  }
  function clientReconnect() {
    if (!C) return;
    if (C.link) { const L = C.link; L.onclose = null; try { L.close(); } catch (e) { } C.link = null; }
    if (C.mode === 'internet' || C.mode === 'test') { clearTimeout(C.retryT); C.retryT = setTimeout(clientConnect, 800); }
    render();
  }
  function clientAttach(L) {
    if (!C) return;
    C.link = L; C.status = 'ok'; C.last = Date.now(); C.tries = 0;
    L.onmsg = clientMsg;
    L.onclose = () => { if (!C || C.link !== L) return; C.link = null; C.status = 'lost'; render(); if (C.mode !== 'offline') { clearTimeout(C.retryT); C.retryT = setTimeout(clientConnect, 1500); } };
    L.send({ t: 'hello', id: me.id, name: me.name });
    render();
  }
  function clientMsg(m) {
    if (!C || !m) return;
    C.last = Date.now();
    if (C.status !== 'ok') { C.status = 'ok'; }
    switch (m.t) {
      case 'lobby': A.lobby = m.lobby; A.view = null; A.screen = 'clientLobby'; render(); break;
      case 'view': A.lobby = m.lobby; A.view = m.v; A.screen = 'game'; render(); break;
      case 'err': toast(m.msg); clearPending(); break;
      case 'full': toast('Der Tisch ist schon voll'); clientLeave(); break;
      case 'bye': toast('Der Tisch wurde beendet'); clientLeave(); break;
      case 'ping': C.link && C.link.send({ t: 'pong' }); break;
    }
  }
  function clientLeave() {
    if (C) { clearTimeout(C.retryT); clearTimeout(C.connT); if (C.link) { C.link.onclose = null; try { C.link.close(); } catch (e) { } } if (C.peer) try { C.peer.destroy(); } catch (e) { } }
    C = null; LS.del('client'); Net.stopCamera();
    A.role = null; A.view = null; A.screen = 'start'; resetTable(); render();
  }

  // Aktion senden
  function act(a) {
    if (A.role === 'host' && H && H.match) {
      const r = Skat.act(H.match, seatOf(me.id), a);
      if (r.error) { toast(r.error); clearPending(); } else hostBroadcast();
    } else if (C && C.link) C.link.send({ t: 'act', a });
    else { toast('Keine Verbindung zum Tisch'); clearPending(); }
  }

  // ======================================================================
  //  SEITEN außerhalb des Spiels
  // ======================================================================
  function render() {
    const app = $('#app');
    if (A.screen === 'game' && A.view) { renderTable(A.view); return; }
    if (app.dataset.screen === 'game') resetTable();
    const fn = PAGES[A.screen] || PAGES.start;
    app.dataset.screen = A.screen;
    const html = fn();
    if (app._html !== html) {
      const active = document.activeElement && document.activeElement.id;
      const val = active && document.activeElement.value;
      app.innerHTML = html; app._html = html;
      if (active && $('#' + active)) { const el = $('#' + active); if (val != null) el.value = val; el.focus(); }
      bindPage(A.screen);
    }
  }
  function logo() {
    const cs = ['cJ', 'sA', 'hT'];
    return `<div class="logo"><div class="fan">${cs.map((c, i) => `<img src="${Cards.faceUrl(c)}" style="transform:rotate(${(i - 1) * 18}deg)">`).join('')}</div><h1>WeSkat</h1></div>`;
  }
  function connSeg() {
    const o = [['internet', 'Mit Internet'], ['hotspot', 'Hotspot mit Netz'], ['offline', 'Ohne Netz']];
    return `<div class="seg" id="conn">${o.map(([k, t]) => `<button data-k="${k}" class="${prefs.conn === k ? 'on' : ''}">${t}</button>`).join('')}</div>
      <p class="hint">${{
      internet: 'Jeder nutzt seine eigene Internetverbindung (mobile Daten). Kein gemeinsames WLAN nötig.',
      hotspot: 'Ein Handy macht einen Hotspot auf, die anderen verbinden sich damit und haben darüber Internet. Spielt sich dann wie „Mit Internet“.',
      offline: 'Kein Netz: Ein Handy macht einen Hotspot auf, die anderen verbinden sich damit. Gekoppelt wird per QR-Code in beide Richtungen.'
    }[prefs.conn]}</p>`;
  }
  const PAGES = {
    start() {
      const res = LS.get('host', null);
      const resOk = res && res.t && Date.now() - res.t < 3 * 86400e3 && res.mode !== 'offline';
      const cl = LS.get('client', null);
      const clOk = cl && cl.t && Date.now() - cl.t < 86400e3 && cl.mode === 'internet';
      return `<div class="page">${logo()}<p class="sub">Zu dritt am Tisch – jeder mit seinem Handy</p>
        <div class="card-box"><label class="lbl" for="nm">Dein Name</label><input class="inp" id="nm" maxlength="14" value="${esc(me.name)}" placeholder="z. B. Anna" autocomplete="off"></div>
        <div class="card-box"><h2>Verbindung</h2>${connSeg()}</div>
        <button class="btn pri" id="bHost">Tisch eröffnen</button>
        <button class="btn" id="bJoin">Am Tisch Platz nehmen</button>
        <button class="btn" id="bDemo">Demo: allein gegen den Computer</button>
        ${resOk ? `<button class="btn" id="bResume">Tisch ${esc(res.code)} fortsetzen${res.match ? ' (Spiel ' + res.match.gameNo + ')' : ''}</button>` : ''}
        ${clOk ? `<button class="btn" id="bRejoin">Wieder an Tisch ${esc(cl.code)} setzen</button>` : ''}
        <div class="row" style="margin-top:6px"><button class="btn small" id="bRules">Regeln</button><button class="btn small" id="bLook">Darstellung</button><button class="btn small" id="bHelp">Hilfe</button></div>
        <div class="foot">Version ${VERSION} · <a href="#" id="bAbout">Über diese App</a></div></div>`;
    },
    hostLobby() {
      const L = A.lobby || lobbyInfo();
      const n = H.players.length;
      let top = '';
      if (H.mode === 'internet' || H.mode === 'test') {
        const url = location.origin + location.pathname + '#t=' + H.code;
        top = `<div class="card-box" style="text-align:center"><h2>Tisch-Code</h2><div class="bigcode">${esc(H.code || '…')}</div>
          ${H.code && H.mode !== 'test' ? `<div class="qr">${Net.qrSvg(url, 'M')}</div>` : ''}
          <p class="hint">Mitspieler: „Am Tisch Platz nehmen“, Code eingeben oder QR-Code scannen (auch mit der normalen Kamera-App).</p>
          <div class="status">${esc(H.status)}</div></div>`;
      } else {
        top = `<div class="card-box"><h2>Ohne Netz koppeln</h2>
          <p class="hint" style="margin-top:0">1. Hotspot auf diesem Handy einschalten. 2. Die beiden anderen verbinden sich mit dem Hotspot (WLAN). 3. Für jeden Mitspieler „Mitspieler koppeln“ tippen.</p>
          ${n < 3 ? `<button class="btn pri" id="bPair">Mitspieler koppeln (${n}/3)</button>` : ''}</div>`;
      }
      return `<div class="page">${top}
        <div class="card-box"><h2>Sitzordnung (im Uhrzeigersinn)</h2><ul class="plist">
        ${L.players.map((p, i) => `<li><span class="dot ${p.online ? '' : 'off'}"></span><span class="nm">${esc(p.name)}${p.host ? ' <small style="color:var(--dim)">(Tisch)</small>' : ''}</span>
          <button class="iconbtn" data-up="${i}" ${i === 0 ? 'disabled style="opacity:.3"' : ''}>▲</button>
          ${!p.host ? `<button class="iconbtn" data-kick="${i}">✕</button>` : ''}</li>`).join('')}
        ${[...Array(3 - n)].map(() => '<li><span class="dot off"></span><span class="nm" style="color:var(--dim)">wartet …</span></li>').join('')}
        </ul>
        ${n < 3 ? `<button class="btn small" id="bBot" style="margin-top:10px">+ Computer als Mitspieler</button><p class="hint" style="margin-top:4px">Für ein Spiel zu zweit: Der Computer übernimmt den dritten Platz. Mit ✕ wieder entfernen.</p>` : ''}
        <label class="lbl" style="margin-top:12px">Wer gibt zuerst?</label>
        <select class="inp" id="fd" style="font-size:16px;padding:10px"><option value="random">Zufall</option>${L.players.map((p, i) => `<option value="${i}" ${H.firstDealer == i ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
        <button class="btn" id="bRules">Regeln: ${esc(rulesSummary(H.rules))}</button>
        <button class="btn pri" id="bStart" ${n === 3 && L.players.every(p => p.online) ? '' : 'disabled'}>Spiel starten</button>
        <button class="btn" id="bEnd">Tisch schließen</button></div>`;
    },
    join() {
      const hc = (location.hash.match(/t=([A-Za-z0-9]{4})/) || [])[1] || '';
      return `<div class="page">${logo()}
        <div class="card-box"><label class="lbl" for="nm">Dein Name</label><input class="inp" id="nm" maxlength="14" value="${esc(me.name)}" placeholder="z. B. Anna" autocomplete="off"></div>
        <div class="card-box"><h2>Tisch-Code eingeben</h2><input class="inp code" id="code" maxlength="4" value="${esc(hc.toUpperCase())}" autocomplete="off" autocapitalize="characters" spellcheck="false">
        <button class="btn pri" id="bGo">Platz nehmen</button>
        <button class="btn" id="bScan">QR-Code scannen</button>
        <video class="scan" id="vid" playsinline muted style="display:none"></video></div>
        <button class="btn" id="bBack">Zurück</button></div>`;
    },
    joinOffline() {
      const st = C && C.offStage || 'scan';
      let body;
      if (st === 'answer') body = `<p><b>2.</b> Jetzt diesen Code mit dem Tisch-Handy scannen lassen:</p><div class="qr">${Net.qrSvg(C.answer, 'L')}</div><p class="status">Warte auf Verbindung …</p>`;
      else body = `<p><b>1.</b> Mit dem Hotspot des Tisch-Handys verbinden. Dann den Code scannen, den das Tisch-Handy zeigt:</p>
        <video class="scan" id="vid" playsinline muted></video><p class="status" id="st">Kamera startet …</p>`;
      return `<div class="page">${logo()}<div class="card-box"><h2>Ohne Netz koppeln</h2>${body}</div><button class="btn" id="bBack">Abbrechen</button></div>`;
    },
    clientWait() {
      const st = C ? C.status : '';
      const msg = { connecting: 'Verbinde mit Tisch ' + (C && C.code) + ' …', slow: 'Dauert länger … neuer Versuch', notfound: 'Tisch ' + (C && C.code) + ' nicht gefunden – Code richtig? Neuer Versuch …', neterr: 'Keine Internetverbindung? Neuer Versuch …', nolib: 'Verbindungsbibliothek fehlt', lost: 'Verbindung verloren – verbinde neu …', ok: 'Verbunden' }[st] || '';
      return `<div class="page">${logo()}<div class="card-box" style="text-align:center"><h2>Tisch ${esc(C && C.code)}</h2><p class="status">${esc(msg)}</p></div><button class="btn" id="bBack">Abbrechen</button></div>`;
    },
    clientLobby() {
      const L = A.lobby;
      return `<div class="page">${logo()}<div class="card-box"><h2>Am Tisch ${esc(L.code || '')}</h2><ul class="plist">
        ${L.players.map(p => `<li><span class="dot ${p.online ? '' : 'off'}"></span><span class="nm">${esc(p.name)}${p.id === me.id ? ' <small style="color:var(--gold)">(du)</small>' : ''}${p.host ? ' <small style="color:var(--dim)">(Tisch)</small>' : ''}</span></li>`).join('')}
        </ul><p class="status">${C && C.status !== 'ok' ? 'Verbindung unterbrochen …' : 'Warte, bis der Tisch das Spiel startet …'}</p></div>
        <button class="btn" id="bRules">Regeln ansehen</button>
        <button class="btn" id="bBack">Tisch verlassen</button></div>`;
    }
  };
  function rulesSummary(r) {
    const a = [];
    a.push(r.scoring === 'seeger' ? 'Seeger-Fabian' : 'einfache Liste');
    if (r.kontra) a.push('Kontra/Re');
    if (r.bock) a.push('Bock');
    if (r.ramsch) a.push(r.schieben ? 'Schieberamsch' : 'Ramsch');
    return a.join(', ');
  }
  let scanStop = null;
  function stopScan() { if (scanStop) { scanStop(); scanStop = null; } }
  function bindPage(screen) {
    const on = (id, fn) => { const el = $('#' + id); if (el) el.onclick = fn; };
    const nameOk = () => {
      const el = $('#nm'); if (el) { me.name = el.value.trim(); SS.set('name', me.name); }
      if (!me.name) { toast('Bitte zuerst deinen Namen eingeben'); $('#nm') && $('#nm').focus(); return false; }
      return true;
    };
    if (screen === 'start') {
      $('#nm').oninput = e => { me.name = e.target.value.trim(); SS.set('name', me.name); };
      $('#conn').onclick = e => { const b = e.target.closest('button'); if (!b) return; prefs.conn = b.dataset.k; savePrefs(); render(); };
      on('bHost', () => { if (!nameOk()) return; hostCreate(TEST ? 'test' : prefs.conn === 'offline' ? 'offline' : 'internet'); });
      on('bJoin', () => {
        if (!nameOk()) return;
        if (TEST) { clientStart('test', 'TEST'); return; }
        if (prefs.conn === 'offline') clientStart('offline'); else { A.screen = 'join'; render(); }
      });
      on('bDemo', () => { if (!me.name) { me.name = 'Ich'; } hostCreate('demo'); });
      on('bResume', () => { if (!nameOk()) return; const r = LS.get('host'); hostCreate(r.mode, r); });
      on('bRejoin', () => { if (!nameOk()) return; const c = LS.get('client'); clientStart(c.mode, c.code); });
      on('bRules', showRules); on('bLook', showLook); on('bHelp', () => showHelp()); on('bAbout', e => { e.preventDefault(); showHelp('about'); });
    }
    if (screen === 'hostLobby') {
      on('bPair', hostPair);
      on('bBot', () => {
        if (H.players.length >= 3) return;
        const used = H.players.map(p => p.name);
        const name = ['Lisa (PC)', 'Max (PC)'].find(x => !used.includes(x)) || 'PC';
        H.players.push({ id: 'bot-' + Net.randCode(6), name, bot: true, online: true });
        hostBroadcast();
      });
      on('bStart', hostStartMatch);
      on('bEnd', () => { if (confirm('Tisch schließen?')) hostEnd(); });
      on('bRules', showRules);
      $('#fd').onchange = e => { H.firstDealer = e.target.value; };
      $('#app').querySelectorAll('[data-up]').forEach(b => b.onclick = () => {
        const i = +b.dataset.up; if (i < 1) return; const p = H.players; [p[i - 1], p[i]] = [p[i], p[i - 1]]; hostBroadcast();
      });
      $('#app').querySelectorAll('[data-kick]').forEach(b => b.onclick = () => {
        const i = +b.dataset.kick; const p = H.players[i]; if (!p || p.local) return;
        if (p.link) { try { p.link.send({ t: 'full' }); } catch (e) { } const L = p.link; L.onclose = null; setTimeout(() => { try { L.close(); } catch (e) { } }, 200); }
        H.players.splice(i, 1); hostBroadcast();
      });
    }
    if (screen === 'join') {
      $('#nm').oninput = e => { me.name = e.target.value.trim(); SS.set('name', me.name); };
      const go = () => {
        if (!nameOk()) return;
        const code = $('#code').value.trim().toUpperCase();
        if (!/^[A-Z0-9]{4}$/.test(code)) { toast('Der Code hat 4 Zeichen'); return; }
        stopScan(); history.replaceState(null, '', location.pathname + location.search);
        clientStart('internet', code);
      };
      on('bGo', go);
      $('#code').onkeydown = e => { if (e.key === 'Enter') go(); };
      on('bScan', async () => {
        const v = $('#vid'); v.style.display = 'block';
        try {
          scanStop = await Net.scan(v, txt => {
            scanStop = null;
            const m = txt.match(/#t=([A-Za-z0-9]{4})/) || txt.match(/^([A-Za-z0-9]{4})$/);
            if (m) { $('#code').value = m[1].toUpperCase(); go(); }
            else { toast('Das ist kein Tisch-Code'); v.style.display = 'none'; }
          });
        } catch (e) { toast('Kamera nicht verfügbar'); v.style.display = 'none'; }
      });
      on('bBack', () => { stopScan(); A.screen = 'start'; render(); });
    }
    if (screen === 'joinOffline') {
      on('bBack', () => { stopScan(); clientLeave(); });
      const v = $('#vid');
      if (v && !scanStop) {
        Net.scan(v, async txt => {
          scanStop = null;
          if (!/^S1\|o\|/.test(txt)) { toast('Das ist kein Tisch-Code (Ohne Netz)'); C.offStage = 'scan'; A.screen = 'joinOffline'; $('#app')._html = ''; render(); return; }
          try {
            const ans = await Net.rtcAnswer(txt);
            C.answer = ans.code; C.offStage = 'answer'; render();
            ans.opened.then(L => { Net.stopCamera(); C.offStage = null; clientAttach(L); })
              .catch(() => { Net.stopCamera(); toast('Keine Verbindung – gleiche Hotspot? Bitte neu versuchen'); C.offStage = 'scan'; $('#app')._html = ''; render(); });
          } catch (e) { toast('Code nicht lesbar – bitte neu scannen'); C.offStage = 'scan'; $('#app')._html = ''; render(); }
        }, true).then(s => { scanStop = s; const st = $('#st'); if (st) st.textContent = 'Code vor die Kamera halten'; })
          .catch(() => { const st = $('#st'); if (st) st.textContent = 'Kamera nicht verfügbar – Zugriff erlauben'; });
      }
    }
    if (screen === 'clientWait') on('bBack', clientLeave);
    if (screen === 'clientLobby') { on('bBack', clientLeave); on('bRules', showRules); }
  }

  // ======================================================================
  //  SPIELTISCH
  // ======================================================================
  const T = {
    built: false, el: {}, hand: new Map(), trick: new Map(), handRects: {}, sel: new Set(),
    lastTrickN: null, showLast: null, collectT: null, panelSig: '', prev: null, bubbles: {}, decl: null,
    resultAt: 0, gameNo: null, pending: null, geom: null, skatEls: []
  };
  function resetTable() {
    const app = $('#app'); if (app.dataset.screen === 'game') { app.innerHTML = ''; app._html = ''; }
    T.built = false; T.hand.clear(); T.trick.clear(); T.sel.clear(); T.prev = null; T.panelSig = ''; T.lastTrickN = null; T.showLast = null; T.skatEls = [];
    releaseWake();
  }
  function buildTable() {
    const app = $('#app');
    app.dataset.screen = 'game'; app._html = '';
    app.innerHTML = `<div id="table">
      <div class="tbar"><button class="iconbtn" id="tMenu">☰</button><div class="tinfo" id="tInfo"></div><button class="iconbtn" id="tSize" title="Kartengröße" style="width:auto;padding:0 8px;font-weight:800;line-height:1"><span style="font-size:11px">A</span><span style="font-size:18px">A</span></button><button class="iconbtn" id="tList" style="width:auto;padding:0 10px;font-size:14px;font-weight:700">Liste</button></div>
      <div class="conn" id="tConn"></div>
      <div class="plate left" id="pl-left"></div><div class="plate right" id="pl-right"></div><div class="plate me" id="pl-me"></div>
      <div class="backs" id="bk-left"></div><div class="backs" id="bk-right"></div>
      <div class="openc" id="oc-left"></div><div class="openc" id="oc-right"></div>
      <div id="panel"></div><div id="kbtn"></div>
      <div id="hand"></div></div>`;
    T.el = { table: $('#table'), info: $('#tInfo'), hand: $('#hand'), panel: $('#panel'), conn: $('#tConn') };
    ['left', 'right', 'me'].forEach(p => T.el['pl-' + p] = $('#pl-' + p));
    ['left', 'right'].forEach(p => { T.el['bk-' + p] = $('#bk-' + p); T.el['oc-' + p] = $('#oc-' + p); });
    T.el.table.addEventListener('scroll', () => { T.el.table.scrollTop = 0; T.el.table.scrollLeft = 0; });
    $('#tMenu').onclick = showMenu;
    $('#tList').onclick = showList;
    $('#tSize').onclick = () => { setSize((prefs.size || 0) + 1); toast('Kartengröße: ' + SIZES[prefs.size], 1200); };
    bindHand();
    T.built = true;
    requestWake();
  }
  const posOf = (v, s) => s === v.seat ? 'me' : s === (v.seat + 1) % 3 ? 'left' : 'right';
  const seatAt = (v, p) => p === 'me' ? v.seat : p === 'left' ? (v.seat + 1) % 3 : (v.seat + 2) % 3;

  function geometry() {
    const r = T.el.table.getBoundingClientRect();
    const W = r.width, Hh = r.height, land = W > Hh * 1.15;
    let cw, tw, ow;
    if (land) { cw = Math.max(46, Math.min(104, Hh / 5.1, W / 10.5)); tw = Math.max(46, Math.min(108, Hh / 5.3)); ow = Math.max(20, Math.min(40, Hh / 13)); }
    else { cw = Math.max(50, Math.min(112, W / 5.3, Hh / 7.4)); tw = Math.max(54, Math.min(126, W / 3.9, Hh / 7)); ow = Math.max(22, Math.min(44, W / 11)); }
    // Kartengröße (Darstellung): 0 = normal, 1 = groß, 2 = sehr groß
    const f = [1, 1.2, 1.4][prefs.size] || 1;
    cw = land ? Math.min(cw * f, Hh / 3.6) : Math.min(cw * f, W / 3.7, Hh / 5.6);
    tw = tw * f;
    {
      const handTop0 = Hh - (cw * 1.5 + cw * 0.55 + 6);
      const fanB = 50 + 52 + ow * 1.6;
      const room = land ? (handTop0 - 50 - 8) / 1.15 : (handTop0 - 50 - fanB) / 1.3;
      tw = Math.max(46, Math.min(tw, room / 1.5));
    }
    const ch = cw * 1.5;
    const handH = ch + cw * 0.55 + 6;
    const top = 50;
    const g = { W, H: Hh, land, cw, ch, tw, th: tw * 1.5, ow, handH, top };
    // Gegner
    g.plate = { left: { x: 8, y: top }, right: { x: W - 8, y: top } };
    g.fan = land
      ? { left: { x: 8 + ow * 1.6, y: top + 52 }, right: { x: W - 8 - ow * 1.6, y: top + 52 } }
      : { left: { x: W * 0.24, y: top + 52 }, right: { x: W * 0.76, y: top + 52 } };
    // Mitte (Stich)
    const fanBottom = top + 52 + ow * 1.6;
    const handTop = Hh - handH;
    g.cx = W / 2;
    g.cy = land ? (top + handTop) / 2 + 6 : Math.max(fanBottom + g.th * 0.7, (fanBottom + handTop - 50) / 2 + 8);
    g.mePlate = { x: 8, y: land ? Math.max(fanBottom + 6, handTop - 40) : handTop - 46 };
    g.panelBottom = land ? handH - 6 : handH + 50;
    return g;
  }
  function applyGeometry() {
    const g = T.geom = geometry();
    const st = T.el.table.style;
    st.setProperty('--cw', g.cw + 'px'); st.setProperty('--tw', g.tw + 'px'); st.setProperty('--ow', g.ow + 'px');
    const pl = T.el['pl-left'], pr = T.el['pl-right'], pm = T.el['pl-me'];
    pl.style.left = g.plate.left.x + 'px'; pl.style.top = g.plate.left.y + 'px';
    pr.style.right = (g.W - g.plate.right.x) + 'px'; pr.style.top = g.plate.right.y + 'px';
    pm.style.left = g.mePlate.x + 'px'; pm.style.top = g.mePlate.y + 'px';
    for (const p of ['left', 'right']) {
      const b = T.el['bk-' + p]; b.style.left = (g.fan[p].x - g.ow / 2) + 'px'; b.style.top = g.fan[p].y + 'px'; b.style.width = g.ow + 'px';
      const o = T.el['oc-' + p];
      o.style.top = (g.fan[p].y - 4) + 'px';
      if (p === 'left') { o.style.left = '8px'; o.style.right = ''; } else { o.style.right = '8px'; o.style.left = ''; }
    }
    T.el.hand.style.height = g.handH + 'px';
    T.el.panel.style.bottom = g.panelBottom + 'px';
  }

  function renderTable(v) {
    if (!T.built) buildTable();
    if (!T.geom || T.resized) { applyGeometry(); T.resized = false; }
    const prev = T.prev;
    if (T.gameNo !== v.gameNo) {
      // neues Spiel
      T.gameNo = v.gameNo; T.sel.clear(); T.decl = null; T.lastTrickN = v.lastTrick ? v.lastTrick.n : null; T.showLast = null; T.resultAt = 0;
      clearTimeout(T.collectT);
      for (const el of T.trick.values()) el.remove(); T.trick.clear();
      T.panelSig = '';
    }
    if (prev && prev.phase !== v.phase) { T.sel.clear(); if (v.phase !== 'declare') T.decl = null; }
    // Hinweise / Ereignisse
    if (prev && prev.gameNo === v.gameNo) {
      if (!prev.kontra.k && v.kontra.k) { bubble(v, v.kontra.kBy, 'Kontra!'); vibrate(40); }
      if (!prev.kontra.re && v.kontra.re) { bubble(v, v.declarer, 'Re!'); vibrate(40); }
      if (prev.declarer == null && v.declarer != null && v.declarer !== v.seat) bubble(v, v.declarer, 'Ich spiele');
    }
    const myTurnNow = v.turn === v.seat && ['bid', 'skat', 'discard', 'declare', 'play', 'schieben'].includes(v.phase);
    const myTurnBefore = prev && prev.turn === prev.seat && prev.phase === v.phase;
    if (myTurnNow && !myTurnBefore) vibrate(25);
    T.prev = v;
    T.pending = null;
    renderInfo(v); renderPlates(v); renderOpp(v); renderTrick(v); renderHand(v); renderPanel(v); renderKontra(v); renderConn();
  }
  function renderConn() {
    const el = T.el.conn;
    if (A.role === 'client' && C && C.status !== 'ok') {
      el.style.display = 'block';
      el.innerHTML = C.mode === 'offline' ? 'Verbindung verloren <button id="reP">Neu koppeln</button>' : 'Verbindung unterbrochen – verbinde neu …';
      const b = $('#reP'); if (b) b.onclick = () => { C.offStage = 'scan'; A.screen = 'joinOffline'; resetTable(); render(); };
    } else if (A.role === 'host' && H) {
      const off = H.players.filter(p => !p.local && !p.online && !p.bot);
      if (off.length && H.match) {
        el.style.display = 'block';
        el.innerHTML = esc(off.map(p => p.name).join(', ')) + ' nicht verbunden' + (H.mode === 'offline' ? ' <button id="reP">Koppeln</button>' : '');
        const b = $('#reP'); if (b) b.onclick = hostPair;
      } else el.style.display = 'none';
    } else el.style.display = 'none';
  }
  function renderInfo(v) {
    let l1 = `<b>Spiel ${v.gameNo}</b> · ${esc(v.names[v.dealer])} gibt`;
    let l2 = '';
    const b = [];
    if (H && H.mode === 'demo') b.push('<span class="badge" style="background:#2b6cb0;color:#fff">DEMO</span>');
    if (v.bock) b.push('<span class="badge bock">BOCK</span>');
    if (v.game && v.game.type === 'ramsch') b.push('<span class="badge ramsch">RAMSCH</span>');
    if (v.kontra && v.kontra.k) b.push(`<span class="badge kontra">${v.kontra.re ? 'RE' : 'KONTRA'}</span>`);
    if (v.phase === 'bid') l2 = 'Reizen' + (v.bid.value ? ' · ' + v.bid.value : '');
    else if (v.phase === 'skat' || v.phase === 'discard' || v.phase === 'declare') l2 = esc(v.names[v.declarer]) + ' spielt · Reizwert ' + v.bid.value;
    else if (v.phase === 'schieben') l2 = 'Schieberamsch';
    else if (v.game && v.game.type !== 'ramsch') l2 = `${esc(v.names[v.declarer])}: <b style="font-size:13.5px">${esc(v.gameName)}</b> · ${v.bid.value}`;
    else if (v.game) l2 = 'Ramsch';
    const q = v.queue && v.queue.length ? ` · noch ${v.queue.filter(x => x === 'B').length ? v.queue.filter(x => x === 'B').length + '× Bock' : ''}${v.queue.filter(x => x === 'R').length ? ' ' + v.queue.filter(x => x === 'R').length + '× Ramsch' : ''}` : '';
    T.el.info.innerHTML = l1 + q + '<br>' + l2 + ' ' + b.join('');
  }
  function renderPlates(v) {
    const turnSeat = v.phase === 'done' ? null : v.phase === 'skat' || v.phase === 'discard' || v.phase === 'declare' ? v.declarer : v.turn;
    for (const p of ['left', 'right', 'me']) {
      const s = seatAt(v, p);
      const el = T.el['pl-' + p];
      const online = A.lobby && A.lobby.players ? (() => { const id = H ? H.seats && H.seats[s] : null; if (H) { const pl = H.players.find(x => x.id === id); return pl ? !!(pl.local || pl.online || pl.bot) : true; } const lp = A.lobby.players.find(x => x.name === v.names[s]); return lp ? lp.online : true; })() : true;
      let role = roleName(v, s);
      if (v.declarer === s && v.game && v.game.type !== 'ramsch') role = `<span class="decl">spielt ${esc(typeLabel(v.game.type))}</span>`;
      else if (v.declarer === s && v.phase !== 'bid') role = '<span class="decl">Alleinspieler</span>';
      const tc = v.phase === 'play' || v.phase === 'done' ? ` · ${v.trickCount[s]} St.` : '';
      let bub = T.bubbles[s] && T.bubbles[s].until > Date.now() ? T.bubbles[s].text : null;
      if (!bub && v.phase === 'bid' && v.bid.said[s]) bub = v.bid.said[s];
      const html = `<div class="av">${esc(initial(v.names[s]))}<span class="dot ${online ? '' : 'off'}"></span></div><div class="tx"><div class="nm">${esc(v.names[s])} <span style="font-weight:600;color:var(--dim);font-size:12.5px">${v.totals[s]}</span></div><div class="rl">${role}${tc}</div></div>${bub ? `<div class="bubble">${esc(bub)}</div>` : ''}`;
      if (el._html !== html) { el.innerHTML = html; el._html = html; }
      el.classList.toggle('turn', turnSeat === s);
    }
  }
  function bubble(v, seat, text) {
    T.bubbles[seat] = { text, until: Date.now() + 2600 };
    setTimeout(() => { if (A.view) renderPlates(A.view); }, 2700);
  }
  function renderOpp(v) {
    const g = T.geom;
    for (const p of ['left', 'right']) {
      const s = seatAt(v, p);
      const bk = T.el['bk-' + p], oc = T.el['oc-' + p];
      const open = v.open && v.open.seat === s ? Skat.sortHand(v.open.cards, prefs.resort ? v.game.type : 'grand', prefs.order) : null;
      const n = open ? 0 : (v.counts ? v.counts[s] : 0);
      const key = n + '|' + (open ? open.join() : '');
      if (bk._k !== key) {
        bk._k = key;
        let h = '';
        const tilt = p === 'left' ? 10 : -10;
        for (let i = 0; i < n; i++) {
          const off = i - (n - 1) / 2;
          h += `<img src="${Cards.backUrl()}" style="transform:rotate(${tilt + off * 7}deg)">`;
        }
        bk.innerHTML = h;
        let o = '';
        if (open) {
          const w = g.ow * 1.25, step = w * 0.62;
          open.forEach((c, i) => {
            const row = Math.floor(i / 5), col = i % 5;
            o += `<img src="${Cards.faceUrl(c)}" style="width:${w}px;left:${p === 'left' ? col * step : ''}px;${p === 'right' ? 'right:' + ((4 - col) * step) + 'px;' : ''}top:${row * w * 0.75}px;transform:none">`;
          });
          oc.style.width = (4 * step + w) + 'px'; oc.style.height = (w * 1.5 + w * 0.75) + 'px';
        }
        oc.innerHTML = o;
      }
    }
  }

  // ---------- Stich in der Mitte ----------
  function slot(pos) {
    const g = T.geom, tw = g.tw, th = g.th;
    if (pos === 'me') return { x: g.cx - tw / 2, y: g.cy - th / 2 + th * 0.26, r: 3 };
    if (pos === 'left') return { x: g.cx - tw / 2 - tw * 0.64, y: g.cy - th / 2 - th * 0.1, r: -11 };
    return { x: g.cx - tw / 2 + tw * 0.64, y: g.cy - th / 2 - th * 0.1, r: 11 };
  }
  function originOf(pos, card) {
    const tr = T.el.table.getBoundingClientRect();
    if (pos === 'me') {
      const r = T.handRects[card];
      if (r) return { x: r.left - tr.left, y: r.top - tr.top, w: r.width };
      const g = T.geom; return { x: g.W / 2 - g.cw / 2, y: g.H - g.ch, w: g.cw };
    }
    const b = T.el['bk-' + pos].getBoundingClientRect();
    return { x: b.left - tr.left, y: b.top - tr.top, w: T.geom.ow };
  }
  function mkTcard(card, faceUp) {
    const el = document.createElement('div');
    el.className = 'tcard';
    el.innerHTML = `<img src="${faceUp ? Cards.faceUrl(card) : Cards.backUrl()}" alt="">`;
    T.el.table.appendChild(el);
    return el;
  }
  function place(el, x, y, r, s, o) {
    el.style.transform = `translate(${x}px,${y}px) rotate(${r || 0}deg) scale(${s == null ? 1 : s})`;
    if (o != null) el.style.opacity = o;
  }
  function flyIn(el, from, to) {
    const g = T.geom;
    el.style.transition = 'none';
    place(el, from.x, from.y, 0, from.w / g.tw);
    el.getBoundingClientRect();
    el.style.transition = 'transform .32s cubic-bezier(.2,.8,.2,1),opacity .3s';
    place(el, to.x, to.y, to.r, 1);
  }
  function renderTrick(v) {
    const lt = v.lastTrick;
    // Stich gerade fertig geworden?
    if (lt && lt.n !== T.lastTrickN && (v.phase === 'play' || v.phase === 'done')) {
      T.lastTrickN = lt.n;
      T.showLast = { cards: lt.cards, winner: lt.winner, until: Date.now() + 1500 };
      clearTimeout(T.collectT);
      T.collectT = setTimeout(() => collect(), 1500);
    }
    let display = v.trick ? v.trick.slice() : [];
    if (display.length && T.showLast) collect(true);
    if (!display.length && T.showLast) display = T.showLast.cards;
    const want = new Set(display.map(t => t.card));
    for (const [c, el] of T.trick) if (!want.has(c) && !el._collecting) { el.remove(); T.trick.delete(c); }
    display.forEach((t, i) => {
      let el = T.trick.get(t.card);
      const pos = posOf(v, t.seat);
      const to = slot(pos);
      if (!el) {
        el = mkTcard(t.card, true); T.trick.set(t.card, el);
        flyIn(el, originOf(pos, t.card), to);
      } else place(el, to.x, to.y, to.r, 1);
      el.style.zIndex = 15 + i;
      el.classList.toggle('win', !!(T.showLast && T.showLast.winner === t.seat && display === T.showLast.cards));
    });
    // Skat in der Mitte (Reizen / Skat aufnehmen / Schieben)
    const showSkat = ['bid', 'skat', 'schieben'].includes(v.phase) && v.skatCount === 2;
    if (showSkat && !T.skatEls.length) {
      const g = T.geom;
      T.skatEls = [0, 1].map(i => {
        const el = mkTcard('', false);
        el.style.transition = 'transform .3s, opacity .3s';
        place(el, g.cx - g.tw / 2 + (i ? g.tw * 0.16 : -g.tw * 0.16), g.cy - g.th * (g.land ? 0.5 : 0.78), i ? 6 : -6, 0.72);
        return el;
      });
    } else if (!showSkat && T.skatEls.length) {
      const g = T.geom; const els = T.skatEls; T.skatEls = [];
      const target = v.declarer != null ? posOf(v, v.declarer) : 'me';
      els.forEach(el => {
        const o = target === 'me' ? { x: g.cx - g.tw / 2, y: g.H - g.ch } : originOf(target, '');
        place(el, o.x, o.y, 0, 0.4, 0);
        setTimeout(() => el.remove(), 350);
      });
    }
  }
  function collect(instant) {
    clearTimeout(T.collectT);
    const sl = T.showLast; T.showLast = null;
    if (!sl || !A.view) return;
    const v = A.view;
    const pos = posOf(v, sl.winner);
    const g = T.geom;
    const target = pos === 'me' ? { x: g.mePlate.x, y: g.mePlate.y - g.th * 0.3 } : originOf(pos, '');
    for (const t of sl.cards) {
      const el = T.trick.get(t.card); if (!el) continue;
      T.trick.delete(t.card);
      if (instant) { el.remove(); continue; }
      el._collecting = true;
      el.style.transition = 'transform .4s ease-in,opacity .4s ease-in';
      place(el, target.x, target.y, 0, 0.35, 0);
      setTimeout(() => el.remove(), 420);
    }
    if (!instant && A.view) setTimeout(() => A.view && renderPanel(A.view), 50);
  }

  // ---------- eigene Hand ----------
  function handMode(v) {
    if (v.phase === 'play' && v.turn === v.seat) return 'play';
    if (v.phase === 'discard' && v.declarer === v.seat) return 'discard';
    if (v.phase === 'schieben' && v.turn === v.seat && v.schieb.picked) return 'push';
    return null;
  }
  function sortType(v) {
    if (!prefs.resort) return 'grand';
    if (v.phase === 'declare' && v.declarer === v.seat && T.decl && T.decl.type) return T.decl.type;
    const t = v.game && v.game.type;
    return !t || t === 'ramsch' ? 'grand' : t;
  }
  function handOrder(v) {
    return Skat.sortHand(v.hand, sortType(v), prefs.order);
  }
  function renderHand(v) {
    const g = T.geom, hEl = T.el.hand;
    const cards = handOrder(v);
    const mode = handMode(v);
    const legal = mode === 'play' && v.legal ? new Set(v.legal) : null;
    hEl.classList.toggle('myturn', mode === 'play');
    // entfernte Karten: Position merken (für den Flug in die Mitte)
    for (const [c, el] of T.hand) {
      if (!cards.includes(c)) { T.handRects[c] = el.getBoundingClientRect(); el.remove(); T.hand.delete(c); T.sel.delete(c); }
    }
    const n = cards.length; if (!n) return;
    const W = g.W - 20 - g.cw * 0.7;
    const step = n > 1 ? Math.min(g.cw * 0.66, (W - g.cw) / (n - 1)) : 0;
    const total = step * (n - 1) + g.cw;
    const x0 = (g.W - total) / 2;
    const ang = Math.min(2.8, 26 / n);
    const base = g.cw * 0.5;
    cards.forEach((c, i) => {
      let el = T.hand.get(c);
      const isNew = !el;
      if (!el) {
        el = document.createElement('div'); el.className = 'cimg'; el.dataset.c = c;
        el.innerHTML = `<img src="${Cards.faceUrl(c)}" alt="">`;
        hEl.appendChild(el); T.hand.set(c, el);
      }
      const off = i - (n - 1) / 2;
      let y = base + off * off * g.cw * 0.012 + Math.abs(off) * 0.6;
      if (T.sel.has(c) || T.pending === c) y -= g.cw * 0.34;
      const x = x0 + i * step;
      el.style.zIndex = 10 + i;
      const tf = `translate(${x}px,${y}px) rotate(${off * ang}deg)`;
      if (isNew) { el.style.transition = 'none'; el.style.transform = `translate(${x}px,${y + g.ch}px) rotate(${off * ang}deg)`; el.style.opacity = 0; el.getBoundingClientRect(); el.style.transition = ''; el.style.opacity = 1; }
      el.style.transform = tf;
      el.classList.toggle('sel', T.sel.has(c));
      el.classList.toggle('no', !!legal && !legal.has(c));
      el.classList.toggle('ok', !!legal && legal.has(c));
      if (prefs.four !== el._four) { el._four = prefs.four; el.firstChild.src = Cards.faceUrl(c); }
    });
    // DOM-Reihenfolge an Sortierung anpassen (für Tippen)
  }
  function clearPending() { T.pending = null; if (A.view && A.screen === 'game') renderHand(A.view); }
  function bindHand() {
    let down = null;
    const hEl = T.el.hand;
    hEl.addEventListener('pointerdown', e => {
      const el = e.target.closest('.cimg'); if (!el) return;
      down = { c: el.dataset.c, y: e.clientY, x: e.clientX, t: Date.now() };
    });
    hEl.addEventListener('pointerup', e => {
      if (!down) return;
      const d = down; down = null;
      const v = A.view; if (!v) return;
      const dy = e.clientY - d.y;
      tapCard(v, d.c, dy < -32);
    });
    hEl.addEventListener('pointercancel', () => { down = null; });
  }
  function tapCard(v, c, swipe) {
    const mode = handMode(v);
    if (!mode) { if (v.phase === 'play') toast(v.names[v.turn] + ' ist dran', 1200); return; }
    if (mode === 'play') {
      if (v.legal && !v.legal.includes(c)) { toast('Farbe bedienen!', 1400); vibrate(60); return; }
      if (swipe || prefs.oneTap || T.sel.has(c)) { T.sel.clear(); T.pending = c; renderHand(v); act({ a: 'play', card: c }); return; }
      T.sel.clear(); T.sel.add(c); renderHand(v); return;
    }
    // drücken / schieben: zwei Karten wählen
    if (T.sel.has(c)) T.sel.delete(c);
    else {
      if (mode === 'push' && v.schieb.noJacks && c[1] === 'J') { toast('Buben dürfen nicht geschoben werden'); return; }
      if (T.sel.size >= 2) T.sel.delete(T.sel.values().next().value);
      T.sel.add(c);
    }
    renderHand(v); renderPanel(v, true);
  }

  // ---------- Bedienfeld ----------
  function renderPanel(v, force) {
    const p = T.el.panel;
    const { sig, html, bind } = panelContent(v);
    if (!force && sig === T.panelSig) return;
    T.panelSig = sig;
    p.innerHTML = html;
    if (bind) bind(p);
    fitPanel();
  }
  function fitPanel() {
    const g = T.geom, p = T.el.panel; if (!g) return;
    p.style.bottom = g.panelBottom + 'px';
    const h = p.offsetHeight, avail = g.H - 52 - g.panelBottom;
    if (h > avail) p.style.bottom = Math.max(4, g.H - 52 - h) + 'px';
  }
  function panelContent(v) {
    const N = s => esc(v.names[s]);
    const meS = v.seat;
    const none = { sig: 'none', html: '' };
    if (v.phase === 'bid') {
      const b = v.bid;
      if (b.turn !== meS) {
        const txt = b.stage === 3 ? `${N(b.turn)} überlegt, ob er 18 spielt …` : b.turn === b.sayer ? `${N(b.sayer)} reizt ${N(b.listener)} …` : `${N(b.listener)} überlegt …`;
        return { sig: 'bw' + txt, html: `<div class="waitmsg">${txt}</div>` };
      }
      if (b.stage === 3) {
        return {
          sig: 'b3', html: `<div class="pbox cp"><div class="q">Beide passen – spielst du <b>18</b>?</div><div class="btns"><button class="btn pri" data-a="bid">18 spielen</button><button class="btn" data-a="pass">Passe</button></div></div>`,
          bind: p => p.querySelectorAll('[data-a]').forEach(x => x.onclick = () => act({ a: x.dataset.a }))
        };
      }
      if (b.turn === b.sayer) {
        const higher = Skat.BIDS.filter(x => x > b.next).slice(0, 18);
        const more = T.bidMore === b.value;
        return {
          sig: 'bs' + b.value + b.listener + more, html: `<div class="pbox cp"><div class="q">Du reizt <b>${N(b.listener)}</b>${b.value ? ' · bisher ' + b.value : ''}</div>
          <div class="btns"><button class="btn pri" data-v="${b.next}">${b.next}</button><button class="btn" data-more style="flex:.55">${more ? 'weniger' : 'mehr'}</button><button class="btn" data-pass>Passe</button></div>
          ${more ? `<div class="chips">${higher.map(x => `<button data-v="${x}">${x}</button>`).join('')}</div>` : ''}</div>`,
          bind: p => {
            p.querySelectorAll('[data-v]').forEach(x => x.onclick = () => act({ a: 'bid', v: +x.dataset.v }));
            p.querySelector('[data-pass]').onclick = () => act({ a: 'pass' });
            p.querySelector('[data-more]').onclick = () => { T.bidMore = more ? null : b.value; renderPanel(v, true); };
          }
        };
      }
      return {
        sig: 'bl' + b.value, html: `<div class="pbox cp"><div class="q">${N(b.sayer)} sagt <b>${b.value}</b></div><div class="btns"><button class="btn pri" data-a="hold">Ja</button><button class="btn" data-a="pass">Passe</button></div></div>`,
        bind: p => p.querySelectorAll('[data-a]').forEach(x => x.onclick = () => act({ a: x.dataset.a }))
      };
    }
    if (v.phase === 'skat') {
      if (v.declarer !== meS) return { sig: 'sw', html: `<div class="waitmsg">${N(v.declarer)} spielt (${v.bid.value}) – nimmt den Skat oder spielt Hand …</div>` };
      return {
        sig: 'sk', html: `<div class="pbox cp"><div class="q">Du hast das Spiel für <b>${v.bid.value}</b>.</div><div class="btns"><button class="btn pri" data-a="pickup">Skat aufnehmen</button><button class="btn" data-a="hand">Hand spielen</button></div></div>`,
        bind: p => p.querySelectorAll('[data-a]').forEach(x => x.onclick = () => act({ a: x.dataset.a }))
      };
    }
    if (v.phase === 'discard') {
      if (v.declarer !== meS) return { sig: 'dw', html: `<div class="waitmsg">${N(v.declarer)} hat den Skat aufgenommen und drückt …</div>` };
      const sel = [...T.sel];
      const pts = Skat.points(sel);
      return {
        sig: 'd' + sel.join(), html: `<div class="pbox cp"><div class="q">Zwei Karten antippen und drücken${sel.length ? ` · ${pts} Augen` : ''}</div><div class="btns"><button class="btn pri" id="dOk" ${sel.length === 2 ? '' : 'disabled'}>Drücken</button></div></div>`,
        bind: p => { p.querySelector('#dOk').onclick = () => { const c = [...T.sel]; T.sel.clear(); act({ a: 'discard', cards: c }); }; }
      };
    }
    if (v.phase === 'declare') {
      if (v.declarer !== meS) return { sig: 'cw', html: `<div class="waitmsg">${N(v.declarer)} sagt das Spiel an …</div>` };
      if (!T.decl) T.decl = { type: null, ouvert: false, schneiderA: false, schwarzA: false };
      const d = T.decl, hand = !v.tookSkat;
      const types = ['c', 's', 'h', 'd', 'grand', 'null'];
      let val = '';
      let bad = false;
      if (d.type) {
        const pv = Skat.previewValue(v.cards12, d.type, { hand, ouvert: d.ouvert, schneiderA: d.schneiderA, schwarzA: d.schwarzA });
        bad = pv.value < v.bid.value;
        const mat = d.type !== 'null' ? ` (${pv.mat > 0 ? 'mit' : 'ohne'} ${Math.abs(pv.mat)}${hand ? ', Skat unbekannt' : ''})` : '';
        val = `<div class="valline ${bad ? 'bad' : ''}">Spielwert <b>${pv.value}</b>${mat} · Reizwert ${v.bid.value}${bad ? ' – überreizt!' : ''}</div>`;
      } else val = `<div class="valline">Spiel wählen · Reizwert ${v.bid.value}</div>`;
      const opt = (k, t, dis) => `<button data-o="${k}" class="${d[k] ? 'on' : ''}" ${dis ? 'disabled style="opacity:.35"' : ''}>${t}</button>`;
      const optHtml = d.type === 'null' ? opt('ouvert', 'Ouvert') : d.type ? (hand ? opt('schneiderA', 'Schneider angesagt') + opt('schwarzA', 'Schwarz angesagt') + opt('ouvert', 'Ouvert') : '<span class="hint" style="margin:0">Ansagen und Ouvert nur bei Hand</span>') : '';
      return {
        sig: 'dc' + JSON.stringify(d) + v.hand.join(), html: `<div class="pbox">
          <div class="gtypes">${types.map(t => `<button data-t="${t}" class="${d.type === t ? 'on' : ''}">${['c', 's', 'h', 'd'].includes(t) ? Cards.pipSvg(t, 22) : `<span style="font-size:${t === 'grand' ? 15 : 17}px;line-height:22px">${t === 'grand' ? 'G' : '0'}</span>`}${typeLabel(t)}</button>`).join('')}</div>
          <div class="opts">${optHtml}</div>${val}
          <div class="btns">${v.tookSkat ? `<button class="btn" id="dBack" style="flex:.6">Skat ${v.mySkat ? mini(v.mySkat) : ''} zurück</button>` : ''}<button class="btn pri" id="dGo" ${d.type ? '' : 'disabled'}>${d.type ? 'Ansagen' : 'Spiel wählen'}</button></div></div>`,
        bind: p => {
          p.querySelectorAll('[data-t]').forEach(x => x.onclick = () => { d.type = x.dataset.t; if (d.type === 'null') { d.schneiderA = d.schwarzA = false; } renderHand(v); renderPanel(v, true); });
          p.querySelectorAll('[data-o]').forEach(x => x.onclick = () => {
            const k = x.dataset.o; d[k] = !d[k];
            if (k === 'schwarzA' && d.schwarzA) d.schneiderA = true;
            if (k === 'schneiderA' && !d.schneiderA) d.schwarzA = false;
            if (k === 'ouvert' && d.ouvert && d.type !== 'null') { d.schneiderA = d.schwarzA = true; }
            renderPanel(v, true);
          });
          const back = p.querySelector('#dBack'); if (back) back.onclick = () => act({ a: 'undiscard' });
          p.querySelector('#dGo').onclick = () => {
            if (!d.type) return;
            if (bad && !confirm('Das Spiel ist weniger wert als dein Reizwert – du verlierst es sicher. Trotzdem ansagen?')) return;
            act({ a: 'declare', type: d.type, ouvert: d.ouvert, schneiderA: d.schneiderA, schwarzA: d.schwarzA });
          };
        }
      };
    }
    if (v.phase === 'schieben') {
      const s = v.schieb;
      if (v.turn !== meS) return { sig: 'rw' + v.turn, html: `<div class="waitmsg">Ramsch! ${N(v.turn)} ist beim Schieben dran …${s.doubles ? ' (' + s.doubles + '× geschoben)' : ''}</div>` };
      if (!s.picked) return {
        sig: 'rp' + s.doubles, html: `<div class="pbox cp"><div class="q"><b>Ramsch!</b> Alle haben gepasst – wer die meisten Augen hat, verliert.${s.doubles ? `<br>Bisher ${s.doubles}× geschoben.` : ''}</div><div class="btns"><button class="btn" data-m="pickup">Skat aufnehmen</button><button class="btn pri" data-m="pass">Schieben (×2)</button></div></div>`,
        bind: p => p.querySelectorAll('[data-m]').forEach(x => x.onclick = () => act({ a: 'schieb', mode: x.dataset.m }))
      };
      const sel = [...T.sel];
      return {
        sig: 'rs' + sel.join(), html: `<div class="pbox cp"><div class="q">Zwei Karten an ${N((meS + 1) % 3)} weitergeben${s.noJacks ? ' (keine Buben)' : ''}</div><div class="btns"><button class="btn pri" id="rOk" ${sel.length === 2 ? '' : 'disabled'}>Weitergeben</button></div></div>`,
        bind: p => { p.querySelector('#rOk').onclick = () => { const c = [...T.sel]; T.sel.clear(); act({ a: 'schieb', mode: 'push', cards: c }); }; }
      };
    }
    if (v.phase === 'play') {
      if (v.turn === meS && v.trick.length === 0 && v.tricksPlayed === 0) return { sig: 'pa', html: `<div class="waitmsg">Du spielst aus</div>` };
      return none;
    }
    if (v.phase === 'done') {
      const wait = T.showLast ? T.showLast.until - Date.now() : 0;
      if (wait > 0) { setTimeout(() => A.view && renderPanel(A.view), wait + 80); return none; }
      return resultPanel(v);
    }
    return none;
  }
  function renderKontra(v) {
    const el = $('#kbtn'); if (!el) return;
    const k = v.phase === 'play' ? (v.canKontra ? 'kontra' : v.canRe ? 're' : '') : '';
    if (el._k === k) return;
    el._k = k;
    el.innerHTML = k ? `<button class="kb">${k === 'kontra' ? 'Kontra' : 'Re'}</button>` : '';
    const g = T.geom;
    el.style.top = (g.mePlate.y + 4) + 'px';
    const b = el.firstChild;
    if (b) b.onclick = () => { if (confirm(k === 'kontra' ? 'Kontra geben? (verdoppelt)' : 'Re geben? (verdoppelt nochmal)')) act({ a: k }); };
  }
  function resultPanel(v) {
    const r = v.result; if (!r) return { sig: 'x', html: '' };
    const N = s => esc(v.names[s]);
    let head, sub = '';
    if (r.kind === 'ramsch') {
      head = r.durchmarsch != null ? `<h3 class="won">${N(r.durchmarsch)}: Durchmarsch!</h3>` : `<h3 class="lost">Ramsch: ${r.losers.map(N).join(' und ')} verliert</h3>`;
      sub = [0, 1, 2].map(s => `${N(s)} ${r.pts[s]}`).join(' · ') + ' Augen';
    } else {
      const g = Skat.gameName(r.game);
      head = `<h3 class="${r.won ? 'won' : 'lost'}">${N(r.declarer)} ${r.won ? 'gewinnt' : 'verliert'} ${esc(g)}</h3>`;
      sub = r.game.type === 'null' ? (r.won ? 'Keinen Stich bekommen' : 'Einen Stich bekommen') : `${r.declPts} : ${r.oppPts} Augen${r.schwarz ? ' · schwarz' : r.schneider ? ' · Schneider' : ''}`;
    }
    const meReady = v.ready[v.seat];
    const readyTxt = [0, 1, 2].filter(s => !v.ready[s]).map(N).join(', ');
    const html = `<div class="pbox result">${head}<div class="calc">${sub}<br>${r.parts.map(esc).join(' · ')}</div>
      <div class="calc">Skat: ${mini(r.origSkat)}${r.kind === 'normal' && v.declarer != null && r.origSkat.join() !== r.skat.join() ? ' · gedrückt: ' + mini(r.skat) : ''}</div>
      <table>${[0, 1, 2].map(s => `<tr><td>${N(s)}</td><td class="n ${cls(r.deltas[s])}">${r.deltas[s] ? signed(r.deltas[s]) : '–'}</td><td class="n">${v.totals[s]}</td></tr>`).join('')}</table>
      ${r.bockTriggers && r.bockTriggers.length ? `<div class="calc" style="color:var(--gold)">Bockrunde! (${r.bockTriggers.map(esc).join(', ')})</div>` : ''}
      <div class="btns"><button class="btn" id="rList" style="flex:.6">Liste</button><button class="btn pri" id="rGo" ${meReady ? 'disabled' : ''}>${meReady ? 'Warte auf ' + readyTxt : 'Weiter'}</button></div></div>`;
    return {
      sig: 'r' + v.gameNo + v.ready.join(), html,
      bind: p => { p.querySelector('#rGo').onclick = () => act({ a: 'ready' }); p.querySelector('#rList').onclick = showList; }
    };
  }

  // ======================================================================
  //  Menü, Liste, Regeln, Darstellung, Hilfe
  // ======================================================================
  function showMenu() {
    const items = [['list', 'Spielliste'], ['last', 'Letzter Stich'], ['rules', 'Regeln'], ['look', 'Darstellung'], ['help', 'Hilfe']];
    if (A.role === 'host' && H && H.mode === 'offline') items.push(['pair', 'Mitspieler neu koppeln']);
    items.push(A.role === 'host' ? ['end', H && H.mode === 'demo' ? 'Demo beenden' : 'Tisch beenden'] : ['leave', 'Tisch verlassen']);
    sheet('Menü', `<div class="menu">${items.map(([k, t]) => `<button data-k="${k}">${t}</button>`).join('')}</div>`, sb => {
      sb.onclick = e => {
        const b = e.target.closest('button'); if (!b) return;
        const k = b.dataset.k; closeSheet();
        if (k === 'list') showList();
        if (k === 'last') showLast();
        if (k === 'rules') showRules();
        if (k === 'look') showLook();
        if (k === 'help') showHelp();
        if (k === 'pair') hostPair();
        if (k === 'end' && (H && H.mode === 'demo' ? true : confirm('Tisch beenden? Das Spiel endet für alle.'))) hostEnd();
        if (k === 'leave' && confirm('Tisch verlassen?')) clientLeave();
      };
    });
  }
  function showList() {
    const v = A.view; if (!v) return;
    const rows = v.history.map(h => `<tr><td>${h.no}</td><td>${esc(h.text)}${h.bock ? ' <span class="badge bock">B</span>' : ''}${h.kontra ? ` <span class="badge kontra">${h.kontra === 'Re' ? 'R' : 'K'}</span>` : ''}</td>${h.deltas.map(d => `<td class="${cls(d)}">${d ? signed(d) : ''}</td>`).join('')}</tr>`).join('');
    const q = v.queue.length ? `<p class="hint">Als Nächstes: ${v.queue.map(x => x === 'B' ? 'Bock' : 'Ramsch').join(', ')}</p>` : '';
    sheet('Spielliste', `<table class="list"><thead><tr><th>#</th><th>Spiel</th>${v.names.map(n => `<th>${esc(n)}</th>`).join('')}</tr></thead><tbody>${rows || '<tr><td></td><td>Noch kein Spiel beendet</td><td></td><td></td><td></td></tr>'}</tbody>
      <tfoot><tr><td></td><td>Summe</td>${v.totals.map(t => `<td>${t}</td>`).join('')}</tr></tfoot></table>${q}
      <p class="hint">Wertung: ${v.rules.scoring === 'seeger' ? 'Seeger-Fabian (gewonnen +50, verloren −50 und Gegner je +40)' : 'einfach (gewonnen +Wert, verloren −2× Wert)'}</p>`);
  }
  function showLast() {
    const v = A.view;
    if (!v || !v.lastTrick) { toast('Noch kein Stich gespielt'); return; }
    const lt = v.lastTrick;
    sheet('Letzter Stich', `<div style="display:flex;gap:10px;justify-content:center;margin:10px 0">${lt.cards.map(t => `<div style="text-align:center"><img src="${Cards.faceUrl(t.card)}" style="width:80px;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,.4)"><div class="hint">${esc(v.names[t.seat])}</div></div>`).join('')}</div><p style="text-align:center">Stich an <b>${esc(v.names[lt.winner])}</b></p>`);
  }
  const RULE_ITEMS = [
    ['kontra', 'Kontra und Re', 'Gegenspieler kann vor seiner ersten Karte Kontra geben (×2), der Alleinspieler darauf Re (×4).'],
    ['scoring', 'Wertung Seeger-Fabian', 'Gewonnen +50, verloren −50 und jeder Gegner +40. Aus: einfache Liste (+Wert / −2× Wert).'],
    ['bock', 'Bockrunden (Hausregel)', 'In einer Bockrunde zählen alle Spiele doppelt.'],
    ['bockKontra', 'Auslöser: Kontra/Re verloren', 'Wer zuletzt Kontra bzw. Re gesagt hat, verliert.', 'bock'],
    ['bock6060', 'Auslöser: 60:60', '', 'bock'],
    ['bockGrandHand', 'Auslöser: Grand Hand verloren', '', 'bock'],
    ['bock120', 'Auslöser: 120:0 Augen', '', 'bock'],
    ['ramschAfterBock', 'Ramschrunde nach jeder Bockrunde', '', 'bock'],
    ['ramsch', 'Ramsch, wenn alle passen (Hausregel)', 'Sonst wird neu gegeben.'],
    ['schieben', 'Schieberamsch', 'Skat aufnehmen und 2 Karten weitergeben oder ungesehen schieben (×2).', 'ramsch'],
    ['schiebenNoJacks', 'Keine Buben schieben', '', 'ramsch'],
    ['jungfrau', 'Jungfrau zählt doppelt', 'Wer im Ramsch keinen Stich hat, verdoppelt den Verlust.', 'ramsch'],
    ['durchmarsch', 'Durchmarsch', 'Wer im Ramsch alle Stiche macht, bekommt +120.', 'ramsch']
  ];
  function showRules() {
    const canEdit = A.role === 'host' || !A.role;
    const r = A.role === 'host' && H ? H.rules : A.role === 'client' && A.lobby ? A.lobby.rules : Object.assign({}, Skat.DEFAULT_RULES, LS.get('rules', {}));
    const val = k => k === 'scoring' ? r.scoring === 'seeger' : !!r[k];
    const draw = sb => {
      sb.innerHTML = `${canEdit ? `<div class="row" style="margin-bottom:6px"><button class="btn small" id="rOff">Offizielle Regeln</button><button class="btn small" id="rHouse">Mit Hausregeln</button></div>` : '<p class="hint">Die Regeln legt das Tisch-Handy fest.</p>'}
        ${RULE_ITEMS.map(([k, t, d, dep]) => `<div class="tog ${dep ? 'indent' : ''}"><span>${esc(t)}${d ? `<small>${esc(d)}</small>` : ''}</span><div class="sw ${val(k) ? 'on' : ''} ${(!canEdit || (dep && !r[dep])) ? 'dis' : ''}" data-k="${k}"></div></div>`).join('')}
        <div class="tog"><span>Spiele je Bockrunde</span><select class="inp" id="bLen" style="width:80px;padding:6px;font-size:16px" ${canEdit ? '' : 'disabled'}>${[3, 6].map(n => `<option ${r.bockLen == n ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
        ${H && H.match ? '<p class="hint">Änderungen gelten ab dem nächsten Spiel.</p>' : ''}
        <h3>Kurz erklärt</h3><p>Gereizt wird nach den offiziellen Reizwerten (18, 20, 22, 23, 24, 27, 30 …). Mittelhand sagt Vorhand, dann Hinterhand dem Gewinner. Passen alle, spielt Vorhand 18 oder es gibt Ramsch bzw. neu.</p>
        <p>Der Alleinspieler nimmt den Skat auf (drückt 2 Karten) oder spielt Hand. Schneider/Schwarz ansagen und Ouvert gehen nur bei Hand (Null Ouvert auch mit Skat). Gewonnen mit 61 Augen. Spielwert = Grundwert (Karo 9, Herz 10, Pik 11, Kreuz 12, Grand 24) × (Spitzen + 1 + Hand + Schneider + … ). Null 23, Null Hand 35, Null Ouvert 46, Null Ouvert Hand 59. Überreizt = verloren.</p>`;
      if (!canEdit) return;
      sb.querySelectorAll('.sw').forEach(s => s.onclick = () => {
        const k = s.dataset.k;
        if (k === 'scoring') r.scoring = r.scoring === 'seeger' ? 'simple' : 'seeger'; else r[k] = !r[k];
        commit();
      });
      sb.querySelector('#bLen').onchange = e => { r.bockLen = +e.target.value; commit(); };
      sb.querySelector('#rOff').onclick = () => { Object.assign(r, Skat.OFFICIAL); commit(); };
      sb.querySelector('#rHouse').onclick = () => { Object.assign(r, Skat.DEFAULT_RULES, { kontra: true, bock: true, ramsch: true }); commit(); };
      function commit() {
        LS.set('rules', r);
        if (H) { H.rules = r; if (H.match) H.match.rules = Object.assign({}, r); hostBroadcast(); }
        draw(sb);
      }
    };
    sheet('Regeln', '', draw);
  }
  function showLook() {
    const items = [['four', 'Vierfarbiges Blatt', 'Kreuz schwarz, Pik grün, Herz rot, Karo gelb – wie im Turnier'],
      ['oneTap', 'Karte mit einem Tipp spielen', 'Sonst: antippen hebt die Karte an, nochmal tippen (oder nach oben wischen) spielt sie'],
      ['vibrate', 'Vibrieren, wenn ich dran bin', 'Nur Android']];
    const draw = sb => {
      sb.innerHTML = `<div class="tog" style="display:block"><span>Kartengröße<small>Jederzeit umstellbar, auch über den Knopf <b>A A</b> oben im Spiel</small></span>
          <div class="seg" id="szSeg" style="margin-top:8px">${SIZES.map((t, i) => `<button data-s="${i}" class="${(prefs.size || 0) === i ? 'on' : ''}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div></div>
        <div class="tog" style="display:block"><span>Reihenfolge der Farben<small>Farben mit dem Finger in die gewünschte Reihenfolge ziehen. Buben stehen immer vorn.</small></span>
          <div id="orDrag" class="sdrag">${prefs.order.map(x => `<div class="stile" data-s="${x}">${Cards.pipSvg(x, 30)}<span>${Skat.SUITNAME[x]}</span></div>`).join('')}</div></div>
        <div class="tog"><span>Nach dem Ansagen umsortieren<small>Trümpfe nach vorn; bei Null werden Buben und Zehner in die Farben einsortiert (A K D B 10 9 8 7). Aus: Die Hand bleibt so sortiert wie beim Reizen.</small></span><div class="sw ${prefs.resort ? 'on' : ''}" data-k="resort"></div></div>` + items.map(([k, t, d]) => `<div class="tog"><span>${t}<small>${d}</small></span><div class="sw ${prefs[k] ? 'on' : ''}" data-k="${k}"></div></div>`).join('')
        + `<div style="display:flex;gap:4px;justify-content:center;margin-top:14px">${['cA', 'sK', 'hQ', 'dJ', 'cT'].map(c => `<img src="${Cards.faceUrl(c)}" style="width:56px;border-radius:5px">`).join('')}</div>`;
      bindSuitDrag(sb.querySelector('#orDrag'), () => { savePrefs(); if (A.view && A.screen === 'game') { T.el['bk-left']._k = T.el['bk-right']._k = null; renderTable(A.view); } });
      sb.querySelector('#szSeg').onclick = e => { const b = e.target.closest('button'); if (!b) return; setSize(+b.dataset.s); draw(sb); };
      sb.querySelectorAll('.sw').forEach(s => s.onclick = () => {
        const k = s.dataset.k; prefs[k] = !prefs[k]; savePrefs(); Cards.setFour(prefs.four);
        draw(sb);
        if (A.view && A.screen === 'game') { for (const el of T.trick.values()) el.remove(); T.trick.clear(); T.el['bk-left']._k = T.el['bk-right']._k = null; renderTable(A.view); }
        else { $('#app')._html = ''; render(); }
      });
    };
    sheet('Darstellung', '', draw);
  }
  // Farben per Ziehen ordnen
  function bindSuitDrag(box, onChange) {
    let drag = null;
    const tiles = () => [...box.querySelectorAll('.stile')];
    box.addEventListener('pointerdown', e => {
      const el = e.target.closest('.stile'); if (!el) return;
      e.preventDefault();
      const ts = tiles(), r0 = ts[0].getBoundingClientRect(), r1 = ts[1].getBoundingClientRect();
      drag = { el, x0: e.clientX, step: r1.left - r0.left, idx: ts.indexOf(el), start: ts.indexOf(el) };
      el.classList.add('drag');
      try { el.setPointerCapture(e.pointerId); } catch (x) { }
    });
    box.addEventListener('pointermove', e => {
      if (!drag) return;
      const dx = e.clientX - drag.x0;
      let ni = Math.max(0, Math.min(3, Math.round(drag.start + dx / drag.step)));
      if (ni !== drag.idx) {
        const ts = tiles().filter(t => t !== drag.el);
        ts.splice(ni, 0, drag.el);
        ts.forEach(t => box.appendChild(t));
        drag.idx = ni;
      }
      drag.el.style.transform = `translateX(${dx - (drag.idx - drag.start) * drag.step}px) scale(1.08)`;
    });
    const end = () => {
      if (!drag) return;
      drag.el.classList.remove('drag'); drag.el.style.transform = '';
      const changed = drag.idx !== drag.start;
      drag = null;
      prefs.order = tiles().map(t => t.dataset.s);
      if (changed) onChange();
    };
    box.addEventListener('pointerup', end);
    box.addEventListener('pointercancel', end);
  }
  function showHelp(section) {
    sheet('Hilfe', `
      <h3>So geht's</h3>
      <p>Alle drei öffnen die App. <b>Einer</b> tippt „Tisch eröffnen“ – sein Handy ist der Tisch: es mischt, teilt aus und prüft die Züge. Die anderen tippen „Am Tisch Platz nehmen“. Der Tisch legt die Sitzordnung fest (im Uhrzeigersinn, mit ▲ verschieben) und startet das Spiel.</p>
      <p><b>Demo:</b> „Demo: allein gegen den Computer“ startet sofort ein Spiel ohne Verbindung gegen zwei Computer-Spieler (Lisa und Max). Zum Ausprobieren der Bedienung; die Computer spielen einfach, aber regelgerecht. Beenden über ☰ → „Demo beenden“.</p>
      <p><b>Zu zweit:</b> Am Tisch „+ Computer als Mitspieler“ tippen – der Computer übernimmt den dritten Platz, der zweite Mensch verbindet sich wie gewohnt.</p>
      <h3>Verbindung</h3>
      <ul><li><b>Mit Internet</b> (empfohlen): Jeder nutzt seine mobilen Daten. Der Tisch zeigt einen Code aus 4 Zeichen und einen QR-Code. Ein gemeinsames WLAN ist nicht nötig, der Datenverbrauch ist winzig.</li>
      <li><b>Hotspot mit Netz</b>: Hat nur ein Handy Netz, macht es einen Hotspot auf. Die anderen verbinden sich damit und haben darüber Internet – dann wie „Mit Internet“.</li>
      <li><b>Ohne Netz</b>: Ein Handy macht einen Hotspot auf (auch ohne Netz), die anderen verbinden sich damit. Gekoppelt wird per QR-Code in beide Richtungen: Mitspieler scannt den Code des Tisches, dann scannt der Tisch den Antwort-Code des Mitspielers. Die App muss vorher einmal mit Internet geöffnet worden sein.</li></ul>
      <p>Bricht die Verbindung ab (z. B. Bildschirm gesperrt), verbindet sich die App mit Internet von selbst neu; ohne Netz über „Neu koppeln“. Der Spielstand bleibt auf dem Tisch-Handy erhalten, auch wenn die App dort neu gestartet wird („Tisch fortsetzen“).</p>
      <h3>Bedienung</h3>
      <ul><li>Karte antippen hebt sie an, nochmal antippen oder nach oben wischen spielt sie. Spielbare Karten sind hell, die anderen abgedunkelt.</li>
      <li>Über ☰ → „Letzter Stich“ siehst du den letzten Stich, über „Liste“ die Spielliste.</li>
      <li>Kontra/Re erscheint als goldener Knopf, solange es erlaubt ist.</li>
      <li>Das Tisch-Handy während des Spiels nicht sperren und die App offen lassen – es hält das Spiel zusammen. Die App hält den Bildschirm dafür wach.</li></ul>
      <h3>Installation</h3>
      <ul><li><b>iPhone:</b> Adresse in Safari öffnen → Teilen □↑ → „Zum Home-Bildschirm“ → Hinzufügen.</li>
      <li><b>Android:</b> Adresse in Chrome öffnen → ⋮ → „App installieren“ bzw. „Zum Startbildschirm hinzufügen“.</li></ul>
      <h3 id="h-ds">Datenschutz</h3>
      <p>Die App speichert Namen, Regeln und Spielstand nur auf den Handys. Die Seite wird bei GitHub gehostet; dabei werden beim Aufruf technische Daten (z. B. IP-Adresse) verarbeitet. Beim Spielen „Mit Internet“ wird die Verbindung über den öffentlichen Vermittlungsdienst von PeerJS (0.peerjs.com) aufgebaut; dabei sieht dieser Dienst die IP-Adressen und den Tisch-Code. Die Spielzüge laufen danach direkt zwischen den Handys – nur wenn das im Mobilfunknetz nicht klappt, über ein Relais von PeerJS. Ohne Netz bleibt alles im Hotspot. Für das Scannen der QR-Codes wird die Kamera benutzt, die Bilder verlassen das Handy nicht.</p>
      <h3>Haftungsausschluss</h3>
      <p>Die App wird ohne Gewähr bereitgestellt. Für Fehler, Ausfälle oder falsch berechnete Spielstände wird keine Haftung übernommen. Kein Spiel um Geld.</p>
      <h3 id="h-about">Über diese App</h3>
      <p>WeSkat – private, kostenlose App ohne Werbung. Kontakt und Rückmeldungen: github.com/app-laden<br>Version ${VERSION}. Verwendet PeerJS (MIT), qrcode-generator (MIT) und jsQR (Apache 2.0).</p>`,
      sb => { if (section === 'about') { const e = $('#h-about', sb); if (e) e.scrollIntoView(); } });
  }

  // ---------- Bildschirm wach halten ----------
  let wake = null;
  async function requestWake() { try { if ('wakeLock' in navigator && !wake) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } } catch (e) { } }
  function releaseWake() { try { if (wake) wake.release(); } catch (e) { } wake = null; }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (A.screen === 'game') requestWake();
    if (C && C.mode !== 'offline') {
      if (!C.link) clientConnect();
      else if (C.last && Date.now() - C.last > 8000) clientReconnect();
    }
    if (H && H.mode === 'internet' && H.peer && (H.peer.disconnected || H.peer.destroyed)) hostOpenPeer(H.code);
  });
  let rsT;
  function relayout() {
    if (A.screen === 'game' && A.view && T.built) {
      T.resized = true; T.el['bk-left']._k = T.el['bk-right']._k = null;
      for (const el of T.trick.values()) el.remove(); T.trick.clear();
      T.skatEls.forEach(e => e.remove()); T.skatEls = [];
      T.panelSig = '';
      renderTable(A.view);
    }
  }
  const SIZES = ['normal', 'groß', 'sehr groß'];
  function setSize(n) {
    prefs.size = ((n % 3) + 3) % 3; savePrefs(); relayout();
  }
  window.addEventListener('resize', () => { clearTimeout(rsT); rsT = setTimeout(relayout, 150); });

  // ---------- Update (Service Worker) ----------
  if ('serviceWorker' in navigator && !TEST && location.protocol === 'https:') {
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (reloading) return; reloading = true; location.reload(); });
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
      const show = w => { const u = $('#upd'); u.style.display = 'block'; u.onclick = () => { u.textContent = 'Lade …'; w.postMessage('skip'); }; };
      if (reg.waiting && navigator.serviceWorker.controller) show(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing; if (!nw) return;
        nw.addEventListener('statechange', () => { if (nw.state === 'installed' && navigator.serviceWorker.controller) show(nw); });
      });
      document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => { }); });
    }).catch(() => { });
  }

  // ---------- Start ----------
  if (/#t=[A-Za-z0-9]{4}/.test(location.hash) && !TEST) A.screen = 'join';
  render();
  window.__skat = { A, get H() { return H; }, get C() { return C; }, T, act };
})();

/* WeSkat – Copyright (C) 2026 app-laden – GPL-3.0-or-later, siehe LICENSE */
/* Skat – Regelwerk (läuft auf dem Tisch-Handy, prüft jeden Zug) */
(function (root) {
  'use strict';
  const SUITS = ['c', 's', 'h', 'd'];            // Kreuz, Pik, Herz, Karo
  const RANKS = ['7', '8', '9', 'Q', 'K', 'T', 'A', 'J'];
  const PTS = { A: 11, T: 10, K: 4, Q: 3, J: 2, 9: 0, 8: 0, 7: 0 };
  const BASE = { c: 12, s: 11, h: 10, d: 9, grand: 24 };
  const SUITNAME = { c: 'Kreuz', s: 'Pik', h: 'Herz', d: 'Karo' };
  const RANKNAME = { 7: '7', 8: '8', 9: '9', Q: 'Dame', K: 'König', T: '10', A: 'Ass', J: 'Bube' };
  const JACKS = ['cJ', 'sJ', 'hJ', 'dJ'];

  const DEFAULT_RULES = {
    kontra: true,          // Kontra / Re
    bock: true,            // Bockrunden
    bockKontra: true,      // Auslöser: Kontra/Re verloren
    bock6060: true,        // Auslöser: 60:60
    bockGrandHand: true,   // Auslöser: Grand Hand verloren
    bock120: true,         // Auslöser: 120:0
    bockLen: 3,            // Spiele je Bockrunde
    ramsch: true,          // Ramsch, wenn alle passen
    ramschAfterBock: false,// nach jeder Bockrunde eine Ramschrunde
    schieben: true,        // Schieberamsch
    schiebenNoJacks: true, // Buben dürfen nicht geschoben werden
    jungfrau: true,        // Jungfrau verdoppelt
    durchmarsch: true,     // Durchmarsch im Ramsch
    ramschGrandHand: true, // in Ramschrunden reihum: Grand Hand? Ramsch wird nachgeholt
    scoring: 'simple'      // 'simple' | 'seeger'
  };
  const OFFICIAL = Object.assign({}, DEFAULT_RULES, {
    kontra: true, bock: false, ramsch: false, ramschAfterBock: false, scoring: 'seeger'
  });

  // ---------- Grundlagen ----------
  const suit = c => c[0];
  const rank = c => c.slice(1);
  const points = cards => cards.reduce((s, c) => s + PTS[rank(c)], 0);

  function newDeck() {
    const d = [];
    for (const s of SUITS) for (const r of RANKS) d.push(s + r);
    return d;
  }
  function rnd(n) {
    if (root.crypto && root.crypto.getRandomValues) {
      const a = new Uint32Array(1); root.crypto.getRandomValues(a); return a[0] % n;
    }
    return Math.floor(Math.random() * n);
  }
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  // Reizwerte
  const BIDS = (() => {
    const set = new Set([23, 35, 46, 59]);
    for (const b of [9, 10, 11, 12, 24]) for (let m = 2; m <= 18; m++) set.add(b * m);
    return [...set].filter(v => v >= 18 && v <= 264).sort((a, b) => a - b);
  })();
  const nextBid = v => BIDS.find(b => b > v);

  // game: {type:'c'|'s'|'h'|'d'|'grand'|'null'|'ramsch'}
  function trumpSuit(type) { return SUITS.includes(type) ? type : null; }
  function eff(card, type) {
    if (type !== 'null' && rank(card) === 'J') return 'T';
    if (suit(card) === trumpSuit(type)) return 'T';
    return suit(card);
  }
  // Stärke innerhalb der "effektiven Farbe" (größer = stärker)
  function strength(card, type) {
    const r = rank(card);
    if (type === 'null') return ['7', '8', '9', 'T', 'J', 'Q', 'K', 'A'].indexOf(r);
    if (r === 'J') return 100 + (3 - SUITS.indexOf(suit(card)));
    return ['7', '8', '9', 'Q', 'K', 'T', 'A'].indexOf(r);
  }
  function trickWinner(trick, type) { // trick: [{seat,card}]
    const led = eff(trick[0].card, type);
    let best = trick[0];
    for (const t of trick.slice(1)) {
      const e = eff(t.card, type), be = eff(best.card, type);
      if (e === be) { if (strength(t.card, type) > strength(best.card, type)) best = t; }
      else if (e === 'T') best = t;
      else if (be !== 'T' && be !== led && e === led) best = t;
    }
    return best.seat;
  }
  function legalCards(hand, trick, type) {
    if (!trick.length) return hand.slice();
    const led = eff(trick[0].card, type);
    const follow = hand.filter(c => eff(c, type) === led);
    return follow.length ? follow : hand.slice();
  }
  // Sortierung der Hand
  function sortHand(hand, type, order) {
    const t = type || 'grand';
    const suitOrder = Array.isArray(order) && order.length === 4 ? order : order === 'alt' ? ['c', 'h', 's', 'd'] : ['c', 's', 'h', 'd'];
    const key = c => {
      const e = eff(c, t);
      let g = e === 'T' ? 0 : 1 + suitOrder.indexOf(e);
      return g * 1000 + (999 - strength(c, t));
    };
    return hand.slice().sort((a, b) => key(a) - key(b));
  }
  function trumpOrder(type) {
    if (type === 'grand' || type === 'ramsch') return JACKS.slice();
    const t = trumpSuit(type);
    return JACKS.concat(['A', 'T', 'K', 'Q', '9', '8', '7'].map(r => t + r));
  }
  // Spitzen: positive Zahl = mit, negative = ohne
  function matadors(cards, type) {
    const order = trumpOrder(type);
    const has = order[0] && cards.includes(order[0]);
    let n = 0;
    for (const c of order) { if (cards.includes(c) === has) n++; else break; }
    return has ? n : -n;
  }

  // ---------- Partie (mehrere Spiele) ----------
  function newMatch(names, rules, firstDealer) {
    return {
      v: 1,
      names: names.slice(0, 3),
      rules: Object.assign({}, DEFAULT_RULES, rules || {}),
      dealer: (firstDealer == null ? rnd(3) : firstDealer) - 1, // wird bei startGame erhöht
      gameNo: 0,
      history: [],
      totals: [0, 0, 0],
      queue: [],          // 'B' = Bockspiel, 'R' = Ramschspiel
      g: null,
      seq: 0
    };
  }
  const roles = dealer => ({ V: (dealer + 1) % 3, M: (dealer + 2) % 3, H: dealer });

  function startGame(m) {
    if (m.repeatDealer) m.repeatDealer = false; // nachgeholter Ramsch: gleicher Geber
    else m.dealer = (m.dealer + 1) % 3;
    m.gameNo++;
    const d = shuffle(newDeck());
    const R = roles(m.dealer);
    const hands = [[], [], []];
    // 3 - Skat 2 - 4 - 3, beginnend bei Vorhand (Reihenfolge egal, aber hübsch)
    const order = [R.V, R.M, R.H];
    let i = 0;
    const give = n => order.forEach(s => { for (let k = 0; k < n; k++) hands[s].push(d[i++]); });
    give(3); const skat = [d[i++], d[i++]]; give(4); give(3);
    const head = m.queue[0] || null;
    const g = {
      phase: 'bid', hands, skat, origSkat: skat.slice(),
      bock: head === 'B' || head === 'BR',
      forcedRamsch: head === 'R' || head === 'BR',
      bid: { value: 0, stage: 1, sayer: R.M, listener: R.V, turn: R.M, said: [null, null, null] },
      declarer: null, game: null, tookSkat: false, cards12: null,
      trick: [], leader: R.V, turn: null, tricks: [], won: [[], [], []], trickCount: [0, 0, 0],
      lastTrick: null, kontra: { k: false, kBy: null, re: false, declLeft: null },
      schieb: null, result: null, ready: [false, false, false], log: []
    };
    m.g = g;
    if (g.forcedRamsch && m.rules.ramschGrandHand) {
      const R = roles(m.dealer);
      g.phase = 'grandask'; g.gask = { order: [R.V, R.M, R.H], idx: 0, said: [null, null, null] }; g.turn = R.V;
    } else if (g.forcedRamsch) startRamsch(m);
    m.seq++;
    return m;
  }

  function startRamsch(m) {
    const g = m.g, R = roles(m.dealer);
    g.game = { type: 'ramsch' };
    g.declarer = null;
    if (m.rules.schieben) {
      g.phase = 'schieben';
      g.schieb = { order: [R.V, R.M, R.H], idx: 0, doubles: 0, picked: false };
      g.turn = R.V;
    } else beginPlay(m);
  }

  function beginPlay(m) {
    const g = m.g, R = roles(m.dealer);
    const first = g.grandInRamsch ? g.declarer : R.V; // Grand Hand im Ramsch: Spieler kommt raus
    g.phase = 'play'; g.leader = first; g.turn = first; g.trick = [];
  }
  // Ramschrunde: reihum fragen, ob jemand Grand Hand spielt
  function actGrandAsk(m, seat, yes) {
    const g = m.g, q = g.gask;
    if (g.phase !== 'grandask' || g.turn !== seat) return err('Du bist nicht dran');
    if (yes) {
      q.said[seat] = 'Grand Hand!';
      g.grandInRamsch = true; g.forcedRamsch = false;
      g.declarer = seat; g.bid.value = 0; g.tookSkat = false;
      g.game = { type: 'grand', hand: true, ouvert: false, schneiderA: false, schwarzA: false };
      g.cards12 = g.hands[seat].concat(g.skat);
      g.phase = 'announce'; g.turn = null; g.acks = [false, false, false]; g.acks[seat] = true;
      return { ok: true };
    }
    q.said[seat] = 'Nein'; q.idx++;
    if (q.idx >= 3) startRamsch(m); else g.turn = q.order[q.idx];
    return { ok: true };
  }

  function err(msg) { return { error: msg }; }

  // ---------- Aktionen ----------
  function act(m, seat, a) {
    const g = m.g;
    if (!g) return err('Kein Spiel');
    let r;
    switch (a.a) {
      case 'bid': case 'hold': case 'pass': r = actBid(m, seat, a); break;
      case 'pickup': r = actPickup(m, seat); break;
      case 'hand': r = actHand(m, seat); break;
      case 'discard': r = actDiscard(m, seat, a.cards); break;
      case 'undiscard': r = actUndiscard(m, seat); break;
      case 'declare': r = actDeclare(m, seat, a); break;
      case 'play': r = actPlay(m, seat, a.card); break;
      case 'kontra': r = actKontra(m, seat); break;
      case 're': r = actRe(m, seat); break;
      case 'schieb': r = actSchieb(m, seat, a); break;
      case 'ready': r = actReady(m, seat); break;
      case 'ack': r = actAck(m, seat); break;
      case 'grandhand': r = actGrandAsk(m, seat, true); break;
      case 'nogrand': r = actGrandAsk(m, seat, false); break;
      default: r = err('Unbekannte Aktion');
    }
    if (!r || !r.error) m.seq++;
    return r || { ok: true };
  }

  function actBid(m, seat, a) {
    const g = m.g, b = g.bid;
    if (g.phase !== 'bid') return err('Es wird nicht gereizt');
    if (b.turn !== seat) return err('Du bist nicht dran');
    if (b.stage === 3) { // Vorhand: spielen (18) oder passen
      if (a.a === 'bid') { b.value = 18; b.said[seat] = '18'; return setDeclarer(m, seat); }
      if (a.a === 'pass') { b.said[seat] = 'Passe'; return allPassed(m); }
      return err('Ungültig');
    }
    const isSayer = seat === b.sayer;
    if (isSayer) {
      if (a.a === 'bid') {
        const v = a.v || nextBid(b.value);
        if (!BIDS.includes(v) || v <= b.value) return err('Ungültiger Reizwert');
        b.value = v; b.said[seat] = String(v); b.turn = b.listener; return { ok: true };
      }
      if (a.a === 'pass') { b.said[seat] = 'Passe'; return stageEnd(m, b.listener); }
    } else {
      if (a.a === 'hold') { b.said[seat] = 'Ja'; b.turn = b.sayer; return { ok: true }; }
      if (a.a === 'pass') { b.said[seat] = 'Passe'; return stageEnd(m, b.sayer); }
    }
    return err('Ungültig');
  }
  function stageEnd(m, winner) {
    const g = m.g, b = g.bid, R = roles(m.dealer);
    if (b.stage === 1) {
      b.stage = 2; b.sayer = R.H; b.listener = winner; b.turn = R.H; return { ok: true };
    }
    // Stufe 2 beendet
    if (b.value > 0) return setDeclarer(m, winner);
    b.stage = 3; b.turn = winner; b.sayer = winner; b.listener = null; // muss Vorhand sein
    return { ok: true };
  }
  function setDeclarer(m, seat) {
    const g = m.g;
    g.declarer = seat; g.phase = 'skat'; g.turn = seat; return { ok: true };
  }
  function allPassed(m) {
    const g = m.g;
    if (m.rules.ramsch) { g.log.push('Alle passen – Ramsch'); startRamsch(m); return { ok: true }; }
    // eingepasst: neu geben
    m.history.push({ no: m.gameNo, dealer: m.dealer, text: 'Eingepasst', deltas: [0, 0, 0], bock: g.bock, totals: m.totals.slice(), passed: true });
    startGame(m);
    return { ok: true, repassed: true };
  }
  function actPickup(m, seat) {
    const g = m.g;
    if (g.phase !== 'skat' || seat !== g.declarer) return err('Nicht möglich');
    g.hands[seat] = g.hands[seat].concat(g.skat); g.skat = []; g.tookSkat = true; g.phase = 'discard';
    return { ok: true };
  }
  function actHand(m, seat) {
    const g = m.g;
    if (g.phase !== 'skat' || seat !== g.declarer) return err('Nicht möglich');
    g.tookSkat = false; g.phase = 'declare'; return { ok: true };
  }
  function actDiscard(m, seat, cards) {
    const g = m.g;
    if (g.phase !== 'discard' || seat !== g.declarer) return err('Nicht möglich');
    if (!Array.isArray(cards) || cards.length !== 2 || cards[0] === cards[1]) return err('Genau zwei Karten drücken');
    const h = g.hands[seat];
    if (!cards.every(c => h.includes(c))) return err('Karte nicht auf der Hand');
    g.hands[seat] = h.filter(c => !cards.includes(c)); g.skat = cards.slice(); g.phase = 'declare';
    return { ok: true };
  }
  function actUndiscard(m, seat) {
    const g = m.g;
    if (g.phase !== 'declare' || seat !== g.declarer || !g.tookSkat) return err('Nicht möglich');
    g.hands[seat] = g.hands[seat].concat(g.skat); g.skat = []; g.phase = 'discard';
    return { ok: true };
  }
  function actDeclare(m, seat, a) {
    const g = m.g;
    if (g.phase !== 'declare' || seat !== g.declarer) return err('Nicht möglich');
    const type = a.type;
    if (![...SUITS, 'grand', 'null'].includes(type)) return err('Unbekanntes Spiel');
    const hand = !g.tookSkat;
    let ouvert = !!a.ouvert, schneiderA = !!a.schneiderA, schwarzA = !!a.schwarzA;
    if (type === 'null') { schneiderA = schwarzA = false; }
    else {
      if (ouvert && !hand) return err('Ouvert (außer Null) nur als Handspiel');
      if ((schneiderA || schwarzA) && !hand) return err('Ansagen nur im Handspiel');
      if (ouvert) { schneiderA = schwarzA = true; }
      if (schwarzA) schneiderA = true;
    }
    g.game = { type, hand, ouvert, schneiderA, schwarzA };
    g.cards12 = g.hands[seat].concat(g.skat);
    // Ansage allen zeigen – jeder bestätigt mit OK, dann geht es los
    g.phase = 'announce'; g.turn = null;
    g.acks = [false, false, false]; g.acks[seat] = true;
    return { ok: true };
  }
  function actAck(m, seat) {
    const g = m.g;
    if (g.phase !== 'announce') return err('Nicht möglich');
    g.acks[seat] = true;
    if (g.acks.every(x => x)) beginPlay(m);
    return { ok: true };
  }
  function actKontra(m, seat) {
    const g = m.g;
    if (!m.rules.kontra) return err('Kontra ist ausgeschaltet');
    if (g.phase !== 'play' || g.game.type === 'ramsch') return err('Nicht möglich');
    if (seat === g.declarer || g.kontra.k) return err('Nicht möglich');
    if (g.hands[seat].length < 10) return err('Kontra nur vor der eigenen ersten Karte');
    g.kontra.k = true; g.kontra.kBy = seat; g.kontra.declLeft = g.hands[g.declarer].length;
    return { ok: true };
  }
  function actRe(m, seat) {
    const g = m.g;
    if (g.phase !== 'play' || seat !== g.declarer || !g.kontra.k || g.kontra.re) return err('Nicht möglich');
    if (g.hands[seat].length !== g.kontra.declLeft) return err('Re nur direkt nach Kontra');
    g.kontra.re = true; return { ok: true };
  }
  function actSchieb(m, seat, a) {
    const g = m.g, s = g.schieb;
    if (g.phase !== 'schieben' || g.turn !== seat) return err('Du bist nicht dran');
    if (a.mode === 'pickup') {
      if (s.picked) return err('Schon aufgenommen');
      g.hands[seat] = g.hands[seat].concat(g.skat); g.skat = []; s.picked = true; return { ok: true };
    }
    if (a.mode === 'push') {
      if (!s.picked) return err('Erst aufnehmen');
      const cards = a.cards || [];
      const h = g.hands[seat];
      if (cards.length !== 2 || cards[0] === cards[1] || !cards.every(c => h.includes(c))) return err('Genau zwei Karten wählen');
      if (m.rules.schiebenNoJacks && cards.some(c => rank(c) === 'J')) return err('Buben dürfen nicht geschoben werden');
      g.hands[seat] = h.filter(c => !cards.includes(c)); g.skat = cards.slice();
    } else if (a.mode === 'pass') {
      if (s.picked) return err('Karten erst weitergeben');
      s.doubles++;
    } else return err('Ungültig');
    s.picked = false; s.idx++;
    if (s.idx >= 3) beginPlay(m); else g.turn = s.order[s.idx];
    return { ok: true };
  }
  function actPlay(m, seat, card) {
    const g = m.g;
    if (g.phase !== 'play') return err('Es wird nicht gespielt');
    if (g.turn !== seat) return err('Du bist nicht dran');
    const h = g.hands[seat];
    if (!h.includes(card)) return err('Karte nicht auf der Hand');
    if (!legalCards(h, g.trick, g.game.type).includes(card)) return err('Farbe bedienen!');
    g.hands[seat] = h.filter(c => c !== card);
    g.trick.push({ seat, card });
    if (g.trick.length < 3) { g.turn = (seat + 1) % 3; return { ok: true }; }
    const w = trickWinner(g.trick, g.game.type);
    const cards = g.trick.map(t => t.card);
    g.tricks.push({ cards: g.trick.slice(), winner: w });
    g.won[w].push(...cards); g.trickCount[w]++;
    g.lastTrick = { cards: g.trick.slice(), winner: w, n: g.tricks.length };
    g.trick = []; g.leader = w; g.turn = w;
    // vorzeitiges Ende
    const t = g.game.type;
    if (t === 'null' && w === g.declarer) return finish(m, true);
    if (t !== 'null' && t !== 'ramsch' && g.game.schwarzA && w !== g.declarer) return finish(m, true);
    if (g.tricks.length === 10) return finish(m, false);
    return { ok: true };
  }
  function actReady(m, seat) {
    const g = m.g;
    if (g.phase !== 'done') return err('Spiel läuft noch');
    g.ready[seat] = true;
    if (g.ready.every(x => x)) startGame(m);
    return { ok: true };
  }

  // ---------- Abrechnung ----------
  function gameName(game) {
    if (!game) return '';
    if (game.type === 'ramsch') return 'Ramsch';
    let n = game.type === 'grand' ? 'Grand' : game.type === 'null' ? 'Null' : SUITNAME[game.type];
    if (game.hand) n += ' Hand';
    if (game.ouvert) n += ' Ouvert';
    else if (game.type !== 'null') {
      if (game.schwarzA) n += ' Schwarz angesagt';
      else if (game.schneiderA) n += ' Schneider angesagt';
    }
    return n;
  }
  function calcNormal(m) {
    const g = m.g, d = g.declarer, game = g.game, bidV = g.bid.value;
    const declPts = points(g.won[d]) + points(g.skat);
    const declTricks = g.trickCount[d];
    const allTricks = g.tricks.length;
    const res = { kind: 'normal', declarer: d, game, declPts, oppPts: 120 - declPts, bid: bidV, skat: g.skat.slice(), origSkat: g.origSkat.slice() };
    let won, value, parts = [];
    if (game.type === 'null') {
      value = game.ouvert ? (game.hand ? 59 : 46) : (game.hand ? 35 : 23);
      won = declTricks === 0;
      parts.push(gameName(game) + ' = ' + value);
      if (value < bidV) { won = false; res.overbid = true; parts.push('überreizt (' + bidV + ')'); }
    } else {
      const base = BASE[game.type];
      const mat = matadors(g.cards12, game.type);
      const nm = Math.abs(mat);
      const schneider = declPts >= 90 || declPts <= 30;
      const schwarz = allTricks === 10 && (declTricks === 10 || declTricks === 0);
      const lostSchwarzA = game.schwarzA && declTricks < allTricks;
      won = declPts >= 61;
      if (game.schneiderA && declPts < 90) won = false;
      if (game.schwarzA && (declTricks !== 10 || allTricks !== 10)) won = false;
      if (lostSchwarzA) won = false;
      let mult = nm + 1;
      parts.push((mat > 0 ? 'mit ' : 'ohne ') + nm, 'Spiel 1');
      if (game.hand) { mult++; parts.push('Hand'); }
      if (schneider || game.schneiderA) { mult++; parts.push('Schneider'); }
      if (game.schneiderA) { mult++; parts.push('angesagt'); }
      if (schwarz || game.schwarzA) { mult++; parts.push('Schwarz'); }
      if (game.schwarzA) { mult++; parts.push('angesagt'); }
      if (game.ouvert) { mult++; parts.push('Ouvert'); }
      value = mult * base;
      res.mult = mult; res.base = base; res.mat = mat; res.schneider = schneider; res.schwarz = schwarz;
      parts = [parts.join(', ') + ' → ' + mult + ' × ' + base + ' = ' + value];
      if (value < bidV) {
        won = false; res.overbid = true;
        value = Math.ceil(bidV / base) * base;
        parts.push('überreizt (Reizwert ' + bidV + ') → ' + value);
      }
    }
    let score = won ? value : -2 * value;
    if (!won) parts.push('verloren: doppelt');
    if (g.kontra.k) { score *= 2; parts.push('Kontra ×2'); }
    if (g.kontra.re) { score *= 2; parts.push('Re ×2'); }
    if (g.bock) { score *= 2; parts.push('Bock ×2'); }
    const deltas = [0, 0, 0];
    deltas[d] = score;
    if (m.rules.scoring === 'seeger') {
      if (won) { deltas[d] += 50; parts.push('+50 gewonnen'); }
      else {
        deltas[d] -= 50;
        for (let s = 0; s < 3; s++) if (s !== d) deltas[s] += 40;
        parts.push('−50, Gegner je +40');
      }
    }
    Object.assign(res, { won, value, score, deltas, parts });
    // Bock-Auslöser
    const trig = [];
    if (m.rules.bock && game.type !== 'null') {
      if (m.rules.bock6060 && declPts === 60) trig.push('60:60');
      if (m.rules.bock120 && allTricks === 10 && (declPts === 120 || declPts === 0)) trig.push('120:0');
      if (m.rules.bockGrandHand && game.type === 'grand' && game.hand && !won) trig.push('Grand Hand verloren');
    }
    if (m.rules.bock && m.rules.bockKontra && g.kontra.k) {
      const lastWasRe = g.kontra.re;
      if ((lastWasRe && !won) || (!lastWasRe && won)) trig.push(lastWasRe ? 'Re verloren' : 'Kontra verloren');
    }
    // Grand Hand statt Ramsch (Ramschrunde): löst keine Bockrunde aus
    res.bockTriggers = g.grandInRamsch ? [] : trig;
    return res;
  }
  function calcRamsch(m) {
    const g = m.g;
    const pts = [0, 1, 2].map(s => points(g.won[s]));
    const last = g.tricks.length ? g.tricks[g.tricks.length - 1].winner : 0;
    pts[last] += points(g.skat);
    const res = { kind: 'ramsch', pts, skat: g.skat.slice(), origSkat: g.origSkat.slice(), tricks: g.trickCount.slice() };
    let mult = 1; const parts = [];
    const doubles = g.schieb ? g.schieb.doubles : 0;
    for (let i = 0; i < doubles; i++) mult *= 2;
    if (doubles) parts.push(doubles + '× geschoben ×' + Math.pow(2, doubles));
    if (g.bock) { mult *= 2; parts.push('Bock ×2'); }
    const deltas = [0, 0, 0];
    const dm = g.trickCount.findIndex(t => t === 10);
    if (m.rules.durchmarsch && dm >= 0) {
      deltas[dm] = 120 * mult; res.durchmarsch = dm; parts.unshift('Durchmarsch: +120');
    } else {
      const max = Math.max(...pts);
      const losers = [0, 1, 2].filter(s => pts[s] === max);
      let jm = 1;
      if (m.rules.jungfrau) {
        const j = g.trickCount.filter(t => t === 0).length;
        if (j) { jm = Math.pow(2, j); parts.push('Jungfrau ×' + jm); res.jungfrau = j; }
      }
      losers.forEach(s => { deltas[s] = -max * mult * jm; });
      res.losers = losers;
      parts.unshift('Meiste Augen: ' + max);
    }
    Object.assign(res, { deltas, parts, bockTriggers: [] });
    return res;
  }
  function finish(m, early) {
    const g = m.g;
    g.phase = 'done'; g.turn = null;
    const res = g.game.type === 'ramsch' ? calcRamsch(m) : calcNormal(m);
    res.early = early; res.bock = g.bock;
    for (let s = 0; s < 3; s++) m.totals[s] += res.deltas[s];
    // Warteschlange: aktuelles Bock/Ramsch-Spiel verbraucht
    if (g.grandInRamsch) m.repeatDealer = true;      // Ramsch wird nachgeholt, gleicher Geber
    else if (m.queue.length) m.queue.shift();
    if (m.rules.bock) {
      for (const t of res.bockTriggers) {
        const L = m.rules.bockLen || 3;
        // Bockrunde: L Bockspiele, ggf. danach L Ramschspiele
        for (let i = 0; i < L; i++) m.queue.push('B');
        if (m.rules.ramschAfterBock) for (let i = 0; i < L; i++) m.queue.push('R');
      }
    }
    g.result = res;
    const text = res.kind === 'ramsch' ? 'Ramsch' + (res.durchmarsch != null ? ' – Durchmarsch' : '')
      : m.names[res.declarer] + ': ' + gameName(res.game) + (res.won ? ' gewonnen' : ' verloren') + ' (' + res.declPts + ')';
    m.history.push({ no: m.gameNo, dealer: m.dealer, text, deltas: res.deltas.slice(), bock: g.bock, kontra: g.kontra.k ? (g.kontra.re ? 'Re' : 'Kontra') : '', totals: m.totals.slice(), trig: res.bockTriggers.slice() });
    return { ok: true, finished: true };
  }

  // ---------- Ansicht für einen Platz ----------
  function view(m, seat) {
    const g = m.g;
    const R = roles(m.dealer);
    const v = {
      seat, seq: m.seq, names: m.names, rules: m.rules, dealer: m.dealer, roles: R, gameNo: m.gameNo,
      totals: m.totals, history: m.history, queue: m.queue.slice(0, 9)
    };
    if (!g) return v;
    const type = g.game ? g.game.type : null;
    const sortType = type || (g.phase === 'schieben' ? 'ramsch' : 'grand');
    Object.assign(v, {
      phase: g.phase, bock: g.bock,
      hand: sortHand(g.hands[seat], sortType === 'ramsch' ? 'grand' : sortType),
      counts: g.hands.map(h => h.length),
      skatCount: g.skat.length,
      bid: { value: g.bid.value, stage: g.bid.stage, sayer: g.bid.sayer, listener: g.bid.listener, turn: g.bid.turn, said: g.bid.said, next: nextBid(g.bid.value) },
      declarer: g.declarer, game: g.game, gameName: gameName(g.game), tookSkat: g.tookSkat,
      trick: g.trick, turn: g.phase === 'bid' ? g.bid.turn : g.turn, leader: g.leader,
      lastTrick: g.lastTrick, trickCount: g.trickCount, tricksPlayed: g.tricks.length,
      kontra: g.kontra, ready: g.ready, acks: g.acks || null,
      gask: g.gask ? { said: g.gask.said } : null, grandInRamsch: !!g.grandInRamsch
    });
    if (g.phase === 'play' && g.turn === seat) v.legal = legalCards(g.hands[seat], g.trick, type);
    // eigener Skat (gedrückt) sichtbar für den Alleinspieler
    if (seat === g.declarer && g.tookSkat && g.phase !== 'discard') v.mySkat = g.skat.slice();
    // Ouvert: Karten des Alleinspielers offen (Null Ouvert ab Spielbeginn)
    if (g.game && g.game.ouvert && g.phase === 'play' && g.declarer !== seat) {
      v.open = { seat: g.declarer, cards: sortHand(g.hands[g.declarer], type) };
    }
    if (g.phase === 'schieben') {
      v.schieb = { doubles: g.schieb.doubles, picked: g.schieb.picked, idx: g.schieb.idx, noJacks: m.rules.schiebenNoJacks };
    }
    if (g.phase === 'play' && m.rules.kontra && type !== 'ramsch') {
      v.canKontra = seat !== g.declarer && !g.kontra.k && g.hands[seat].length === 10;
      v.canRe = seat === g.declarer && g.kontra.k && !g.kontra.re && g.hands[seat].length === g.kontra.declLeft;
    }
    if (g.phase === 'done') {
      v.result = g.result;
      v.allHands = { won: g.won.map(w => points(w)) };
    }
    if (seat === g.declarer && g.phase === 'declare') v.cards12 = g.tookSkat ? g.hands[seat].concat(g.skat) : g.hands[seat].slice();
    return v;
  }

  // Vorschau Spielwert für den Alleinspieler (beim Ansagen)
  function previewValue(cards, type, opts) {
    if (type === 'null') return { value: opts.ouvert ? (opts.hand ? 59 : 46) : (opts.hand ? 35 : 23) };
    const mat = matadors(cards, type);
    let mult = Math.abs(mat) + 1;
    if (opts.hand) mult++;
    let sA = opts.schneiderA, wA = opts.schwarzA;
    if (opts.ouvert) { sA = wA = true; }
    if (wA) sA = true;
    if (sA) mult += 2;
    if (wA) mult += 2;
    if (opts.ouvert) mult++;
    return { value: mult * BASE[type], mat, mult, base: BASE[type] };
  }

  // ---------- Computer-Spieler (Demo) ----------
  function bestGame(cards, withSkatUnknown) {
    // liefert {type, value, ok} für das stärkste Spiel
    const jacks = cards.filter(c => rank(c) === 'J').length;
    const aces = cards.filter(c => rank(c) === 'A').length;
    const tens = cards.filter(c => rank(c) === 'T' && cards.includes(suit(c) + 'A')).length;
    let best = null;
    for (const s of SUITS) {
      const tr = cards.filter(c => eff(c, s) === 'T').length;
      const side = aces - (cards.includes(s + 'A') ? 1 : 0);
      const score = tr * 1.0 + jacks * 0.6 + side * 0.9 + tens * 0.4;
      const need = withSkatUnknown ? 6.4 : 6.0;
      const v = (Math.abs(matadors(cards, s)) + 1) * BASE[s];
      if (score >= need && (!best || score > best.score + 0.01 || (Math.abs(score - best.score) < 0.01 && v > best.value))) best = { type: s, value: v, score };
    }
    if ((jacks >= 3 && aces >= 2) || (jacks >= 2 && aces >= 3) || (jacks === 4 && aces >= 1)) {
      const v = (Math.abs(matadors(cards, 'grand')) + 1) * 24;
      best = { type: 'grand', value: v, score: 99 };
    }
    if (!best) {
      // Null, wenn fast nur kleine Karten
      const high = cards.filter(c => ['A', 'K', 'Q'].includes(rank(c)) || (rank(c) === 'J')).length;
      const sevens = cards.filter(c => rank(c) === '7').length;
      if (high <= 1 && sevens >= 2) best = { type: 'null', value: 23, score: 0 };
    }
    return best;
  }
  function botDiscard(cards, type) {
    const cand = cards.filter(c => eff(c, type) !== 'T' && rank(c) !== 'A');
    const len = s => cards.filter(c => eff(c, type) === s).length;
    cand.sort((a, b) => {
      const sa = len(suit(a)) * 10 - PTS[rank(a)] - (rank(a) === 'T' && !cards.includes(suit(a) + 'A') ? 15 : 0);
      const sb = len(suit(b)) * 10 - PTS[rank(b)] - (rank(b) === 'T' && !cards.includes(suit(b) + 'A') ? 15 : 0);
      return sa - sb;
    });
    const pick = cand.slice(0, 2);
    while (pick.length < 2) { const r = cards.filter(c => !pick.includes(c)).sort((a, b) => PTS[rank(a)] - PTS[rank(b)])[0]; pick.push(r); }
    return pick;
  }
  function botPlay(m, seat) {
    const g = m.g, type = g.game.type;
    const hand = g.hands[seat];
    const legal = legalCards(hand, g.trick, type);
    if (legal.length === 1) return legal[0];
    const pts = c => PTS[rank(c)];
    const low = arr => arr.slice().sort((a, b) => (pts(a) - pts(b)) || (strength(a, type) - strength(b, type)))[0];
    const highPts = arr => arr.slice().sort((a, b) => (pts(b) - pts(a)) || (strength(a, type) - strength(b, type)))[0];
    const wins = c => trickWinner(g.trick.concat([{ seat, card: c }]), type) === seat;
    const winners = legal.filter(wins);
    const losers = legal.filter(c => !wins(c));
    if (type === 'ramsch' || (type === 'null' && seat === g.declarer)) {
      if (!g.trick.length) return legal.slice().sort((a, b) => strength(a, type) - strength(b, type))[0];
      if (losers.length) return losers.slice().sort((a, b) => strength(b, type) - strength(a, type))[0];
      return legal.slice().sort((a, b) => strength(a, type) - strength(b, type))[0];
    }
    if (type === 'null') { // Gegenspieler im Null: kleine Karten
      return legal.slice().sort((a, b) => strength(a, type) - strength(b, type))[0];
    }
    const decl = g.declarer;
    const isDecl = seat === decl;
    if (!g.trick.length) {
      const trumps = legal.filter(c => eff(c, type) === 'T');
      const aces = legal.filter(c => rank(c) === 'A' && eff(c, type) !== 'T');
      if (isDecl && trumps.length >= 2) return trumps.slice().sort((a, b) => strength(b, type) - strength(a, type))[0];
      if (aces.length) return aces[0];
      const side = legal.filter(c => eff(c, type) !== 'T');
      return low(side.length ? side : legal);
    }
    const curWin = trickWinner(g.trick, type);
    const partnerWinning = !isDecl && curWin !== decl;
    const last = g.trick.length === 2;
    if (partnerWinning) {
      if (last || (g.trick.length === 1 && !legal.some(c => eff(c, type) === eff(g.trick[0].card, type)))) return highPts(losers.length ? losers : legal);
      return low(losers.length ? losers : legal);
    }
    const trickPts = g.trick.reduce((s, t) => s + pts(t.card), 0);
    if (winners.length && (last || trickPts >= 10 || isDecl)) {
      return winners.slice().sort((a, b) => strength(a, type) - strength(b, type) || pts(b) - pts(a))[0];
    }
    return low(losers.length ? losers : legal);
  }
  function botAction(m, seat) {
    const g = m.g; if (!g) return null;
    const hand = g.hands[seat];
    if (g.phase === 'done') return g.ready[seat] ? null : { a: 'ready' };
    if (g.phase === 'announce') return g.acks[seat] ? null : { a: 'ack' };
    if (g.phase === 'grandask') {
      if (g.turn !== seat) return null;
      const jacks = hand.filter(c => rank(c) === 'J').length, aces = hand.filter(c => rank(c) === 'A').length;
      return (jacks >= 3 && aces >= 2) || (jacks === 4 && aces >= 1) ? { a: 'grandhand' } : { a: 'nogrand' };
    }
    if (g.phase === 'bid') {
      const b = g.bid; if (b.turn !== seat) return null;
      const bg = bestGame(hand, true);
      const max = bg ? (bg.type === 'null' ? 23 : bg.value) : 0;
      if (b.stage === 3) return max >= 18 ? { a: 'bid' } : { a: 'pass' };
      if (seat === b.sayer) { const n = nextBid(b.value); return n <= max ? { a: 'bid', v: n } : { a: 'pass' }; }
      return b.value <= max ? { a: 'hold' } : { a: 'pass' };
    }
    if (g.phase === 'skat' && g.declarer === seat) return { a: 'pickup' };
    if (g.phase === 'discard' && g.declarer === seat) {
      const bg = bestGame(hand, false) || { type: 'grand' };
      g._botType = bg.type === 'null' ? 'grand' : bg.type;
      return { a: 'discard', cards: botDiscard(hand, g._botType) };
    }
    if (g.phase === 'declare' && g.declarer === seat) {
      let type = g._botType || ((bestGame(hand, false) || {}).type) || 'grand';
      const cards = g.tookSkat ? hand.concat(g.skat) : hand;
      if (previewValue(cards, type, { hand: !g.tookSkat }).value < g.bid.value) {
        let bestV = 0;
        for (const t of [...SUITS, 'grand']) { const v = previewValue(cards, t, { hand: !g.tookSkat }).value; if (v >= g.bid.value && (!bestV || v < bestV)) { bestV = v; type = t; } }
      }
      return { a: 'declare', type };
    }
    if (g.phase === 'schieben' && g.turn === seat) {
      if (g.schieb.picked) {
        const c = hand.filter(x => !(m.rules.schiebenNoJacks && rank(x) === 'J')).sort((a, b) => PTS[rank(b)] - PTS[rank(a)]).slice(0, 2);
        return { a: 'schieb', mode: 'push', cards: c };
      }
      return { a: 'schieb', mode: 'pass' };
    }
    if (g.phase === 'play' && g.turn === seat) return { a: 'play', card: botPlay(m, seat) };
    return null;
  }

  const api = {
    botAction,
    SUITS, RANKS, PTS, BASE, BIDS, SUITNAME, RANKNAME, DEFAULT_RULES, OFFICIAL,
    suit, rank, points, newDeck, shuffle, eff, strength, trickWinner, legalCards, sortHand, matadors,
    nextBid, newMatch, startGame, act, view, roles, gameName, previewValue
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Skat = api;
})(typeof window !== 'undefined' ? window : globalThis);

(() => {
  'use strict';
  const S = window.FEST;
  const $ = (id) => document.getElementById(id);
  const cv = $('game'), ctx = cv.getContext('2d');
  const low = document.createElement('canvas'), g = low.getContext('2d');
  const params = new URLSearchParams(location.search);
  const forcePhase = params.has('t') ? Number(params.get('t')) : null; // ?t=0.6 처럼 시간대 고정 (테스트용)
  const forceSlide = params.has('slide') ? Number(params.get('slide')) : null; // ?slide=2 처럼 전광판 화면 고정 (미리보기용)
  // 통계 보내기 (stats.js). 그 파일이 막혀도 게임은 그대로 돌아가게
  const track = (name, params) => { if (window.track) window.track(name, params); };
  const FONT = '"Galmuri11", "DungGeunMo", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif';

  // ───────── 화면 크기 ─────────
  const isTouch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
  if (isTouch) document.body.classList.add('touch');

  // kpx = 월드 1픽셀이 차지하는 기기 픽셀 수(정수). 화면은 기기 픽셀 해상도로 그려서
  // 캐릭터와 카메라가 월드 픽셀보다 잘게 움직인다 (걸을 때 덜컥거리지 않게)
  let scale = 3, kpx = 3, kAuto = 3, viewW = 320, viewH = 180, ox = 0, oy = 0, camX = 0, camY = 0, vw = 0, vh = 0, dpr = 1;
  // 줌 단계: 화면 크기에 맞춘 배율(1) 대비. 처음엔 PC 40%(넓게), 폰 75%. 맵 전체가 화면에 들어오는 크기보다 작아지지는 않는다
  // 저장은 배율 값으로 (단계가 늘어도 예전 저장값이 다른 크기를 가리키지 않게)
  const ZOOMS = [0.35, 0.4, 0.5, 0.65, 0.75, 1, 1.25, 1.5, 2];
  const ZOOM_DEFAULT = ZOOMS.indexOf(isTouch ? 0.75 : 0.4);
  let zoomIdx = ZOOM_DEFAULT;
  try { const z = ZOOMS.indexOf(Number(localStorage.getItem('fest.zoomv'))); if (z >= 0) zoomIdx = z; } catch { /* 기본값 */ }
  const zoomK = (i) => Math.max(Math.max(1, Math.floor(Math.min((vw * dpr) / S.W, (vh * dpr) / S.H))), Math.round(kAuto * ZOOMS[i]));
  function resize() {
    dpr = window.devicePixelRatio || 1;
    vw = innerWidth; vh = innerHeight;
    // 폰은 화면이 작아서 더 크게 확대한다. 기기 픽셀 기준 정수배라 도트가 고르게 보인다
    const target = isTouch ? Math.min(vw / 165, vh / 150) : Math.floor(Math.min(vw / 300, vh / 170));
    kAuto = Math.max(2, Math.round(Math.max(2, target) * dpr));
    kpx = zoomK(zoomIdx);
    scale = kpx / dpr;
    viewW = Math.min(S.W, Math.ceil(vw / scale));
    viewH = Math.ceil(vh / scale); // 화면이 맵보다 길면 남는 위쪽은 하늘로 채운다 (drawSky)
    low.width = viewW * kpx; low.height = viewH * kpx;
    cv.width = Math.round(vw * dpr); cv.height = Math.round(vh * dpr);
    cv.style.width = vw + 'px'; cv.style.height = vh + 'px';
    ox = Math.floor(((vw - viewW * scale) / 2) * dpr) / dpr; oy = Math.floor(((vh - viewH * scale) / 2) * dpr) / dpr;
  }
  addEventListener('resize', resize);
  resize();
  const toScreen = (wx, wy) => [ox + (wx - camX) * scale, oy + (wy - camY) * scale];

  // ───────── 시계 / 전광판 설정 ─────────
  let clockOffset = 0;
  const now = () => Date.now() + clockOffset;
  const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* 무시 */ } } };

  let board = { festivalName: '틈락페', stageName: 'TEUM ROCK FEST', tagline: '틈 날때마다 즐기는 락페스티벌', slideSeconds: 8, setMinutes: 4, lineup: ['THE PIXEL KIDS'], slides: [] };
  const images = {};
  async function loadBoard() {
    try {
      const r = await fetch('billboard.json', { cache: 'no-store' });
      board = Object.assign(board, await r.json());
      const srcs = board.slides.filter((s) => s.type === 'image').concat(Array.isArray(board.fence) ? board.fence : []).map((s) => s && s.src);
      for (const src of srcs) if (src && !images[src]) { const im = new Image(); im.src = src; images[src] = im; }
      $('festName').textContent = board.festivalName;
      // <title>은 검색 노출용 문구(락페·부락페 키워드 포함)라 덮어쓰지 않는다
    } catch { /* 기본값 유지 */ }
  }
  loadBoard();
  setInterval(loadBoard, 60000);
  const setIndex = (T) => Math.floor(T / (board.setMinutes * 60000));
  const currentBand = (T) => board.lineup[setIndex(T) % board.lineup.length] || board.festivalName;

  // ───────── 음악: 서버 시각 기준으로 모두 같은 소절을 듣는다 ─────────
  const music = { el: null, gain: null, actx: null, dur: 0, failed: false, muted: store.get('fest.mute') === '1', syncAt: 0 };
  const songBpm = () => (board.music && board.music.bpm) || S.BPM;
  const songDur = () => music.dur || (board.music && board.music.duration) || 0;
  // 서버 시각에서 곡 위치(초)를 뽑는다. 곡 길이를 모르면 null
  function songPos(T) { const d = songDur(); return d ? ((T / 1000) % d + d) % d : null; }
  function songBeat(T) {
    const d = songDur(), bpm = songBpm();
    if (!d) return T / (60000 / bpm);
    // 내 귀에 들리는 위치를 기준으로 해야 화면과 소리가 맞는다
    const heard = music.el && !music.el.paused && music.el.readyState >= 2 ? music.el.currentTime : songPos(T);
    return Math.floor(T / 1000 / d) * 4096 + (heard - ((board.music && board.music.offset) || 0)) * bpm / 60;
  }
  function startMusic() {
    const m = board.music;
    if (!m || !m.src || music.el) return;
    const el = new Audio();
    el.src = m.src; el.loop = true; el.preload = 'auto';
    el.setAttribute('playsinline', '');
    music.el = el;
    try {
      // iOS는 audio.volume을 무시해서 거리별 음량은 GainNode로 조절한다
      const AC = window.AudioContext || window.webkitAudioContext;
      music.actx = new AC();
      music.gain = music.actx.createGain();
      music.gain.gain.value = 0;
      music.actx.createMediaElementSource(el).connect(music.gain).connect(music.actx.destination);
      music.actx.resume();
    } catch { music.actx = music.gain = null; }
    el.addEventListener('loadedmetadata', () => { music.dur = el.duration; music.syncAt = 0; });
    el.addEventListener('error', () => { music.failed = true; toast('음원 파일이 아직 없어요 (public/music/에 넣어주세요)'); });
    el.play().catch(() => {});
  }
  // 자동재생이 막혔으면 다음 터치/키 입력 때 다시 시도
  function unlockMusic() {
    if (!music.el || music.failed) return;
    if (music.actx && music.actx.state !== 'running') music.actx.resume();
    if (music.el.paused) music.el.play().catch(() => {});
  }
  addEventListener('pointerdown', unlockMusic);
  addEventListener('keydown', unlockMusic);
  function setMuted(v) {
    music.muted = v;
    store.set('fest.mute', v ? '1' : '0');
    $('sound').textContent = v ? '🔇' : '🔊';
    $('sound').classList.toggle('off', v);
  }
  function updateMusic(dt, T, wallMs) {
    const el = music.el;
    if (!el || music.failed || !music.dur) return;
    if (wallMs - music.syncAt > 1000 && !el.paused) {
      music.syncAt = wallMs;
      let diff = el.currentTime - songPos(T);
      if (diff > music.dur / 2) diff -= music.dur; else if (diff < -music.dur / 2) diff += music.dur;
      if (Math.abs(diff) > 0.25) el.currentTime = songPos(T);
    }
    // 무대에 가까울수록 크게
    const d = Math.hypot(me.x - 320, (me.y - 108) * 1.2);
    const target = music.muted ? 0 : Math.max(0.3, Math.min(1, 1.15 - d / 380));
    if (music.gain) music.gain.gain.value += (target - music.gain.gain.value) * Math.min(1, dt * 4);
    else el.volume = target;
  }

  // ───────── 색 / 시간대 ─────────
  const hex = (c) => { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const lerpA = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  const rgb = (a, al) => (al == null ? `rgb(${a})` : `rgba(${a},${al})`);
  const isLight = (c) => { const [r, gg, b] = hex(c); return r * 0.3 + gg * 0.59 + b * 0.11 > 160; };
  const shade = (c) => { const a = hex(c); return a[0] + a[1] + a[2] < 150 ? rgb(lerpA(a, [255, 255, 255], 0.3)) : rgb(a.map((v) => Math.round(v * 0.62))); };
  const KEYS = [
    { p: 0.00, sky: '#8ec9ff', hor: '#d4ecff', tint: '#ffffff', dark: 0 },
    { p: 0.36, sky: '#8ec9ff', hor: '#d4ecff', tint: '#ffffff', dark: 0 },
    { p: 0.46, sky: '#ff9a6a', hor: '#ffd27a', tint: '#ffd6b8', dark: 0.25 },
    { p: 0.55, sky: '#4a3a8a', hor: '#e0607a', tint: '#9a88c8', dark: 0.65 },
    { p: 0.62, sky: '#1a2050', hor: '#3a3a80', tint: '#565ca0', dark: 1 },
    { p: 0.88, sky: '#1a2050', hor: '#3a3a80', tint: '#565ca0', dark: 1 },
    { p: 0.95, sky: '#d8a0c0', hor: '#ffd0a0', tint: '#e0d2ee', dark: 0.3 },
    { p: 1.00, sky: '#8ec9ff', hor: '#d4ecff', tint: '#ffffff', dark: 0 },
  ].map((k) => ({ ...k, sky: hex(k.sky), hor: hex(k.hor), tint: hex(k.tint) }));
  function env(p) {
    let i = 0;
    while (i < KEYS.length - 2 && p >= KEYS[i + 1].p) i++;
    const a = KEYS[i], b = KEYS[i + 1], t = (p - a.p) / (b.p - a.p || 1);
    return { sky: lerpA(a.sky, b.sky, t), hor: lerpA(a.hor, b.hor, t), tint: lerpA(a.tint, b.tint, t), dark: a.dark + (b.dark - a.dark) * t };
  }
  const phaseLabel = (p) => (p < 0.4 ? '☀️ 낮' : p < 0.53 ? '🌇 노을' : p < 0.92 ? '🌙 밤' : '🌅 새벽');

  // 한국 시간(KST, UTC+9)의 실제 해 뜨고 지는 시각에 맞춘다. 서울 기준 근사치라 계절마다 달라진다
  const kstHours = (T) => (((T / 3600000 + 9) % 24) + 24) % 24;
  function sunTimes(T) {
    const d = new Date(T + 9 * 3600000);
    const doy = (Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 0)) / 86400000;
    const c = Math.cos((2 * Math.PI * (doy - 172)) / 365);
    return { rise: 6.35 - 1.28 * c, set: 18.6 + 1.35 * c };
  }
  // KST 시각 → 하늘 색 키프레임 위치(p). p=0이 한낮 시작, 0.46이 노을 절정, 0.62~0.88이 밤
  function kstPhase(T) {
    const { rise, set } = sunTimes(T), start = rise + 0.5;
    const pts = [[0, 0], [set - 1 - start, 0.36], [set - start, 0.46], [set + 0.5 - start, 0.55], [set + 1 - start, 0.62], [rise - 0.75 + 24 - start, 0.88], [rise + 24 - start, 0.95], [24, 1]];
    const h = (((kstHours(T) - start) % 24) + 24) % 24;
    for (let i = 1; i < pts.length; i++) {
      if (h <= pts[i][0]) { const [h0, p0] = pts[i - 1], [h1, p1] = pts[i]; return (p0 + ((h - h0) / (h1 - h0 || 1)) * (p1 - p0)) % 1; }
    }
    return 0;
  }
  const kstClock = (T) => { const h = kstHours(T); return `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`; };

  // ───────── 배경 미리 그리기 ─────────
  const bg = document.createElement('canvas');
  bg.width = S.W; bg.height = S.H;
  const mountainH = [], treeH = [];
  for (let x = 0; x < S.W; x++) {
    mountainH[x] = Math.max(2, Math.round(6 + 3 * Math.sin(x * 0.021) + 2 * Math.sin(x * 0.053 + 1) + 1.5 * Math.sin(x * 0.13 + 2)));
    treeH[x] = 1 + (S.hash(x, 3) > 0.45 ? 1 : 0) + (S.hash(x >> 2, 9) > 0.7 ? 1 : 0);
  }
  const bulbs = [];
  for (const [a, b] of [[10, 166], [474, 630]]) {
    for (let x = a; x <= b; x += 6) bulbs.push({ x, y: 49 + Math.round(Math.abs(Math.sin(((x - a) / 30) * Math.PI)) * 2), c: bulbs.length % 3 });
  }

  (function buildBg() {
    const b = bg.getContext('2d');
    const img = b.createImageData(S.W, S.H), d = img.data;
    const rng = S.mulberry32(7);
    const G1 = hex('#5f9e3c'), G2 = hex('#68a843'), GD = hex('#528c33'), GL = hex('#7cbc53');
    const DIRT = hex('#9a8455'), DIRTD = hex('#84703f'), WORN = hex('#6e8a3a');
    const REED = [hex('#6f8f3e'), hex('#8aa34a'), hex('#c9b77a'), hex('#5c7a34')];
    const FLW = [hex('#ffffff'), hex('#ffe066'), hex('#ff9ec4')];
    const onPath = (x, y) => S.PATH.some((p) => S.inRect(p, x, y));
    for (let y = 0; y < S.H; y++) {
      for (let x = 0; x < S.W; x++) {
        const i = (y * S.W + x) * 4, r = rng();
        if (y < 42) { d[i + 3] = 0; continue; }
        let c;
        if (y < 50) c = REED[(r * 4) | 0];
        else if (onPath(x, y)) c = r < 0.3 ? DIRTD : DIRT;
        else if (S.inRect(S.STANDING, x, y)) c = r < 0.28 ? DIRT : r < 0.5 ? WORN : r < 0.7 ? GD : G1;
        else {
          c = Math.floor((x + y * 0.4) / 28) % 2 ? G1 : G2;
          if (r < 0.1) c = GD; else if (r < 0.14) c = GL; else if (r < 0.0016 + 0.14) c = FLW[(r * 1000) % 3 | 0];
        }
        d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
      }
    }
    b.putImageData(img, 0, 0);
    const R = (col, x, y, w, h) => { b.fillStyle = col; b.fillRect(x, y, w, h); };
    // 갈대
    for (let x = 0; x < S.W; x += 2) if (S.hash(x, 1) > 0.4) R(S.hash(x, 2) > 0.5 ? '#b8a868' : '#7f9a44', x, 42 + (S.hash(x, 5) * 3 | 0), 1, 3);
    // 위쪽 펜스
    for (const [a, w] of [[8, 158], [474, 158]]) {
      R('#e9edf2', a, 50, w, 5); R('#c3c9d2', a, 54, w, 1);
      for (let x = a; x < a + w; x += 12) R('#9aa1ab', x, 49, 1, 7);
    }
    // 옆 펜스
    for (const x of [6, 631]) {
      R('#e9edf2', x, 50, 3, 347); R('#c3c9d2', x + 2, 50, 1, 347);
      for (let y = 50; y < 397; y += 12) R('#9aa1ab', x, y, 3, 1);
    }
    // 스탠딩존 로프
    const st = S.STANDING;
    for (let x = st.x; x <= st.x + st.w; x += 2) R('#f5d142', x, st.y + st.h, 1, 1);
    for (let y = st.y; y <= st.y + st.h; y += 2) { R('#f5d142', st.x, y, 1, 1); R('#f5d142', st.x + st.w, y, 1, 1); }
    for (const [x, y] of [[st.x, st.y + st.h], [st.x + st.w, st.y + st.h], [st.x, st.y], [st.x + st.w, st.y]]) R('#d6452f', x - 1, y - 3, 2, 4);
    // 길 가장자리 돌
    for (const p of S.PATH) for (let y = p.y; y < p.y + p.h; y += 3) { R('#b9a77a', p.x, y, 1, 1); R('#b9a77a', p.x + p.w - 1, y + 1, 1, 1); }
  })();

  // ───────── 픽셀 그리기 도구 ─────────
  let C = g;
  // 기기 픽셀 격자에 맞춘 위치 (도트는 또렷하고 움직임은 부드럽게)
  const snap = (v) => Math.round(v * kpx) / kpx;
  const R = (col, x, y, w, h) => { C.fillStyle = col; C.fillRect(x, y, w, h); };

  function drawPerson(c, p, beat, t) {
    const prev = C; C = c;
    const L = p.look;
    const skin = S.SKIN[L[0]], hair = S.HAIR[L[1]], shirt = S.SHIRT[L[2]], pants = S.PANTS[L[3]];
    const hatC = S.SHIRT[(L[2] + 4) % S.SHIRT.length];
    const x = snap(p.x), y = snap(p.y), a = p.a, sd = p.seed || 0;
    let bob = 0, jump = 0;
    if (a === 2) bob = Math.floor(beat * 2 + (sd % 2)) % 2;
    if (a === 3) jump = Math.round(Math.abs(Math.sin((beat + sd * 0.37) * Math.PI)) * 5);
    const sit = !!p.sit;
    const walk = p.moving && !sit ? Math.floor(t * 8 + sd) % 2 : -1;
    R('rgba(0,0,0,0.28)', x - 3, y - 1, 7, 2);
    const top = y - 12 - jump + bob + (sit ? 3 : 0);
    const shoe = '#2a2226';
    if (sit) {
      R(pants, x - 3, top + 8, 7, 1);
      R(shoe, x - 3, top + 9, 2, 1); R(shoe, x + 2, top + 9, 2, 1);
    } else {
      const sp = a === 3 && jump > 1 ? 1 : 0;
      const lh = walk === 0 ? 1 : 2, rh = walk === 1 ? 1 : 2;
      R(pants, x - 2, top + 8, 5, 1);
      R(pants, x - 2 - sp, top + 9, 2, lh); R(pants, x + 1 + sp, top + 9, 2, rh);
      R(shoe, x - 2 - sp, top + 9 + lh, 2, 1); R(shoe, x + 1 + sp, top + 9 + rh, 2, 1);
    }
    R(shirt, x - 2, top + 4, 5, 4);
    const shirtStyle = L[7] | 0, hairStyle = L[6] | 0;
    const ink = isLight(shirt) ? '#2a2a2a' : '#ffffff';
    if (shirtStyle === 1) { R(ink, x - 2, top + 5, 5, 1); R(ink, x - 2, top + 7, 5, 1); }
    else if (shirtStyle === 2) { R(ink, x - 1, top + 5, 3, 2); R('#ff4fa3', x, top + 5, 1, 1); }
    else if (shirtStyle === 3) { const dk = shade(shirt); for (let yy = 0; yy < 4; yy++) for (let xx = (yy % 2); xx < 5; xx += 2) R(dk, x - 2 + xx, top + 4 + yy, 1, 1); }
    if (hairStyle === 1) {
      if (p.f === 1) R(hair, x - 3, top + 2, 7, 4);
      else if (p.f === 0) { R(hair, x - 3, top + 2, 1, 4); R(hair, x + 3, top + 2, 1, 4); }
      else R(hair, p.f === 2 ? x + 1 : x - 3, top + 2, 3, 4);
    }
    const up =(s) => { const ax = x + 3 * s; R(skin, ax, top - 2, 1, 6); R(shirt, ax, top + 4, 1, 1); };
    const down = (s) => { const ax = x + 3 * s; R(shirt, ax, top + 4, 1, 1); R(skin, ax, top + 5, 1, 2); };
    const out = (s) => { const ax = x + 3 * s; R(shirt, ax, top + 4, 1, 1); R(skin, ax, top + 3, 1, 1); R(skin, ax + s, top + 1, 1, 2); };
    if (a === 1) { up(-1); up(1); }
    else if (a === 2) { if (Math.floor(beat) % 2) { up(-1); down(1); } else { down(-1); up(1); } }
    else if (a === 3) { out(-1); out(1); }
    else { down(-1); down(1); }
    const hy = top;
    const mohawk = hairStyle === 2, cap = mohawk ? skin : hair;
    R(cap, x - 2, hy, 5, 1); R(cap, x - 3, hy + 1, 7, 1);
    if (p.f === 1) R(cap, x - 3, hy + 2, 7, 2);
    else {
      R(skin, x - 2, hy + 2, 5, 2);
      if (p.f === 0) {
        if (!mohawk) { R(hair, x - 3, hy + 2, 1, 1); R(hair, x + 3, hy + 2, 1, 1); }
        R('#1a1418', x - 1, hy + 2, 1, 1); R('#1a1418', x + 1, hy + 2, 1, 1);
      } else {
        const s = p.f === 2 ? -1 : 1;
        if (!mohawk) R(hair, s < 0 ? x + 1 : x - 3, hy + 2, 3, 2);
        R('#1a1418', x + s, hy + 2, 1, 1);
      }
    }
    if (mohawk) R(hair, x - 1, hy - 3, 2, p.f === 1 ? 7 : 4);
    else if (hairStyle === 3) R(hair, x - 1, hy - 2, 3, 2);
    if (L[4] === 3) {
      R(hatC, x - 3, hy + 1, 7, 1);
      if (p.f !== 0) R(hatC, p.f === 2 ? x + 3 : x - 4, hy + 1, 1, 3);
    } else if (L[4] === 1) {
      R(hatC, x - 3, hy - 1, 7, 2);
      if (p.f === 0) R(hatC, x - 3, hy + 1, 7, 1); else if (p.f === 2) R(hatC, x - 5, hy + 1, 3, 1); else if (p.f === 3) R(hatC, x + 3, hy + 1, 3, 1);
    } else if (L[4] === 2) {
      R(hatC, x - 3, hy - 2, 7, 3); R(hatC, x - 4, hy + 1, 9, 1);
    }
    if (p.flag) {
      const fl = S.FLAGS[(p.flagIdx ?? sd) % S.FLAGS.length].c, fx = x + 4;
      R('#d8d8d8', fx, top - 9, 1, 15);
      for (let i = 0; i < 7; i++) {
        const dy = Math.round(Math.sin(t * 5 - i * 0.8 + sd) * (i / 6) * 1.2);
        R(fl[0], fx + 1 + i, top - 9 + dy, 1, 2); R(fl[1], fx + 1 + i, top - 7 + dy, 1, 3);
      }
    }
    C = prev;
  }

  function drawMat(m, mine) {
    const [x, y, pat] = m, W = S.MAT_W, H = S.MAT_H;
    R('rgba(0,0,0,0.18)', x + 1, y + 1, W, H);
    switch (pat) {
      case 0: R('#f2f4f7', x, y, W, H); R('#d6dbe3', x, y + H - 1, W, 1); R('#e1e5ec', x + W / 2, y, 1, H); break;
      case 1: R('#9fd3f5', x, y, W, H); for (let i = 0; i < H; i += 3) R('#e6f5ff', x, y + i, W, 1); break;
      case 2: for (let yy = 0; yy < H; yy += 3) for (let xx = 0; xx < W; xx += 3) R(((xx + yy) / 3) % 2 ? '#e23d3d' : '#ffffff', x + xx, y + yy, 3, 3); break;
      case 3: R('#e89a2a', x, y, W, H); R('#f7d154', x + 1, y + 1, W - 2, H - 2); break;
      case 4: R('#f6a6c8', x, y, W, H); for (let yy = 2; yy < H; yy += 4) for (let xx = 2; xx < W; xx += 4) R('#ffffff', x + xx + (yy % 8 ? 2 : 0), y + yy, 1, 1); break;
      default: R('#4f9e7a', x, y, W, H); for (let i = 0; i < W; i += 4) R('#3c7f60', x + i, y, 1, H); for (let i = 0; i < H; i += 4) R('#3c7f60', x, y + i, W, 1); R('#f2d16b', x + 2, y, 1, H);
    }
    if (mine) { const c = '#ffd84a'; R(c, x - 1, y - 1, 3, 1); R(c, x - 1, y - 1, 1, 3); R(c, x + W - 2, y - 1, 3, 1); R(c, x + W, y - 1, 1, 3); R(c, x - 1, y + H, 3, 1); R(c, x - 1, y + H - 2, 1, 3); R(c, x + W - 2, y + H, 3, 1); R(c, x + W, y + H - 2, 1, 3); }
  }

  // 걸어가는 목적지 표시: 바닥에 납작한 노란 고리, 누른 직후엔 크게 퍼진다
  function drawWalkMark(tg, ts) {
    const x = Math.round(tg.x), y = Math.round(tg.y), k = Math.max(0, 1 - (ts - tg.at) / 250), w = 3 + Math.round(k * 3), c = '#ffd84a';
    R(c, x - w, y - 1, 1, 1); R(c, x + w, y - 1, 1, 1); R(c, x - w + 1, y - 2, 2 * w - 1, 1); R(c, x - w + 1, y, 2 * w - 1, 1);
  }

  function drawFlag(f, t) {
    R('#8a8f99', f.x - 1, f.y - 1, 3, 1);
    R('#cfd3da', f.x, f.y - f.h, 1, f.h);
    R('#ffd84a', f.x, f.y - f.h - 1, 1, 1);
    const n = f.c.length;
    for (let i = 0; i < 12; i++) {
      const dy = Math.round(Math.sin(t * 4 - i * 0.55 + f.x) * (i / 11) * 1.6);
      for (let r = 0; r < 8; r++) {
        let col;
        if (f.s === 0) col = f.c[Math.min(n - 1, Math.floor((r * n) / 8))];
        else if (f.s === 1) col = f.c[i < 6 ? 0 : 1];
        else col = i >= 4 && i <= 7 && r >= 2 && r <= 5 ? f.c[1] : f.c[0];
        R(col, f.x + 1 + i, f.y - f.h + r + dy, 1, 1);
      }
    }
  }

  function bandLooks(si) {
    const rng = S.mulberry32(si * 99 + 1);
    return [0, 1, 2, 3].map(() => S.randomLook(rng));
  }
  function bandMembers(T, beat) {
    const looks = bandLooks(setIndex(T));
    const b4 = beat % 32;
    const hop = (k) => (Math.floor(beat * 2 + k) % 4 === 0 ? 1 : 0);
    return [
      { x: 320, y: 104, look: looks[0], f: 0, a: b4 < 8 ? 1 : b4 < 24 ? 2 : 0, seed: 1, role: 'vocal' },
      { x: 282, y: 101 - hop(0), look: looks[1], f: 0, a: 0, seed: 2, role: 'guitar', gc: '#e23d3d' },
      { x: 320, y: 90, look: looks[2], f: 0, a: 2, seed: 3, role: 'drum' },
      { x: 358, y: 101 - hop(2), look: looks[3], f: 0, a: 0, seed: 4, role: 'bass', gc: '#2f6fe0' },
    ];
  }

  function drawStage(T, beat, t) {
    const pulse = beat % 1 < 0.15;
    const speaker = (x) => {
      R('#16161c', x, 66, 10, 46);
      for (let k = 0; k < 4; k++) { R('#2b2b35', x + 2, 69 + k * 11, 6, 6); R(pulse ? '#454556' : '#0b0b0f', x + 3, 70 + k * 11, 4, 4); }
    };
    speaker(226); speaker(404);
    for (const px of [236, 400]) { R('#6a6e78', px, 40, 4, 72); for (let y = 41; y < 112; y += 4) R('#3d4048', px + 1, y, 2, 2); }
    R('#1e1e26', 230, 36, 180, 8); R('#34343f', 230, 36, 180, 2);
    for (let i = 0; i < 9; i++) R(['#ff4f6d', '#ffd84a', '#5fc8ff'][(i + Math.floor(beat)) % 3], 242 + i * 20, 42, 3, 2);
    R('#ffcf3a', 262, 44, 116, 9); R('#e8a92a', 262, 51, 116, 2);
    R('#121218', 240, 53, 160, 44);
    const led = ['#ff4fa3', '#5fc8ff', '#ffd84a', '#7dffb0'];
    for (let i = 0; i < 20; i++) R(led[(i + Math.floor(beat * 2)) % 4], 244 + i * 8, 57, 3, 1);
    for (const ax of [258, 370]) { R('#22222a', ax, 84, 12, 12); R('#3a3a46', ax + 1, 86, 10, 9); R('#c9a24a', ax + 1, 85, 10, 1); }
    R('#2a2a33', 298, 86, 44, 10);
    R('#3b3b46', 238, 96, 164, 10); R('#262630', 238, 106, 164, 6);
    for (let i = 0; i < 164; i += 8) R('#1c1c24', 238 + i, 107, 1, 5);
    for (let i = 0; i < 10; i++) R(pulse && i % 2 ? '#fff4c0' : '#8a7a50', 246 + i * 16, 105, 2, 1);

    const m = bandMembers(T, beat);
    const drum = m[2];
    drawPerson(g, drum, beat, t);
    const hit = beat % 1 < 0.2;
    R('#e8c547', 304, hit ? 79 : 80, 7, 1); R('#e8c547', 330, hit ? 80 : 79, 7, 1);
    R('#c9c9d2', 314, 84, 13, 9); R('#f2f2f6', 315, 85, 11, 7); R('#ff4fa3', 319, 87, 3, 3);
    R('#7a2b2b', 309, 86, 5, 4); R('#7a2b2b', 327, 86, 5, 4);
    for (const mb of [m[1], m[3]]) {
      drawPerson(g, mb, beat, t);
      R(mb.gc, mb.x - 3, mb.y - 7, 4, 3); R('#1a1a1a', mb.x - 2, mb.y - 6, 1, 1); R('#7a5230', mb.x + 1, mb.y - 7, 5, 1);
    }
    drawPerson(g, m[0], beat, t);
    R('#9a9aa4', 320, 95, 1, 9); R('#333', 319, 94, 2, 2);
    return m;
  }

  function drawScreenFrame(r) {
    R('#5a5d66', r.x + 6, r.y + r.h, 2, 112 - r.y - r.h); R('#5a5d66', r.x + r.w - 8, r.y + r.h, 2, 112 - r.y - r.h);
    R('#45474f', r.x + 6, r.y + r.h + 5, r.w - 12, 1);
    R('#2a2a30', r.x - 2, r.y - 2, r.w + 4, r.h + 4);
    R('#050507', r.x, r.y, r.w, r.h);
  }

  const camCv = document.createElement('canvas');
  camCv.width = 18; camCv.height = 14;
  const camG = camCv.getContext('2d');
  function drawLiveCam(members, beat, t, T) {
    const r = S.SCREEN_R;
    const who = members[[0, 1, 0, 2, 0, 3][Math.floor(T / 4000) % 6]];
    const bgc = [['#2a0f3d', '#401860'], ['#0f2a3d', '#184a60'], ['#3d0f1f', '#601830']][Math.floor(beat / 8) % 3];
    for (let y = 0; y < 14; y++) { camG.fillStyle = (y + Math.floor(beat * 2)) % 4 < 2 ? bgc[0] : bgc[1]; camG.fillRect(0, y, 18, 1); }
    drawPerson(camG, { ...who, x: 9, y: 14, seed: who.seed }, beat, t);
    g.imageSmoothingEnabled = false;
    g.drawImage(camCv, r.x + 1, r.y + 1, 54, 42);
    R('#ff3b3b', r.x + 3, r.y + 3, 2, 2);
    for (let y = r.y; y < r.y + r.h; y += 2) R('rgba(0,0,0,0.18)', r.x, y, r.w, 1);
  }

  function drawTents(rect, valance) {
    for (let i = 0; i < 3; i++) {
      const tx = rect.x + i * 32;
      R('#2a2a30', tx + 2, rect.y + 6, 1, 34); R('#2a2a30', tx + 29, rect.y + 6, 1, 34);
      R('#16141c', tx + 3, rect.y + 8, 26, 22);
      drawPerson(g, { x: tx + 16, y: rect.y + 31, look: S.CROWD.npcs[(i * 7 + rect.x) % S.CROWD.npcs.length].look, f: 0, a: 0, seed: i }, 0, 0);
      R('#caa66a', tx + 2, rect.y + 30, 28, 5); R('#9c7c48', tx + 2, rect.y + 35, 28, 3);
      for (let k = 0; k < 5; k++) R(['#ff4f6d', '#ffd84a', '#ffffff', '#5fc8ff'][(k + i) % 4], tx + 5 + k * 5, rect.y + 29, 2, 1);
      for (let k = 0; k < 7; k++) R('#1f1f27', tx + 9 - k, rect.y - 2 + k, 14 + 2 * k, 1);
      R(valance, tx + 1, rect.y + 5, 30, 3);
      for (let j = 0; j < 30; j += 4) R(valance, tx + 1 + j, rect.y + 8, 2, 1);
    }
  }

  function drawBooth(beat, t) {
    const b = S.BOOTH;
    for (const px of [b.x, b.x + b.w - 2]) R('#9aa0a8', px, b.y - 14, 2, b.h + 14);
    R('#5a5d66', b.x, b.y + b.h - 6, b.w, 6);
    R('#2b2b33', b.x + 4, b.y + 8, b.w - 8, 7);
    for (let k = 0; k < 9; k++) R(['#7dffb0', '#ffd84a', '#ff4f6d'][(k + Math.floor(beat * 2)) % 3], b.x + 6 + k * 4, b.y + 9, 1, 1);
    drawPerson(g, { x: b.x + 15, y: b.y + 22, look: [1, 0, 1, 1, 1, 0], f: 1, a: 0, seed: 5 }, beat, t);
    drawPerson(g, { x: b.x + 29, y: b.y + 22, look: [3, 8, 1, 0, 0, 0], f: 1, a: 2, seed: 6 }, beat, t);
    for (let k = 0; k < 6; k++) R(k % 2 ? '#e9edf2' : '#ffffff', b.x - 3 + (5 - k), b.y - 20 + k, b.w + 6 - 2 * (5 - k), 1);
    R('#c3c9d2', b.x - 2, b.y - 14, b.w + 4, 1);
    drawFlag({ x: b.x + 21, y: b.y - 20, h: 10, c: ['#ff4fa3', '#ffffff'], s: 1 }, t);
  }

  // 하단 펜스 광고판 자리 (월드 좌표). 내용은 billboard.json의 fence 항목
  const FENCE_X = [36, 176, 360, 500], FENCE_Y = 389, FENCE_W = 104, FENCE_H = 8;
  const FENCE_EMPTY = { text: '광고 문의 환영', bg: '#2a2a33', fg: '#ffd84a', accent: '#ff4fa3' };
  function drawFenceBottom() {
    const y = 391;
    R('#e9edf2', 8, y, 624, 6); R('#c3c9d2', 8, y + 5, 624, 1);
    for (let x = 8; x < 632; x += 12) R('#9aa1ab', x, y - 1, 1, 7);
    for (const x of FENCE_X) { R('#3a3a44', x - 1, FENCE_Y - 1, FENCE_W + 2, FENCE_H + 2); R('#9aa1ab', x + 6, FENCE_Y + FENCE_H + 1, 2, 1); R('#9aa1ab', x + FENCE_W - 8, FENCE_Y + FENCE_H + 1, 2, 1); }
  }
  // 광고가 4개보다 많으면 fenceSeconds초마다 다음 묶음으로 넘어간다
  function fenceAds(T) {
    const list = Array.isArray(board.fence) ? board.fence : [];
    const n = FENCE_X.length;
    if (list.length <= n) return FENCE_X.map((_, k) => list[k] || FENCE_EMPTY);
    const shift = Math.floor(T / ((board.fenceSeconds || 10) * 1000)) * n;
    return FENCE_X.map((_, k) => list[(shift + k) % list.length]);
  }
  // 글씨가 또렷하도록 확대된 화면에 직접 그리고, 밤에는 주변처럼 어둡게 만든다
  function drawFenceAds(T, e) {
    fenceAds(T).forEach((a, k) => {
      const [sx, sy] = toScreen(FENCE_X[k], FENCE_Y), w = FENCE_W * scale, h = FENCE_H * scale;
      if (sx > vw || sy > vh || sx + w < 0 || sy + h < 0) return;
      ctx.save();
      ctx.beginPath(); ctx.rect(sx, sy, w, h); ctx.clip();
      const im = a.src && images[a.src];
      if (im && im.complete && im.naturalWidth) {
        ctx.fillStyle = a.bg || '#111'; ctx.fillRect(sx, sy, w, h);
        const s = Math.max(w / im.naturalWidth, h / im.naturalHeight), iw = im.naturalWidth * s, ih = im.naturalHeight * s;
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(im, sx + (w - iw) / 2, sy + (h - ih) / 2, iw, ih);
      } else {
        const text = a.text || '';
        ctx.fillStyle = a.bg || '#2a2a33'; ctx.fillRect(sx, sy, w, h);
        ctx.fillStyle = a.accent || 'rgba(255,255,255,0.35)';
        ctx.fillRect(sx, sy, w, scale); ctx.fillRect(sx, sy + h - scale, w, scale);
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        fitFont(ctx, text, 900, Math.round(h * 0.6), w * 0.9);
        ctx.fillStyle = a.fg || '#ffffff'; ctx.fillText(text, sx + w / 2, sy + h / 2 + scale * 0.2);
      }
      ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(sx, sy + scale, w, scale);
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = rgb(e.tint); ctx.fillRect(sx, sy, w, h);
      ctx.restore();
    });
  }

  function drawSky(e, p, t) {
    if (camY > 42) return;
    const x0 = Math.floor(camX), w = viewW + 1;
    // 맵 위쪽(줌을 많이 줄였을 때): 위로 갈수록 조금 짙어지는 하늘
    if (camY < 0) {
      const top = Math.floor(camY), deep = lerpA(e.sky, [20, 30, 90], 0.3);
      for (let y = top; y < 0; y++) R(rgb(lerpA(e.sky, deep, y / top)), x0, y, w, 1);
    }
    for (let y = 0; y < 18; y++) R(rgb(lerpA(e.sky, e.hor, y / 17)), x0, y, w, 1);
    let sun = null;
    if (p < 0.53) {
      const q = p / 0.53;
      sun = { x: Math.round(60 + q * 520), y: Math.round(2 + q * q * 17), c: rgb(lerpA([255, 244, 176], [255, 110, 60], Math.max(0, q - 0.55) / 0.45)) };
      R(sun.c, sun.x - 2, sun.y - 3, 5, 7); R(sun.c, sun.x - 3, sun.y - 2, 7, 5);
    } else if (p > 0.56 && p < 0.97) {
      const q = (p - 0.56) / 0.41, mx = Math.round(80 + q * 480), my = Math.round(3 + Math.pow((q - 0.5) * 2, 2) * 10);
      R('#f2f0e0', mx - 2, my - 2, 5, 5); R('#f2f0e0', mx - 1, my - 3, 3, 7); R(rgb(e.sky), mx + 1, my - 2, 2, 3);
    }
    C.fillStyle = rgb(lerpA(e.sky, [40, 50, 80], 0.55));
    for (let x = x0; x < x0 + w; x++) C.fillRect(x, 18 - mountainH[x], 1, mountainH[x]);
    const tc = rgb(lerpA([44, 70, 48], e.sky, 0.2));
    R(tc, x0, 18, w, 4);
    C.fillStyle = tc;
    for (let x = x0; x < x0 + w; x++) C.fillRect(x, 18 - treeH[x], 1, treeH[x]);
    const bc = rgb(lerpA([70, 76, 90], e.sky, 0.3));
    for (const [bx, bw, bh] of [[250, 9, 6], [262, 2, 13], [470, 14, 7], [488, 3, 11], [120, 6, 4]]) R(bc, bx, 18 - bh, bw, bh);
    R(rgb(lerpA(e.hor, [50, 100, 160], 0.55)), x0, 22, w, 20);
    const sh = rgb(lerpA(e.hor, [255, 255, 255], 0.35), 0.6);
    for (let i = 0; i < 70; i++) {
      const y = 23 + ((i * 7) % 19);
      const x = ((i * 97 + t * (5 + (i % 5))) % (S.W + 30)) - 15;
      R(sh, Math.round(x), y, 4 + ((i * 13) % 9), 1);
    }
    if (sun && p > 0.3) for (let y = 23; y < 42; y += 2) { const w2 = 2 + ((y * 7 + Math.floor(t * 4)) % 5); R(rgb(lerpA(e.hor, [255, 230, 160], 0.6), 0.75), sun.x - (w2 >> 1), y, w2, 1); }
  }

  // 조명은 월드 해상도 캔버스에 그린 뒤 확대해서 얹는다 (빛줄기 가장자리도 도트로 보이게)
  const lightCv = document.createElement('canvas'), lg = lightCv.getContext('2d');
  function drawLights(e, t, beat) {
    const d = e.dark, lx = Math.floor(camX), ly = Math.floor(camY);
    if (lightCv.width !== viewW + 2 || lightCv.height !== viewH + 2) { lightCv.width = viewW + 2; lightCv.height = viewH + 2; }
    lg.setTransform(1, 0, 0, 1, 0, 0);
    lg.clearRect(0, 0, lightCv.width, lightCv.height);
    lg.setTransform(1, 0, 0, 1, -lx, -ly);
    lg.globalCompositeOperation = 'lighter';
    const gr = lg.createRadialGradient(320, 104, 4, 320, 110, 150);
    gr.addColorStop(0, `rgba(255,140,200,${0.35 * d})`); gr.addColorStop(1, 'rgba(255,140,200,0)');
    lg.fillStyle = gr; lg.fillRect(170, 30, 300, 240);
    const cols = [[255, 80, 160], [80, 180, 255], [255, 220, 90], [140, 255, 170], [200, 120, 255]];
    for (let i = 0; i < 5; i++) {
      const sx = 248 + i * 36, tx = 320 + Math.sin(t * 0.7 + i * 1.3) * 150, ty = 220 + Math.cos(t * 0.5 + i) * 40;
      lg.fillStyle = rgb(cols[(i + Math.floor(beat / 8)) % 5], 0.12 * d);
      lg.beginPath(); lg.moveTo(sx, 44); lg.lineTo(tx - 16, ty); lg.lineTo(tx + 16, ty); lg.closePath(); lg.fill();
      lg.beginPath(); lg.ellipse(tx, ty, 16, 6, 0, 0, Math.PI * 2); lg.fill();
    }
    if (beat % 4 < 0.12) { lg.fillStyle = `rgba(255,255,255,${0.14 * d})`; lg.fillRect(236, 40, 168, 72); }
    const bc = [[255, 200, 120], [255, 140, 170], [150, 210, 255]];
    for (const b of bulbs) { lg.fillStyle = rgb(bc[b.c], 0.22 * d); lg.fillRect(b.x - 1, b.y, 3, 3); lg.fillStyle = rgb(bc[b.c], 0.9 * d); lg.fillRect(b.x, b.y + 1, 1, 1); }
    for (const tr of [S.TENTS_L, S.TENTS_R]) for (let i = 0; i < 3; i++) { lg.fillStyle = `rgba(255,190,110,${0.18 * d})`; lg.fillRect(tr.x + i * 32 + 3, tr.y + 8, 26, 30); }
    const b = S.BOOTH;
    lg.fillStyle = `rgba(120,255,180,${0.15 * d})`; lg.fillRect(b.x + 2, b.y + 4, b.w - 4, 14);
    g.globalCompositeOperation = 'lighter';
    g.drawImage(lightCv, lx, ly);
    g.globalCompositeOperation = 'source-over';
    const skyTop = Math.min(0, Math.floor(camY)), stars = Math.min(220, 50 - skyTop);
    if (camY < 18) for (let i = 0; i < stars; i++) {
      const sx = Math.floor(S.hash(i, 11) * S.W), sy = skyTop + Math.floor(S.hash(i, 12) * (15 - skyTop));
      const tw = 0.5 + 0.5 * Math.sin(t * 2 + i);
      R(`rgba(255,255,240,${d * tw})`, sx, sy, 1, 1);
    }
  }

  // ───────── 상태 ─────────
  const me = { id: 0, name: '', look: null, x: 300, y: 370, f: 1, moving: false, a: 0, flag: false, mat: null, target: null, stuck: 0, hasPos: false, vx: 0, vy: 0, joined: false, bumpCd: 0 };
  const others = new Map();
  const particles = [];
  let online = 0;
  // NPC 관객 출입 (서버가 정함): out = 밖에 있음, at = 마지막으로 드나든 서버 시각
  const npcOut = new Uint8Array(S.CROWD.npcs.length), npcAt = new Float64Array(S.CROWD.npcs.length);
  const NPC_WALK = 40; // 출구까지 걷는 속도 (px/초)
  function applyNpc(ch) { for (const [i, o, at] of ch) { npcOut[i] = o; npcAt[i] = at; } }
  // 슬램 러시 (서버가 정함): 돗자리 NPC가 일어나 스탠딩존 아래까지 올라간 뒤 슬램존으로, 끝나면 반대로
  let rush = { on: false, at: 0, ids: [] }, rushIdx = new Map();
  function setRush(r) { rush = r; rushIdx = new Map(r.ids.map((id, k) => [id, k])); }
  const RUSH_WALK = 45, RUSH_Y = S.STANDING.y + S.STANDING.h + 4;
  function pitPos(k, tt) {
    const rad = 7 + (k % 5) * 4, ang = k * 2.4 + tt * 0.9;
    return { x: S.MOSH.x + Math.cos(ang) * rad, y: S.MOSH.y + Math.sin(ang) * rad * 0.55, ang };
  }
  const lerpPt = (a, b, k) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
  const faceTo = (a, b) => (Math.abs(b.x - a.x) > Math.abs(b.y - a.y) ? (b.x > a.x ? 3 : 2) : b.y > a.y ? 0 : 1);
  // null이면 돗자리에서 평소처럼
  function rushState(n, k, T) {
    const mid = { x: n.x, y: RUSH_Y }, el = (T - rush.at) / 1000;
    const base = { look: n.look, seed: n.seed, flag: false, sit: false, moving: true, kind: 'rush', a: 0 };
    if (rush.on) {
      const t1 = Math.abs(n.y - RUSH_Y) / RUSH_WALK, t2 = Math.hypot(mid.x - S.MOSH.x, mid.y - S.MOSH.y) / RUSH_WALK;
      if (el < t1) return { ...base, ...lerpPt(n, mid, el / t1), f: 1 };
      const target = pitPos(k, rush.at / 1000 + t1 + t2);
      if (el < t1 + t2) return { ...base, ...lerpPt(mid, target, (el - t1) / t2), f: faceTo(mid, target) };
      const p = pitPos(k, T / 1000), vx = -Math.sin(p.ang), vy = Math.cos(p.ang);
      return { ...base, x: p.x, y: p.y, a: 3, f: Math.abs(vx) > Math.abs(vy) ? (vx > 0 ? 3 : 2) : vy > 0 ? 0 : 1 };
    }
    const start = pitPos(k, rush.at / 1000), t1 = Math.hypot(start.x - mid.x, start.y - mid.y) / RUSH_WALK, t2 = Math.abs(n.y - RUSH_Y) / RUSH_WALK;
    if (el < t1) return { ...base, ...lerpPt(start, mid, el / t1), f: faceTo(start, mid) };
    if (el < t1 + t2) return { ...base, ...lerpPt(mid, n, (el - t1) / t2), f: 0 };
    return null;
  }

  function onOwnMat(p, mat) {
    return mat && S.inRect(S.matRect(mat), p.x, p.y - 1);
  }

  function npcStates(beat, t, dark, T) {
    const seg = Math.floor(beat / 16);
    const out = [];
    S.CROWD.npcs.forEach((n, i) => {
      // 나가는 중이면 자리에서 옆 출구로, 들어오는 중이면 출구에서 자리로 걷는다
      const ex = S.npcExit(n), dur = (Math.abs(n.x - ex.x) / NPC_WALK) * 1000, el = T - npcAt[i];
      if (npcOut[i] && el >= dur) return;
      if (el < dur) {
        const from = npcOut[i] ? n : ex, to = npcOut[i] ? ex : n, k = Math.max(0, el / dur);
        out.push({ x: from.x + (to.x - from.x) * k, y: n.y, f: to.x > from.x ? 3 : 2, look: n.look, seed: n.seed, flag: n.flag, a: 0, sit: false, moving: true, kind: 'walk' });
        return;
      }
      const rk = rushIdx.get(i);
      if (rk != null) { const st = rushState(n, rk, T); if (st) { out.push(st); return; } }
      const r = S.hash(i * 7 + 1, seg);
      const p = { x: n.x, y: n.y, f: n.f, look: n.look, seed: n.seed, flag: n.flag, a: 0, sit: false, moving: false, kind: n.kind };
      if (n.kind === 'mat') {
        p.sit = r < 0.78;
        p.a = r < 0.42 ? 0 : r < 0.62 ? 2 : r < 0.78 ? 1 : r < 0.9 ? 2 : 1;
      } else if (n.kind === 'stand') {
        const k = r + dark * 0.3;
        p.a = k < 0.3 ? 0 : k < 0.75 ? 2 : 1;
      } else {
        const active = seg % 3 !== 0 || dark > 0.5;
        if (active) {
          const dx = n.x - S.MOSH.x, dy = (n.y - S.MOSH.y) / 0.55;
          const rad = Math.max(6, Math.hypot(dx, dy)), ang = Math.atan2(dy, dx) + t * 0.9;
          p.x = S.MOSH.x + Math.cos(ang) * rad; p.y = S.MOSH.y + Math.sin(ang) * rad * 0.55;
          const vx = -Math.sin(ang), vy = Math.cos(ang);
          p.f = Math.abs(vx) > Math.abs(vy) ? (vx > 0 ? 3 : 2) : vy > 0 ? 0 : 1;
          p.a = 3; p.moving = true;
        } else p.a = 2;
      }
      out.push(p);
    });
    return out;
  }

  // ───────── UI ─────────
  let toastTimer = 0;
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg; el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
  }
  function syncKeysUi() {
    document.querySelectorAll('[data-a]').forEach((el) => el.classList.toggle('on', Number(el.dataset.a) === me.a));
    document.querySelectorAll('[data-k="mat"]').forEach((el) => el.classList.toggle('on', !!me.mat));
    document.querySelectorAll('[data-k="flag"]').forEach((el) => el.classList.toggle('on', me.flag));
  }

  // ───────── 입력 ─────────
  const keys = {};

  function allMatsExceptMine() {
    const mats = S.activeMats(npcOut);
    for (const o of others.values()) if (o.mat) mats.push(o.mat);
    return mats;
  }
  function toggleMat() {
    if (me.mat && onOwnMat(me, me.mat)) { me.mat = null; toast('돗자리를 접었어요'); syncKeysUi(); track('mat', { act: 'fold' }); return; }
    const r = S.matRectAt(me.x, me.y);
    const problem = S.matProblem(r, allMatsExceptMine());
    if (problem === 'zone') return toast('돗자리는 아래쪽 잔디밭에서만 펼 수 있어요');
    if (problem === 'overlap') return toast('다른 돗자리랑 겹쳐요. 조금만 옆으로!');
    const moved = !!me.mat;
    me.mat = [r.x, r.y, me.look[5]];
    toast(moved ? '돗자리를 여기로 옮겼어요' : '돗자리를 폈어요! 앉아서 쉬어요 🎶');
    syncKeysUi();
    track('mat', { act: moved ? 'move' : 'open' });
  }
  function setAction(n) {
    if (n === 3 && me.a !== 3 && !S.inStanding(me.x, me.y)) return toast('슬램은 무대 앞 스탠딩존(노란 로프 안)에서만!');
    me.a = me.a === n ? 0 : n;
    if (me.a) track('action', { name: ['', 'hands_up', 'rhythm', 'slam'][me.a] });
    // 터치 버튼은 글자 없이 아이콘만이라 무엇이 켜졌는지 알려준다
    if (isTouch) toast(me.a ? ['', '✋ 손들기', '🎵 리듬타기', '💥 슬램! 다른 슬래머와 부딪혀 보세요'][me.a] : '동작을 멈췄어요');
    syncKeysUi();
  }
  // 줌: 버튼, +/- 키, 마우스 휠. 맵 끝까지 줄였거나 최대로 키웠으면 알려준다
  function zoomBy(dir) {
    let i = zoomIdx + dir;
    while (ZOOMS[i] != null && zoomK(i) === kpx) i += dir;
    if (ZOOMS[i] == null) return toast(dir < 0 ? '더 이상 줄일 수 없어요 (맵 전체가 보여요)' : '가장 크게 보고 있어요');
    zoomIdx = i;
    store.set('fest.zoomv', String(ZOOMS[i]));
    resize();
    toast(`🔍 ${Math.round((kpx / kAuto) * 100)}%`);
  }
  function toggleFlag() {
    me.flag = !me.flag;
    if (me.flag) track('action', { name: 'flag' });
    toast(me.flag ? '깃발을 들었어요! 🚩 (꾸미기에서 무늬를 바꿀 수 있어요)' : '깃발을 내렸어요');
    syncKeysUi();
  }

  addEventListener('keydown', (e) => {
    if (editing) { if (e.code === 'Escape') closeEditor(false); return; }
    if (!me.joined) return;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    keys[e.code] = true;
    if (e.repeat) return;
    switch (e.code) {
      case 'Space': toggleMat(); break;
      case 'Digit1': case 'Numpad1': setAction(1); break;
      case 'Digit2': case 'Numpad2': setAction(2); break;
      case 'Digit3': case 'Numpad3': setAction(3); break;
      case 'Digit4': case 'Numpad4': toggleFlag(); break;
      case 'Escape': me.a = 0; me.flag = false; syncKeysUi(); break;
      case 'KeyC': openEditor(); break;
      case 'Equal': case 'NumpadAdd': zoomBy(1); break;
      case 'Minus': case 'NumpadSubtract': zoomBy(-1); break;
      case 'KeyM': if (board.music) setMuted(!music.muted); break;
    }
  });
  addEventListener('keyup', (e) => { keys[e.code] = false; });
  // 트랙패드는 작은 휠 값이 연달아 오므로 모아서 한 단계씩
  let wheelSum = 0, wheelLast = 0, wheelStep = 0;
  addEventListener('wheel', (e) => {
    if (!me.joined || editing) return;
    e.preventDefault();
    const tnow = performance.now();
    if (tnow - wheelLast > 250) wheelSum = 0;
    wheelLast = tnow; wheelSum += e.deltaY;
    if (Math.abs(wheelSum) >= 80 && tnow - wheelStep > 180) { zoomBy(wheelSum < 0 ? 1 : -1); wheelSum = 0; wheelStep = tnow; }
  }, { passive: false });
  document.querySelectorAll('#zoom [data-zoom]').forEach((btn) => btn.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    if (me.joined && !editing) zoomBy(Number(btn.dataset.zoom));
  }));
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

  // ───────── 터치/클릭한 곳으로 걸어가기 + 아래 버튼 ─────────
  // 누른 채로 끌면 손가락을 따라간다. 키보드로 움직이면 취소
  let walkId = null;
  function setWalkTarget(e) {
    const wx = camX + (e.clientX - ox) / scale, wy = camY + (e.clientY - oy) / scale;
    me.target = { x: Math.min(S.WALK.x + S.WALK.w, Math.max(S.WALK.x, wx)), y: Math.min(S.WALK.y + S.WALK.h, Math.max(S.WALK.y, wy)), at: performance.now() };
    me.stuck = 0;
  }
  cv.addEventListener('pointerdown', (e) => {
    if (!me.joined || editing || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    walkId = e.pointerId;
    try { cv.setPointerCapture(e.pointerId); } catch { /* 캡처가 안 돼도 탭 이동은 동작 */ }
    setWalkTarget(e);
  });
  cv.addEventListener('pointermove', (e) => { if (e.pointerId === walkId) setWalkTarget(e); });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) cv.addEventListener(ev, (e) => { if (e.pointerId === walkId) walkId = null; });

  document.querySelectorAll('#pad [data-act]').forEach((btn) => {
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (!me.joined || editing) return;
      const act = btn.dataset.act;
      if (act === 'mat') toggleMat();
      else if (act === 'flag') toggleFlag();
      else if (act === 'edit') { me.target = null; openEditor(); }
      else setAction(Number(act));
    });
  });
  document.addEventListener('gesturestart', (e) => e.preventDefault());

  // ───────── 네트워크 ─────────
  let ws = null, lastSentAt = 0, lastSentStr = '', waitingNo = null, denied = null;
  function netSend(msg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); }
  function connect() {
    const net = $('net');
    net.textContent = '연결 중…'; net.style.display = 'block';
    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
    ws.onopen = () => {
      net.style.display = 'none';
      netSend({ t: 'join', name: me.name, look: me.look, pos: me.hasPos ? [me.x, me.y] : null, mat: me.mat ? [me.mat[0], me.mat[1]] : null });
    };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.t === 'deny') {
        denied = m.msg; // 서버가 거절함 (IP당 접속 수 초과): 천천히 다시 시도
      } else if (m.t === 'queue') {
        // 꽉 차서 밖에서 대기 중: 무대를 보면서 내 순서를 기다린다
        if (waitingNo == null) track('queue_wait', { ahead: m.ahead, cap: m.cap });
        waitingNo = m.no;
        document.body.classList.add('waiting');
        $('qNo').textContent = `No. ${m.no}`;
        $('qAhead').textContent = m.ahead ? `${m.ahead}명` : '다음 차례예요!';
        $('qAheadBox').classList.toggle('next', !m.ahead);
        $('qFoot').textContent = `정원 ${m.cap}명 · 지금 ${m.n}명이 즐기는 중`;
        online = m.n;
      } else if (m.t === 'welcome') {
        const fromQueue = waitingNo != null;
        waitingNo = null;
        document.body.classList.remove('waiting');
        others.clear();
        for (const q of m.players || []) upsertInfo(q);
        online = m.n;
        npcOut.fill(0); npcAt.fill(0); applyNpc(m.npc || []);
        setRush(m.rush || { on: false, at: 0, ids: [] });
        const wasJoined = me.joined, again = wasJoined || returning;
        me.id = m.id; me.name = m.name; me.x = m.x; me.y = m.y; me.a = 0; me.flag = false; me.target = null; me.joined = true; me.hasPos = true;
        me.mat = m.mat ? [m.mat[0], m.mat[1], me.look[5]] : null;
        clockOffset = m.time - Date.now();
        syncKeysUi();
        document.body.classList.add('playing');
        if (fromQueue) toast('기다려주셔서 고마워요! 입장할 차례예요 🎟️');
        else if (daily && !wasJoined) toast(`${band.visits}일째 방문! 오늘도 즐겨요 🎸`);
        else if (again) toast(`다시 오셨네요, ${me.name}님! 🎟️ No.${band.no}`);
        else toast(isTouch ? '가고 싶은 곳을 터치하면 걸어가요 · 🧺로 돗자리' : `${me.name}님, 입장! Space로 돗자리를 펴보세요`);
        if (!wasJoined) track('join_festival', { kind: fromQueue ? 'queue' : daily ? 'daily' : again ? 'returning' : 'new', visits: band.visits, online: m.n, touch: isTouch });
        returning = false;
      } else if (m.t === 'snap') {
        // 스냅샷엔 지난번과 달라진 사람만 온다. 안 온 사람은 그대로 있는 것
        clockOffset += (m.time - Date.now() - clockOffset) * 0.1;
        for (const st of m.p) if (st[0] !== me.id) applyState(st);
        online = m.n;
      } else if (m.t === 'info') {
        upsertInfo(m);
      } else if (m.t === 'rush') {
        setRush(m);
      } else if (m.t === 'npc') {
        applyNpc(m.ch);
        online = m.n;
      } else if (m.t === 'mat') {
        const o = others.get(m.id);
        if (o) o.mat = m.mat;
      } else if (m.t === 'leave') {
        others.delete(m.id);
      } else if (m.t === 'fix') {
        me.x = m.x; me.y = m.y; me.target = null;
      }
    };
    ws.onclose = () => {
      net.textContent = denied || '연결이 끊겼어요 · 다시 연결 중…'; net.style.display = 'block';
      others.clear();
      setTimeout(connect, denied ? 15000 : 2000);
      denied = null;
    };
  }
  // 서버 pack 형식: [id, x*10, y*10, 방향|걷는중<<2|동작<<3|깃발<<5]
  function applyState([id, x10, y10, fl]) {
    const o = others.get(id);
    if (!o) return;
    o.x = x10 / 10; o.y = y10 / 10;
    o.f = fl & 3; o.moving = !!(fl & 4); o.a = (fl >> 3) & 3; o.flag = !!(fl & 32);
    if (o.rx == null) { o.rx = o.x; o.ry = o.y; }
  }
  // 이름·외형·돗자리 (들어올 때, 꾸미기를 바꿀 때)
  function upsertInfo(q) {
    let o = others.get(q.id);
    if (!o) { o = { id: q.id, seed: q.id, rx: null, ry: null }; others.set(q.id, o); }
    o.name = q.name; o.look = q.look; o.mat = q.mat;
    applyState(q.s);
  }
  function sendState(ts) {
    if (!me.joined) return;
    const st = { t: 's', x: Math.round(me.x * 10) / 10, y: Math.round(me.y * 10) / 10, f: me.f, m: me.moving ? 1 : 0, a: me.a, g: me.flag ? 1 : 0, mat: me.mat ? [me.mat[0], me.mat[1]] : null };
    const s = JSON.stringify(st);
    if ((s !== lastSentStr && ts - lastSentAt > 90) || ts - lastSentAt > 1000) { netSend(st); lastSentStr = s; lastSentAt = ts; }
  }

  // ───────── 업데이트 ─────────
  function spark(x, y, n, cols) {
    for (let i = 0; i < n; i++) particles.push({ x, y, vx: (Math.random() - 0.5) * 60, vy: -Math.random() * 50 - 10, g: 120, life: 0.5 + Math.random() * 0.4, c: cols[i % cols.length] });
  }
  function update(dt, npcs, T) {
    if (!me.joined) return;
    let dx = (keys.ArrowRight || keys.KeyD ? 1 : 0) - (keys.ArrowLeft || keys.KeyA ? 1 : 0);
    let dy = (keys.ArrowDown || keys.KeyS ? 1 : 0) - (keys.ArrowUp || keys.KeyW ? 1 : 0);
    const sp = me.a === 3 ? 44 : 52;
    if (dx || dy) me.target = null;
    else if (me.target) {
      const tx = me.target.x - me.x, ty = me.target.y - me.y, d = Math.hypot(tx, ty);
      if (d < 0.8) me.target = null;
      else { const k = Math.min(1, d / (sp * dt)); dx = (tx / d) * k; dy = (ty / d) * k; } // 목표를 지나치지 않게 마지막 걸음은 짧게
    }
    const bx = me.x, by = me.y;
    const len = Math.max(1, Math.hypot(dx, dy));
    const mx = (dx / len) * sp * dt + me.vx * dt, my = (dy / len) * sp * dt + me.vy * dt;
    const damp = Math.pow(0.02, dt);
    me.vx *= damp; me.vy *= damp;
    if (S.walkable(me.x + mx, me.y)) me.x += mx; else me.vx = 0;
    if (S.walkable(me.x, me.y + my)) me.y += my; else me.vy = 0;
    me.moving = !!(dx || dy);
    // 펜스·텐트 같은 데 막혀서 못 가면 잠깐 뒤 포기
    if (me.target) {
      me.stuck = Math.hypot(me.x - bx, me.y - by) < sp * dt * 0.25 ? me.stuck + dt : 0;
      if (me.stuck > 0.3) { me.target = null; me.moving = false; }
    }
    if (dx || dy) me.f = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 3 : 2) : dy > 0 ? 0 : 1;
    if (me.a === 3 && !S.inStanding(me.x, me.y)) { me.a = 0; syncKeysUi(); toast('스탠딩존을 벗어나서 슬램을 멈췄어요'); }
    me.bumpCd -= dt;
    if (me.a === 3 && me.bumpCd <= 0) {
      const slammers = npcs.filter((n) => n.a === 3).concat([...others.values()].filter((o) => o.a === 3).map((o) => ({ x: o.rx, y: o.ry })));
      for (const o of slammers) {
        const ddx = me.x - o.x, ddy = me.y - o.y, d = Math.hypot(ddx, ddy);
        if (d < 7 && d > 0.01) {
          me.vx += (ddx / d) * 90; me.vy += (ddy / d) * 60;
          spark((me.x + o.x) / 2, (me.y + o.y) / 2 - 8, 6, ['#ffffff', '#ffd84a', '#ff4fa3']);
          me.bumpCd = 0.3;
          break;
        }
      }
    }
    const since = T - setIndex(T) * board.setMinutes * 60000;
    if (since < 6000 && Math.random() < 0.6) {
      particles.push({ x: S.STANDING.x + Math.random() * S.STANDING.w, y: 100, vx: (Math.random() - 0.5) * 10, vy: 18 + Math.random() * 14, g: 0, life: 4, c: ['#ff4fa3', '#ffd84a', '#5fc8ff', '#7dffb0', '#ffffff'][(Math.random() * 5) | 0] });
    }
  }

  // ───────── 렌더링 ─────────
  function fitFont(c, text, weight, size, maxW) {
    let s = size;
    do { c.font = `${weight} ${s}px ${FONT}`; s -= 1; } while (c.measureText(text).width > maxW && s > 6);
  }

  function drawInsta(sx, sy, w, h, s, beat) {
    const size = Math.round(h * 0.4), ix = sx + (w - size) / 2, iy = sy + h * 0.12 - Math.max(0, 1 - (beat % 1) * 4) * scale * 1.5;
    const gr = ctx.createLinearGradient(ix, iy + size, ix + size, iy);
    gr.addColorStop(0, '#feda75'); gr.addColorStop(0.3, '#fa7e1e'); gr.addColorStop(0.6, '#d62976'); gr.addColorStop(0.85, '#962fbf'); gr.addColorStop(1, '#4f5bd5');
    ctx.fillStyle = gr;
    ctx.beginPath(); ctx.roundRect(ix, iy, size, size, size * 0.28); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(2, size * 0.08);
    const p = size * 0.2;
    ctx.beginPath(); ctx.roundRect(ix + p, iy + p, size - 2 * p, size - 2 * p, size * 0.17); ctx.stroke();
    ctx.beginPath(); ctx.arc(ix + size / 2, iy + size / 2, size * 0.15, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(ix + size * 0.69, iy + size * 0.31, size * 0.045, 0, Math.PI * 2); ctx.fill();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    fitFont(ctx, s.handle || '', 900, Math.round(h * 0.16), w * 0.84);
    ctx.fillStyle = s.accent || '#fff'; ctx.fillText(s.handle || '', sx + w / 2 + scale * 0.9, sy + h * 0.69 + scale * 0.9);
    ctx.shadowColor = s.fg || '#fff'; ctx.shadowBlur = scale * 3;
    ctx.fillStyle = s.fg || '#fff';
    ctx.fillText(s.handle || '', sx + w / 2, sy + h * 0.69);
    ctx.shadowBlur = 0;
    if (s.sub) {
      fitFont(ctx, s.sub, 600, Math.round(h * 0.09), w * 0.88);
      ctx.fillStyle = s.accent || '#fff';
      ctx.fillText(s.sub, sx + w / 2, sy + h * 0.85);
    }
  }

  // 공연장 전광판 느낌: 그라데이션, 흐르는 사선, 박자 맞춰 튀는 이퀄라이저, 반짝이, 픽셀 모서리
  function slideBackdrop(sx, sy, w, h, s, beat, t) {
    const acc = s.accent || '#fff';
    const gr = ctx.createLinearGradient(sx, sy, sx, sy + h);
    gr.addColorStop(0, s.bg || '#111'); gr.addColorStop(1, s.bg2 || s.bg || '#111');
    ctx.fillStyle = gr; ctx.fillRect(sx, sy, w, h);
    ctx.fillStyle = acc;
    ctx.globalAlpha = 0.07;
    const step = scale * 10, bw = scale * 3, off = (t * scale * 6) % step;
    for (let x = -h - step; x < w + step; x += step) {
      ctx.beginPath();
      ctx.moveTo(sx + x + off, sy + h); ctx.lineTo(sx + x + off + h, sy); ctx.lineTo(sx + x + off + h + bw, sy); ctx.lineTo(sx + x + off + bw, sy + h);
      ctx.fill();
    }
    ctx.globalAlpha = 0.3;
    const n = 14, cw = w / n;
    for (let i = 0; i < n; i++) {
      const lv = 0.2 + 0.8 * Math.abs(Math.sin(beat * Math.PI * 0.5 + i * 1.7)) * (0.55 + 0.45 * S.hash(i, Math.floor(beat)));
      const bh = Math.max(1, Math.round((h * 0.12 * lv) / scale)) * scale;
      ctx.fillRect(sx + i * cw + scale * 0.5, sy + h - scale - bh, cw - scale, bh);
    }
    ctx.globalAlpha = 1;
    for (let i = 0; i < 6; i++) {
      const tw = Math.sin(t * 3 + i * 2.1);
      if (tw < 0.2) continue;
      const a = scale * (tw > 0.75 ? 1.4 : 0.9);
      const px = sx + w * (i % 2 ? 0.06 + 0.1 * S.hash(i, 21) : 0.84 + 0.1 * S.hash(i, 21)), py = sy + h * (0.1 + 0.16 * S.hash(i, 22));
      ctx.fillStyle = i % 3 ? '#ffffff' : acc;
      ctx.fillRect(px - a / 2, py - a * 2, a, a * 4); ctx.fillRect(px - a * 2, py - a / 2, a * 4, a);
    }
    ctx.fillStyle = acc;
    const c = scale * 4, th = scale;
    ctx.fillRect(sx + th, sy + th, c, th); ctx.fillRect(sx + th, sy + th, th, c);
    ctx.fillRect(sx + w - th - c, sy + th, c, th); ctx.fillRect(sx + w - th * 2, sy + th, th, c);
    ctx.fillRect(sx + th, sy + h - th * 3, c, th); ctx.fillRect(sx + th, sy + h - th * 2 - c, th, c);
    ctx.fillRect(sx + w - th - c, sy + h - th * 3, c, th); ctx.fillRect(sx + w - th * 2, sy + h - th * 2 - c, th, c);
  }

  const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
  // 아이콘 → (라벨) → 제목(박자에 맞춰 통통, 그림자+네온) → 리본 모양 부제 순서로 세로 가운데 정렬
  function drawTextSlide(sx, sy, w, h, s, T, beat) {
    const np = s.type === 'nowplaying', song = np && board.music;
    const title = np ? (song ? song.title : currentBand(T)) : s.title || '';
    const label = np ? (song ? '♪ NOW PLAYING' : '● NOW ON STAGE') : s.label || '';
    const sub = np ? (song ? `${song.artist} · ${song.credit}` : '') : s.sub || '';
    const fg = s.fg || '#fff', acc = s.accent || '#fff';
    const lines = String(title).split('\n');
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    let fs = Math.round(h * (lines.length > 1 ? 0.14 : 0.19));
    for (const l of lines) { fitFont(ctx, l, 900, fs, w * 0.84); fs = Math.min(fs, parseInt(ctx.font.split(' ')[1], 10)); }
    const iconS = s.icon ? Math.round(h * 0.17) : 0, labelS = label ? Math.round(h * 0.075) : 0, subS = sub ? Math.round(h * 0.075) : 0;
    const gap = h * 0.045, lh = fs * 1.22, ribbonH = subS * 1.9;
    const blockH = (iconS ? iconS + gap : 0) + (labelS ? labelS + gap : 0) + lines.length * lh + (subS ? gap + ribbonH : 0);
    const cx = sx + w / 2, kick = Math.max(0, 1 - (beat % 1) * 4);
    let y = sy + (h * 0.9 - blockH) / 2;
    if (iconS) {
      ctx.font = `${iconS}px ${EMOJI_FONT}`;
      ctx.fillText(s.icon, cx, y + iconS / 2 - kick * scale * 1.5);
      y += iconS + gap;
    }
    if (labelS) {
      ctx.font = `800 ${labelS}px ${FONT}`;
      ctx.fillStyle = acc; ctx.globalAlpha = Math.floor(beat) % 2 ? 1 : 0.65;
      ctx.fillText(label, cx, y + labelS / 2);
      ctx.globalAlpha = 1;
      y += labelS + gap;
    }
    ctx.save();
    ctx.translate(cx, y + (lines.length * lh) / 2);
    const pulse = 1 + 0.035 * kick;
    ctx.scale(pulse, pulse);
    ctx.font = `900 ${fs}px ${FONT}`;
    lines.forEach((l, i) => {
      const ly = (i - (lines.length - 1) / 2) * lh;
      ctx.fillStyle = acc; ctx.fillText(l, scale * 0.9, ly + scale * 0.9);
      ctx.shadowColor = fg; ctx.shadowBlur = scale * 3;
      ctx.fillStyle = fg; ctx.fillText(l, 0, ly);
      ctx.shadowBlur = 0;
    });
    ctx.restore();
    y += lines.length * lh;
    if (subS) {
      y += gap;
      fitFont(ctx, sub, 800, subS, w * 0.74);
      const rw = ctx.measureText(sub).width + subS * 1.6;
      ctx.fillStyle = acc;
      ctx.beginPath(); ctx.roundRect(cx - rw / 2, y, rw, ribbonH, ribbonH / 2); ctx.fill();
      ctx.fillStyle = s.bg2 || s.bg || '#111';
      ctx.fillText(sub, cx, y + ribbonH / 2 + 1);
    }
  }

  // 슬램 러시 중에 전광판을 덮는 화면 (billboard.json slamSlide로 바꾸거나 false로 끌 수 있다)
  const SLAM_SLIDE = { type: 'text', icon: '💥', label: 'SLAM TIME', title: '에바뛰', bg: '#5a0f1a', bg2: '#16040a', fg: '#ffffff', accent: '#ff3b5c' };
  function drawSlide(T, beat) {
    const r = S.SCREEN_L;
    const [sx, sy] = toScreen(r.x, r.y), w = r.w * scale, h = r.h * scale;
    if (sx > vw || sy > vh || sx + w < 0 || sy + h < 0) return;
    const slides = board.slides.length ? board.slides : [{ type: 'text', title: board.festivalName, sub: '' }];
    const dur = board.slideSeconds * 1000;
    const slam = rush.on && board.slamSlide !== false;
    const idx = forceSlide != null && slides[forceSlide] ? forceSlide : Math.floor(T / dur) % slides.length;
    const s = slam ? { ...SLAM_SLIDE, ...(board.slamSlide || {}) } : slides[idx];
    ctx.save();
    ctx.beginPath(); ctx.rect(sx, sy, w, h); ctx.clip();
    // 슬램 땐 박자마다 화면이 좌우로 쿵쿵 흔들린다
    if (slam && beat % 1 < 0.18) ctx.translate((Math.floor(beat) % 2 ? 1 : -1) * scale, 0);
    const im = s.type === 'image' && images[s.src];
    if (im && im.complete && im.naturalWidth) {
      ctx.fillStyle = s.bg || '#111'; ctx.fillRect(sx, sy, w, h);
      const k = Math.max(w / im.naturalWidth, h / im.naturalHeight), iw = im.naturalWidth * k, ih = im.naturalHeight * k;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(im, sx + (w - iw) / 2, sy + (h - ih) / 2, iw, ih);
    } else {
      slideBackdrop(sx, sy, w, h, s, beat, T / 1000);
      if (s.type === 'insta') drawInsta(sx, sy, w, h, s, beat);
      else drawTextSlide(sx, sy, w, h, s, T, beat);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    for (let y = 0; y < h; y += scale) ctx.fillRect(sx, sy + y, w, 1);
    ctx.fillStyle = s.accent || '#fff';
    ctx.fillRect(sx, sy + h - scale, slam ? (w * (beat % 4)) / 4 : (w * (T % dur)) / dur, scale);
    ctx.restore();
  }

  function drawLabels() {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const [bx, by] = toScreen(320, 48.5);
    // 무대 현수막은 영어 이름 (billboard.json stageName)
    const banner = board.stageName || board.festivalName;
    fitFont(ctx, banner, 800, Math.round(scale * 6.5), 110 * scale);
    ctx.fillStyle = '#2a1440'; ctx.fillText(banner, bx, by);
    ctx.font = `700 ${Math.round(scale * 2.6)}px ${FONT}`;
    [[S.TENTS_L, ['GOODS', 'MERCH', 'WATER']], [S.TENTS_R, ['FOOD', 'BAR', 'CAFE']]].forEach(([r, names]) => {
      names.forEach((n, i) => { const [x, y] = toScreen(r.x + i * 32 + 16, r.y + 6.6); ctx.fillStyle = '#fff'; ctx.fillText(n, x, y); });
    });
  }

  // 이름표는 없다. 내 캐릭터 머리 위에만 통통 뛰는 노란 화살표 (조명·밤 색조 위에 그려 늘 잘 보이게)
  function drawMeMark(t) {
    const x = snap(me.x), y = snap(me.y) - 21 + (me.sit ? 3 : 0) - Math.round(Math.abs(Math.sin(t * 4)) * 2);
    const c = '#ffd84a', o = '#2a1f00';
    R(o, x - 3, y - 1, 7, 1);
    R(o, x - 3, y, 7, 1); R(c, x - 2, y, 5, 1);
    R(o, x - 2, y + 1, 5, 1); R(c, x - 1, y + 1, 3, 1);
    R(o, x - 1, y + 2, 3, 1); R(c, x, y + 2, 1, 1);
    R(o, x, y + 3, 1, 1);
  }

  let lastTs = performance.now(), hudAt = 0, padCover = 0;
  function frame(ts) {
    const dt = Math.min(0.05, (ts - lastTs) / 1000); lastTs = ts;
    const T = now(), t = T / 1000, beat = songBeat(T);
    updateMusic(dt, T, ts);
    const p = forcePhase != null && Number.isFinite(forcePhase) ? ((forcePhase % 1) + 1) % 1 : kstPhase(T);
    const e = env(p);
    const npcs = npcStates(beat, t, e.dark, T);
    update(dt, npcs, T);
    for (const o of others.values()) {
      if (Math.hypot(o.x - o.rx, o.y - o.ry) > 40) { o.rx = o.x; o.ry = o.y; }
      const k = Math.min(1, dt * 10); o.rx += (o.x - o.rx) * k; o.ry += (o.y - o.ry) * k;
    }
    for (let i = particles.length - 1; i >= 0; i--) {
      const q = particles[i];
      q.life -= dt; q.vy += q.g * dt; q.x += q.vx * dt; q.y += q.vy * dt;
      if (q.life <= 0) particles.splice(i, 1);
    }
    sendState(ts);

    // 터치 화면에선 아래쪽 버튼에 가리지 않게 캐릭터를 위쪽에 두고, 맵 아래로도 카메라가 내려갈 수 있게 한다
    // PC도 키 안내 창에 펜스 광고판이 가리지 않을 만큼 내려간다
    const portrait = vh > vw;
    const padB = isTouch ? Math.ceil((padCover + 8) / scale) : Math.ceil(64 / scale);
    const fx = me.joined ? me.x : waitingNo != null ? 320 + Math.sin(t / 14) * 160 : 320;
    const fy = me.joined ? me.y - 20 + (isTouch && portrait ? 16 : 0) : waitingNo != null ? 150 + Math.sin(t / 23) * 40 : 150;
    camX = snap(Math.min(Math.max(0, fx - viewW / 2), S.W - viewW));
    // 맵 전체가 세로로 다 보이면 맵을 화면 아래에 붙이고, 위로 남는 자리는 하늘이 된다
    const maxCamY = S.H - viewH + padB;
    camY = snap(maxCamY < 0 ? maxCamY : Math.max(0, Math.min(fy - viewH / 2, maxCamY)));

    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, low.width, low.height);
    g.imageSmoothingEnabled = false;
    g.setTransform(kpx, 0, 0, kpx, -Math.round(camX * kpx), -Math.round(camY * kpx));
    C = g;
    drawSky(e, p, t);
    g.drawImage(bg, 0, 0);
    if (camY + viewH > S.H) { R('#4c7d31', camX, S.H, viewW, viewH); for (let x = camX - (camX % 28); x < camX + viewW; x += 28) R('#44722b', x, S.H, 14, viewH); }
    for (const b of bulbs) { R('#3a3a40', b.x - 3, b.y, 6, 1); R(['#c99a5a', '#c9708a', '#7aa0c9'][b.c], b.x, b.y + 1, 1, 1); }
    const members = drawStage(T, beat, t);
    drawScreenFrame(S.SCREEN_L); drawScreenFrame(S.SCREEN_R);

    for (const m of S.activeMats(npcOut)) drawMat(m, false); // 모두 나간 NPC 돗자리는 걷혀 있다
    for (const o of others.values()) if (o.mat) drawMat(o.mat, false);
    if (me.mat) drawMat(me.mat, true);
    if (me.target) drawWalkMark(me.target, ts);

    const list = [];
    for (const n of npcs) list.push({ y: n.y, fn: () => drawPerson(g, n, beat, t) });
    for (const o of others.values()) {
      const op = { x: o.rx, y: o.ry, f: o.f, a: o.a, moving: o.moving, look: o.look, seed: o.seed, flag: o.flag, flagIdx: o.look && o.look[8] };
      op.sit = !op.moving && op.a !== 3 && onOwnMat(op, o.mat);
      list.push({ y: op.y, fn: () => drawPerson(g, op, beat, t) });
    }
    if (me.joined) {
      me.sit = !me.moving && me.a !== 3 && onOwnMat(me, me.mat);
      list.push({ y: me.y + 0.01, fn: () => drawPerson(g, { ...me, seed: me.id, flagIdx: me.look[8] }, beat, t) });
    }
    for (const f of S.FLAGS) list.push({ y: f.y, fn: () => drawFlag(f, t) });
    list.push({ y: S.TENTS_L.y + S.TENTS_L.h, fn: () => drawTents(S.TENTS_L, '#ff4fa3') });
    list.push({ y: S.TENTS_R.y + S.TENTS_R.h, fn: () => drawTents(S.TENTS_R, '#ff8a3d') });
    list.push({ y: S.BOOTH.y + S.BOOTH.h, fn: () => drawBooth(beat, t) });
    list.sort((a, b) => a.y - b.y);
    for (const it of list) it.fn();
    for (const q of particles) R(q.c, Math.round(q.x), Math.round(q.y), 1, 1);
    drawFenceBottom();

    g.globalCompositeOperation = 'multiply';
    g.fillStyle = rgb(e.tint); g.fillRect(camX, camY, viewW, viewH);
    g.globalCompositeOperation = 'source-over';
    if (e.dark > 0.02) drawLights(e, t, beat);
    drawLiveCam(members, beat, t, T);
    if (me.joined) drawMeMark(t);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#07140c'; ctx.fillRect(0, 0, vw, vh);
    ctx.drawImage(low, ox, oy, viewW * scale, viewH * scale);
    drawSlide(T, beat);
    drawFenceAds(T, e);
    drawLabels();

    if (ts - hudAt > 500) {
      hudAt = ts;
      // 오른쪽 아래 버튼 묶음이 화면 아래에서 차지하는 높이 (세로 화면에서 펜스 광고판이 가리지 않게)
      if (isTouch && me.joined) padCover = vh - $('pad').getBoundingClientRect().top;
      if (me.joined) store.set('fest.pos', JSON.stringify([Math.round(me.x * 10) / 10, Math.round(me.y * 10) / 10, me.mat ? [me.mat[0], me.mat[1]] : null]));
      $('nowBand').textContent = currentBand(T);
      document.body.classList.toggle('has-music', !!board.music);
      if (board.music) { $('songRow').style.display = ''; $('song').textContent = board.music.title; }
      $('online').textContent = online || (me.joined ? 1 : 0);
      $('phase').textContent = `${phaseLabel(p)} ${kstClock(T)}`;
    }
    if (!me.joined || editing) drawPreview(beat, t);
    requestAnimationFrame(frame);
  }

  // ───────── 입장 화면 ─────────
  // ?new 를 붙이면 팔찌·캐릭터·자리를 지우고 처음 온 사람처럼 시작 (테스트용)
  if (params.has('new')) for (const k of ['fest.band', 'fest.name', 'fest.look', 'fest.pos']) { try { localStorage.removeItem(k); } catch { /* 무시 */ } }
  const pv = $('preview'), pg = pv.getContext('2d');
  try { me.look = S.sanitizeLook(JSON.parse(store.get('fest.look'))); } catch { me.look = S.randomLook(Math.random); }
  $('nameInput').value = store.get('fest.name') || '';
  // 입장 팔찌: 하루짜리(1DAY PASS)라 한국 날짜가 바뀌면 새로 채워준다.
  // 오늘 팔찌가 있으면 새로고침해도 같은 사람으로 바로 입장한다
  const BAND_COLORS = ['#ff4fa3', '#2f6fe0', '#f2a516', '#2bb673', '#9b59d0', '#e23d3d', '#14a3b8'];
  const kstDay = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  let band = null, daily = false;
  try { const b = JSON.parse(store.get('fest.band')); if (b && b.no && b.name) band = b; } catch { /* 팔찌 없음 */ }
  // 마지막에 있던 자리와 돗자리 (서버가 다시 검사한다)
  try {
    const p = JSON.parse(store.get('fest.pos'));
    if (Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) {
      me.x = p[0]; me.y = p[1]; me.hasPos = true;
      if (Array.isArray(p[2])) me.mat = [p[2][0], p[2][1], me.look[5]];
    }
  } catch { /* 처음 */ }
  // 어제 팔찌가 있으면 이어서 몇 번째 날인지 세고, 색은 어제와 다르게
  function newBand(name, prev) {
    const r = new Uint32Array(1);
    crypto.getRandomValues(r);
    const colors = BAND_COLORS.filter((c) => !prev || c !== prev.color);
    return { name, no: String(r[0] % 1000000).padStart(6, '0'), color: colors[r[0] % colors.length], issued: Date.now(), day: kstDay(), visits: ((prev && prev.visits) || 0) + 1 };
  }
  function renderBand() {
    $('band').style.setProperty('--band', band.color);
    $('bandFest').textContent = `${board.festivalName} · 1DAY PASS`;
    $('bandName').textContent = band.name;
    $('bandNo').textContent = `No. ${band.no} · ${band.day.replace(/-/g, '.')}`;
    $('bandChip').style.setProperty('--band', band.color);
    $('bandLabel').textContent = `${band.name} · No.${band.no}`;
  }
  const STEP_TEXT = {
    name: [() => board.festivalName, () => `${board.tagline} · 먼저 이름을 알려주세요`],
    band: [() => (daily ? '오늘의 입장 팔찌' : '입장 팔찌를 채워드릴게요'),
      () => (daily ? `${band.name}님, 오늘도 와주셨네요! · ${band.visits}일째 방문` : '오늘 하루 이 팔찌로 언제든 바로 다시 들어올 수 있어요')],
    look: [() => '캐릭터 만들기', () => `축제에서 입을 옷을 골라요 · 나중에 ${isTouch ? '👕' : 'C'}로 바꿀 수 있어요`],
  };
  function showStep(step) {
    $('join').dataset.step = step;
    $('joinTitle').textContent = STEP_TEXT[step][0]();
    $('joinSub').textContent = STEP_TEXT[step][1]();
    const order = ['name', 'band', 'look'];
    document.querySelectorAll('#join .steps span').forEach((el) => {
      const i = order.indexOf(el.dataset.s), cur = order.indexOf(step);
      el.classList.toggle('on', i === cur); el.classList.toggle('done', i < cur);
    });
    if (step === 'name' && !isTouch) $('nameInput').focus();
    if (step === 'band') { const el = $('band'); el.classList.remove('worn'); void el.offsetWidth; el.style.animation = ''; }
  }
  function nameNext() {
    const name = $('nameInput').value.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 12);
    if (!name) { $('nameHint').textContent = '팔찌에 새길 이름을 적어주세요'; return; }
    $('nameHint').textContent = '';
    $('nameInput').blur();
    band = band && band.name === name && band.day === kstDay() ? band : newBand(name, band);
    track('tutorial_begin');
    renderBand();
    showStep('band');
  }
  function bandNext() {
    $('band').classList.add('worn');
    track('band_issued', { visits: band.visits });
    toast(`🎟️ 팔찌 착용 완료! No.${band.no}`);
    // 다음 날 다시 온 사람은 캐릭터가 이미 있으니 팔찌만 차고 바로 입장
    setTimeout(() => (daily ? enter() : showStep('look')), 600);
  }
  function drawPreview(beat, t) {
    pg.fillStyle = '#5f9e3c'; pg.fillRect(0, 0, 24, 26);
    const prev = C; C = pg;
    drawMat([3, 12, me.look[5]], false);
    C = prev;
    // 고른 깃발이 보이도록 미리보기에선 늘 깃발을 들고 있다
    drawPerson(pg, { x: 12, y: 21, look: me.look, f: [0, 3, 1, 2][Math.floor(t / 1.5) % 4], a: 2, seed: 0, flag: true, flagIdx: me.look[8] }, beat, t);
  }

  // ───────── 꾸미기 패널 ─────────
  const PARTS = [
    { i: 0, label: '피부', colors: S.SKIN },
    { i: 1, label: '머리색', colors: S.HAIR },
    { i: 6, label: '머리 모양', names: S.HAIR_STYLES },
    { i: 4, label: '모자', names: S.HAT_NAMES },
    { i: 2, label: '상의 색', colors: S.SHIRT },
    { i: 7, label: '상의 무늬', names: S.SHIRT_STYLES },
    { i: 3, label: '하의', colors: S.PANTS },
    { i: 5, label: '돗자리', names: S.MAT_NAMES },
    { i: 8, label: '깃발', flags: S.FLAGS, hint: `게임에서 ${isTouch ? '🚩 버튼' : '4키'}로 들 수 있어요` },
  ];
  // 깃발 무늬를 견본 버튼 배경으로 (drawFlag의 무늬 규칙과 같다)
  function flagCss(f) {
    const n = f.c.length;
    if (f.s === 0) return `linear-gradient(to bottom, ${f.c.map((c, i) => `${c} ${(i / n) * 100}% ${((i + 1) / n) * 100}%`).join(', ')})`;
    if (f.s === 1) return `linear-gradient(to right, ${f.c[0]} 50%, ${f.c[1]} 50%)`;
    return `linear-gradient(to right, transparent 33%, ${f.c[1]} 33% 67%, transparent 67%) center / 100% 50% no-repeat, ${f.c[0]}`;
  }
  function setPart(i, v) {
    me.look[i] = v;
    if (!editing) store.set('fest.look', JSON.stringify(me.look));
    renderParts();
  }
  function renderParts() {
    const box = $('parts');
    box.replaceChildren();
    for (const part of PARTS) {
      const row = document.createElement('div'); row.className = 'part';
      const label = document.createElement('span'); label.textContent = part.label;
      const ctl = document.createElement('div');
      if (part.colors || part.flags) {
        ctl.className = 'swatches';
        (part.colors || part.flags).forEach((c, v) => {
          const b = document.createElement('button');
          b.type = 'button'; b.className = 'sw' + (part.flags ? ' flag' : '') + (me.look[part.i] === v ? ' on' : '');
          b.style.background = part.flags ? flagCss(c) : c; b.title = part.flags ? `깃발 ${v + 1}` : c;
          b.onclick = () => setPart(part.i, v);
          ctl.append(b);
        });
      } else {
        ctl.className = 'stepper';
        const n = part.names.length, cur = me.look[part.i];
        const prevB = document.createElement('button'), nextB = document.createElement('button'), name = document.createElement('span');
        prevB.type = nextB.type = 'button'; prevB.textContent = '◀'; nextB.textContent = '▶';
        name.textContent = part.names[cur];
        prevB.onclick = () => setPart(part.i, (cur + n - 1) % n);
        nextB.onclick = () => setPart(part.i, (cur + 1) % n);
        ctl.append(prevB, name, nextB);
      }
      row.append(label, ctl);
      if (part.hint) { const h = document.createElement('span'); h.className = 'part-hint'; h.textContent = part.hint; row.append(h); }
      box.append(row);
    }
  }

  let editing = false, lookBefore = null;
  function openEditor() {
    editing = true; lookBefore = me.look.slice();
    for (const k in keys) keys[k] = false;
    $('join').classList.add('editing');
    $('join').dataset.step = 'look';
    $('joinTitle').textContent = '캐릭터 꾸미기';
    $('joinSub').textContent = '저장하면 모두에게 바로 보여요 · Esc 취소';
    $('enter').textContent = '저장하기';
    $('join').style.display = 'grid';
    renderParts();
  }
  function closeEditor(save) {
    if (save) {
      store.set('fest.look', JSON.stringify(me.look));
      netSend({ t: 'look', look: me.look });
      if (me.mat) me.mat[2] = me.look[5];
      toast('새 모습으로 변신! ✨');
      track('customize');
    } else me.look = lookBefore;
    editing = false;
    $('join').style.display = 'none';
    $('enter').blur();
  }

  $('reroll').onclick = () => { me.look = S.randomLook(Math.random); if (!editing) store.set('fest.look', JSON.stringify(me.look)); renderParts(); };
  let returning = false;
  function enter() {
    me.name = band.name;
    store.set('fest.band', JSON.stringify(band)); store.set('fest.name', me.name); store.set('fest.look', JSON.stringify(me.look));
    $('join').style.display = 'none';
    $('enter').blur();
    $('bandRow').style.display = '';
    startMusic();
    connect();
  }
  $('sound').addEventListener('pointerdown', (e) => { e.stopPropagation(); setMuted(!music.muted); });
  setMuted(music.muted);
  $('enter').onclick = () => (editing ? closeEditor(true) : (track('tutorial_complete'), enter()));
  $('cancel').onclick = () => closeEditor(false);
  renderParts();
  $('nameInput').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) nameNext(); });
  $('nameNext').onclick = nameNext;
  $('bandNext').onclick = bandNext;
  // 오늘 팔찌가 있으면 온보딩 없이 바로 입장, 어제 팔찌만 있으면 오늘 팔찌를 새로 채워준다
  if (band && band.day === kstDay()) { returning = true; renderBand(); enter(); }
  else if (band) { daily = true; band = newBand(band.name, band); renderBand(); $('join').classList.add('daily'); showStep('band'); }
  else showStep('name');

  requestAnimationFrame(frame);
})();

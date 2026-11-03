const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const S = require('./public/shared.js');

const PORT = Number(process.env.PORT) || 3000;
const PUB = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
};
// 검색 노출용 깔끔한 주소. /about.html 로 들어오면 /about 으로 보내서 주소가 하나만 색인되게 한다
const PAGES = { '/': '/index.html', '/about': '/about.html', '/favicon.ico': '/icon-192.png' };
const AUDIO_EXT = ['.mp3', '.m4a', '.wav', '.ogg'];

// public/music/ 안의 첫 번째 음원 파일 (이름 상관없이 넣기만 하면 된다)
function currentTrack() {
  try {
    const dir = path.join(PUB, 'music');
    const f = fs.readdirSync(dir).filter((n) => AUDIO_EXT.includes(path.extname(n).toLowerCase())).sort()[0];
    return f ? path.join(dir, f) : null;
  } catch { return null; }
}

const server = http.createServer((req, res) => {
  let p;
  try { p = decodeURIComponent(req.url.split('?')[0]); } catch { res.writeHead(400); return res.end(); }
  if (p === '/index.html' || p === '/about.html') {
    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    res.writeHead(301, { Location: (p === '/index.html' ? '/' : '/about') + qs }); return res.end();
  }
  if (PAGES[p]) p = PAGES[p];
  const fp = p === '/music/current' ? currentTrack() : path.normalize(path.join(PUB, p));
  if (!fp) { res.writeHead(404); return res.end('no track'); }
  if (!fp.startsWith(PUB + path.sep)) { res.writeHead(403); return res.end(); }
  fs.stat(fp, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('not found'); }
    const headers = { 'Content-Type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'Accept-Ranges': 'bytes' };
    // 음원 탐색(currentTime 이동)에 필요한 Range 요청 지원
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (m && (m[1] || m[2])) {
      let start = m[1] ? Number(m[1]) : st.size - Number(m[2]);
      let end = m[1] && m[2] ? Number(m[2]) : st.size - 1;
      start = Math.max(0, start); end = Math.min(end, st.size - 1);
      if (start > end) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
      return fs.createReadStream(fp, { start, end }).pipe(res);
    }
    res.writeHead(200, { ...headers, 'Content-Length': st.size });
    fs.createReadStream(fp).pipe(res);
  });
});

// 스냅샷 JSON을 압축해서 보낸다 (작은 메시지는 그대로). 사람마다 압축 상태를 따로 갖지 않아 메모리가 거의 안 든다
const wss = new WebSocketServer({
  server, maxPayload: 4096,
  perMessageDeflate: process.env.DEFLATE === '0' ? false : { threshold: 256, serverNoContextTakeover: true, clientNoContextTakeover: true, zlibDeflateOptions: { level: 3 } },
});
const players = new Map();
let nextId = 1;
// 정원. 꽉 차면 웨이팅 번호를 받고 밖에서 기다리다 자리가 나면 순서대로 들어간다
const CAPACITY = Number(process.env.CAPACITY) || 200;
const queue = [];
let nextWaitNo = 1;
// 한 사람이 탭·봇을 잔뜩 열어 정원을 채우지 못하게 IP당 연결 수를 제한한다 (웨이팅 포함).
// 통신사 폰은 여러 명이 IP 하나를 같이 쓰기도 해서 넉넉하게. 내 컴퓨터(루프백) 테스트는 제한 없음
const MAX_PER_IP = Number(process.env.MAX_PER_IP) || 10;
const perIp = new Map();
// Fly.io 프록시 뒤에서는 Fly-Client-IP가 진짜 주소 (Fly 밖에선 누구나 꾸며 보낼 수 있으니 안 믿는다)
function clientIp(req) {
  const fly = process.env.FLY_APP_NAME && req.headers['fly-client-ip'];
  return String(fly || req.socket.remoteAddress || '').replace(/^::ffff:/, '');
}
const isLoopback = (ip) => ip === '127.0.0.1' || ip === '::1';

// NPC 관객도 접속자 수와 정원에 같이 센다. 실제 사용자가 4명 이상이면 5분마다 몇 명씩 빠지고,
// 그 사이사이 한 명씩 나갔다 들어왔다 한다. 사용자가 적으면 5분마다 다시 돌아온다
const NPC_TOTAL = S.CROWD.npcs.length;
const npcOut = new Uint8Array(NPC_TOTAL); // 1 = 밖에 있음
const npcAt = new Array(NPC_TOTAL).fill(0); // 마지막으로 나가거나 들어온 시각
const NPC_MIN = Number(process.env.NPC_MIN) || 40; // 이 밑으로는 줄지 않는다
const NPC_WAVE_MS = (Number(process.env.NPC_WAVE_SEC) || 300) * 1000;
const NPC_BUSY_USERS = 4;
const NPC_REST_MS = 15000; // 방금 드나든 NPC는 잠깐 쉬게 (걷는 중에 방향을 바꾸지 않게)
let npcIn = NPC_TOTAL;
const total = () => npcIn + players.size;
// 누군가 2분 넘게 머물면 돗자리 NPC 20명이 일어나 슬램존으로 간다.
// 2분 슬램(전광판 '에바뛰')하고 돗자리에서 5분 쉬었다가 다시 들어가기를 반복하고, 그런 사람이 다 나가면 돌아간다
const RUSH_AFTER_MS = (Number(process.env.RUSH_AFTER_SEC) || 120) * 1000;
const RUSH_SLAM_MS = (Number(process.env.RUSH_SLAM_SEC) || 120) * 1000;
const RUSH_REST_MS = (Number(process.env.RUSH_REST_SEC) || 300) * 1000;
const RUSH_COUNT = 20;
const rush = { on: false, at: 0, ids: [] };
let rushSession = false;

const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, max);
const int = (v, lo, hi) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo; };
function send(ws, msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }
function broadcast(msg, except) { const s = JSON.stringify(msg); for (const p of players.values()) if (p !== except && p.ws.readyState === 1) p.ws.send(s); }
// 자주 바뀌는 상태는 숫자 4개로: [id, x*10, y*10, 방향|걷는중<<2|동작<<3|깃발<<5]
const pack = (q) => [q.id, Math.round(q.x * 10), Math.round(q.y * 10), q.f | (q.m << 2) | (q.a << 3) | (q.g << 5)];
// 이름·외형·돗자리처럼 가끔 바뀌는 정보는 들어올 때와 바뀔 때만 보낸다
const info = (q) => ({ id: q.id, name: q.name, look: q.look, mat: q.mat, s: pack(q) });
const sameMat = (a, b) => (a && b ? a[0] === b[0] && a[1] === b[1] && a[2] === b[2] : a === b);
function sendQueue() {
  queue.forEach((w, i) => send(w.ws, { t: 'queue', no: w.no, ahead: i, n: total(), cap: CAPACITY }));
}
function admitNext() {
  while (total() < CAPACITY && queue.length) {
    const w = queue.shift();
    if (w.ws.readyState === 1) w.admit();
  }
  sendQueue();
}
function otherMats(me) {
  const mats = S.activeMats(npcOut);
  for (const p of players.values()) if (p !== me && p.mat) mats.push(p.mat);
  return mats;
}

wss.on('connection', (ws, req) => {
  const ip = clientIp(req);
  if (!isLoopback(ip)) {
    const c = (perIp.get(ip) || 0) + 1;
    if (c > MAX_PER_IP) {
      send(ws, { t: 'deny', msg: '같은 곳에서 너무 많이 접속했어요. 다른 탭을 닫아주세요' });
      return ws.close(4001);
    }
    perIp.set(ip, c);
    ws.on('close', () => { const n = perIp.get(ip) - 1; if (n > 0) perIp.set(ip, n); else perIp.delete(ip); });
  }
  let me = null, waiting = null;
  ws.alive = true;
  ws.on('pong', () => { ws.alive = true; });

  function enter(msg) {
    const now = Date.now();
    // 다시 온 사람은 마지막에 있던 자리에서 시작 (걸을 수 있는 곳일 때만)
    const pos = Array.isArray(msg.pos) ? [Number(msg.pos[0]), Number(msg.pos[1])] : null;
    const spot = pos && pos.every(Number.isFinite) && S.walkable(pos[0], pos[1]) ? { x: pos[0], y: pos[1] } : S.findSpawn(Math.random);
    me = {
      id: nextId++, ws, name: clean(msg.name, 12) || `관객${Math.floor(1000 + Math.random() * 9000)}`,
      look: S.sanitizeLook(msg.look), x: spot.x, y: spot.y, f: 1, m: 0, a: 0, g: 0, mat: null,
      lastMove: now, joinedAt: now,
    };
    // 펴 두었던 돗자리도 그 자리가 아직 비어 있으면 다시 편다
    if (Array.isArray(msg.mat)) {
      const m = [Math.round(Number(msg.mat[0])), Math.round(Number(msg.mat[1])), me.look[5]];
      if (Number.isFinite(m[0]) && Number.isFinite(m[1]) && !S.matProblem(S.matRect(m), otherMats(me))) me.mat = m;
    }
    // 새로 온 사람에겐 지금 있는 사람 전부를, 나머지에겐 새 사람 정보만
    const roster = [...players.values()].map(info);
    players.set(me.id, me);
    me.sentKey = pack(me).join(',');
    // 밖에 있거나 막 드나든 NPC만 알려준다 [번호, 밖?, 시각]
    const npc = [];
    for (let i = 0; i < NPC_TOTAL; i++) if (npcOut[i] || now - npcAt[i] < NPC_REST_MS) npc.push([i, npcOut[i], npcAt[i]]);
    send(ws, { t: 'welcome', id: me.id, name: me.name, time: now, x: me.x, y: me.y, mat: me.mat, players: roster, npc, n: total(), rush });
    broadcast({ t: 'info', ...info(me) }, me);
  }

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const now = Date.now();

    if (!me) {
      if (msg.t !== 'join' || waiting) return;
      // 꽉 찼거나 이미 기다리는 사람이 있으면 줄 맨 뒤로
      if (total() >= CAPACITY || queue.length) {
        waiting = { ws, no: nextWaitNo++, admit: () => { waiting = null; enter(msg); } };
        queue.push(waiting);
        sendQueue();
        return;
      }
      enter(msg);
      return;
    }

    if (msg.t === 's') {
      const x = Number(msg.x), y = Number(msg.y);
      const dt = Math.max(16, now - me.lastMove);
      const maxDist = (160 * dt) / 1000 + 10; // 슬램 넉백까지 고려한 넉넉한 상한
      if (Number.isFinite(x) && Number.isFinite(y) && S.walkable(x, y) && Math.hypot(x - me.x, y - me.y) <= maxDist) {
        me.x = x; me.y = y;
      } else if (Number.isFinite(x)) {
        send(ws, { t: 'fix', x: me.x, y: me.y });
      }
      me.lastMove = now;
      me.f = int(msg.f, 0, 3);
      me.m = msg.m ? 1 : 0;
      me.a = int(msg.a, 0, 3);
      if (me.a === 3 && !S.inStanding(me.x, me.y)) me.a = 0;
      me.g = msg.g ? 1 : 0;
      const matBefore = me.mat;
      if (msg.mat === null) me.mat = null;
      else if (Array.isArray(msg.mat)) {
        const m = [Math.round(Number(msg.mat[0])), Math.round(Number(msg.mat[1])), me.look[5]];
        if (!me.mat || m[0] !== me.mat[0] || m[1] !== me.mat[1]) {
          if (Number.isFinite(m[0]) && Number.isFinite(m[1]) && !S.matProblem(S.matRect(m), otherMats(me))) me.mat = m;
        }
      }
      if (!sameMat(matBefore, me.mat)) broadcast({ t: 'mat', id: me.id, mat: me.mat }, me);
    } else if (msg.t === 'look') {
      me.look = S.sanitizeLook(msg.look);
      if (me.mat) me.mat = [me.mat[0], me.mat[1], me.look[5]];
      broadcast({ t: 'info', ...info(me) }, me);
    }
  });

  ws.on('close', () => {
    if (me) { players.delete(me.id); broadcast({ t: 'leave', id: me.id }); admitNext(); }
    else if (waiting) { queue.splice(queue.indexOf(waiting), 1); sendQueue(); }
  });
});

// 10Hz 스냅샷: 지난번과 달라진 사람만 pack 형태로. n = 전체 접속자 수
// (모두에게 같은 내용이라 JSON은 한 번만 만든다)
setInterval(() => {
  if (!players.size) return;
  const p = [];
  for (const q of players.values()) {
    const s = pack(q), key = s.join(',');
    if (key !== q.sentKey) { q.sentKey = key; p.push(s); }
  }
  broadcast({ t: 'snap', time: Date.now(), n: total(), p });
}, 100);

// ───────── NPC 관객 드나들기 ─────────
function npcPick(out, k) {
  const now = Date.now(), list = [];
  for (let i = 0; i < NPC_TOTAL; i++) if (npcOut[i] === (out ? 0 : 1) && now - npcAt[i] > NPC_REST_MS && !rush.ids.includes(i)) list.push(i);
  for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
  return list.slice(0, Math.max(0, k));
}
function npcSet(i, out, ch) {
  npcOut[i] = out; npcAt[i] = Date.now(); npcIn += out ? -1 : 1;
  ch.push([i, out, npcAt[i]]);
}
function npcLeave(k, ch) {
  for (const i of npcPick(true, Math.min(k, npcIn - NPC_MIN))) npcSet(i, 1, ch);
}
// 돌아올 땐 정원에 여유가 있고, 걷힌 돗자리 자리를 사용자가 쓰고 있지 않을 때만
function npcReturn(k, ch) {
  const playerMats = [...players.values()].filter((q) => q.mat).map((q) => S.matRect(q.mat));
  for (const i of npcPick(false, NPC_TOTAL)) {
    if (k <= 0 || total() >= CAPACITY || queue.length) break;
    const n = S.CROWD.npcs[i];
    if (n.kind === 'mat' && S.CROWD.matMembers[n.mat].every((j) => npcOut[j])) {
      const r = S.matRect(S.CROWD.mats[n.mat]);
      if (playerMats.some((pr) => S.overlap(r, pr, 1))) continue;
    }
    npcSet(i, 0, ch); k--;
  }
}
// 슬램존으로 갈 NPC: 지금 들판에 있는 돗자리 NPC 중에서 (음향 부스 바로 위아래는 부스를 뚫고 가게 되니 빼고)
function rushPick() {
  const now = Date.now(), list = [];
  S.CROWD.npcs.forEach((n, i) => {
    if (n.kind === 'mat' && !npcOut[i] && now - npcAt[i] > NPC_REST_MS && Math.abs(n.x - (S.BOOTH.x + S.BOOTH.w / 2)) > S.BOOTH.w / 2 + 8) list.push(i);
  });
  for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
  return list.slice(0, RUSH_COUNT);
}
function updateRush() {
  const now = Date.now(), want = [...players.values()].some((q) => now - q.joinedAt >= RUSH_AFTER_MS);
  const flip = (on) => { rush.on = on; rush.at = now; broadcast({ t: 'rush', ...rush }); };
  if (!want) {
    if (!rushSession) return;
    rushSession = false;
    if (rush.on) flip(false);
    setTimeout(() => { if (!rushSession) rush.ids = []; }, 20000); // 다 돌아간 뒤 명단 비우기
  } else if (!rushSession) {
    // 지난번 무리가 돌아가는 중이면 조금 기다린다
    if (rush.on || now - rush.at < 20000) return;
    rushSession = true; rush.ids = rushPick();
    flip(true);
  } else if (rush.on ? now - rush.at >= RUSH_SLAM_MS : now - rush.at >= RUSH_REST_MS) {
    flip(!rush.on); // 슬램 ↔ 돗자리에서 쉬기
  }
}
let nextWave = Date.now() + NPC_WAVE_MS;
setInterval(() => {
  updateRush();
  const busy = players.size >= NPC_BUSY_USERS, ch = [];
  if (Date.now() >= nextWave) {
    nextWave = Date.now() + NPC_WAVE_MS;
    const n = 3 + Math.floor(Math.random() * 6); // 한 번에 3~8명
    if (busy) npcLeave(n, ch); else npcReturn(n, ch);
  } else if (busy && Math.random() < 1 / 20) {
    if (Math.random() < 0.5) npcLeave(1, ch); else npcReturn(1, ch);
  }
  if (ch.length) {
    broadcast({ t: 'npc', ch, n: total() });
    admitNext(); // NPC가 나가서 생긴 자리는 기다리던 사람 몫
  }
}, 1000);

// 끊긴 연결 정리
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false;
    ws.ping();
  }
}, 15000);

server.listen(PORT, () => console.log(`🎸 틈락페 열림 → http://localhost:${PORT}`));

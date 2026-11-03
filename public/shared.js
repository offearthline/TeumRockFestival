// 서버와 클라이언트가 함께 쓰는 월드 레이아웃/규칙
(function (root) {
  const W = 640, H = 400;
  const BPM = 120;
  const MAT_W = 18, MAT_H = 12;

  const STAGE = { x: 236, y: 44, w: 168, h: 68 };
  const SCREEN_L = { x: 172, y: 56, w: 56, h: 44 };
  const SCREEN_R = { x: 412, y: 56, w: 56, h: 44 };
  const BOOTH = { x: 300, y: 252, w: 44, h: 30 };
  const TENTS_L = { x: 24, y: 62, w: 96, h: 40 };
  const TENTS_R = { x: 520, y: 62, w: 96, h: 40 };

  const WALK = { x: 12, y: 56, w: 616, h: 334 };
  const BLOCKED = [
    { x: 166, y: 40, w: 308, h: 72 }, // 무대 + 전광판 + 스피커
    { x: 200, y: 112, w: 240, h: 9 }, // 펜스 앞 피트
    TENTS_L, TENTS_R, BOOTH,
  ];
  const STANDING = { x: 160, y: 121, w: 320, h: 65 };
  const FIELD = { x: 14, y: 192, w: 612, h: 196 };
  const PATH = [{ x: 316, y: 186, w: 12, h: 66 }, { x: 316, y: 282, w: 12, h: 110 }];
  const MOSH = { x: 320, y: 156, r: 20 };

  const FLAGS = [
    { x: 16, y: 58, h: 30, c: ['#ff4f6d', '#ffffff', '#ff4f6d'], s: 0 },
    { x: 150, y: 60, h: 28, c: ['#2f6fe0', '#ffd84a'], s: 1 },
    { x: 490, y: 60, h: 28, c: ['#ffd84a', '#111111'], s: 2 },
    { x: 624, y: 58, h: 30, c: ['#3fbf6a', '#ffffff', '#3fbf6a'], s: 0 },
    { x: 156, y: 126, h: 26, c: ['#ff8a3d', '#ffffff'], s: 1 },
    { x: 484, y: 126, h: 26, c: ['#9b59d0', '#ffd84a'], s: 2 },
    { x: 18, y: 204, h: 28, c: ['#2bc7c7', '#ffffff', '#2bc7c7'], s: 0 },
    { x: 622, y: 204, h: 28, c: ['#ff5fa2', '#ffffff'], s: 1 },
    { x: 104, y: 290, h: 26, c: ['#e23d3d', '#111111'], s: 2 },
    { x: 536, y: 290, h: 26, c: ['#f6c445', '#2f6fe0', '#f6c445'], s: 0 },
    { x: 18, y: 384, h: 28, c: ['#ffffff', '#e23d3d'], s: 1 },
    { x: 622, y: 384, h: 28, c: ['#111111', '#ffd84a'], s: 2 },
  ];

  const SKIN = ['#f6d3b3', '#e8b48f', '#c98e66', '#8d5a3b', '#f1c7a0'];
  const HAIR = ['#1b1b1f', '#3a2418', '#6b3b1f', '#d9b25a', '#b33a3a', '#e86fb1', '#4a6ad8', '#eeeeee', '#2c2c40'];
  const SHIRT = ['#ffffff', '#111111', '#e23d3d', '#2f6fe0', '#f6c445', '#3fbf6a', '#9b59d0', '#ff8a3d', '#2bc7c7', '#ff5fa2'];
  const PANTS = ['#2a3550', '#1a1a1a', '#5b6b84', '#c9b48a', '#3b2c22', '#7f8c9a'];
  const HAT_NAMES = ['없음', '캡모자', '버킷햇', '반다나'];
  const MAT_NAMES = ['하양', '하늘 줄무늬', '빨강 체크', '노랑', '분홍 땡땡이', '초록 타탄'];
  const HAIR_STYLES = ['짧은 머리', '긴 머리', '모히칸', '똥머리'];
  const SHIRT_STYLES = ['민무늬', '줄무늬', '밴드 티', '체크 셔츠'];
  const MATS = MAT_NAMES.length;
  // look = [피부, 머리색, 상의색, 하의, 모자, 돗자리무늬, 머리모양, 상의무늬, 깃발무늬]
  const LOOK_SIZES = [SKIN.length, HAIR.length, SHIRT.length, PANTS.length, HAT_NAMES.length, MATS, HAIR_STYLES.length, SHIRT_STYLES.length, FLAGS.length];

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash(a, b) {
    let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  // 깃발무늬는 rng를 쓰지 않고 나머지 값에서 뽑는다 (NPC 배치 시드가 바뀌지 않게)
  function randomLook(rng) {
    const look = LOOK_SIZES.slice(0, 8).map((n, i) => (i === 4 ? (rng() < 0.6 ? 0 : 1 + Math.floor(rng() * (n - 1))) : Math.floor(rng() * n)));
    look.push(Math.floor(hash(look[1] * 31 + look[2], look[6] * 7 + look[7]) * FLAGS.length));
    return look;
  }
  // 예전 저장값(항목 수가 적은 look)은 없는 항목을 0으로 채운다
  function sanitizeLook(look) {
    if (!Array.isArray(look) || look.length < 6 || look.length > LOOK_SIZES.length) return randomLook(Math.random);
    return LOOK_SIZES.map((n, i) => {
      const v = Math.floor(Number(look[i]));
      return Number.isFinite(v) && v >= 0 && v < n ? v : 0;
    });
  }

  function overlap(a, b, m = 0) {
    return a.x < b.x + b.w + m && a.x + a.w + m > b.x && a.y < b.y + b.h + m && a.y + a.h + m > b.y;
  }
  function inRect(r, x, y) {
    return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
  }
  function walkable(x, y) {
    if (x < WALK.x || x > WALK.x + WALK.w || y < WALK.y || y > WALK.y + WALK.h) return false;
    const feet = { x: x - 3, y: y - 2, w: 6, h: 3 };
    for (const b of BLOCKED) if (overlap(feet, b)) return false;
    return true;
  }
  function inStanding(x, y) { return inRect(STANDING, x, y); }
  function matRectAt(x, y) { return { x: Math.round(x) - 9, y: Math.round(y) - 8, w: MAT_W, h: MAT_H }; }
  function matRect(m) { return { x: m[0], y: m[1], w: MAT_W, h: MAT_H }; }

  // null = 가능, 'zone' = 펼 수 없는 구역, 'overlap' = 다른 돗자리와 겹침
  function matProblem(r, mats) {
    if (r.x < FIELD.x || r.y < FIELD.y || r.x + r.w > FIELD.x + FIELD.w || r.y + r.h > FIELD.y + FIELD.h) return 'zone';
    for (const p of PATH) if (overlap(r, p, 1)) return 'zone';
    if (overlap(r, BOOTH, 2)) return 'zone';
    for (const f of FLAGS) if (overlap(r, { x: f.x - 1, y: f.y - 2, w: 3, h: 3 })) return 'zone';
    for (const m of mats) if (overlap(r, matRect(m), 1)) return 'overlap';
    return null;
  }

  // 고정 시드 NPC 관객 — 모든 접속자에게 똑같이 보인다
  function genCrowd() {
    const rng = mulberry32(20261031);
    const mats = [], npcs = [];
    for (let gy = FIELD.y + 4; gy + MAT_H <= FIELD.y + FIELD.h - 2; gy += 22) {
      for (let gx = FIELD.x + 6; gx + MAT_W <= FIELD.x + FIELD.w - 2; gx += 28) {
        if (rng() > 0.3) continue;
        const m = [gx + Math.floor(rng() * 6), gy + Math.floor(rng() * 6), Math.floor(rng() * MATS)];
        if (matProblem(matRect(m), mats)) continue;
        mats.push(m);
        const n = 1 + Math.floor(rng() * 2.4);
        for (let i = 0; i < n; i++) {
          npcs.push({
            kind: 'mat', mat: mats.length - 1, x: m[0] + 4 + i * 5 + Math.floor(rng() * 2), y: m[1] + 9,
            f: rng() < 0.7 ? 1 : 0, look: randomLook(rng), seed: npcs.length, flag: rng() < 0.06,
          });
        }
      }
    }
    for (let i = 0; i < 52; i++) {
      const x = STANDING.x + 6 + rng() * (STANDING.w - 12);
      const y = STANDING.y + 4 + rng() * (STANDING.h - 6);
      const d = Math.hypot(x - MOSH.x, (y - MOSH.y) / 0.6);
      npcs.push({
        kind: d < MOSH.r ? 'mosh' : 'stand', x, y, f: 1, look: randomLook(rng), seed: npcs.length,
        flag: d >= MOSH.r && rng() < 0.08,
      });
    }
    // 돗자리마다 그 위에 앉는 NPC 번호들 (전부 나가면 돗자리도 걷는다)
    const matMembers = mats.map(() => []);
    npcs.forEach((n, i) => { if (n.kind === 'mat') matMembers[n.mat].push(i); });
    return { mats, npcs, matMembers };
  }
  const CROWD = genCrowd();
  // NPC 관객은 서버가 정한 대로 나갔다 들어온다. out[i] = 1이면 i번 NPC가 밖에 있음
  function activeMats(out) {
    return CROWD.mats.filter((_, mi) => CROWD.matMembers[mi].some((i) => !out[i]));
  }
  // NPC가 드나드는 옆 출구 (가까운 쪽 펜스)
  function npcExit(n) { return { x: n.x < W / 2 ? WALK.x + 2 : WALK.x + WALK.w - 2, y: n.y }; }

  function findSpawn(rng) {
    for (let i = 0; i < 200; i++) {
      const x = FIELD.x + 20 + rng() * (FIELD.w - 40);
      const y = FIELD.y + FIELD.h - 30 + rng() * 26;
      if (walkable(x, y)) return { x, y };
    }
    return { x: 300, y: 370 };
  }

  const api = {
    W, H, BPM, MAT_W, MAT_H, STAGE, SCREEN_L, SCREEN_R, BOOTH, TENTS_L, TENTS_R,
    WALK, BLOCKED, STANDING, FIELD, PATH, MOSH, FLAGS, SKIN, HAIR, SHIRT, PANTS, LOOK_SIZES, CROWD,
    HAT_NAMES, MAT_NAMES, HAIR_STYLES, SHIRT_STYLES,
    mulberry32, hash, randomLook, sanitizeLook, overlap, inRect, walkable, inStanding,
    matRectAt, matRect, matProblem, findSpawn, activeMats, npcExit,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FEST = api;
})(typeof window !== 'undefined' ? window : globalThis);

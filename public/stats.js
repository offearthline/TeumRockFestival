// 파이어베이스 애널리틱스(GA4). 방문(page_view)은 자동으로 세고, 게임 안 행동은 window.track(이름, 값)으로 보낸다.
// SDK를 다 받기 전에 부른 track도 줄에 쌓아뒀다가 보낸다. 설정이 비어 있거나 내 컴퓨터(localhost)면 아무것도 안 보낸다
// (내 컴퓨터에서 확인하려면 주소에 ?ga 를 붙인다). 이름·팔찌 번호 같은 개인 정보는 보내지 않는다
(() => {
  'use strict';
  // 파이어베이스 콘솔 > 프로젝트 설정 > 내 앱(웹) > SDK 설정의 firebaseConfig. 웹 설정값은 공개돼도 되는 값이다
  const FIREBASE_CONFIG = {
    apiKey: 'AIzaSyDYl34mYTvOtojw9CjXYoJwy4MMf1m27GE',
    authDomain: 'teumrockfestival.firebaseapp.com',
    projectId: 'teumrockfestival',
    storageBucket: 'teumrockfestival.firebasestorage.app',
    messagingSenderId: '191403140043',
    appId: '1:191403140043:web:a2efdeb326a283b1608c4e',
    measurementId: 'G-HDDWCFMD1J',
  };
  const SDK = 'https://www.gstatic.com/firebasejs/13.2.0/';

  const pending = [];
  let send = null;
  window.track = (name, params) => {
    try { if (send) send(name, params); else if (pending.length < 50) pending.push([name, params]); } catch { /* 통계는 게임에 영향 없게 */ }
  };

  const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(location.hostname);
  if (!FIREBASE_CONFIG || (local && !new URLSearchParams(location.search).has('ga'))) return;
  (async () => {
    const [{ initializeApp }, { getAnalytics, isSupported, logEvent }] = await Promise.all([
      import(SDK + 'firebase-app.js'), import(SDK + 'firebase-analytics.js'),
    ]);
    if (!(await isSupported())) return;
    const analytics = getAnalytics(initializeApp(FIREBASE_CONFIG));
    send = (name, params) => logEvent(analytics, name, params);
    for (const [name, params] of pending.splice(0)) send(name, params);
  })().catch(() => { /* 광고 차단기 등으로 못 받으면 그냥 넘어간다 */ });
})();

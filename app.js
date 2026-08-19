/* 보광중앙교회 청년부 출석부
 * - 백엔드 2종: 로컬(localStorage) / 클라우드(Firebase Firestore 실시간 공유)
 * - 상태 모양: { members:[{id,name,groupId,order}], groups:[{id,name,order}],
 *               attendance:{ "YYYY-MM-DD": { memberId:true } } }
 */

const LS_STATE  = 'bokwang.attendance.v1';
const LS_CONFIG = 'bokwang.sync.v1';

/* ── 유틸 ─────────────────────────────────────────────────── */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const uid = () => (crypto.randomUUID?.() ?? Date.now() + '-' + Math.random().toString(36).slice(2));
const pad = n => String(n).padStart(2, '0');
const esc = s => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];
/** 교회에서는 일요일을 '주일'이라 부른다 */
const dayLabel = d => d.getDay() === 0 ? '주일' : `${WEEKDAY[d.getDay()]}요일`;
const toKey   = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = k => new Date(k + 'T00:00:00');
const addDays = (k, n) => { const d = fromKey(k); d.setDate(d.getDate() + n); return toKey(d); };
function lastSundayKey() {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return toKey(d);
}
function prettyDate(k) {
  const d = fromKey(k);
  return { main: `${d.getMonth() + 1}월 ${d.getDate()}일`,
           sub: `${d.getFullYear()}년 · ${dayLabel(d)}` };
}
const byName = (a, b) => a.name.localeCompare(b.name, 'ko');

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, 2200);
}

const emptyState = () => ({ members: [], groups: [], attendance: {}, notes: {} });

/* ── 백엔드: 로컬 ─────────────────────────────────────────── */
function LocalBackend() {
  let state = emptyState();
  let onChange = () => {};

  const load = () => {
    try {
      const raw = localStorage.getItem(LS_STATE);
      if (raw) state = { ...emptyState(), ...JSON.parse(raw) };
    } catch { state = emptyState(); }
  };
  const save = () => {
    localStorage.setItem(LS_STATE, JSON.stringify(state));
    onChange(structuredClone(state));
  };

  return {
    mode: 'local',
    async start(cb) {
      onChange = cb;
      load();
      window.addEventListener('storage', e => { if (e.key === LS_STATE) { load(); onChange(structuredClone(state)); } });
      onChange(structuredClone(state));
    },
    async addMember(name, groupId = null) {
      state.members.push({ id: uid(), name, groupId, order: state.members.length });
      save();
    },
    async updateMember(id, patch) {
      const m = state.members.find(x => x.id === id); if (!m) return;
      Object.assign(m, patch); save();
    },
    async removeMember(id) {
      state.members = state.members.filter(x => x.id !== id);
      for (const k of Object.keys(state.attendance)) delete state.attendance[k][id];
      save();
    },
    async addGroup(name) {
      const id = uid();
      state.groups.push({ id, name, order: state.groups.length }); save();
      return id;                       // 만든 직후 바로 배치할 수 있도록 id 를 돌려준다
    },
    async updateGroup(id, patch) {
      const g = state.groups.find(x => x.id === id); if (!g) return;
      Object.assign(g, patch); save();
    },
    async removeGroup(id) {
      state.groups = state.groups.filter(x => x.id !== id);
      state.members.forEach(m => { if (m.groupId === id) m.groupId = null; });
      save();
    },
    async setAttendance(dateKey, memberId, present) {
      const day = state.attendance[dateKey] ?? (state.attendance[dateKey] = {});
      if (present) day[memberId] = true; else delete day[memberId];
      if (!Object.keys(day).length) delete state.attendance[dateKey];
      save();
    },
    async addNote(dateKey, text) {
      const day = state.notes[dateKey] ?? (state.notes[dateKey] = {});
      day[uid()] = { text, at: Date.now() };
      save();
    },
    async updateNote(dateKey, id, text) {
      const n = state.notes[dateKey]?.[id]; if (!n) return;
      n.text = text; save();
    },
    async removeNote(dateKey, id) {
      const day = state.notes[dateKey]; if (!day) return;
      delete day[id];
      if (!Object.keys(day).length) delete state.notes[dateKey];
      save();
    },
    async replaceAll(next) { state = { ...emptyState(), ...next }; save(); }
  };
}

/* ── 백엔드: Firebase Firestore ───────────────────────────── */
function FirebaseBackend(cfg) {
  let db, fb, room, unsubs = [];
  const cache = { members: new Map(), groups: new Map(), attendance: new Map(), notes: new Map() };
  let onChange = () => {};

  const emit = () => onChange({
    members: [...cache.members.values()],
    groups: [...cache.groups.values()],
    attendance: Object.fromEntries(cache.attendance),
    notes: Object.fromEntries(cache.notes)
  });

  const col = n => fb.collection(db, 'rooms', room, n);
  const doc = (n, id) => fb.doc(db, 'rooms', room, n, id);

  return {
    mode: 'cloud',
    async start(cb) {
      onChange = cb;
      room = cfg.roomId;
      const app  = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js');
      const auth = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js');
      fb = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

      const a = app.initializeApp(cfg.firebase);
      const authRef = auth.getAuth(a);
      await auth.signInAnonymously(authRef);
      db = fb.getFirestore(a);

      unsubs.push(fb.onSnapshot(col('members'), s => {
        cache.members.clear();
        s.forEach(d => cache.members.set(d.id, { id: d.id, ...d.data() }));
        emit();
      }));
      unsubs.push(fb.onSnapshot(col('groups'), s => {
        cache.groups.clear();
        s.forEach(d => cache.groups.set(d.id, { id: d.id, ...d.data() }));
        emit();
      }));
      unsubs.push(fb.onSnapshot(col('attendance'), s => {
        cache.attendance.clear();
        s.forEach(d => cache.attendance.set(d.id, d.data()));
        emit();
      }));
      unsubs.push(fb.onSnapshot(col('notes'), s => {
        cache.notes.clear();
        s.forEach(d => cache.notes.set(d.id, d.data()));
        emit();
      }));
    },
    async addMember(name, groupId = null) {
      await fb.addDoc(col('members'), { name, groupId, order: cache.members.size });
    },
    async updateMember(id, patch) { await fb.updateDoc(doc('members', id), patch); },
    async removeMember(id) {
      await fb.deleteDoc(doc('members', id));
      // 각 날짜 문서에서 해당 인원 필드만 제거 (다른 사람 기록은 건드리지 않음)
      const jobs = [];
      for (const [dateKey, day] of cache.attendance)
        if (day[id]) jobs.push(fb.updateDoc(doc('attendance', dateKey), { [id]: fb.deleteField() }));
      await Promise.all(jobs);
    },
    async addGroup(name) {
      const r = await fb.addDoc(col('groups'), { name, order: cache.groups.size });
      return r.id;                     // 만든 직후 바로 배치할 수 있도록 id 를 돌려준다
    },
    async updateGroup(id, patch) { await fb.updateDoc(doc('groups', id), patch); },
    async removeGroup(id) {
      await fb.deleteDoc(doc('groups', id));
      const jobs = [];
      for (const m of cache.members.values())
        if (m.groupId === id) jobs.push(fb.updateDoc(doc('members', m.id), { groupId: null }));
      await Promise.all(jobs);
    },
    async setAttendance(dateKey, memberId, present) {
      const ref = doc('attendance', dateKey);
      // 필드 단위 쓰기 → 두 명이 동시에 체크해도 서로 덮어쓰지 않음
      if (present) await fb.setDoc(ref, { [memberId]: true }, { merge: true });
      else         await fb.setDoc(ref, { [memberId]: fb.deleteField() }, { merge: true });
    },
    async addNote(dateKey, text) {
      await fb.setDoc(doc('notes', dateKey), { [uid()]: { text, at: Date.now() } }, { merge: true });
    },
    async updateNote(dateKey, id, text) {
      await fb.setDoc(doc('notes', dateKey), { [id]: { text, at: Date.now() } }, { merge: true });
    },
    async removeNote(dateKey, id) {
      await fb.setDoc(doc('notes', dateKey), { [id]: fb.deleteField() }, { merge: true });
    },
    async replaceAll(next) {
      const batchJobs = [];
      for (const d of cache.members.keys())    batchJobs.push(fb.deleteDoc(doc('members', d)));
      for (const d of cache.groups.keys())     batchJobs.push(fb.deleteDoc(doc('groups', d)));
      for (const d of cache.attendance.keys()) batchJobs.push(fb.deleteDoc(doc('attendance', d)));
      for (const d of cache.notes.keys())      batchJobs.push(fb.deleteDoc(doc('notes', d)));
      await Promise.all(batchJobs);

      const idMap = new Map();
      for (const g of next.groups ?? []) {
        const r = await fb.addDoc(col('groups'), { name: g.name, order: g.order ?? 0 });
        idMap.set(g.id, r.id);
      }
      const mMap = new Map();
      for (const m of next.members ?? []) {
        const r = await fb.addDoc(col('members'), {
          name: m.name, groupId: m.groupId ? (idMap.get(m.groupId) ?? null) : null, order: m.order ?? 0,
          // 자리 순서와 장기 부재 구간도 함께 복원한다 (빠뜨리면 백업에서 되살릴 때 사라진다)
          seat: m.seat ?? null,
          leaveReason: m.leaveReason ?? null,
          leaveFrom: m.leaveFrom ?? null,
          leaveTo: m.leaveTo ?? null
        });
        mMap.set(m.id, r.id);
      }
      for (const [dateKey, day] of Object.entries(next.attendance ?? {})) {
        const remapped = {};
        for (const oldId of Object.keys(day)) { const n = mMap.get(oldId); if (n) remapped[n] = true; }
        if (Object.keys(remapped).length) await fb.setDoc(doc('attendance', dateKey), remapped);
      }
    }
  };
}

/* ── 앱 상태 ──────────────────────────────────────────────── */
let backend = null;
let S = emptyState();
let currentDate = lastSundayKey();
let activeTab = 'attendance';
// 명단 정렬 기준: 'seat'(가까이 앉는 대로) | 'name'(가나다) | 'group'(소그룹별)
let sortMode = localStorage.getItem('bokwang.sortmode') || 'seat';
/** 자리 순 — 자리가 없는 사람은 맨 뒤로 (이름순) */
const bySeat = (a, b) => (a.seat ?? Infinity) - (b.seat ?? Infinity) || byName(a, b);

const membersSorted = () => [...S.members].sort(byName);

/* ── 저장 상태 ─────────────────────────────────────────────
   체크할 때마다 이미 자동 저장되지만, 눈에 보여야 안심이 된다.
   저장 바를 누르면 저장소에서 다시 읽어 화면과 대조한다. */
let lastSavedAt = null;
const relTime = ts => {
  if (!ts) return '';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 10) return '방금';
  if (s < 60) return `${s}초 전`;
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  return `${Math.floor(s / 3600)}시간 전`;
};

/* ── 그날의 메모 ───────────────────────────────────────── */
const notesFor = dateKey => Object.entries(S.notes?.[dateKey] ?? {})
  .map(([id, n]) => ({ id, ...n }))
  .sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
/** 장기 부재(군 복무·유학 등) — 명단과 기록은 그대로 두되 통계에서만 뺀다.
 *  플래그가 아니라 '구간'이다: leaveFrom 부터 leaveTo 직전까지가 부재 기간.
 *  그래서 8/16에 복귀시켜도 8/9 을 열면 그 주에는 여전히 부재로 남는다.
 *  leaveTo 가 없으면 아직 부재 중 → 매주 자동으로 이어진다. */
const onLeaveAt = (m, dateKey) => {
  if (!m.leaveReason || !m.leaveFrom) return false;
  if (dateKey < m.leaveFrom) return false;
  if (m.leaveTo && dateKey >= m.leaveTo) return false;
  return true;
};
const activeAt = dateKey => membersSorted().filter(m => !onLeaveAt(m, dateKey));
const leaveAt  = dateKey => membersSorted().filter(m =>  onLeaveAt(m, dateKey));
/** 통계 기준 시점 — 가장 최근 모임(없으면 오늘) */
const statsAsOf = () => sessionKeys().at(-1) ?? toKey(new Date());
const groupsSorted  = () => [...S.groups].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || byName(a, b));
const groupName = id => S.groups.find(g => g.id === id)?.name ?? '미배정';
const isPresent = (dateKey, id) => !!S.attendance[dateKey]?.[id];
const presentCount = k => Object.keys(S.attendance[k] ?? {}).length;
/** 실제로 모임이 있었던 날(출석 1명 이상), 오래된 순 */
const sessionKeys = () =>
  Object.keys(S.attendance).filter(k => presentCount(k) > 0).sort();

/* ── 부팅 ─────────────────────────────────────────────────── */
async function boot() {
  const cfg = readConfig();
  setSync(cfg ? 'connecting' : 'local', cfg ? '연결 중…' : '로컬 모드 (이 기기에만 저장)');
  try {
    backend = cfg ? FirebaseBackend(cfg) : LocalBackend();
    await backend.start(next => { S = next; lastSavedAt = Date.now(); render(); queueSheetPush(); });
    if (cfg) setSync('cloud', '공유 중');
  } catch (e) {
    console.error(e);
    setSync('error', '연결 실패 — 로컬 모드로 동작');
    backend = LocalBackend();
    await backend.start(next => { S = next; lastSavedAt = Date.now(); render(); queueSheetPush(); });
    toast('Firebase 연결 실패: ' + (e?.message ?? e));
  }
}
function readConfig() {
  try { return JSON.parse(localStorage.getItem(LS_CONFIG) || 'null'); } catch { return null; }
}
/** 교회 이름 줄에 동기화 상태를 덧붙인다 (로컬 모드면 교회 이름만) */
function setSync(mode, label) {
  $('#sync-label').textContent = mode === 'local' ? '보광중앙교회' : `보광중앙교회 · ${label}`;
}

/* ── 렌더 ─────────────────────────────────────────────────── */
function render() {
  if (activeTab === 'attendance') renderAttendance();
  if (activeTab === 'stats')      renderStats();
  if (activeTab === 'groups')     renderGroups();
}

/* 출석 탭 ------------------------------------------------- */
/** 화면에 그려질 묶음 목록 (소그룹별 보기가 꺼져 있으면 묶음 하나) */
function attendanceBlocks() {
  const all = activeAt(currentDate);
  if (sortMode === 'name') return [{ title: null, members: all }];
  if (sortMode === 'seat') return [{ title: null, members: [...all].sort(bySeat) }];
  const blocks = [];
  for (const g of groupsSorted()) {
    const ms = all.filter(m => m.groupId === g.id);
    if (ms.length) blocks.push({ title: g.name, members: ms });
  }
  const none = all.filter(m => !m.groupId || !S.groups.some(g => g.id === m.groupId));
  if (none.length) blocks.push({ title: '미배정', members: none });
  return blocks;
}

let lastSig = null;      // 격자 구조가 그대로면 다시 그리지 않는다
let justToggled = null;  // 방금 누른 카드만 통 튀게 한다

function renderAttendance() {
  const p = prettyDate(currentDate);
  $('#date-label .d-main').textContent = p.main;
  $('#date-label .d-sub').textContent  = p.sub;
  $('#date-input').value = currentDate;

  const all   = activeAt(currentDate);
  const leave = leaveAt(currentDate);
  refreshSaveBar();
  refreshNotesBadge();
  $$('.sort-opt').forEach(b => {
    const on = b.dataset.sort === sortMode;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-checked', on);
  });
  setHeadcount(all);

  const body = $('#attendance-body');
  if (!all.length && !leave.length) {
    lastSig = null;
    body.innerHTML = `<div class="empty">
      <p>아직 등록된 사람이 없어요.<br>명단을 먼저 만들어 주세요.</p>
      <button class="btn primary" id="btn-add-member">첫 명단 추가하기</button>
    </div>`;
    wireAttendance(); return;
  }

  const blocks = attendanceBlocks();
  const sig = JSON.stringify([
    blocks.map(b => [b.title, b.members.map(m => [m.id, m.name])]),
    leave.map(m => [m.id, m.name, m.leaveReason])
  ]);

  // 출석 체크만 바뀐 경우엔 통째로 다시 그리지 않는다.
  // innerHTML 을 갈아끼우면 요소가 교체돼 CSS 전환·애니메이션이 재생되지 않기 때문.
  if (sig === lastSig) { patchAttendance(blocks); return; }

  lastSig = sig;
  body.innerHTML = (sortMode === 'group'
    ? blocks.map(b => groupBlock(b)).join('') + `<div class="grid">${addCard()}</div>`
    : `<div class="grid">${blocks[0].members.map(nameCard).join('')}${addCard()}</div>`) + leaveBlock(leave);
  wireAttendance();
}

/** 장기 부재자는 통계에서 빠지지만, 들르면 체크할 수 있게 아래에 따로 둔다 */
const leaveBlock = leave => leave.length ? `<div class="group-block leave-block">
    <h3>장기 부재 <span class="n">${leave.length}명</span>
      <span class="note">통계에서 제외됩니다</span></h3>
    <div class="grid">${leave.map(nameCard).join('')}</div>
  </div>` : '';

/** 히어로 카드의 인원·출석률·진행 막대 (장기 부재자는 분모에서 뺀다) */
function refreshSaveBar() {
  const base = lastSavedAt ? relTime(lastSavedAt) + ' 저장' : '자동 저장';
  const cfg = readSheetCfg();
  let tail = '';
  if (cfg) tail = sheetState.error ? ' · 시트 전송 실패'
                : sheetState.at    ? ' · 시트 반영됨' : ' · 시트 대기';
  $('#save-when').textContent = base + tail;
  $('#btn-save').classList.toggle('has-error', !!(cfg && sheetState.error));
}

function refreshNotesBadge() {
  const n = notesFor(currentDate).length;
  const b = $('#notes-badge');
  b.textContent = n;
  b.hidden = n === 0;
}

function setHeadcount(all) {
  const on = all.filter(m => isPresent(currentDate, m.id)).length;
  const pct = all.length ? Math.round(on / all.length * 100) : 0;
  $('#present-count').textContent = on;
  $('#total-count').textContent   = `/ ${all.length}명`;
  $('#present-rate').textContent  = all.length ? `출석률 ${pct}%` : '—';
  $('#present-meter').style.width = `${pct}%`;
}

function patchAttendance(blocks) {
  setHeadcount(activeAt(currentDate));
  $$('#attendance-body .name-card[data-id]').forEach(el => {
    const on = isPresent(currentDate, el.dataset.id);
    if (on === el.classList.contains('present')) return;
    el.classList.toggle('present', on);
    if (on && el.dataset.id === justToggled) {
      clearTimeout(el._popTimer);
      el.classList.remove('pop');
      void el.offsetWidth;            // 애니메이션을 다시 재생시키기 위한 리플로우
      el.classList.add('pop');
      // animationend 는 탭이 백그라운드면 발송되지 않으므로 타이머로 정리한다
      el._popTimer = setTimeout(() => el.classList.remove('pop'), 420);
    }
  });
  justToggled = null;

  if (sortMode === 'group') $$('#attendance-body .group-block').forEach((el, i) => {
    const b = blocks[i]; if (!b) return;
    const on = b.members.filter(m => isPresent(currentDate, m.id)).length;
    $('.n', el).textContent = `${on}/${b.members.length}`;
  });
}

/** 명단 맨 뒤에 붙는 인원 추가 카드 — 이름표와 같은 모양·크기, 색만 다르다 */
const addCard = () => `<button class="name-card add-card" id="btn-add-member" aria-label="이름 추가">
  <span class="txt">+</span></button>`;

const groupBlock = b => {
  const on = b.members.filter(m => isPresent(currentDate, m.id)).length;
  return `<div class="group-block"><h3>${esc(b.title)} <span class="n">${on}/${b.members.length}</span></h3>
    <div class="grid">${b.members.map(nameCard).join('')}</div></div>`;
};
const nameCard = m => {
  const away = onLeaveAt(m, currentDate);
  return `<button class="name-card${isPresent(currentDate, m.id) ? ' present' : ''}${away ? ' on-leave' : ''}"
    data-id="${m.id}"><span class="txt">${esc(m.name)}${away ? `<small>${esc(m.leaveReason)}</small>` : ''}</span></button>`;
};

/* ── 순서 바꾸기 (가까이 앉는 대로 에서만) ────────────────────
   길게 눌러 카드를 들어올린 뒤 끌면 순서가 바뀐다. 가나다순·소그룹별은
   계산으로 나오는 순서라 애초에 이 엔진이 붙지 않는다.
   DOM 순서는 그대로 두고 transform 으로만 자리를 옮기므로, 카드에 이미
   걸려 있는 transform transition 이 곧 서로 비켜주는 리플로우가 된다. */
function createReorder(grid) {
  const cards = [...grid.querySelectorAll('.name-card[data-id]')];
  if (cards.length < 2) return null;

  const gb0 = grid.getBoundingClientRect();
  const slots = cards.map(c => {
    const r = c.getBoundingClientRect();
    return { left: r.left - gb0.left, top: r.top - gb0.top, w: r.width, h: r.height };
  });
  const domIdx = new Map(cards.map((c, i) => [c.dataset.id, i]));
  const order = cards.map(c => c.dataset.id);
  const main = $('main');

  let card = null, id = null, pos = 0, sx = 0, sy = 0, raf = null, edge = 0;

  /** 끌고 있는 카드를 뺀 나머지를 현재 순서대로 비켜세운다 */
  const place = () => {
    for (const c of cards) {
      if (c === card) continue;
      const s = slots[order.indexOf(c.dataset.id)], d = slots[domIdx.get(c.dataset.id)];
      c.style.transform = `translate(${s.left - d.left}px, ${s.top - d.top}px)`;
    }
  };

  const nearestSlot = (x, y) => {
    let best = 0, bestD = Infinity;
    slots.forEach((s, i) => {
      const dist = (s.left + s.w / 2 - x) ** 2 + (s.top + s.h / 2 - y) ** 2;
      if (dist < bestD) { bestD = dist; best = i; }
    });
    return best;
  };

  const autoScroll = () => {
    if (!edge) { raf = null; return; }
    main.scrollTop += edge;
    raf = requestAnimationFrame(autoScroll);
  };

  return {
    /** 길게 눌러 들어올린 순간 */
    arm(el, x, y) {
      card = el; id = el.dataset.id; pos = order.indexOf(id);
      sx = x; sy = y;
      el.classList.add('dragging');
    },
    move(ev) {
      if (!card) return;
      const base = slots[domIdx.get(id)], cur = slots[pos];
      card.style.transform =
        `translate(${cur.left - base.left + ev.clientX - sx}px, ` +
        `${cur.top - base.top + ev.clientY - sy}px) scale(1.08)`;

      const mb = main.getBoundingClientRect();
      edge = ev.clientY < mb.top + 80 ? -9 : ev.clientY > mb.bottom - 80 ? 9 : 0;
      if (edge && !raf) raf = requestAnimationFrame(autoScroll);

      // 격자는 스크롤에 따라 움직이므로 매번 다시 잰다
      const gb = grid.getBoundingClientRect();
      const target = nearestSlot(ev.clientX - gb.left, ev.clientY - gb.top);
      if (target !== pos) {
        order.splice(target, 0, order.splice(pos, 1)[0]);
        pos = target;
        place();
      }
    },
    async drop(didDrag) {
      if (!card) return;
      edge = 0; if (raf) { cancelAnimationFrame(raf); raf = null; }
      const el = card, myId = id, myPos = pos;
      card = null;
      el.classList.remove('dragging');
      const s = slots[myPos], d = slots[domIdx.get(myId)];
      el.style.transform = `translate(${s.left - d.left}px, ${s.top - d.top}px)`;
      if (didDrag) await commitSeats(order, myId);
    }
  };
}

/** 옮긴 사람에게만 새 자리 번호를 준다 — 앞뒤 번호 사이의 값.
 *  누가 옮겨졌는지는 추측하지 않고 드래그 엔진이 알려준다
 *  (순서가 어긋난 첫 지점을 찾는 방식은 옮긴 카드의 '앞 카드'를 짚어 틀린다).
 *  간격이 너무 촘촘해지면 전체를 정수로 다시 매긴다. */
async function commitSeats(order, movedId) {
  const byId = new Map(S.members.map(m => [m.id, m]));
  const i = order.indexOf(movedId);
  if (i < 0) return;

  const prev = i > 0 ? byId.get(order[i - 1])?.seat : null;
  const next = i < order.length - 1 ? byId.get(order[i + 1])?.seat : null;

  let seat;
  if (i === 0)                          seat = (typeof next === 'number' ? next : 0) - 1;
  else if (i === order.length - 1)      seat = (typeof prev === 'number' ? prev : 0) + 1;
  else if (typeof prev === 'number' && typeof next === 'number') seat = (prev + next) / 2;

  const tooTight = typeof prev === 'number' && typeof next === 'number'
                   && Math.abs(next - prev) < 1e-6;
  if (seat === undefined || tooTight) {
    for (let k = 0; k < order.length; k++)          // 예비 경로: 전부 정수로 다시 매긴다
      if (byId.get(order[k])?.seat !== k) await backend.updateMember(order[k], { seat: k });
  } else {
    await backend.updateMember(movedId, { seat });
  }
  lastSig = null;
  toast('순서를 바꿨어요');
}

function wireAttendance() {
  const grid = $('#attendance-body > .grid');
  // 자리 순일 때만 드래그 엔진을 붙인다
  const dnd = sortMode === 'seat' && grid ? createReorder(grid) : null;
  $$('#attendance-body .name-card[data-id]').forEach(el => {
    attachPress(el,
      () => {
        justToggled = el.dataset.id;
        backend.setAttendance(currentDate, el.dataset.id, !isPresent(currentDate, el.dataset.id));
      },
      () => memberActions(el.dataset.id),
      dnd);
  });
  $('#btn-add-member')?.addEventListener('click', addMemberDialog);
}

/** 탭 = onTap, 길게 누르기 = 카드를 들어올림.
 *  들어올린 뒤 끌면 순서 바꾸기(dnd), 그대로 떼면 onHold(메뉴).
 *  dnd 가 없으면(가나다순·소그룹별) 길게 누른 즉시 메뉴가 열린다. */
function attachPress(el, onTap, onHold, dnd) {
  const HOLD_MS = 550, MOVE_TOLERANCE = 12;
  let timer = null, held = false, moved = false, active = false;
  let dragging = false, sx = 0, sy = 0;

  const stopTimer = () => { clearTimeout(timer); timer = null; el.classList.remove('pressing'); };
  const reset = () => { stopTimer(); active = false; held = false; dragging = false; };

  el.addEventListener('pointerdown', e => {
    if (e.button && e.button !== 0) return;
    held = false; moved = false; dragging = false; active = true;
    sx = e.clientX; sy = e.clientY;
    el.classList.add('pressing');
    const pid = e.pointerId;
    timer = setTimeout(() => {
      held = true; stopTimer();
      navigator.vibrate?.(18);
      if (dnd) { try { el.setPointerCapture(pid); } catch {} dnd.arm(el, sx, sy); }
      else onHold();
    }, HOLD_MS);
  });

  el.addEventListener('pointermove', e => {
    if (!active) return;
    if (held && dnd) {                       // 들어올린 상태 → 끌기
      dragging = true;
      e.preventDefault();
      dnd.move(e);
      return;
    }
    // 아직 안 들었는데 손가락이 미끄러지면 스크롤로 보고 탭을 취소한다
    if (!moved && Math.hypot(e.clientX - sx, e.clientY - sy) > MOVE_TOLERANCE) {
      moved = true; stopTimer();
    }
  });

  // 터치에서 click 은 손을 뗀 뒤 한참 있다 온다 → pointerup 에서 바로 처리한다
  el.addEventListener('pointerup', () => {
    if (!active) return;
    if (held && dnd) {
      const didDrag = dragging;
      dnd.drop(didDrag);
      reset();
      if (!didDrag) onHold();               // 들었다가 그냥 떼면 메뉴
      return;
    }
    const isTap = !held && !moved;
    reset();
    if (isTap) onTap();
  });

  // 브라우저가 스크롤 제스처로 가져가면 pointercancel 이 온다
  el.addEventListener('pointercancel', () => {
    if (held && dnd) dnd.drop(dragging);
    reset();
  });

  el.addEventListener('click', e => {
    e.preventDefault();            // pointerup 에서 이미 처리했으므로 중복 실행 방지
    if (e.detail === 0) onTap();   // 키보드(Enter/Space)로 누른 경우만 여기서 처리
  });
  el.addEventListener('contextmenu', e => e.preventDefault());
}

/* ── 통계 ─────────────────────────────────────────────────── */
const WEEKS_SHOWN = 12;

function computeStats() {
  const sessions = sessionKeys();
  const asOf     = statsAsOf();
  const recent   = sessions.slice(-WEEKS_SHOWN);
  // 장기 부재자(군 복무·유학 등)는 못 오는 게 정상이므로 모든 통계에서 뺀다.
  // 주별 출석 수 막대는 실제 참석 인원이라 그대로 둔다 — 부재 처리 전에 온 기록은 사실이므로.
  const members  = activeAt(asOf);
  const total    = members.length;

  const weekly = recent.map(k => ({ key: k, count: presentCount(k) }));

  const groupRows = groupsSorted().map(g => {
    const ms = members.filter(m => m.groupId === g.id);
    const win = sessions.slice(-8);
    let hit = 0;
    for (const k of win) for (const m of ms) if (isPresent(k, m.id)) hit++;
    const denom = ms.length * win.length;
    return { name: g.name, size: ms.length, rate: denom ? hit / denom : 0,
             avg: win.length ? hit / win.length : 0 };
  }).filter(r => r.size > 0);

  const unassignedMs = members.filter(m => !m.groupId || !S.groups.some(g => g.id === m.groupId));
  if (unassignedMs.length) {
    const win = sessions.slice(-8);
    let hit = 0;
    for (const k of win) for (const m of unassignedMs) if (isPresent(k, m.id)) hit++;
    const denom = unassignedMs.length * win.length;
    groupRows.push({ name: '미배정', size: unassignedMs.length,
      rate: denom ? hit / denom : 0, avg: win.length ? hit / win.length : 0 });
  }

  // 개인별 + 챙길 사람
  const people = members.map(m => {
    // 장기 부재였던 주는 그 사람의 계산에서 통째로 빠진다.
    // 군 복무 2년 뒤 복귀한 사람이 '연속 100회 결석'으로 잡히지 않도록.
    const mine  = sessions.filter(k => !onLeaveAt(m, k));
    const strip = recent.map(k => onLeaveAt(m, k) ? 'leave' : isPresent(k, m.id) ? 'on' : 'off');
    const first = mine.findIndex(k => isPresent(k, m.id));       // 첫 출석 = 합류 시점으로 간주
    const since = first === -1 ? [] : mine.slice(first);

    const last4  = since.slice(-4);
    const prior8 = since.slice(-12, -4);
    const nRecent = last4.filter(k => isPresent(k, m.id)).length;
    const nPrior  = prior8.filter(k => isPresent(k, m.id)).length;
    const rRecent = last4.length  ? nRecent / last4.length  : 0;
    const rPrior  = prior8.length ? nPrior  / prior8.length : 0;

    let streak = 0;
    for (let i = since.length - 1; i >= 0; i--) { if (isPresent(since[i], m.id)) break; streak++; }
    const lastSeen = [...since].reverse().find(k => isPresent(k, m.id)) ?? null;
    const overall = since.length ? since.filter(k => isPresent(k, m.id)).length / since.length : 0;

    return { m, strip, since, last4, prior8, nRecent, nPrior, rRecent, rPrior, streak, lastSeen, overall };
  });

  // 연속 결석 회수로 두 단계로 나눈다.
  //   3~4회  → 챙겨야 할 사람 (지금 연락하면 돌아올 수 있는 시점)
  //   5회 이상 → 발걸음이 뜸한 사람 (한동안 못 본 사람)
  // 한 번도 출석 기록이 없는 사람은 since 가 비어 streak 이 0 이므로 어느 쪽에도 오르지 않는다.
  const CARE_MIN = 3, AWAY_MIN = 5;

  // 오래 빠진 순서 → 같으면 평소 잘 나오던 사람 순서
  const byUrgency = (a, b) => b.streak - a.streak || b.rPrior - a.rPrior || byName(a.m, b.m);

  const absent = people.filter(p => p.since.length && p.streak >= CARE_MIN);
  const care = absent.filter(p => p.streak < AWAY_MIN)
                     .map(p => ({ ...p, drop: p.rPrior - p.rRecent, level: p.streak >= 4 ? 'serious' : 'warning' }))
                     .sort(byUrgency);
  const away = absent.filter(p => p.streak >= AWAY_MIN)
                     .map(p => ({ ...p, drop: p.rPrior - p.rRecent, level: 'critical' }))
                     .sort(byUrgency);
  // 명단에는 있으나 기록된 모든 모임에 한 번도 안 온 사람 (성격이 다른 챙김이라 따로 센다)
  const never = people.filter(p => !p.since.length).map(p => p.m.name).sort((a, b) => a.localeCompare(b, 'ko'));

  // '급감' 탭 — 연속 결석과 무관하게, 평소 잘 나오던 사람의 출석률이 확 떨어진 경우를 잡는다.
  // 띄엄띄엄 빠지는 패턴(연속 결석은 짧은데 빈도가 반토막)도 여기서 걸린다.
  const WAS_REGULAR = .5;   // 이전 8회를 최소 절반은 나오던 사람
  const BIG_DROP    = .35;  // 최근 4회에 이만큼 떨어졌을 때

  const drops = people
    .map(p => {
      if (p.prior8.length < 4 || p.last4.length < 3) return null;  // 비교할 이력이 부족
      if (p.rPrior < WAS_REGULAR) return null;                      // 원래 잘 나오던 사람이 아님
      const drop = p.rPrior - p.rRecent;
      if (drop < BIG_DROP) return null;
      const level = drop >= .6 ? 'critical' : drop >= .45 ? 'serious' : 'warning';
      return { ...p, drop, level };
    })
    .filter(Boolean)
    .sort((a, b) => b.drop - a.drop || b.rPrior - a.rPrior || byName(a.m, b.m));

  return { sessions, recent, weekly, groupRows, people, care, away, never, drops, total };
}

function renderStats() {
  const st = computeStats();
  const body = $('#stats-body');

  if (!st.sessions.length) {
    body.innerHTML = `<div class="empty">아직 출석 기록이 없어요.<br><b>출석</b> 탭에서 체크를 시작하면<br>여기에 통계가 자동으로 쌓입니다.</div>`;
    return;
  }

  const avg = Math.round(st.weekly.reduce((s, w) => s + w.count, 0) / st.weekly.length);
  const last = st.weekly.at(-1);

  body.innerHTML = `
  <div class="card">
    <h2>주별 출석 수</h2>
    <p class="sub">최근 ${st.weekly.length}회 모임 · 평균 ${avg}명 · 전체 ${st.total}명</p>
    ${weeklyChart(st.weekly, st.total)}
    <div class="chart-detail" id="weekly-detail">막대를 누르면 그 주의 상세가 보여요</div>
  </div>

  <div class="card">
    <h2>소그룹별 출석률</h2>
    <p class="sub">최근 ${Math.min(8, st.sessions.length)}회 모임 기준</p>
    ${st.groupRows.length ? groupChart(st.groupRows)
      : '<div class="empty" style="padding:18px">소그룹을 만들면 여기에 표시돼요.</div>'}
  </div>

  <div class="card">
    <h2>챙겨야 할 사람 <span class="badge">${st.care.length}</span></h2>
    <p class="sub">연속 3~4회 빠진 분들이에요. 지금 연락하기 좋은 때예요.</p>
    ${st.care.length ? st.care.map(careRow).join('')
      : '<div class="empty" style="padding:18px">연속 3~4회 빠진 사람은 없어요 👍</div>'}
  </div>

  <div class="card">
    <h2>잘 나오다가 갑자기 안 나온 사람 <span class="badge">${st.drops.length}</span></h2>
    <p class="sub">이전 8회를 절반 이상 나오던 분 중, 최근 4회 출석이 35%p 이상 떨어진 분들이에요.</p>
    ${st.drops.length ? st.drops.map(dropRow).join('')
      : '<div class="empty" style="padding:18px">출석이 갑자기 떨어진 사람은 없어요 👍</div>'}
    <p class="legend-note">연속 결석과는 다른 기준이에요. 매주 오다 3주 내리 빠진 분도,
    매주 오다 격주로 바뀐 분도 여기 잡힙니다.</p>
  </div>

  <div class="card">
    <h2>발걸음이 뜸한 사람 <span class="badge">${st.away.length}</span></h2>
    <p class="sub">연속 5회 이상 못 뵌 분들이에요.</p>
    ${st.away.length ? st.away.map(careRow).join('')
      : '<div class="empty" style="padding:18px">연속 5회 이상 빠진 사람은 없어요 👍</div>'}
    ${st.never.length ? `<p class="legend-note">명단에 있지만 기록된 ${st.sessions.length}회 모임에
      한 번도 출석이 없는 분 ${st.never.length}명 — ${st.never.map(esc).join(', ')}</p>` : ''}
  </div>

  <div class="card">
    <h2>개인별 출석률</h2>
    <p class="sub">최근 ${st.weekly.length}회 · 왼쪽이 오래된 주</p>
    ${[...st.people].sort((a, b) => a.overall - b.overall).map(personRow).join('')}
  </div>`;

  // 주별 차트 상호작용
  const detail = $('#weekly-detail');
  $$('#stats-body [data-wk]').forEach(el => {
    const show = () => {
      const w = st.weekly[+el.dataset.wk];
      const p = prettyDate(w.key);
      const rate = st.total ? Math.round(w.count / st.total * 100) : 0;
      detail.textContent = `${p.sub.split(' · ')[0]} ${p.main} ${dayLabel(fromKey(w.key))} · 출석 ${w.count}명 · 전체의 ${rate}%`;
    };
    el.addEventListener('pointerenter', show);
    el.addEventListener('click', show);
  });
}

const careRow = c => {
  // 심각도는 왼쪽의 색 띠로 표시하고, 뜻은 이름 옆 글자 라벨이 담당한다 (색만으로 구분하지 않음)
  const lastTxt = c.lastSeen ? `${prettyDate(c.lastSeen).main} 마지막 출석` : '출석 기록 없음';
  return `<div class="care">
    <span class="sev" data-l="${c.level}" aria-hidden="true"></span>
    <div>
      <div class="who">${esc(c.m.name)}<small>연속 ${c.streak}회 결석 · ${esc(groupName(c.m.groupId))}</small></div>
      <div class="why">${lastTxt} · 그 전 ${c.prior8.length}회는 ${Math.round(c.rPrior * 100)}% 출석
        · 전체 ${Math.round(c.overall * 100)}%</div>
      <div class="strip">${c.strip.map(v => `<i class="${v === 'on' ? 'on' : v === 'leave' ? 'lv' : ''}"></i>`).join('')}</div>
    </div>
  </div>`;
};

/* 소그룹 탭 — 편성 현황 보기 ------------------------------- */
function renderGroups() {
  const all = membersSorted();
  const gs  = groupsSorted();
  const unassigned = all.filter(m => !m.groupId || !S.groups.some(g => g.id === m.groupId));
  const assigned = all.length - unassigned.length;

  const chips = ms => ms.length
    ? ms.map(m => { const away = onLeaveAt(m, statsAsOf());
        return `<button class="chip${away ? ' on-leave' : ''}" data-mid="${m.id}">${esc(m.name)}${
          away ? `<small>${esc(m.leaveReason)}</small>` : ''}</button>`; }).join('')
    : '<span class="chip muted">아직 아무도 없어요</span>';

  let html = `
  <div class="card">
    <h2>편성 현황</h2>
    <p class="sub">이름을 누르면 소그룹을 옮길 수 있어요.</p>
    <div class="tally">
      <div><strong>${gs.length}</strong><span>소그룹</span></div>
      <div><strong>${assigned}</strong><span>배정됨</span></div>
      <div><strong>${unassigned.length}</strong><span>미배정</span></div>
    </div>
    <div class="meter"><i style="width:${all.length ? Math.round(assigned / all.length * 100) : 0}%"></i></div>
  </div>`;

  html += gs.map(g => {
    const ms = all.filter(m => m.groupId === g.id);
    return `<div class="card">
      <div class="ghead">
        <h2>${esc(g.name)}</h2>
        <span class="cnt">${ms.length}명</span>
        <button class="icon-btn" data-gedit="${g.id}" aria-label="${esc(g.name)} 수정">⋯</button>
      </div>
      <div class="chips">${chips(ms)}</div>
    </div>`;
  }).join('');

  html += `<div class="card">
    <div class="ghead"><h2>미배정</h2><span class="cnt">${unassigned.length}명</span></div>
    <div class="chips">${unassigned.length ? chips(unassigned)
      : '<span class="chip muted">모두 배치 완료 🎉</span>'}</div>
  </div>
  <button class="btn primary block" id="btn-add-group">+ 소그룹 만들기</button>`;

  $('#groups-body').innerHTML = html;

  $('#btn-add-group').addEventListener('click', () =>
    promptDialog('새 소그룹', '예: 1소그룹, 요셉조', '', v => backend.addGroup(v)));
  $$('#groups-body [data-mid]').forEach(el =>
    el.addEventListener('click', () => pickGroupDialog(el.dataset.mid)));
  $$('#groups-body [data-gedit]').forEach(el =>
    el.addEventListener('click', () => groupActions(el.dataset.gedit)));
}

const dropRow = d => `<div class="care">
  <span class="sev" data-l="${d.level}" aria-hidden="true"></span>
  <div>
    <div class="who">${esc(d.m.name)}<small>${esc(groupName(d.m.groupId))}</small></div>
    <div class="drop-line">
      <span class="was">${Math.round(d.rPrior * 100)}%</span>
      <span class="arrow" aria-hidden="true">→</span>
      <span class="now">${Math.round(d.rRecent * 100)}%</span>
      <span class="delta">${Math.round(d.drop * 100)}%p 하락</span>
    </div>
    <div class="why">이전 ${d.prior8.length}회 중 ${d.nPrior}회 → 최근 ${d.last4.length}회 중 ${d.nRecent}회
      ${d.streak >= 2 ? ` · 연속 ${d.streak}회 결석` : ''}
      ${d.lastSeen ? ` · ${prettyDate(d.lastSeen).main} 마지막 출석` : ''}</div>
    <div class="strip">${d.strip.map(v => `<i class="${v === 'on' ? 'on' : v === 'leave' ? 'lv' : ''}"></i>`).join('')}</div>
  </div>
</div>`;

const personRow = p => `<div class="stat-row">
  <span class="nm">${esc(p.m.name)}</span>
  <span class="strip">${p.strip.map(v => `<i class="${v === 'on' ? 'on' : v === 'leave' ? 'lv' : ''}"></i>`).join('')}</span>
  <span class="vl">${Math.round(p.overall * 100)}%</span>
</div>`;

/* 차트 ---------------------------------------------------- */
// 상단 모서리만 둥근 막대 (바닥은 기준선에 붙임)
function barUp(x, y, w, h, r = 7) {
  const rr = Math.min(r, w / 2, Math.max(h, 0));
  const b = y + h;
  return `M${x},${b} L${x},${y + rr} Q${x},${y} ${x + rr},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${b} Z`;
}
// 오른쪽 끝만 둥근 가로 막대 (r 을 높이의 절반으로 주면 알약 모양)
function barRight(x, y, w, h, r = 8) {
  const rr = Math.min(r, h / 2, Math.max(w, 0));
  return `M${x},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h - rr} Q${x + w},${y + h} ${x + w - rr},${y + h} L${x},${y + h} Z`;
}

function weeklyChart(weekly, total) {
  const W = 340, H = 178, PAD_L = 4, PAD_R = 4, TOP = 20, BOTTOM = 26;
  const n = weekly.length;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - TOP - BOTTOM;
  const slot = plotW / n;
  const bw = Math.max(6, Math.min(30, slot - 6));   // 막대 사이 간격 확보
  const max = Math.max(1, total, ...weekly.map(w => w.count));

  const bars = weekly.map((w, i) => {
    const h = (w.count / max) * plotH;
    const x = PAD_L + slot * i + (slot - bw) / 2;
    const y = TOP + plotH - h;
    const d = fromKey(w.key);
    const label = `${d.getMonth() + 1}/${d.getDate()}`;
    return `<g data-wk="${i}" style="cursor:pointer">
      <title>${label} · ${w.count}명</title>
      <rect x="${PAD_L + slot * i}" y="${TOP}" width="${slot}" height="${plotH + BOTTOM - 6}" fill="transparent"/>
      <path class="bar" d="${barUp(x, y, bw, h)}"/>
      <text class="value-label" x="${x + bw / 2}" y="${y - 5}" text-anchor="middle">${w.count}</text>
      <text class="axis-label" x="${x + bw / 2}" y="${H - 8}" text-anchor="middle">${label}</text>
    </g>`;
  }).join('');

  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img"
    aria-label="주별 출석 인원 막대그래프">
    ${bars}
    <line class="baseline" x1="${PAD_L}" y1="${TOP + plotH + .5}" x2="${W - PAD_R}" y2="${TOP + plotH + .5}"/>
  </svg>`;
}

function groupChart(rows) {
  const W = 340, ROW = 34, PAD = 2;
  const H = rows.length * ROW + PAD * 2;
  const LABEL_W = 96, VALUE_W = 52;
  const trackX = LABEL_W, trackW = W - LABEL_W - VALUE_W;

  const bars = rows.map((r, i) => {
    const y = PAD + i * ROW + 8;
    const h = 16;
    const w = Math.max(2, r.rate * trackW);
    return `<g>
      <title>${r.name} · 출석률 ${Math.round(r.rate * 100)}%</title>
      <text class="value-label" x="0" y="${y + 12}" style="font-size:12px">${esc(r.name)}</text>
      <text class="axis-label" x="0" y="${y + 24}">${r.size}명</text>
      <path class="bar-track" d="${barRight(trackX, y, trackW, h, 8)}"/>
      <path class="bar" d="${barRight(trackX, y, w, h, 8)}"/>
      <text class="value-label" x="${W}" y="${y + 12}" text-anchor="end">${Math.round(r.rate * 100)}%</text>
      <text class="axis-label" x="${W}" y="${y + 24}" text-anchor="end">평균 ${r.avg.toFixed(1)}명</text>
    </g>`;
  }).join('');

  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img"
    aria-label="소그룹별 출석률 가로 막대그래프">${bars}</svg>`;
}

/* ── 모달 ─────────────────────────────────────────────────── */
function openSheet(html, wire, opts = {}) {
  const ov = $('#overlay'), sh = $('#sheet');
  sh.innerHTML = html;
  ov.classList.toggle('at-top', !!opts.top);   // 메모는 위에서 내려온다
  ov.hidden = false;
  const close = () => { ov.hidden = true; sh.innerHTML = ''; };
  ov.onclick = e => { if (e.target === ov) close(); };
  $$('[data-close]', sh).forEach(b => b.addEventListener('click', close));
  wire?.(sh, close);
  return close;
}

function promptDialog(title, placeholder, value, onOk, sub = '') {
  openSheet(`<h2>${esc(title)}</h2>${sub ? `<p class="sub">${sub}</p>` : ''}
    <label class="field"><input type="text" id="p-in" placeholder="${esc(placeholder)}" value="${esc(value)}"></label>
    <div class="actions"><button class="btn" data-close>취소</button>
    <button class="btn primary" id="p-ok">확인</button></div>`,
  (sh, close) => {
    const inp = $('#p-in', sh);
    inp.focus(); inp.select();
    const ok = () => { const v = inp.value.trim(); if (!v) return; close(); onOk(v); };
    $('#p-ok', sh).onclick = ok;
    inp.onkeydown = e => { if (e.key === 'Enter') ok(); };
  });
}

function confirmDialog(title, sub, okLabel, onOk) {
  openSheet(`<h2>${esc(title)}</h2><p class="sub">${sub}</p>
    <div class="actions"><button class="btn" data-close>취소</button>
    <button class="btn danger" id="c-ok">${esc(okLabel)}</button></div>`,
  (sh, close) => { $('#c-ok', sh).onclick = () => { close(); onOk(); }; });
}

function addMemberDialog() {
  const opts = ['<option value="">미배정</option>',
    ...groupsSorted().map(g => `<option value="${g.id}">${esc(g.name)}</option>`)].join('');
  openSheet(`<h2>이름 추가</h2>
    <p class="sub">여러 명은 줄바꿈 또는 쉼표로 한 번에 넣을 수 있어요.</p>
    <label class="field">이름
      <textarea id="a-names" placeholder="김청년&#10;이믿음, 박소망"></textarea></label>
    <label class="field">소그룹<select id="a-group">${opts}</select></label>
    <div class="actions"><button class="btn" data-close>취소</button>
    <button class="btn primary" id="a-ok">추가</button></div>`,
  (sh, close) => {
    $('#a-names', sh).focus();
    $('#a-ok', sh).onclick = async () => {
      const names = $('#a-names', sh).value.split(/[\n,]/).map(s => s.trim()).filter(Boolean);
      const gid = $('#a-group', sh).value || null;
      if (!names.length) return;
      close();
      for (const n of names) await backend.addMember(n, gid);
      toast(`${names.length}명 추가했어요`);
    };
  });
}

function memberActions(id) {
  const m = S.members.find(x => x.id === id); if (!m) return;
  const away = onLeaveAt(m, currentDate);
  const week = prettyDate(currentDate).main;
  openSheet(`<h2>${esc(m.name)}</h2>
    <p class="sub">소그룹: ${esc(groupName(m.groupId))}${away ? ` · 장기 부재 (${esc(m.leaveReason)})` : ''}</p>
    <div class="menu">
      <button class="btn" id="m-rename">이름 수정</button>
      <button class="btn" id="m-group">소그룹 정하기</button>
      ${away ? `<button class="btn" id="m-reason">부재 사유 수정</button>` : ''}
      <button class="btn" id="m-leave">${away ? `${week}부터 복귀` : `${week}부터 장기 부재`}</button>
      <button class="btn danger" id="m-del">명단에서 삭제</button>
      <button class="btn" data-close>닫기</button>
    </div>`,
  (sh, close) => {
    $('#m-rename', sh).onclick = () => { close();
      promptDialog('이름 수정', '이름', m.name, v => backend.updateMember(id, { name: v })); };
    $('#m-group', sh).onclick  = () => { close(); pickGroupDialog(id); };
    // 사유만 고치기 — 복귀 처리했다 다시 지정하지 않아도 되게
    $('#m-reason', sh)?.addEventListener('click', () => { close();
      promptDialog('부재 사유', '예: 군 복무', m.leaveReason ?? '',
        v => backend.updateMember(id, { leaveReason: v }),
        `${esc(m.name)} 님의 부재 기간은 그대로 두고 사유만 바꿉니다.`); });
    // 부재/복귀는 '보고 있는 주'를 경계로 삼는다 → 이전 주 기록은 그대로 부재로 남는다
    $('#m-leave', sh).onclick  = () => { close();
      away ? backend.updateMember(id, { leaveTo: currentDate })
               .then(() => toast(`${m.name} · ${week}부터 복귀`))
           : leaveDialog(id); };
    $('#m-del', sh).onclick    = () => { close();
      confirmDialog(`${m.name} 삭제`, '출석 기록도 함께 지워집니다. 되돌릴 수 없어요.', '삭제',
        async () => { await backend.removeMember(id); toast('삭제했어요'); }); };
  });
}

/** 군 복무·유학처럼 '못 오는 게 정상'인 상태로 표시 — 명단과 지난 기록은 그대로 남는다 */
function leaveDialog(memberId) {
  const m = S.members.find(x => x.id === memberId); if (!m) return;
  const presets = ['군 복무', '유학', '타지 거주', '건강', '장기 출타'];
  const week = prettyDate(currentDate).main;
  openSheet(`<h2>${esc(m.name)} · 장기 부재</h2>
    <p class="sub"><b>${esc(week)}부터</b> 부재로 처리합니다. 그 이전 주 기록은 건드리지 않아요.
    명단과 지난 출석 기록은 그대로 남고 <b>통계에서만 빠집니다</b> —
    챙겨야 할 사람·발걸음이 뜸한 사람·출석률 분모 모두에서요.</p>
    <div class="menu">
      ${presets.map(p => `<button class="btn" data-r="${esc(p)}">${esc(p)}</button>`).join('')}
      <button class="btn" id="l-etc">직접 입력</button>
      <button class="btn" data-close>취소</button>
    </div>`,
  (sh, close) => {
    const mark = reason =>
      backend.updateMember(memberId, { leaveReason: reason, leaveFrom: currentDate, leaveTo: null })
        .then(() => toast(`${m.name} · ${week}부터 ${reason}`));
    $$('[data-r]', sh).forEach(b => b.onclick = () => { close(); mark(b.dataset.r); });
    $('#l-etc', sh).onclick = () => { close();
      promptDialog('장기 부재 사유', '예: 파견 근무', '', v => mark(v)); };
  });
}

/** 소그룹 배치 + 소그룹 만들기·수정·삭제가 모두 여기서 이뤄진다 (별도 탭 없음) */
function pickGroupDialog(memberId) {
  const m = S.members.find(x => x.id === memberId); if (!m) return;
  const gs = groupsSorted();
  const row = (label, value, on, gid) => `<div class="row">
      <button class="btn row-main${on ? ' primary' : ''}" data-g="${value}">${esc(label)}${on ? ' ✓' : ''}</button>
      ${gid ? `<button class="icon-btn" data-gedit="${gid}" aria-label="${esc(label)} 수정">⋯</button>` : ''}
    </div>`;

  openSheet(`<h2>${esc(m.name)}</h2>
    <p class="sub">${gs.length ? '들어갈 소그룹을 고르세요.' : '아직 소그룹이 없어요. 아래에서 만들 수 있습니다.'}</p>
    <div class="menu">
      ${gs.map(g => row(g.name, g.id, g.id === m.groupId, g.id)).join('')}
      ${row('미배정', '', !m.groupId, null)}
      <button class="btn" id="g-new">+ 새 소그룹 만들기</button>
      <button class="btn" data-close>닫기</button>
    </div>`,
  (sh, close) => {
    $$('[data-g]', sh).forEach(b => b.onclick = async () => {
      close(); await backend.updateMember(memberId, { groupId: b.dataset.g || null });
    });
    $$('[data-gedit]', sh).forEach(b => b.onclick = e => {
      e.stopPropagation(); close(); groupActions(b.dataset.gedit);
    });
    $('#g-new', sh).onclick = () => {
      close();
      promptDialog('새 소그룹', '예: 1소그룹, 요셉조', '', async name => {
        const gid = await backend.addGroup(name);
        await backend.updateMember(memberId, { groupId: gid });
        toast(`${name} 만들고 ${m.name} 배치했어요`);
      }, `만들면 ${esc(m.name)} 님이 바로 이 소그룹에 들어갑니다.`);
    };
  });
}

function groupActions(gid) {
  const g = S.groups.find(x => x.id === gid); if (!g) return;
  openSheet(`<h2>${esc(g.name)}</h2>
    <div class="menu">
      <button class="btn" id="g-rename">이름 수정</button>
      <button class="btn danger" id="g-del">소그룹 삭제</button>
      <button class="btn" data-close>닫기</button>
    </div>`,
  (sh, close) => {
    $('#g-rename', sh).onclick = () => { close();
      promptDialog('소그룹 이름 수정', '소그룹 이름', g.name, v => backend.updateGroup(gid, { name: v })); };
    $('#g-del', sh).onclick = () => { close();
      confirmDialog(`${g.name} 삭제`, '소속된 사람들은 미배정으로 이동합니다. 명단과 출석 기록은 그대로예요.',
        '삭제', () => backend.removeGroup(gid)); };
  });
}

/* ── 그날의 메모 ─────────────────────────────────────────── */
function notesDialog() {
  const p = prettyDate(currentDate);
  const list = notesFor(currentDate);
  const ICON_EDIT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
  const ICON_DEL  = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>';

  openSheet(`<h2>${esc(p.main)} 메모</h2>
    <p class="sub">${esc(p.sub)} · 그날의 특이사항을 남겨두세요.</p>
    <label class="field"><textarea id="n-new" placeholder="예: 야외예배로 진행 · 새가족 2명 방문"></textarea></label>
    <button class="btn primary block" id="n-add">메모 추가</button>
    ${list.length ? `<div class="notes">${list.map(n => `<div class="note-row">
        <p>${esc(n.text)}</p>
        <div class="note-act">
          <button class="icon-mini" data-edit="${n.id}" aria-label="메모 수정">${ICON_EDIT}</button>
          <button class="icon-mini danger" data-del="${n.id}" aria-label="메모 삭제">${ICON_DEL}</button>
        </div>
      </div>`).join('')}</div>`
      : '<div class="empty" style="padding:22px 8px">아직 메모가 없어요.</div>'}
    <button class="btn block" data-close style="margin-top:14px">닫기</button>`,
  (sh, close) => {
    $('#n-add', sh).onclick = async () => {
      const v = $('#n-new', sh).value.trim();
      if (!v) { toast('내용을 입력해 주세요'); return; }
      close();
      await backend.addNote(currentDate, v);
      toast('메모를 남겼어요');
    };
    $$('[data-del]', sh).forEach(b => b.onclick = async () => {
      close();
      await backend.removeNote(currentDate, b.dataset.del);
      toast('메모를 지웠어요');
    });
    $$('[data-edit]', sh).forEach(b => b.onclick = () => {
      const n = list.find(x => x.id === b.dataset.edit);
      close();
      promptDialog('메모 수정', '내용', n.text, v => backend.updateNote(currentDate, n.id, v));
    });
  }, { top: true });
}

/* ── 구글 시트 자동 저장 ───────────────────────────────────
   체크할 때마다 표 세 장을 통째로 만들어 보낸다(덮어쓰기).
   부분 갱신이 아니라 전체 스냅샷이라 중간에 실패해도 다음 전송에서 회복된다. */
const LS_SHEET = 'bokwang.sheet.v1';
const readSheetCfg = () => {
  try { return JSON.parse(localStorage.getItem(LS_SHEET) || 'null'); } catch { return null; }
};
let sheetState = { at: null, error: null, busy: false };
let sheetTimer = null;

function queueSheetPush() {
  if (!readSheetCfg()) return;
  clearTimeout(sheetTimer);
  sheetTimer = setTimeout(pushToSheet, 2500);   // 연달아 체크할 때 한 번만 보낸다
}

async function pushToSheet() {
  const cfg = readSheetCfg();
  if (!cfg?.url || sheetState.busy) return;
  sheetState.busy = true;
  try {
    const body = JSON.stringify({
      secret: cfg.secret ?? '',
      sheets: { '출석표': attendanceTable(), '주별 요약': weeklyTable(), '소그룹': groupTable() }
    });
    // text/plain 이라야 사전 요청(preflight) 없이 그대로 간다
    const res = await fetch(cfg.url, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body
    });
    const out = await res.json();
    if (out.ok) { sheetState = { at: Date.now(), error: null, busy: false }; }
    else        { sheetState = { at: sheetState.at, error: out.error || '거부됨', busy: false }; }
  } catch (e) {
    sheetState = { at: sheetState.at, error: e.message || String(e), busy: false };
  }
  refreshSaveBar();
}

function sheetDialog() {
  const cfg = readSheetCfg() ?? {};
  openSheet(`<h2>구글 시트로 자동 저장</h2>
    <p class="sub">출석을 체크할 때마다 지정한 구글 시트가 최신 상태로 덮어써집니다.
    <b>출석표 · 주별 요약 · 소그룹</b> 세 장이 만들어져요.
    설정 방법은 <b>google-sheet/Code.gs</b> 파일 맨 위 주석에 단계별로 적어뒀습니다.</p>
    <label class="field">웹 앱 URL
      <input type="text" id="sh-url" placeholder="https://script.google.com/macros/s/…/exec"
        value="${esc(cfg.url ?? '')}"></label>
    <label class="field">SECRET (스크립트에 적은 값과 같아야 함)
      <input type="text" id="sh-secret" placeholder="예: bokwang-2026" value="${esc(cfg.secret ?? '')}"></label>
    <div class="actions">
      <button class="btn" data-close>취소</button>
      <button class="btn primary" id="sh-ok">저장하고 지금 보내기</button>
    </div>
    ${cfg.url ? '<button class="btn danger block" id="sh-off" style="margin-top:9px">연결 끊기</button>' : ''}`,
  (sh, close) => {
    $('#sh-ok', sh).onclick = async () => {
      const url = $('#sh-url', sh).value.trim();
      const secret = $('#sh-secret', sh).value.trim();
      if (!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec/.test(url)) {
        toast('웹 앱 URL 이 올바르지 않아요 (…/exec 로 끝나야 합니다)'); return;
      }
      localStorage.setItem(LS_SHEET, JSON.stringify({ url, secret }));
      close();
      toast('시트로 보내는 중…');
      await pushToSheet();
      toast(sheetState.error ? `시트 전송 실패: ${sheetState.error}` : '시트에 저장했어요');
    };
    $('#sh-off', sh)?.addEventListener('click', () => {
      localStorage.removeItem(LS_SHEET);
      sheetState = { at: null, error: null, busy: false };
      close(); refreshSaveBar(); toast('시트 연결을 껐어요');
    });
  });
}

/* ── 저장 확인 ───────────────────────────────────────────── */
async function verifySave() {
  const shown = Object.keys(S.attendance[currentDate] ?? {}).length;
  const when  = prettyDate(currentDate).main;

  if (backend.mode === 'local') {
    // 저장소에서 실제로 다시 읽어 화면과 대조한다 (보여주기용 버튼이 아니라 진짜 확인)
    let saved = null;
    try {
      const raw = JSON.parse(localStorage.getItem(LS_STATE) || '{}');
      saved = Object.keys(raw.attendance?.[currentDate] ?? {}).length;
    } catch { saved = null; }
    if (saved === shown) toast(`${when} 출석 ${shown}명 저장 확인`);
    else toast(`저장이 어긋났어요 (화면 ${shown} / 저장 ${saved ?? '읽기 실패'})`);
  } else {
    toast(`${when} 출석 ${shown}명 · 공유 저장 확인`);
  }
  lastSavedAt = Date.now();
  refreshSaveBar();

  const cfg = readSheetCfg();
  if (cfg) {
    await pushToSheet();
    toast(sheetState.error ? `시트 전송 실패: ${sheetState.error}` : '구글 시트에도 반영했어요');
  }
}

/* ── 설정 ─────────────────────────────────────────────────── */
function settingsDialog() {
  const cfg = readConfig();
  openSheet(`<h2>설정</h2>
    <p class="sub">${cfg ? `실시간 공유 중 · 방 코드 <b>${esc(cfg.roomId)}</b>` : '지금은 이 기기에만 저장되는 <b>로컬 모드</b>입니다.'}</p>
    <div class="menu">
      <button class="btn primary" id="s-sheet">구글 시트로 자동 저장</button>
      <button class="btn" id="s-sync">${cfg ? '공유 설정 변경' : '여러 명이 공유하도록 설정'}</button>
      <button class="btn" id="s-export">데이터 내보내기 (JSON 백업)</button>
      <button class="btn" id="s-csv">출석표 CSV 내려받기</button>
      <button class="btn" id="s-import">백업 불러오기</button>
      <button class="btn danger" id="s-reset">전체 초기화</button>
      <button class="btn" data-close>닫기</button>
    </div>`,
  (sh, close) => {
    $('#s-sheet', sh).onclick  = () => { close(); sheetDialog(); };
    $('#s-sync', sh).onclick   = () => { close(); syncDialog(); };
    $('#s-export', sh).onclick = () => { close(); download(`출석부-백업-${toKey(new Date())}.json`,
      JSON.stringify(S, null, 2), 'application/json'); };
    $('#s-csv', sh).onclick    = () => { close(); download(`출석부-${toKey(new Date())}.csv`, buildCSV(), 'text/csv'); };
    $('#s-import', sh).onclick = () => { close(); importDialog(); };
    $('#s-reset', sh).onclick  = () => { close(); confirmDialog('전체 초기화',
      '명단·소그룹·출석 기록이 모두 지워집니다. 먼저 백업을 받아두세요.', '전부 지우기',
      async () => { await backend.replaceAll(emptyState()); toast('초기화했어요'); }); };
  });
}

/* ── 표 만들기 (CSV·구글 시트 공용) ───────────────────────── */
/** 이름 × 날짜 출석표 */
function attendanceTable() {
  const ms = [...S.members].sort((a, b) => (a.seat ?? Infinity) - (b.seat ?? Infinity) || byName(a, b));
  const keys = sessionKeys();
  const asOf = statsAsOf();
  const head = ['이름', '소그룹', '상태', ...keys, '출석횟수', '출석률'];
  const rows = ms.map(m => {
    // 장기 부재였던 주는 결석이 아니므로 출석률 분모에서도 뺀다
    const counted = keys.filter(k => !onLeaveAt(m, k));
    const hits = counted.filter(k => isPresent(k, m.id)).length;
    return [m.name, groupName(m.groupId),
            onLeaveAt(m, asOf) ? `장기 부재 (${m.leaveReason})` : '',
            ...keys.map(k => onLeaveAt(m, k) ? '부재' : isPresent(k, m.id) ? 'O' : ''),
            hits, counted.length ? Math.round(hits / counted.length * 100) + '%' : ''];
  });
  return [head, ...rows];
}

/** 주별 요약 — 그날의 메모까지 함께 */
function weeklyTable() {
  const head = ['날짜', '요일', '출석', '전체', '출석률', '메모'];
  const rows = sessionKeys().map(k => {
    const active = activeAt(k);
    const on = active.filter(m => isPresent(k, m.id)).length;
    const memo = notesFor(k).map(n => n.text).join(' / ');
    return [k, dayLabel(fromKey(k)), on, active.length,
            active.length ? Math.round(on / active.length * 100) + '%' : '', memo];
  });
  return [head, ...rows];
}

/** 소그룹 편성 */
function groupTable() {
  const head = ['소그룹', '인원', '명단'];
  const rows = groupsSorted().map(g => {
    const ms = membersSorted().filter(m => m.groupId === g.id);
    return [g.name, ms.length, ms.map(m => m.name).join(', ')];
  });
  const none = membersSorted().filter(m => !m.groupId || !S.groups.some(g => g.id === m.groupId));
  if (none.length) rows.push(['미배정', none.length, none.map(m => m.name).join(', ')]);
  return [head, ...rows];
}

function buildCSV() {
  const csv = attendanceTable()
    .map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  return '﻿' + csv;   // 엑셀 한글 깨짐 방지
}

function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click(); URL.revokeObjectURL(url);
}

function importDialog() {
  openSheet(`<h2>백업 불러오기</h2>
    <p class="sub">JSON 파일을 고르거나 내용을 붙여넣으세요. <b>현재 데이터는 모두 대체됩니다.</b></p>
    <button class="btn primary block" id="i-pick">파일 선택</button>
    <input type="file" id="i-file" accept=".json,application/json" hidden />
    <p class="sub" style="margin:14px 0 6px">또는 직접 붙여넣기</p>
    <label class="field"><textarea class="code" id="i-json" placeholder='{"members":[…]}'></textarea></label>
    <div class="actions"><button class="btn" data-close>취소</button>
    <button class="btn danger" id="i-ok">불러오기</button></div>`,
  (sh, close) => {
    const apply = async raw => {
      let data;
      try { data = JSON.parse(raw); }
      catch { toast('JSON 형식이 올바르지 않아요'); return; }
      if (!Array.isArray(data.members)) { toast('members 항목이 없어요'); return; }
      close();
      await backend.replaceAll(data);
      toast(`${data.members.length}명 · ${Object.keys(data.attendance ?? {}).length}회 불러왔어요`);
    };
    // 백업 파일은 수십 KB 라 붙여넣기가 어렵다 — 파일 선택을 기본 경로로 둔다
    $('#i-pick', sh).onclick = () => $('#i-file', sh).click();
    $('#i-file', sh).onchange = async e => {
      const f = e.target.files?.[0]; if (!f) return;
      apply(await f.text());
    };
    $('#i-ok', sh).onclick = () => apply($('#i-json', sh).value);
  });
}

function syncDialog() {
  const cfg = readConfig();
  openSheet(`<h2>여러 명이 공유하기</h2>
    <p class="sub">Firebase 웹앱 설정(firebaseConfig)을 붙여넣고 방 코드를 정하면,
    같은 코드를 넣은 모든 기기에서 실시간으로 같은 출석부를 보게 됩니다.
    설정 방법은 README.md 를 참고하세요.</p>
    <label class="field">방 코드 (팀끼리 공유할 비밀 코드)
      <input type="text" id="y-room" placeholder="bokwang-youth-x7k2m9"
        value="${esc(cfg?.roomId ?? 'bokwang-youth-' + Math.random().toString(36).slice(2, 8))}"></label>
    <label class="field">firebaseConfig (JSON 또는 붙여넣은 코드 그대로)
      <textarea class="code" id="y-cfg" placeholder='{ "apiKey": "…", "projectId": "…", "appId": "…" }'>${esc(cfg ? JSON.stringify(cfg.firebase, null, 2) : '')}</textarea></label>
    <div class="actions">
      <button class="btn" data-close>취소</button>
      <button class="btn primary" id="y-ok">저장하고 새로고침</button>
    </div>
    ${cfg ? '<button class="btn danger block" id="y-off" style="margin-top:8px">공유 끄고 로컬 모드로</button>' : ''}`,
  (sh, close) => {
    $('#y-ok', sh).onclick = () => {
      const room = $('#y-room', sh).value.trim();
      const raw  = $('#y-cfg', sh).value.trim();
      if (!room) { toast('방 코드를 입력해 주세요'); return; }
      let firebase;
      try { firebase = parseFirebaseConfig(raw); }
      catch (e) { toast(e.message); return; }
      localStorage.setItem(LS_CONFIG, JSON.stringify({ roomId: room, firebase }));
      close(); location.reload();
    };
    $('#y-off', sh)?.addEventListener('click', () => {
      localStorage.removeItem(LS_CONFIG); location.reload();
    });
  });
}

/** Firebase 콘솔에서 복사한 코드 조각도, 순수 JSON도 모두 받아준다. */
function parseFirebaseConfig(raw) {
  if (!raw) throw new Error('firebaseConfig를 붙여넣어 주세요');
  let text = raw;
  const m = raw.match(/\{[\s\S]*\}/);
  if (m) text = m[0];
  let obj;
  try { obj = JSON.parse(text); }
  catch {
    // { apiKey: "…" } 처럼 따옴표 없는 키 → JSON 으로 보정
    const fixed = text
      .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
      .replace(/'/g, '"')
      .replace(/,(\s*[}\]])/g, '$1');
    try { obj = JSON.parse(fixed); } catch { throw new Error('설정을 읽지 못했어요. 중괄호 부분만 붙여넣어 보세요.'); }
  }
  for (const k of ['apiKey', 'projectId', 'appId'])
    if (!obj[k]) throw new Error(`firebaseConfig에 ${k} 가 없어요`);
  return obj;
}

/* ── 이벤트 배선 ──────────────────────────────────────────── */
$$('.dock-tab').forEach(t => t.addEventListener('click', () => {
  activeTab = t.dataset.tab;
  $$('.dock-tab').forEach(x => {
    const on = x === t;
    x.classList.toggle('is-active', on);
    x.setAttribute('aria-selected', on);
  });
  $$('.panel').forEach(p => p.classList.toggle('is-active', p.id === 'panel-' + activeTab));
  $('main').scrollTop = 0;
  render();
}));
$('#btn-notes').addEventListener('click', notesDialog);
$('#btn-save').addEventListener('click', verifySave);

$('#date-prev').addEventListener('click', () => { currentDate = addDays(currentDate, -7); renderAttendance(); });
$('#date-next').addEventListener('click', () => { currentDate = addDays(currentDate,  7); renderAttendance(); });
$('#date-label').addEventListener('click', () => {
  const inp = $('#date-input');
  if (inp.showPicker) { inp.style.pointerEvents = 'auto'; inp.showPicker(); }
  else { inp.style.opacity = 1; inp.style.pointerEvents = 'auto'; inp.focus(); }
});
$('#date-input').addEventListener('change', e => {
  if (e.target.value) currentDate = e.target.value;
  e.target.style.opacity = 0; e.target.style.pointerEvents = 'none';
  renderAttendance();
});
$$('.sort-opt').forEach(b => b.addEventListener('click', () => {
  sortMode = b.dataset.sort;
  localStorage.setItem('bokwang.sortmode', sortMode);
  lastSig = null;
  renderAttendance();
}));
$('#btn-settings').addEventListener('click', settingsDialog);
document.addEventListener('keydown', e => { if (e.key === 'Escape') $('#overlay').hidden = true; });

boot();

import { firebaseEnabled, firebaseConfig } from './firebase-config.js';

let fb = null;
let roster = [];
const appState = {
  mode: 'lobby',
  code: '',
  seat: '',
  room: null,
  unsubscribe: null,
  offline: false,
  activeSlot: null,
  selectedFormationCode: '',
  liveMatchActive: false,
  matchInterval: null
};

const $ = (id) => document.getElementById(id);

const FORMATIONS = {
  '4-4-2': [
    { pos: 'GK', x: 50, y: 88 },
    { pos: 'DEF', x: 20, y: 70 }, { pos: 'DEF', x: 40, y: 75 }, { pos: 'DEF', x: 60, y: 75 }, { pos: 'DEF', x: 80, y: 70 },
    { pos: 'MID', x: 20, y: 45 }, { pos: 'MID', x: 40, y: 50 }, { pos: 'MID', x: 60, y: 50 }, { pos: 'MID', x: 80, y: 45 },
    { pos: 'FWD', x: 35, y: 20 }, { pos: 'FWD', x: 65, y: 20 }
  ],
  '4-3-3': [
    { pos: 'GK', x: 50, y: 88 },
    { pos: 'DEF', x: 20, y: 70 }, { pos: 'DEF', x: 40, y: 75 }, { pos: 'DEF', x: 60, y: 75 }, { pos: 'DEF', x: 80, y: 70 },
    { pos: 'MID', x: 30, y: 50 }, { pos: 'MID', x: 50, y: 55 }, { pos: 'MID', x: 70, y: 50 },
    { pos: 'FWD', x: 25, y: 20 }, { pos: 'FWD', x: 50, y: 15 }, { pos: 'FWD', x: 75, y: 20 }
  ],
  '3-5-2': [
    { pos: 'GK', x: 50, y: 88 },
    { pos: 'DEF', x: 30, y: 75 }, { pos: 'DEF', x: 50, y: 75 }, { pos: 'DEF', x: 70, y: 75 },
    { pos: 'MID', x: 15, y: 50 }, { pos: 'MID', x: 35, y: 55 }, { pos: 'MID', x: 50, y: 60 }, { pos: 'MID', x: 65, y: 55 }, { pos: 'MID', x: 85, y: 50 },
    { pos: 'FWD', x: 35, y: 20 }, { pos: 'FWD', x: 65, y: 20 }
  ],
  '3-4-3': [
    { pos: 'GK', x: 50, y: 88 },
    { pos: 'DEF', x: 30, y: 75 }, { pos: 'DEF', x: 50, y: 75 }, { pos: 'DEF', x: 70, y: 75 },
    { pos: 'MID', x: 20, y: 50 }, { pos: 'MID', x: 40, y: 55 }, { pos: 'MID', x: 60, y: 55 }, { pos: 'MID', x: 80, y: 50 },
    { pos: 'FWD', x: 25, y: 20 }, { pos: 'FWD', x: 50, y: 15 }, { pos: 'FWD', x: 75, y: 20 }
  ],
  '4-2-3-1': [
    { pos: 'GK', x: 50, y: 88 },
    { pos: 'DEF', x: 20, y: 70 }, { pos: 'DEF', x: 40, y: 75 }, { pos: 'DEF', x: 60, y: 75 }, { pos: 'DEF', x: 80, y: 70 },
    { pos: 'MID', x: 35, y: 55 }, { pos: 'MID', x: 65, y: 55 },
    { pos: 'MID', x: 20, y: 35 }, { pos: 'MID', x: 50, y: 40 }, { pos: 'MID', x: 80, y: 35 },
    { pos: 'FWD', x: 50, y: 15 }
  ]
};

init();

async function init() {
  bindEvents();
  await loadRoster();
  await initFirebase();
  renderLobbyStats();
  renderAll();
}

function bindEvents() {
  $('createRoomBtn').addEventListener('click', createOnlineRoom);
  $('offlineBtn').addEventListener('click', startOfflineRoom);
  $('joinRoomBtn').addEventListener('click', joinOnlineRoom);
  $('copyCodeBtn').addEventListener('click', copyCode);
  $('startDraftBtn').addEventListener('click', startDraft);
  $('leaveRoomBtn').addEventListener('click', leaveRoom);
  $('autoPickBtn').addEventListener('click', autoPick);
  $('simulateBtn').addEventListener('click', simulateMatch);
  $('searchInput').addEventListener('input', renderPlayers);
  $('posFilter').addEventListener('change', renderPlayers);
  $('sortSelect').addEventListener('change', renderPlayers);

  // Formation selection
  document.querySelectorAll('.formation-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.formation-btn').forEach(b => b.classList.remove('selected'));
      e.target.classList.add('selected');
      appState.selectedFormationCode = e.target.dataset.fmt;
      $('confirmFormationBtn').disabled = false;
    });
  });
  $('confirmFormationBtn').addEventListener('click', confirmFormation);
}

async function loadRoster() {
  try {
    const res = await fetch('./data/players.snapshot.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    roster = (Array.isArray(data.players) ? data.players : []).map(normalizePlayer);
    roster.sort((a,b) => b.rating - a.rating || a.name.localeCompare(b.name));
    $('dataTitle').textContent = `${roster.length} pemain siap main`;
    $('dataNote').textContent = data.meta?.note || 'Roster snapshot berhasil dimuat.';
    $('statSource').textContent = data.meta?.source || 'snapshot';
    $('rosterLabel').textContent = `${roster.length} pemain tersedia`;
  } catch (err) {
    $('dataTitle').textContent = 'Roster gagal dimuat';
    $('dataNote').textContent = err.message;
    roster = [];
  }
}

async function initFirebase() {
  if (!firebaseEnabled || !firebaseConfig?.apiKey || !firebaseConfig?.databaseURL) {
    $('onlineBadge').textContent = 'Firebase belum aktif';
    $('onlineBadge').className = 'badge warn';
    $('lobbyStatus').textContent = 'Online room belum aktif. Isi public/firebase-config.js dulu, atau pakai Main Offline 1 Device.';
    return;
  }
  try {
    const appMod = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js');
    const dbMod = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js');
    const app = appMod.initializeApp(firebaseConfig);
    const db = dbMod.getDatabase(app);
    fb = { ...dbMod, db };
    $('onlineBadge').textContent = 'Online ready';
    $('onlineBadge').className = 'badge ok';
    $('lobbyStatus').textContent = 'Firebase aktif. Buat room lalu kirim kode ke teman.';
  } catch (err) {
    $('onlineBadge').textContent = 'Firebase error';
    $('onlineBadge').className = 'badge warn';
    $('lobbyStatus').textContent = `Firebase gagal: ${err.message}`;
  }
}

function normalizePlayer(p, idx=0) {
  return {
    id: String(p.id || `${p.name}-${p.club}-${idx}`).replace(/[^a-zA-Z0-9_-]/g, '-'),
    name: String(p.name || 'Unknown'),
    position: normalizePosition(p.position || p.rawPosition),
    rawPosition: p.rawPosition || p.position || '',
    club: String(p.club || 'Unknown Club'),
    country: String(p.country || ''),
    rating: Math.max(40, Math.min(99, Number(p.rating) || 70)),
    trait: p.trait || 'Balanced',
    source: p.source || 'snapshot'
  };
}

function normalizePosition(raw) {
  const p = String(raw || '').toLowerCase();
  if (p.includes('goal') || p === 'gk') return 'GK';
  if (/(def|back|cb|lb|rb|lwb|rwb)/.test(p)) return 'DEF';
  if (/(mid|cm|dm|am|winger)/.test(p)) return 'MID';
  if (/(fw|fwd|att|forward|striker|st|wing)/.test(p)) return 'FWD';
  return ['GK','DEF','MID','FWD'].includes(String(raw).toUpperCase()) ? String(raw).toUpperCase() : 'MID';
}

function managerName() {
  return ($('managerName').value || 'Manager').trim().slice(0,18);
}

function randomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({length:5}, () => chars[Math.floor(Math.random()*chars.length)]).join('');
}

async function createOnlineRoom() {
  if (!fb) { setStatus('Firebase belum aktif.'); return; }
  setStatus('Membuat room...');
  const code = randomCode();
  const room = newRoom(code, managerName(), '');
  room.mode = 'online';
  room.hostSeat = 'A';
  try {
    await fb.set(fb.ref(fb.db, `rooms/${code}`), room);
    enterRoom(code, 'A', false);
  } catch (err) {
    console.error("Firebase set error:", err);
    setStatus('Gagal membuat room. Pastikan Firebase Security Rules diset ke true.');
  }
}

async function joinOnlineRoom() {
  if (!fb) { setStatus('Firebase belum aktif.'); return; }
  const code = $('joinCodeInput').value.trim().toUpperCase();
  if (!/^[A-Z0-9]{5}$/.test(code)) { setStatus('Kode 5 karakter.'); return; }
  setStatus('Mencari room...');
  try {
    const snap = await fb.get(fb.ref(fb.db, `rooms/${code}`));
    if (!snap.exists()) { setStatus('Room tidak ada.'); return; }
    const room = snap.val();
    const myName = managerName();
    let seat = 'SPECTATOR';
    
    if (!room.managers?.B || room.managers.B === myName) {
      seat = 'B';
    } else if (room.managers.A === myName) {
      seat = 'A';
    }

    if (seat === 'B') {
      await fb.update(fb.ref(fb.db, `rooms/${code}`), { 'managers/B': myName, updatedAt: Date.now() });
    }
    console.log(`[Join Room] Masuk sebagai seat: ${seat}`);
    enterRoom(code, seat, false);
  } catch (err) {
    console.error("Firebase get error:", err);
    setStatus('Gagal join room. Pastikan Firebase Security Rules diset ke true.');
  }
}

function startOfflineRoom() {
  const code = 'LOCAL';
  const room = newRoom(code, managerName(), 'Manager B');
  room.mode = 'offline';
  appState.offline = true;
  appState.code = code;
  appState.seat = 'A';
  appState.room = room;
  showRoom();
  checkFormationModal();
  renderAll();
}

function newRoom(code, managerA, managerB) {
  return {
    code, status: 'lobby', turn: 'A',
    managers: { A: managerA || 'Manager A', B: managerB || '' },
    formations: { A: '', B: '' },
    teams: { A: {}, B: {} }, // keys are slot indices
    picked: {}, result: null,
    createdAt: Date.now(), updatedAt: Date.now(),
    rosterVersion: 'players.snapshot.json'
  };
}

function enterRoom(code, seat, offline) {
  appState.code = code; appState.seat = seat; appState.offline = offline;
  showRoom();
  if (appState.unsubscribe) appState.unsubscribe();
  if (!offline && fb) {
    const roomRef = fb.ref(fb.db, `rooms/${code}`);
    appState.unsubscribe = fb.onValue(roomRef, (snap) => {
      if (!snap.exists()) { setStatus('Room dihapus.'); leaveRoom(false); return; }
      const oldRoom = appState.room;
      const newRoom = snap.val();
      
      console.log(`[Firebase onValue] Status: ${newRoom.status}, Turn: ${newRoom.turn}, Seat: ${appState.seat}`);

      appState.room = newRoom;
      
      if (appState.activeSlot && !appState.activeSlot.startsWith(appState.seat + '-')) {
        appState.activeSlot = null;
      }

      checkFormationModal();
      renderAll();

      try {
        if (!appState.offline && oldRoom && newRoom.status === 'draft') {
          const oldPicked = oldRoom.picked || {};
          const newPicked = newRoom.picked || {};
          const mySeat = appState.seat;
          for (const pid in newPicked) {
            if (!oldPicked[pid] && newPicked[pid] !== mySeat) {
              const p = roster.find(x => x.id === pid);
              if (p) showToast(`${newRoom.managers[newPicked[pid]]} mem-pick ${p.name} (${p.position})`);
            }
          }
        }
      } catch (err) {
        console.error("Error processing toast:", err);
      }
    });
  }
}

function showRoom() { $('lobby').classList.add('hidden'); $('roomView').classList.remove('hidden'); }
function showLobby() { $('lobby').classList.remove('hidden'); $('roomView').classList.add('hidden'); }

function leaveRoom(reset=true) {
  if (appState.unsubscribe) appState.unsubscribe();
  appState.unsubscribe = null;
  if (appState.matchInterval) clearInterval(appState.matchInterval);
  appState.liveMatchActive = false;
  if (reset) { appState.code = ''; appState.seat = ''; appState.room = null; appState.offline = false; appState.activeSlot = null; }
  showLobby(); renderAll();
}

function checkFormationModal() {
  const r = appState.room;
  if (!r) return;
  const modal = $('formationModal');
  const title = modal.querySelector('h2');
  
  if (r.status !== 'lobby') {
    modal.classList.add('hidden');
    return;
  }

  if (appState.offline) {
    if (!r.formations.A) {
      title.textContent = `${r.managers.A}: Pilih Formasi`;
      modal.classList.remove('hidden');
    } else if (!r.formations.B) {
      title.textContent = `${r.managers.B}: Pilih Formasi`;
      modal.classList.remove('hidden');
    } else {
      modal.classList.add('hidden');
    }
  } else {
    if (appState.seat === 'SPECTATOR') {
      modal.classList.add('hidden');
    } else if (!r.formations[appState.seat]) {
      title.textContent = `Pilih Formasi Kamu`;
      modal.classList.remove('hidden');
    } else {
      modal.classList.add('hidden');
    }
  }
}

async function confirmFormation() {
  if (!appState.selectedFormationCode) return;
  const r = appState.room;
  const code = appState.selectedFormationCode;
  
  if (appState.offline) {
    if (!r.formations.A) {
      r.formations.A = code;
    } else if (!r.formations.B) {
      r.formations.B = code;
    }
    appState.selectedFormationCode = '';
    document.querySelectorAll('.formation-btn').forEach(b => b.classList.remove('selected'));
    $('confirmFormationBtn').disabled = true;
    checkFormationModal();
    renderAll();
  } else {
    const seat = appState.seat;
    if (seat === 'A' || seat === 'B') {
      await updateRoom({ [`formations/${seat}`]: code, updatedAt: Date.now() });
      appState.selectedFormationCode = '';
      document.querySelectorAll('.formation-btn').forEach(b => b.classList.remove('selected'));
      $('confirmFormationBtn').disabled = true;
    }
  }
}

async function startDraft() {
  const room = appState.room;
  if (!room) return;
  if (appState.seat !== 'A' && !appState.offline) { setStatus('Hanya host bisa start draft.'); return; }
  if (!room.formations.A || !room.formations.B) { setStatus('Semua manager harus pilih formasi dulu.'); return; }
  await updateRoom({ status:'draft', turn:'A', result:null, updatedAt: Date.now() });
}

async function updateRoom(patch) {
  if (appState.offline) {
    appState.room = deepMerge(appState.room, patch);
    renderAll(); return;
  }
  if (!fb || !appState.code) return;
  await fb.update(fb.ref(fb.db, `rooms/${appState.code}`), flattenPatch(patch));
}

function flattenPatch(obj, prefix='', out={}) {
  for (const [k,v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}/${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flattenPatch(v, path, out);
    else out[path] = v;
  }
  return out;
}

function deepMerge(base, patch) {
  const out = structuredClone(base || {});
  for (const [k,v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = deepMerge(out[k] || {}, v);
    else out[k] = v;
  }
  return out;
}

async function pickPlayer(playerId) {
  const room = appState.room;
  if (!room || room.status !== 'draft') return;
  
  const seat = appState.offline ? room.turn : appState.seat;
  if (seat !== room.turn && !appState.offline) return;
  
  const p = roster.find(x => x.id === playerId);
  if (!p) return;
  if (room.picked?.[playerId]) return;
  
  // Need to place in activeSlot
  if (!appState.activeSlot || !appState.activeSlot.startsWith(seat + '-')) {
    alert('Pilih posisi kosong di lapanganmu terlebih dahulu!');
    return;
  }
  
  const slotIdx = parseInt(appState.activeSlot.split('-')[1], 10);
  const formationCode = room.formations[seat];
  const requiredPos = FORMATIONS[formationCode][slotIdx].pos;
  
  if (p.position !== requiredPos) {
    alert(`Posisi tidak cocok! Slot ini untuk ${requiredPos}, tapi pemain ini ${p.position}.`);
    return;
  }

  if (room.teams?.[seat]?.[slotIdx]) return; // slot filled

  if (appState.offline) {
    applyPickLocal(playerId, seat, slotIdx);
    appState.activeSlot = null;
    renderAll();
    return;
  }

  const roomRef = fb.ref(fb.db, `rooms/${appState.code}`);
  await fb.runTransaction(roomRef, (current) => {
    if (!current) return current;
    if (current.status !== 'draft') {
      console.log("[Transaction] Ditolak: status bukan draft");
      return current;
    }
    if (current.turn !== seat) {
      console.log("[Transaction] Ditolak: bukan giliran seat", seat);
      return current;
    }
    
    current.teams = current.teams || {A:{}, B:{}};
    current.teams.A = current.teams.A || {}; 
    current.teams.B = current.teams.B || {};
    current.picked = current.picked || {};
    
    if (current.picked[playerId]) {
      console.log("[Transaction] Ditolak: pemain sudah dipick");
      return current;
    }
    if (current.teams[seat][slotIdx]) {
      console.log("[Transaction] Ditolak: slot sudah terisi");
      return current;
    }
    
    current.teams[seat][slotIdx] = playerId;
    current.picked[playerId] = seat;
    current.result = null;
    current.turn = nextTurn(current);
    
    const aLen = Object.values(current.teams.A).filter(Boolean).length;
    const bLen = Object.values(current.teams.B).filter(Boolean).length;
    if (aLen >= 11 && bLen >= 11) {
      current.status = 'ready';
    }
    current.updatedAt = Date.now();
    
    return current;
  });
  appState.activeSlot = null;
}

function applyPickLocal(playerId, seat, slotIdx) {
  const r = appState.room;
  r.teams ||= {A:{}, B:{}};
  r.picked ||= {};
  if (r.picked[playerId]) return;
  r.teams[seat][slotIdx] = playerId;
  r.picked[playerId] = seat;
  r.result = null;
  r.turn = nextTurn(r);
  r.teams.A ||= {};
  r.teams.B ||= {};
  const aLen = Object.values(r.teams.A).filter(Boolean).length;
  const bLen = Object.values(r.teams.B).filter(Boolean).length;
  if (aLen >= 11 && bLen >= 11) {
    r.status = 'ready';
  }
}

function nextTurn(room) {
  const a = Object.values(room.teams?.A || {}).filter(Boolean).length;
  const b = Object.values(room.teams?.B || {}).filter(Boolean).length;
  if (a >= 11 && b >= 11) return room.turn || 'A';
  const other = room.turn === 'A' ? 'B' : 'A';
  if (Object.values(room.teams?.[other] || {}).filter(Boolean).length < 11) return other;
  return Object.values(room.teams?.A || {}).filter(Boolean).length < 11 ? 'A' : 'B';
}

async function autoPick() {
  const room = appState.room;
  if (!room || room.status !== 'draft') return;
  const seat = appState.offline ? room.turn : appState.seat;
  if (seat !== room.turn && !appState.offline) return;
  
  const formationCode = room.formations[seat];
  const slots = FORMATIONS[formationCode];
  
  // Find first empty slot
  let emptyIdx = -1;
  let requiredPos = '';
  for (let i = 0; i < 11; i++) {
    if (!room.teams?.[seat]?.[i]) {
      emptyIdx = i;
      requiredPos = slots[i].pos;
      break;
    }
  }
  
  if (emptyIdx === -1) return; // Full
  
  appState.activeSlot = `${seat}-${emptyIdx}`; // Set active slot automatically for auto pick
  
  const available = roster
    .filter(p => !room.picked?.[p.id] && p.position === requiredPos)
    .sort((a,b) => b.rating - a.rating);
    
  if (available[0]) await pickPlayer(available[0].id);
}

async function simulateMatch() {
  const room = appState.room;
  if (!room) return;
  const A = Object.values(room.teams?.A || {}).map(id => roster.find(p => p.id === id)).filter(Boolean);
  const B = Object.values(room.teams?.B || {}).map(id => roster.find(p => p.id === id)).filter(Boolean);
  if (A.length < 11 || B.length < 11) { setStatus('Draft belum lengkap.'); return; }
  
  const result = generateMatchEvents(A, B, room.managers?.A || 'Manager A', room.managers?.B || 'Manager B');
  await updateRoom({ result, status: 'playing', updatedAt: Date.now() });
}

function generateMatchEvents(A, B, nameA, nameB) {
  const powerA = teamPower(A);
  const powerB = teamPower(B);
  const diff = powerA - powerB;
  const baseA = 1.15 + diff / 30 + Math.random() * 1.4;
  const baseB = 1.15 - diff / 30 + Math.random() * 1.4;
  const scoreA = clamp(Math.round(baseA + Math.random()), 0, 6);
  const scoreB = clamp(Math.round(baseB + Math.random()), 0, 6);
  const winner = scoreA === scoreB ? 'Draw' : (scoreA > scoreB ? nameA : nameB);
  
  const events = [];
  let shotsA = scoreA + Math.floor(Math.random() * 6);
  let shotsB = scoreB + Math.floor(Math.random() * 6);

  for (let i = 0; i < scoreA; i++) {
    const min = Math.floor(Math.random() * 90) + 1;
    const scorer = A[Math.floor(Math.random() * A.length)]?.name || 'Pemain A';
    events.push({ min, team: 'A', type: 'goal', msg: `GOAL! ${scorer} merobek gawang!` });
  }
  for (let i = 0; i < scoreB; i++) {
    const min = Math.floor(Math.random() * 90) + 1;
    const scorer = B[Math.floor(Math.random() * B.length)]?.name || 'Pemain B';
    events.push({ min, team: 'B', type: 'goal', msg: `GOAL! ${scorer} memecah kebuntuan!` });
  }

  for (let i = 0; i < shotsA - scoreA; i++) {
    const min = Math.floor(Math.random() * 90) + 1;
    const shooter = A[Math.floor(Math.random() * A.length)]?.name || 'Pemain A';
    events.push({ min, team: 'A', type: 'shot', msg: `Tembakan meleset dari ${shooter}.` });
  }
  for (let i = 0; i < shotsB - scoreB; i++) {
    const min = Math.floor(Math.random() * 90) + 1;
    const shooter = B[Math.floor(Math.random() * B.length)]?.name || 'Pemain B';
    events.push({ min, team: 'B', type: 'shot', msg: `Peluang ${shooter} berhasil digagalkan kiper.` });
  }

  events.sort((a,b) => a.min - b.min);

  return { finalScoreA: scoreA, finalScoreB: scoreB, events, winner, simulatedAt: Date.now() };
}

function teamPower(team) {
  const avg = team.reduce((s,p)=>s+p.rating,0) / Math.max(1, team.length);
  return avg + Math.random() * 3;
}

function clamp(n,min,max){return Math.max(min,Math.min(max,n));}

function renderLobbyStats() {
  $('statPlayers').textContent = roster.length;
  $('statClubs').textContent = new Set(roster.map(p => p.club)).size;
}

function renderAll() {
  renderHeader();
  renderTeams();
  renderPlayers();
  renderResult();
}

function renderHeader() {
  const room = appState.room;
  $('roomLabel').textContent = room ? `Room ${room.code}` : 'Belum masuk room';
  if (!room) return;
  $('codeText').textContent = room.code;
  $('seatText').textContent = appState.offline ? 'Offline' : (appState.seat === 'SPECTATOR' ? 'Penonton (Hanya Melihat)' : `Manager ${appState.seat}`);
  
  let statusDisplay = 'Lobby';
  if (room.status === 'draft') statusDisplay = 'Draft';
  if (room.status === 'ready') statusDisplay = 'Siap Simulasi';
  if (room.status === 'playing') statusDisplay = 'Live Match';
  if (room.status === 'complete') statusDisplay = 'Selesai';
  $('statusText').textContent = statusDisplay;

  $('managerAName').textContent = room.managers?.A || 'Manager A';
  $('managerBName').textContent = room.managers?.B || 'Menunggu B';
  $('managerAFormation').textContent = room.formations?.A || 'Formasi?';
  $('managerBFormation').textContent = room.formations?.B || 'Formasi?';
  
  const turnName = room.turn === 'A' ? room.managers?.A : room.managers?.B;
  if (room.status === 'lobby') $('turnText').textContent = 'Menunggu formasi & host start';
  else if (room.status === 'playing' || room.status === 'complete') $('turnText').textContent = 'Match Center';
  else if (room.status === 'ready') $('turnText').textContent = 'Draft Selesai, Siap Simulasi';
  else $('turnText').textContent = `Giliran ${turnName || `Manager ${room.turn}`}`;
  
  const canStart = room.formations?.A && room.formations?.B && room.status === 'lobby';
  $('startDraftBtn').disabled = (!appState.offline && appState.seat !== 'A') || !canStart;
  $('simulateBtn').disabled = !room || room.status === 'playing' || room.status === 'complete' || Object.keys(room.teams?.A||{}).length < 11 || Object.keys(room.teams?.B||{}).length < 11;
  
  const isMyTurn = (!appState.offline && appState.seat === room.turn) || (appState.offline && room.turn);
  $('autoPickBtn').disabled = !room || room.status !== 'draft' || appState.seat === 'SPECTATOR' || !isMyTurn;
}

function renderTeams() {
  const room = appState.room;
  if (!room) return;

  const panelA = $('teamAPanel');
  const panelB = $('teamBPanel');
  
  if (!appState.offline && room.status === 'draft' && appState.seat !== 'SPECTATOR') {
    if (appState.seat === 'A') {
      panelA.style.display = 'block';
      panelB.style.display = 'none';
    } else if (appState.seat === 'B') {
      panelA.style.display = 'none';
      panelB.style.display = 'block';
    }
  } else {
    panelA.style.display = 'block';
    panelB.style.display = 'block';
  }

  renderPitch('A', $('pitchA'), $('teamACount'));
  renderPitch('B', $('pitchB'), $('teamBCount'));
}

function renderPitch(seat, container, countEl) {
  const room = appState.room;
  const formationCode = room.formations?.[seat];
  const teamObj = room.teams?.[seat] || {};
  const count = Object.keys(teamObj).length;
  countEl.textContent = `${count}/11`;
  
  const isMyTurn = (appState.offline && room.turn === seat) || (!appState.offline && appState.seat === seat && room.turn === seat);
  
  if (!isMyTurn || room.status !== 'draft') {
    container.classList.add('disabled');
  } else {
    container.classList.remove('disabled');
  }

  if (!formationCode) {
    container.innerHTML = '<div style="color:var(--muted);text-align:center;margin-top:50%;">Menunggu formasi...</div>';
    return;
  }
  
  const slots = FORMATIONS[formationCode];
  const html = slots.map((s, idx) => {
    const slotId = `${seat}-${idx}`;
    const playerId = teamObj[idx];
    const p = playerId ? roster.find(x => x.id === playerId) : null;
    const isActive = appState.activeSlot === slotId;
    const isFilled = !!p;
    
    let content = `<div class="pos-label">${s.pos}</div>`;
    if (p) {
      content = `
        <div class="p-rating">${p.rating}</div>
        <div class="p-name">${escapeHtml(p.name)}</div>
      `;
    }
    
    return `<div class="slot ${isActive ? 'active' : ''} ${isFilled ? 'filled' : ''}" 
                 data-slotid="${slotId}" 
                 style="left: ${s.x}%; top: ${s.y}%;">
              ${content}
            </div>`;
  }).join('');
  
  container.innerHTML = html;
  
  container.querySelectorAll('.slot').forEach(el => {
    const slotId = el.dataset.slotid;
    const isFilled = el.classList.contains('filled');
    
    if (isMyTurn && room.status === 'draft' && !isFilled) {
      el.addEventListener('click', () => {
        appState.activeSlot = appState.activeSlot === slotId ? null : slotId;
        renderAll();
      });
    }
  });
}

function getVisiblePlayers() {
  const room = appState.room;
  const picked = room?.picked || {};
  const q = $('searchInput').value.trim().toLowerCase();
  
  // Filter by active slot position if set
  let requiredPos = 'ALL';
  if (appState.activeSlot) {
    const [seat, idx] = appState.activeSlot.split('-');
    const formationCode = room.formations[seat];
    if (formationCode) requiredPos = FORMATIONS[formationCode][parseInt(idx)].pos;
  }
  
  const pos = requiredPos !== 'ALL' ? requiredPos : $('posFilter').value;
  
  if (requiredPos !== 'ALL') {
    $('posFilter').value = requiredPos;
    $('posFilter').disabled = true;
  } else {
    $('posFilter').disabled = false;
  }

  const sort = $('sortSelect').value;
  let out = roster.filter(p => {
    const hay = `${p.name} ${p.club} ${p.country} ${p.position} ${p.trait}`.toLowerCase();
    return (pos === 'ALL' || p.position === pos) && (!q || hay.includes(q));
  });
  if (sort === 'rating') out.sort((a,b)=>b.rating-a.rating || a.name.localeCompare(b.name));
  if (sort === 'name') out.sort((a,b)=>a.name.localeCompare(b.name));
  if (sort === 'club') out.sort((a,b)=>a.club.localeCompare(b.club) || a.name.localeCompare(b.name));
  return out.map(p => ({...p, pickedBy: picked[p.id] || ''}));
}

function renderPlayers() {
  const grid = $('playerGrid');
  if (!grid) return;
  const room = appState.room;
  const infoEl = $('renderCountInfo');
  
  if (!room) { grid.innerHTML = ''; if(infoEl) infoEl.textContent=''; return; }
  
  const canPick = room.status === 'draft' && (appState.offline || appState.seat === room.turn);
  const visible = getVisiblePlayers();
  if (!visible.length) { grid.innerHTML = '<p class="muted">Tidak ada pemain cocok.</p>'; if(infoEl) infoEl.textContent=''; return; }
  
  const q = $('searchInput').value.trim();
  const limit = q.length > 0 ? 600 : 260;
  const rendered = visible.slice(0, limit);
  
  if (infoEl) {
    if (visible.length > limit) {
      infoEl.textContent = `Menampilkan ${limit} dari ${visible.length} pemain. Gunakan pencarian untuk hasil lebih spesifik.`;
    } else {
      infoEl.textContent = `Menampilkan ${visible.length} pemain.`;
    }
  }
  
  grid.innerHTML = rendered.map(p => `
    <article class="player-card ${p.pickedBy ? 'picked' : ''}">
      <div class="player-top">
        <div>
          <div class="player-name">${escapeHtml(p.name)}</div>
          <div class="player-meta"><span class="pos">${p.position}</span> · ${escapeHtml(p.country || 'Unknown')}</div>
        </div>
        <div class="rating">${p.rating}</div>
      </div>
      <div class="player-club">${escapeHtml(p.club)} · ${escapeHtml(p.trait)}</div>
      <button class="primary" data-id="${escapeAttr(p.id)}" ${!canPick || p.pickedBy ? 'disabled' : ''}>${p.pickedBy ? `Dipilih ${p.pickedBy}` : 'Pick'}</button>
    </article>
  `).join('');
  
  grid.querySelectorAll('button[data-id]').forEach(btn => btn.addEventListener('click', () => pickPlayer(btn.dataset.id)));
}

function renderResult() {
  const box = $('resultBox');
  const r = appState.room?.result;
  if (!r) { box.classList.add('hidden'); return; }
  
  box.classList.remove('hidden');
  
  $('scoreNameA').textContent = appState.room.managers?.A || 'Manager A';
  $('scoreNameB').textContent = appState.room.managers?.B || 'Manager B';
  
  if (appState.room.status === 'playing') {
    if (!appState.liveMatchActive) {
      startLiveMatch(r);
    }
  } else if (appState.room.status === 'complete') {
    // If completed, just show final state directly without interval
    $('scoreValA').textContent = r.finalScoreA;
    $('scoreValB').textContent = r.finalScoreB;
    $('matchClock').textContent = "90'";
    $('matchStatus').textContent = "FULL TIME";
    $('shotsA').textContent = r.events.filter(e => e.team === 'A').length;
    $('shotsB').textContent = r.events.filter(e => e.team === 'B').length;
    
    const logBox = $('matchLog');
    logBox.innerHTML = r.events.map(e => `<div class="${e.type === 'goal' ? 'log-goal' : ''}">${e.min}' - ${escapeHtml(e.msg)}</div>`).reverse().join('') + '<div>Kick off dimulai!</div>';
  }
}

function startLiveMatch(r) {
  appState.liveMatchActive = true;
  let currentMin = 0;
  let currentScoreA = 0;
  let currentScoreB = 0;
  let currentShotsA = 0;
  let currentShotsB = 0;
  
  const logBox = $('matchLog');
  logBox.innerHTML = '<div>Kick off dimulai!</div>';
  
  if (appState.matchInterval) clearInterval(appState.matchInterval);
  
  appState.matchInterval = setInterval(() => {
    currentMin++;
    $('matchClock').textContent = `${currentMin}'`;
    $('matchStatus').textContent = currentMin > 45 ? "2nd Half" : "1st Half";
    
    const minEvents = r.events.filter(e => e.min === currentMin);
    minEvents.forEach(e => {
      if (e.team === 'A') currentShotsA++;
      else currentShotsB++;
      
      if (e.type === 'goal') {
        if (e.team === 'A') currentScoreA++;
        else currentScoreB++;
      }
      
      const div = document.createElement('div');
      if (e.type === 'goal') div.className = 'log-goal';
      div.textContent = `${e.min}' - ${e.msg}`;
      logBox.prepend(div);
    });
    
    $('scoreValA').textContent = currentScoreA;
    $('scoreValB').textContent = currentScoreB;
    $('shotsA').textContent = currentShotsA;
    $('shotsB').textContent = currentShotsB;
    
    if (currentMin >= 90) {
      clearInterval(appState.matchInterval);
      appState.liveMatchActive = false;
      $('matchStatus').textContent = "FULL TIME";
      if (appState.offline || appState.seat === 'A') {
         updateRoom({ status: 'complete' });
      }
    }
  }, 166);
}

function copyCode() {
  if (!appState.code) return;
  navigator.clipboard?.writeText(appState.code);
  setStatus(`Kode ${appState.code} dicopy.`);
}

function setStatus(msg) { $('lobbyStatus').textContent = msg; }
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function escapeAttr(s) { return escapeHtml(s).replace(/'/g, '&#39;'); }

function showToast(msg) {
  try {
    let container = $('toastContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toastContainer';
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<div class="toast-title">Pick Lawan</div>${msg}`;
    container.appendChild(toast);
    console.log("[Toast]", msg);
    setTimeout(() => { if (toast.parentNode) toast.remove(); }, 2000);
  } catch (err) {
    console.error("Toast error:", err);
  }
}

document.addEventListener('DOMContentLoaded', init);

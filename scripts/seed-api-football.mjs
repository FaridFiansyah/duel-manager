import fs from 'fs';
import path from 'path';
import https from 'https';

const ROOT = process.cwd();
const ENV = loadEnv(path.join(ROOT, '.env'));
const API_KEY = ENV.API_FOOTBALL_KEY;
const HOST = ENV.API_FOOTBALL_HOST || 'v3.football.api-sports.io';
const SEASON = Number(ENV.API_FOOTBALL_SEASON || 2025);
const TARGETS_FILE = path.join(ROOT, 'data', 'api-football-targets.json');
const OUT_FILE = path.join(ROOT, 'public', 'data', 'players.snapshot.json');
const RATE_DELAY_MS = Number(ENV.API_FOOTBALL_DELAY_MS || 900);

if (!API_KEY || API_KEY === 'isi_api_key_kamu') {
  console.error('ERROR: isi API_FOOTBALL_KEY di file .env dulu. Lihat .env.example');
  process.exit(1);
}

const targets = JSON.parse(fs.readFileSync(TARGETS_FILE, 'utf8'));
const seasonsToTry = unique([SEASON, targets.defaultSeason, 2025, 2024, 2023].filter(Boolean));
const allPlayers = [];
const resolvedTeams = [];
const failedTeams = [];

console.log(`Seed API-Football: ${targets.teams.length} klub target, season utama ${SEASON}`);
console.log('Catatan: satu klub biasanya butuh 2 request: resolve ID + ambil squad. Perhatikan quota API kamu.\n');

for (const target of targets.teams) {
  try {
    const resolved = await resolveTeam(target);
    if (!resolved) {
      failedTeams.push({ target, reason: 'Team senior tidak ditemukan' });
      console.warn(`SKIP: ${target.name} tidak ditemukan`);
      continue;
    }
    resolvedTeams.push(resolved);
    console.log(`OK team: ${target.name} -> ${resolved.name} #${resolved.id}, season ${resolved.season}`);
    await sleep(RATE_DELAY_MS);
    const squad = await fetchSquad(resolved.id);
    console.log(`   squad: ${squad.length} pemain`);
    allPlayers.push(...squad.map((p) => normalizePlayer(p, resolved)));
    await sleep(RATE_DELAY_MS);
  } catch (err) {
    failedTeams.push({ target, reason: err.message });
    console.warn(`FAIL: ${target.name} -> ${err.message}`);
  }
}

const players = dedupePlayers(allPlayers).sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name));
fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
fs.writeFileSync(OUT_FILE, JSON.stringify({
  meta: {
    source: 'api-football',
    generatedAt: new Date().toISOString(),
    seasonTried: seasonsToTry,
    clubsResolved: resolvedTeams.length,
    clubsFailed: failedTeams.length,
    count: players.length,
    note: 'Data squad diambil dari API-Football. Rating adalah estimasi gameplay buatan script, bukan rating resmi EA/Football Manager.'
  },
  resolvedTeams,
  failedTeams,
  players
}, null, 2));

console.log('\nSELESAI');
console.log(`Pemain tersimpan: ${players.length}`);
console.log(`File: ${OUT_FILE}`);
if (failedTeams.length) {
  console.log('\nTim gagal ditemukan:');
  failedTeams.forEach((f) => console.log(`- ${f.target.name}: ${f.reason}`));
}

function loadEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  const text = fs.readFileSync(file, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx < 0) continue;
    const k = trimmed.slice(0, idx).trim();
    let v = trimmed.slice(idx + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[k] = v;
  }
  return out;
}

function unique(arr) { return [...new Set(arr)]; }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function resolveTeam(target) {
  for (const season of seasonsToTry) {
    for (const withLeague of [true, false]) {
      const params = new URLSearchParams();
      params.set('search', target.name);
      if (withLeague && target.league) params.set('league', String(target.league));
      params.set('season', String(season));
      const json = await apiGet(`/teams?${params.toString()}`);
      const list = Array.isArray(json.response) ? json.response : [];
      const picked = pickSeniorTeam(list, target);
      if (picked) {
        return {
          id: picked.team.id,
          name: picked.team.name,
          country: picked.team.country || target.country || '',
          logo: picked.team.logo || '',
          league: withLeague ? (target.league || null) : null,
          season
        };
      }
      await sleep(RATE_DELAY_MS);
      if (!target.league) break;
    }
  }
  return null;
}

function pickSeniorTeam(list, target) {
  const bad = /(u19|u20|u21|u23|women|w\b|ii\b|b\b|reserves|academy|youth|castilla)/i;
  const normTarget = normalizeName(target.name);
  const exact = list.find((x) => x.team && normalizeName(x.team.name) === normTarget && !bad.test(x.team.name));
  if (exact) return exact;
  const contains = list.find((x) => x.team && normalizeName(x.team.name).includes(normTarget) && !bad.test(x.team.name));
  if (contains) return contains;
  return list.find((x) => x.team && !bad.test(x.team.name)) || null;
}

async function fetchSquad(teamId) {
  const json = await apiGet(`/players/squads?team=${encodeURIComponent(teamId)}`);
  const response = Array.isArray(json.response) ? json.response : [];
  const players = [];
  for (const entry of response) {
    const teamName = entry.team?.name || `Team ${teamId}`;
    const teamIdFromApi = entry.team?.id || teamId;
    const teamLogo = entry.team?.logo || '';
    const squad = Array.isArray(entry.players) ? entry.players : [];
    for (const p of squad) players.push({ ...p, teamName, teamId: teamIdFromApi, teamLogo });
  }
  return players;
}

function apiGet(pathname) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: HOST,
      path: pathname,
      method: 'GET',
      headers: { 'x-apisports-key': API_KEY }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data || '{}');
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
            return;
          }
          if (json.errors && Object.keys(json.errors).length) {
            reject(new Error(`API error: ${JSON.stringify(json.errors)}`));
            return;
          }
          resolve(json);
        } catch (err) {
          reject(new Error(`Gagal parse JSON: ${err.message}`));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function normalizeName(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function normalizePosition(raw) {
  const p = String(raw || '').toLowerCase();
  if (p.includes('goal') || p === 'gk') return 'GK';
  if (/(back|def|cb|lb|rb|lwb|rwb)/.test(p)) return 'DEF';
  if (/(mid|cm|dm|am|winger)/.test(p)) return 'MID';
  if (/(att|forward|striker|fw|st|left winger|right winger)/.test(p)) return 'FWD';
  return 'MID';
}

function normalizePlayer(p, team) {
  const pos = normalizePosition(p.position);
  const name = String(p.name || 'Unknown Player').trim();
  return {
    id: `api-football-${p.id || stableId(name + team.id)}`,
    providerId: p.id || null,
    source: 'api-football',
    name,
    position: pos,
    rawPosition: p.position || pos,
    club: team.name || p.teamName || '',
    clubId: team.id,
    clubLogo: team.logo || p.teamLogo || '',
    country: p.nationality || '',
    age: p.age || null,
    number: p.number || null,
    photo: p.photo || '',
    rating: estimateRating(name, pos, team.name),
    trait: traitFromPosition(pos, name),
    updatedAt: new Date().toISOString()
  };
}

function estimateRating(name, pos, club) {
  const text = `${name}|${pos}|${club}`;
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  const base = { GK: 72, DEF: 72, MID: 73, FWD: 73 }[pos] || 72;
  const clubBoost = /(Real Madrid|Barcelona|Manchester City|Liverpool|Arsenal|Bayern|Paris|Inter|Juventus|AC Milan)/i.test(club) ? 5 : 2;
  return Math.max(60, Math.min(94, base + clubBoost + Math.abs(hash % 15)));
}

function traitFromPosition(pos, seed) {
  const pools = {
    GK: ['Reflex', 'Shot Stopper', 'Sweeper Keeper', 'Penalty Saver'],
    DEF: ['Tackler', 'Aerial Wall', 'Ball Playing Defender', 'Recovery Pace'],
    MID: ['Playmaker', 'Box-to-Box', 'Tempo Setter', 'Press Resistant'],
    FWD: ['Finisher', 'Explosive', 'Inside Forward', 'Poacher']
  };
  const arr = pools[pos] || pools.MID;
  let h = 0;
  for (let i = 0; i < String(seed).length; i++) h = ((h << 5) - h + String(seed).charCodeAt(i)) | 0;
  return arr[Math.abs(h) % arr.length];
}

function stableId(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

function dedupePlayers(players) {
  const map = new Map();
  for (const p of players) {
    const key = `${normalizeName(p.name)}|${normalizeName(p.club)}`;
    if (!map.has(key)) map.set(key, p);
  }
  return [...map.values()];
}

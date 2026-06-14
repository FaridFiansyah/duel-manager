import fs from 'fs';
import path from 'path';

function loadEnv() {
  try {
    const envFile = fs.readFileSync('.env', 'utf-8');
    for (const line of envFile.split('\n')) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        let key = match[1];
        let value = match[2] || '';
        value = value.replace(/^['"](.*)['"]$/, '$1').trim();
        process.env[key] = value;
      }
    }
  } catch (err) {
    console.warn("No .env file found or could not read, continuing with existing process.env");
  }
}

loadEnv();

const API_KEY = process.env.API_FOOTBALL_KEY;
const API_HOST = process.env.API_FOOTBALL_HOST || 'v3.football.api-sports.io';
const SEASON = process.env.API_FOOTBALL_SEASON || '2023';
const DELAY_MS = parseInt(process.env.API_FOOTBALL_DELAY_MS || '1100');
const MAX_TEAMS = parseInt(process.env.API_FOOTBALL_MAX_TEAMS || '30');
const START_INDEX = parseInt(process.env.API_FOOTBALL_START_INDEX || '0');
const MERGE_PREVIOUS = process.env.API_FOOTBALL_MERGE_PREVIOUS === 'true';

if (!API_KEY || API_KEY === 'isi_api_key_kamu') {
  console.error("Error: API_FOOTBALL_KEY is invalid or missing in .env");
  process.exit(1);
}

const LEAGUES_FILE = process.argv[2];
if (!LEAGUES_FILE) {
  console.error("Usage: node seed-api-football-leagues.mjs <path-to-leagues.json>");
  process.exit(1);
}

const DATA_DIR = path.resolve('public/data');
const CACHE_DIR = path.resolve('data/cache');
const OUTPUT_FILE = path.join(DATA_DIR, 'players.snapshot.json');

if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

async function apiFetch(endpoint) {
  const url = `https://${API_HOST}${endpoint}`;
  console.log(`[API] Fetching ${endpoint}`);
  const res = await fetch(url, {
    headers: {
      'x-rapidapi-host': API_HOST,
      'x-rapidapi-key': API_KEY
    }
  });
  if (!res.ok) throw new Error(`API Error: ${res.status} ${res.statusText}`);
  const data = await res.json();
  if (data.errors && Object.keys(data.errors).length > 0) {
    console.error("API Error Response:", data.errors);
    if (data.errors.requests) throw new Error("Quota exceeded or rate limit");
  }
  return data;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizePosition(apiPos) {
  if (!apiPos) return 'MID';
  const p = apiPos.toLowerCase();
  if (p === 'goalkeeper') return 'GK';
  if (p === 'defender') return 'DEF';
  if (p === 'midfielder') return 'MID';
  if (p === 'attacker') return 'FWD';
  return 'MID';
}

function estimateRating(playerAge, teamId) {
  // Simple heuristic just for fun since API-Football doesn't give FIFA-like ratings in squad endpoint
  const base = 70;
  const ageFactor = (playerAge > 24 && playerAge < 32) ? 5 : (playerAge >= 32 ? 2 : 0);
  const randomFactor = Math.floor(Math.random() * 10);
  return Math.min(99, base + ageFactor + randomFactor);
}

function isValidTeamName(name) {
  const n = name.toLowerCase();
  const invalid = ['u19', 'u20', 'u21', 'u23', 'women', ' ii', ' b ', 'academy', 'youth', 'reserves'];
  for (const inv of invalid) {
    if (n.includes(inv)) return false;
  }
  return true;
}

async function getTeamsForLeague(leagueId) {
  const cacheFile = path.join(CACHE_DIR, `teams-${leagueId}-${SEASON}.json`);
  if (fs.existsSync(cacheFile)) {
    return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  }
  const data = await apiFetch(`/teams?league=${leagueId}&season=${SEASON}`);
  const teams = data.response || [];
  fs.writeFileSync(cacheFile, JSON.stringify(teams, null, 2));
  await sleep(DELAY_MS);
  return teams;
}

async function getSquadForTeam(teamId) {
  const cacheFile = path.join(CACHE_DIR, `squad-${teamId}.json`);
  if (fs.existsSync(cacheFile)) {
    return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  }
  const data = await apiFetch(`/players/squads?team=${teamId}`);
  const squad = data.response[0]?.players || [];
  fs.writeFileSync(cacheFile, JSON.stringify(squad, null, 2));
  await sleep(DELAY_MS);
  return squad;
}

async function main() {
  const leagueIds = JSON.parse(fs.readFileSync(path.resolve(LEAGUES_FILE), 'utf8'));
  console.log(`Loading leagues: ${leagueIds.join(', ')}`);

  let allTeams = [];
  for (const lid of leagueIds) {
    try {
      const teamsData = await getTeamsForLeague(lid);
      const validTeams = teamsData.filter(t => t.team && isValidTeamName(t.team.name));
      allTeams.push(...validTeams.map(t => ({ id: t.team.id, name: t.team.name, league: lid })));
    } catch (e) {
      console.error(`Failed to get teams for league ${lid}: ${e.message}`);
      if (e.message.includes("Quota")) process.exit(1);
    }
  }

  console.log(`Total valid teams found across leagues: ${allTeams.length}`);
  
  const teamsToProcess = allTeams.slice(START_INDEX, START_INDEX + MAX_TEAMS);
  console.log(`Processing ${teamsToProcess.length} teams (Index ${START_INDEX} to ${START_INDEX + MAX_TEAMS - 1})...`);

  const newPlayersMap = new Map();

  let processedCount = 0;
  for (const t of teamsToProcess) {
    try {
      console.log(`[${processedCount+1}/${teamsToProcess.length}] Fetching squad for ${t.name} (ID: ${t.id})...`);
      const squad = await getSquadForTeam(t.id);
      
      for (const p of squad) {
        if (!p.id || !p.name) continue;
        const pid = `api-${p.id}`;
        newPlayersMap.set(pid, {
          id: pid,
          name: p.name,
          position: normalizePosition(p.position),
          rawPosition: p.position || 'Unknown',
          club: t.name,
          league: t.league,
          country: '',
          rating: estimateRating(p.age, t.id),
          trait: 'Standard',
          source: 'api-football'
        });
      }
      processedCount++;
    } catch (e) {
      console.error(`Failed to fetch squad for team ${t.name}: ${e.message}`);
      if (e.message.includes("Quota") || e.message.includes("rate limit")) {
        console.log(`\n--- QUOTA EXCEEDED ---`);
        console.log(`Please continue tomorrow by setting API_FOOTBALL_START_INDEX=${START_INDEX + processedCount} in .env`);
        break;
      }
    }
  }

  let finalPlayers = [];
  if (MERGE_PREVIOUS && fs.existsSync(OUTPUT_FILE)) {
    try {
      const existingData = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
      finalPlayers = existingData.players || [];
      console.log(`Loaded ${finalPlayers.length} existing players from snapshot.`);
    } catch (e) {
      console.warn("Could not parse existing snapshot, starting fresh.");
    }
  }

  const existingMap = new Map();
  for (const p of finalPlayers) {
    existingMap.set(p.id, p);
  }

  let added = 0;
  let updated = 0;

  for (const [id, p] of newPlayersMap.entries()) {
    if (existingMap.has(id)) {
      existingMap.set(id, { ...existingMap.get(id), ...p });
      updated++;
    } else {
      existingMap.set(id, p);
      added++;
    }
  }

  finalPlayers = Array.from(existingMap.values());

  const outputData = {
    meta: {
      generatedAt: new Date().toISOString(),
      count: finalPlayers.length,
      season: SEASON,
      teamsProcessed: processedCount,
      lastStartIndex: START_INDEX,
      source: 'api-football'
    },
    players: finalPlayers
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(outputData, null, 2));
  console.log(`\n=== SEED SUCCESS ===`);
  console.log(`Saved to ${OUTPUT_FILE}`);
  console.log(`Total players: ${finalPlayers.length} (Added: ${added}, Updated: ${updated})`);
  
  if (processedCount < teamsToProcess.length) {
    console.log(`Stopped early due to errors/quota. Next start index: ${START_INDEX + processedCount}`);
  } else if (START_INDEX + processedCount < allTeams.length) {
    console.log(`More teams available. To continue, set API_FOOTBALL_START_INDEX=${START_INDEX + processedCount} and run again.`);
  } else {
    console.log("All teams processed!");
  }
}

main().catch(console.error);

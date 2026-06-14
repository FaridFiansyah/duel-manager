import fs from 'fs';
import path from 'path';

const snapshotPath = path.resolve('public/data/players.snapshot.json');

console.log(`Validating ${snapshotPath}...`);

if (!fs.existsSync(snapshotPath)) {
  console.error("❌ File players.snapshot.json not found!");
  process.exit(1);
}

let data;
try {
  data = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
} catch (e) {
  console.error("❌ File is not valid JSON:", e.message);
  process.exit(1);
}

if (!data.players || !Array.isArray(data.players)) {
  console.error("❌ 'players' array is missing or not an array!");
  process.exit(1);
}

const players = data.players;
console.log(`Found ${players.length} players. Validating fields...`);

let errors = 0;
let validPositions = ['GK', 'DEF', 'MID', 'FWD'];

for (let i = 0; i < players.length; i++) {
  const p = players[i];
  const requiredFields = ['id', 'name', 'position', 'club', 'rating'];
  
  for (const f of requiredFields) {
    if (!p[f] && p[f] !== 0) {
      console.error(`❌ Player at index ${i} is missing required field '${f}':`, p);
      errors++;
    }
  }

  if (p.position && !validPositions.includes(p.position)) {
    console.error(`❌ Player at index ${i} has invalid position '${p.position}'. Must be one of ${validPositions.join(', ')}`);
    errors++;
  }
}

if (errors > 0) {
  console.error(`\n❌ Validation failed with ${errors} errors.`);
  process.exit(1);
}

console.log(`✅ Validation passed! Total players: ${players.length}`);
process.exit(0);

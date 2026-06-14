import { execSync } from 'child_process';
import path from 'path';

const leaguesFile = path.resolve('data/api-football-top5-leagues.json');
const scriptFile = path.resolve('scripts/seed-api-football-leagues.mjs');

console.log(`Starting Top 5 Leagues Seeding...`);
try {
  execSync(`node "${scriptFile}" "${leaguesFile}"`, { stdio: 'inherit' });
} catch (e) {
  console.error("Seeding failed or was interrupted.");
  process.exit(1);
}

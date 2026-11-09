#!/usr/bin/env node
// Run: npx wrangler r2 object put lingvo-tutor-data/words.csv --file=scripts/words.csv
// Or use: npm run seed  (which does the same thing)

const { execSync } = require('child_process');
const path = require('path');

const csvPath = path.join(__dirname, 'words.csv');
console.log('Uploading seed data to R2...');
try {
  execSync(`npx wrangler r2 object put lingvo-tutor-data/words.csv --file="${csvPath}"`, {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..')
  });
  console.log('Done! Seed data uploaded.');
} catch (e) {
  console.error('Failed. Make sure you have created the R2 bucket first:');
  console.error('  npx wrangler r2 bucket create lingvo-tutor-data');
  process.exit(1);
}

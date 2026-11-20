import { convertVenuePrefix, formatVenueConversion } from '../lib/storage/convert-venue-prefix';
import { isConflict } from '../lib/storage/batch';
import { neonHttp } from '../lib/storage/sql-client';

async function main() {
  if (process.env.VALET_CONVERT_VENUE !== '1') {
    console.error('Set VALET_CONVERT_VENUE=1 to opt in to the venue conversion.');
    process.exitCode = 1;
    return;
  }
  const { DATABASE_URL } = process.env;
  if (!DATABASE_URL) {
    console.error('Set DATABASE_URL in the environment before running the venue conversion.');
    process.exitCode = 1;
    return;
  }
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--dry-run')) {
    console.error('Usage: npm run db:convert-venue-prefix -- [--dry-run]');
    process.exitCode = 1;
    return;
  }
  const report = await convertVenuePrefix(neonHttp(DATABASE_URL), { dryRun: args.includes('--dry-run') });
  console.log(formatVenueConversion(report));
}

main().catch((error: unknown) => {
  console.error(isConflict(error)
    ? 'Venue conversion rolled back due to a concurrent change. Run another dry run before retrying.'
    : 'Venue conversion failed. Verify normalized storage and connection settings, then retry the dry run.');
  process.exitCode = 1;
});

import { loadEnvConfig } from '@next/env';
import { isStage } from '../lib/competition-record';
import { commitStageMerge, mergeReport, planStageMerge } from '../lib/storage/merge-stages';
import { readLegacyDocuments } from '../lib/storage/migrate-data';
import { loadCompetitions, loadStages } from '../lib/storage/rows';
import { neonHttp } from '../lib/storage/sql-client';
import { storageGate } from '../lib/storage/switch';

loadEnvConfig(process.cwd());

async function main() {
  if (process.env.VALET_MERGE_STAGES !== '1') {
    console.error('Refusing to merge stages. Set VALET_MERGE_STAGES=1 to opt in.');
    process.exitCode = 1;
    return;
  }
  if (!process.env.DATABASE_URL) {
    console.error('Set DATABASE_URL before running the stage merge.');
    process.exitCode = 1;
    return;
  }
  const sql = neonHttp(process.env.DATABASE_URL);
  const dryRun = process.argv.includes('--dry-run');
  const gate = await storageGate(sql);
  if (!dryRun && gate.mode !== 'normalized') {
    console.error('Refusing to write. Run the data migration and flip the storage switch first.');
    process.exitCode = 1;
    return;
  }
  if (dryRun) {
    const documents =
      gate.mode === 'normalized'
        ? [...(await loadStages(sql)).map((stage) => stage.stored), ...(await loadCompetitions(sql))]
        : await readLegacyDocuments(sql);
    const plan = planStageMerge(documents);
    console.log(mergeReport(plan, true));
    console.log(`source: ${gate.mode}`);
    return;
  }
  const plan = await commitStageMerge(sql);
  console.log(mergeReport(plan, false));
  console.log(`stages-touched: ${plan.documents.filter(isStage).length}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.name === 'Error' ? error.message : error.name : 'Merge failed');
  process.exitCode = 1;
});

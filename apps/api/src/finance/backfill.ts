import { createDatabase } from '@xiaohai/db';
import { backfillFinanceLedger } from './finance-ledger.js';

const database = createDatabase(process.env);

try {
  const result = await backfillFinanceLedger(database.db);
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  await database.pool.end();
}

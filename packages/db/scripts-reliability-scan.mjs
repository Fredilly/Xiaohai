import pg from 'pg';
import { scanReliability } from './reliability-scan.mjs';

// Schedule with a read-only DB role. Never log connection details or modify business data.
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  const result = await scanReliability(client);
  console.log(
    JSON.stringify({ event: 'RELIABILITY_SCAN', ...result, checkedAt: new Date().toISOString() }),
  );
  if (result.hasAlert) process.exitCode = 1;
} catch {
  console.error(JSON.stringify({ event: 'RELIABILITY_SCAN_FAILED' }));
  process.exitCode = 2;
} finally {
  await client.end().catch(() => undefined);
}

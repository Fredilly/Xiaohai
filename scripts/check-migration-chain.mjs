// Fail a stacked PR when numbered SQL files and the Drizzle journal diverge.
// One historical inversion (0036 -> 0037) is accepted only because the
// append-only, idempotent 0038 repair is present for incremental upgrades.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const directory = fileURLToPath(new URL('../packages/db/migrations/', import.meta.url));
const entries = JSON.parse(readFileSync(join(directory, 'meta/_journal.json'), 'utf8')).entries;
const files = readdirSync(directory)
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .map((name) => name.slice(0, -4))
  .sort();
const fail = (reason) => {
  throw new Error(`MIGRATION_CHAIN_INVALID: ${reason}`);
};
if (!Array.isArray(entries) || entries.length === 0) fail('journal is empty');
if (entries.length !== files.length) {
  fail(`journal lists ${entries.length} migrations but folder contains ${files.length} SQL files`);
}
let highestWhen = 0;
for (const [index, entry] of entries.entries()) {
  if (entry.idx !== index || entry.tag !== files[index]) {
    fail(`migration idx/tag mismatch at position ${index}`);
  }
  if (!Number.isSafeInteger(entry.when) || entry.when <= 0) {
    fail(`invalid timestamp for ${entry.tag}`);
  }
  if (entry.when <= highestWhen) {
    const isKnownLegacyInversion =
      index === 37 &&
      entries[index - 1].tag === '0036_store_catalog_correction_requests' &&
      entry.tag === '0037_store_catalog_direct_edit' &&
      entries[index - 1].when === 1792590000000 &&
      entry.when === 1792584849830;
    if (!isKnownLegacyInversion) {
      fail(`migration ${entry.tag} is not newer than earlier journal entries`);
    }
  }
  highestWhen = Math.max(highestWhen, entry.when);
}
if (entries[38]?.tag !== '0038_store_catalog_direct_edit_upgrade_repair') {
  fail('missing forward-only catalog upgrade repair');
}
const repairSql = readFileSync(
  join(directory, '0038_store_catalog_direct_edit_upgrade_repair.sql'),
  'utf8',
);
for (const required of [
  'ADD COLUMN IF NOT EXISTS',
  'CREATE TABLE IF NOT EXISTS "store_catalog_metadata"',
  'CREATE INDEX IF NOT EXISTS',
  'ON CONFLICT ("key") DO NOTHING',
]) {
  if (!repairSql.includes(required)) fail(`repair lacks required idempotence marker: ${required}`);
}
console.log(`Migration journal/SQL correspondence passed: ${entries.length} files; 0038 repairs legacy 0037 ordering.`);

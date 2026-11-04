import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { buildMeipingPreflight } from './meiping-preflight.js';
import { parseMeipingWorkbook, sourceChecksum } from './meiping-xls.js';

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const file = argument('--file');
if (!file)
  throw new Error(
    'Usage: pnpm --filter @xiaohai/api meiping:preflight -- --file <path> [--output <dir>] [--store-id <id>] [--store-code <code>]',
  );

const output = argument('--output') ?? join(process.cwd(), 'tmp', 'meiping-preflight');
const storeId = argument('--store-id') ?? 'UNCONFIRMED_PENDING_FORMAL_STORE_ID';
const storeCode = argument('--store-code') ?? 'UNCONFIRMED_PENDING_FORMAL_STORE_CODE';
const buffer = await readFile(file);
const parsed = parseMeipingWorkbook(buffer);
const report = buildMeipingPreflight(
  parsed.rows,
  { storeId, storeCode },
  {
    missingMappedFields: parsed.missingMappedFields,
  },
);
await mkdir(output, { recursive: true });
await writeFile(
  join(output, 'preflight-report.json'),
  JSON.stringify(
    {
      sourceFileName: basename(file),
      sourceFileSizeBytes: buffer.byteLength,
      sourceChecksum: sourceChecksum(buffer),
      sheetName: parsed.sheetName,
      headers: parsed.headers,
      missingMappedFields: parsed.missingMappedFields,
      ...report,
    },
    null,
    2,
  ),
);
await writeFile(join(output, 'exceptions.csv'), report.exceptionReportCsv);
console.log(
  JSON.stringify(
    {
      sourceFileName: basename(file),
      totalRows: report.totalRows,
      matchedRows: report.matchedRows,
      createCandidateRows: report.createCandidateRows,
      exceptionRows: report.exceptionRows,
      plannedInventoryTotal: report.plannedInventoryTotal,
      inventoryApproval: report.inventoryApproval,
      output,
    },
    null,
    2,
  ),
);

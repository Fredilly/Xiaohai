import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createI111DatabaseEvidencePorts } from './i111-db-evidence-ports.mjs';
import { I111_ONE_SHOT_SCOPE as scope } from './i111-one-shot-policy.mjs';

const ids = [
  '00000000-1111-4222-8333-444444444441',
  '00000000-1111-4222-8333-444444444442',
  '00000000-1111-4222-8333-444444444443',
];
const mediaIds = [
  '00000000-1111-4222-8333-555555555551',
  '00000000-1111-4222-8333-555555555552',
  '00000000-1111-4222-8333-555555555553',
];
const reservationIds = [
  '00000000-1111-4222-8333-666666666661',
  '00000000-1111-4222-8333-666666666662',
  '00000000-1111-4222-8333-666666666663',
];
const ledgerIds = [
  '00000000-1111-4222-8333-777777777771',
  '00000000-1111-4222-8333-777777777772',
  '00000000-1111-4222-8333-777777777773',
];
const slots = [
  { pageId: scope.page1Id, revisionNumber: 1, regenerate: false },
  { pageId: scope.page2Id, revisionNumber: 1, regenerate: false },
  { pageId: scope.page2Id, revisionNumber: 2, regenerate: true },
];
const marker = JSON.stringify({
  benchmark: 'I111_MAC_PLAN_B',
  marker: 'PROVIDER_POST_SLOT_CONSUMED',
  inputImageCount: 2,
  outputImageCount: 1,
  expectedInputUnitMinor: 2,
  expectedOutputUnitMinor: 18,
  expectedChargeMinor: 22,
  actualChargeVerified: false,
});

function media(index) {
  const objectKey = `picture-books/bailian/${ids[index]}.png`;
  return {
    media_asset_id: mediaIds[index],
    media_id: mediaIds[index],
    media_provider: 'BAIDU_BOS',
    media_status: 'READY',
    media_mime_type: 'image/png',
    media_object_key: objectKey,
    media_playback_url: `https://xiaohai-i111-work-2ec3900280.cd.bcebos.com/${objectKey}`,
    media_byte_size: 1234,
  };
}

function state(previous = 0, stage = 'before') {
  const active = stage === 'before' ? 0 : 1;
  const illustrations = [];
  const reservations = [];
  const ledgers = [];
  for (let index = 0; index < previous + active; index++) {
    const pending = index === previous;
    const finished = pending && stage === 'finished';
    illustrations.push({
      id: ids[index],
      page_id: slots[index].pageId,
      revision_number: slots[index].revisionNumber,
      picture_book_id: scope.bookId,
      provider: scope.provider,
      model: scope.model,
      status: !pending || finished ? 'READY' : 'QUEUED',
      ...(pending && !finished
        ? {
            media_asset_id: null,
            media_id: null,
            media_provider: null,
            media_status: null,
            media_mime_type: null,
            media_object_key: null,
            media_playback_url: null,
            media_byte_size: null,
          }
        : media(index)),
    });
    reservations.push({
      id: reservationIds[index],
      budget_key: scope.budgetKey,
      window_key: scope.windowKey,
      consumer_user_id: scope.ownerId,
      resource_type: 'PICTURE_BOOK_IMAGE',
      resource_id: ids[index],
      provider: scope.provider,
      model: scope.model,
      reserved_minor: scope.reservationMinor,
      actual_minor: pending ? null : 22,
      status: pending ? 'RESERVED' : 'SETTLED',
      uncertainty: pending && finished ? 'AT_RISK' : 'NONE',
      provider_request_id: pending && !finished ? null : `req-${index}`,
    });
    if (!pending || finished) {
      ledgers.push({
        id: ledgerIds[index],
        reservation_id: reservationIds[index],
        consumer_user_id: scope.ownerId,
        resource_type: 'PICTURE_BOOK_IMAGE',
        resource_id: ids[index],
        provider: scope.provider,
        model: scope.model,
        amount_minor: pending ? scope.reservationMinor : 22,
        outcome: pending ? 'AT_RISK' : 'SUCCEEDED',
        usage: marker,
        provider_request_id: `req-${index}`,
      });
    }
  }
  const windows =
    previous + active === 0
      ? []
      : ['GLOBAL', 'CONSUMER'].map((type) => ({
          budget_key: scope.budgetKey,
          window_key: scope.windowKey,
          scope_type: type,
          consumer_user_id: type === 'GLOBAL' ? null : scope.ownerId,
          limit_minor: 200,
          reserved_minor: active * 25,
          actual_minor: previous * 22,
        }));
  return {
    identity: [
      {
        database_name: scope.databaseName,
        database_user: 'xiaohai_i111_app',
        transaction_read_only: 'on',
        is_replica: false,
        server_port: 5432,
        server_version_num: '170005',
      },
    ],
    role: [
      {
        rolname: 'xiaohai_i111_app',
        rolsuper: false,
        rolinherit: false,
        rolcreaterole: false,
        rolcreatedb: false,
        rolcanlogin: true,
        rolreplication: false,
        rolbypassrls: false,
        can_connect: true,
      },
    ],
    pages: [scope.coverId, scope.page1Id, scope.page2Id].map((pageId, index) => ({
      page_id: pageId,
      page_number: index,
      page_kind: index === 0 ? 'COVER' : 'CONTENT',
      picture_book_id: scope.bookId,
      consumer_user_id: scope.ownerId,
      book_status: 'ILLUSTRATING',
    })),
    illustrations,
    reservations,
    ledgers,
    windows,
    activity: [{ ai_jobs: 0, references: 0, illustrations: stage === 'reserved' ? 1 : 0 }],
  };
}

function client(snapshot, { failAt } = {}) {
  const calls = [];
  return {
    calls,
    async query(statement) {
      calls.push(statement);
      if (failAt && statement.includes(failAt)) throw new Error('untrusted database secret');
      const match = /\/\* I111_ONE_SHOT_(\w+) \*\//u.exec(statement);
      if (!match) return { rows: [] };
      const key = match[1].toLowerCase();
      return { rows: structuredClone(snapshot[key] ?? []) };
    },
  };
}

test('first-slot fresh proof uses only read-only SQL and no provider or write calls', async () => {
  const pg = client(state());
  const ports = createI111DatabaseEvidencePorts(pg);
  assert.equal(await ports.verifySlotFreshBeforePrepare({ slot: slots[0] }), true);
  assert.match(pg.calls[0], /^BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY$/u);
  assert.equal(pg.calls.at(-1), 'COMMIT');
  assert.ok(pg.calls.some((sql) => sql.includes('I111_ONE_SHOT_RESERVATIONS')));
  assert.ok(pg.calls.every((sql) => !/\b(INSERT|UPDATE|DELETE|TRUNCATE)\b/u.test(sql)));
  assert.equal(await ports.verifySlotFreshBeforePrepare({ slot: slots[1] }), false);
});

test('second/third slot requires exactly settled prior successes', async () => {
  for (const count of [1, 2]) {
    const ports = createI111DatabaseEvidencePorts(client(state(count)));
    assert.equal(await ports.verifySlotFreshBeforePrepare({ slot: slots[count] }), true);
    assert.equal(await ports.verifySlotFreshBeforePrepare({ slot: slots[count - 1] }), false);
  }
});

test('exactly one new formal-API reservation may follow a settled prefix', async () => {
  for (const count of [0, 1, 2]) {
    const ports = createI111DatabaseEvidencePorts(client(state(count, 'reserved')));
    assert.equal(
      await ports.verifyExactlyOneReservation({ slot: slots[count], targetId: ids[count] }),
      true,
    );
    assert.equal(
      await ports.verifyExactlyOneReservation({
        slot: slots[count],
        targetId: ids[(count + 1) % 3],
      }),
      false,
    );
    assert.equal(await ports.verifySlotFreshBeforePrepare({ slot: slots[count] }), false);
  }
});

test('post-worker evidence remains AT_RISK until independently reconciled', async () => {
  for (const count of [0, 1, 2]) {
    const ports = createI111DatabaseEvidencePorts(client(state(count, 'finished')));
    assert.deepEqual(await ports.readFinalEvidence(ids[count]), {
      illustrationId: ids[count],
      status: 'SUCCEEDED',
      mediaStatus: 'READY',
      reservationStatus: 'AT_RISK',
      ledgerStatus: 'AT_RISK',
    });
    assert.equal(
      await ports.verifyExactlyOneReservation({ slot: slots[count], targetId: ids[count] }),
      false,
    );
  }
});

test('scope/identity/unknown cost/queue/extra rows fail before API or Worker', async () => {
  const scenarios = [
    (s) => {
      s.identity[0].database_name = 'prod';
    },
    (s) => {
      s.role[0].rolsuper = true;
    },
    (s) => {
      s.pages[1].consumer_user_id = 'wrong';
    },
    (s) => {
      s.activity[0].ai_jobs = 1;
    },
    (s) => {
      s.activity[0].references = 1;
    },
    (s) => {
      s.activity[0].illustrations = 1;
    },
    (s) => {
      s.windows.push({ ...s.windows[0], scope_type: 'GLOBAL' });
    },
    (s) => {
      s.reservations[0].budget_key = 'another';
    },
    (s) => {
      s.reservations[0].status = 'RESERVED';
    },
    (s) => {
      s.reservations[0].actual_minor = null;
    },
    (s) => {
      s.reservations[0].provider_request_id = null;
    },
    (s) => {
      s.reservations[0].provider_request_id = 'bailian-image-unknown';
    },
    (s) => {
      s.ledgers[0].usage = 'fake-marker';
    },
    (s) => {
      s.ledgers[0].outcome = 'AT_RISK';
    },
    (s) => {
      s.ledgers[0].amount_minor = 24;
    },
    (s) => {
      s.illustrations[0].media_object_key = 'other.png';
    },
    (s) => {
      s.illustrations[0].media_playback_url = 'https://evil.test/image.png';
    },
    (s) => {
      s.illustrations.push({ ...s.illustrations[0], id: ids[2] });
    },
    (s) => {
      s.reservations.push({ ...s.reservations[0], id: reservationIds[2] });
    },
    (s) => {
      s.ledgers.push({ ...s.ledgers[0], id: ledgerIds[2] });
    },
  ];
  for (const mutate of scenarios) {
    const snapshot = state(1);
    mutate(snapshot);
    assert.equal(
      await createI111DatabaseEvidencePorts(client(snapshot)).verifySlotFreshBeforePrepare({
        slot: slots[1],
      }),
      false,
    );
  }
});

test('new reservation/media/AT_RISK drift cannot pass later gates', async () => {
  const reservationFailures = [
    (s) => {
      s.illustrations[0].status = 'RUNNING';
    },
    (s) => {
      s.reservations[0].status = 'SETTLED';
    },
    (s) => {
      s.reservations[0].uncertainty = 'AT_RISK';
    },
    (s) => {
      s.ledgers.push({ id: ledgerIds[0] });
    },
    (s) => {
      s.windows[0].reserved_minor = 0;
    },
    (s) => {
      s.activity[0].illustrations = 0;
    },
  ];
  for (const mutate of reservationFailures) {
    const snapshot = state(0, 'reserved');
    mutate(snapshot);
    assert.equal(
      await createI111DatabaseEvidencePorts(client(snapshot)).verifyExactlyOneReservation({
        slot: slots[0],
        targetId: ids[0],
      }),
      false,
    );
  }
  const finalFailures = [
    (s) => {
      s.illustrations[0].media_status = 'FAILED';
    },
    (s) => {
      s.reservations[0].uncertainty = 'NONE';
    },
    (s) => {
      s.reservations[0].provider_request_id = null;
    },
    (s) => {
      s.reservations[0].provider_request_id = 'bailian-image-unknown';
    },
    (s) => {
      s.ledgers[0].provider_request_id = 'wrong';
    },
    (s) => {
      s.ledgers[0].outcome = 'SUCCEEDED';
    },
  ];
  for (const mutate of finalFailures) {
    const snapshot = state(0, 'finished');
    mutate(snapshot);
    assert.equal(
      await createI111DatabaseEvidencePorts(client(snapshot)).readFinalEvidence(ids[0]),
      null,
    );
  }
});

test('failed query rolls back and does not disclose exception or authorize anything', async () => {
  const pg = client(state(), { failAt: 'I111_ONE_SHOT_RESERVATIONS' });
  const ports = createI111DatabaseEvidencePorts(pg);
  assert.equal(await ports.verifySlotFreshBeforePrepare({ slot: slots[0] }), false);
  assert.equal(pg.calls.at(-1), 'ROLLBACK');
  assert.equal(await ports.verifyExactlyOneReservation({ slot: slots[0], targetId: 'bad' }), false);
  assert.equal(await ports.readFinalEvidence('bad'), null);
});

test('durable slot marker stays identical to the production Worker gate', async () => {
  const worker = await readFile(
    new URL('../apps/worker/src/i111-paid-attempt-gate.ts', import.meta.url),
    'utf8',
  );
  const match = /const SLOT_MARKER = JSON\.stringify\((\{[\s\S]*?\})\);/u.exec(worker);
  assert.ok(match);
  for (const [key, value] of Object.entries(JSON.parse(marker))) {
    const literal = typeof value === 'string' ? `'${value}'` : JSON.stringify(value);
    assert.ok(match[1].includes(`${key}: ${literal}`));
  }
});

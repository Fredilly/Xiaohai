import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createConnection } from 'node:net';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  assessI111OneShotSnapshot,
  I111_ONE_SHOT_SCOPE as scope,
} from './i111-one-shot-policy.mjs';

const requireFromDb = createRequire(new URL('../packages/db/package.json', import.meta.url));
const requireFromApi = createRequire(new URL('../apps/api/package.json', import.meta.url));

export const I111_READONLY_PATHS = Object.freeze({
  gateRoot: '/Volumes/Data/Xiaohai-i111-gate-b',
  backup:
    '/Volumes/Data/Xiaohai-i111-gate-b/.i111-plan-b/evidence/storyboard-preapply-699ab7c-20261116T170840.dump',
  mimi: '/Volumes/Data/Xiaohai-i111-gate-b/.i111-plan-b/assets/mimi_reference_candidate.png',
  pip: '/Volumes/Data/Xiaohai-i111-gate-b/.i111-plan-b/assets/pip_reference_candidate.png',
  apiMode: '/Volumes/Data/Xiaohai-i111-gate-b/.i111-plan-b/api.mode',
  approval:
    '/Volumes/Data/Xiaohai-i111-gate-b/.i111-plan-b/evidence/i111-readonly-runtime-approval.json',
});

const EXPECTED = Object.freeze({
  gateSha: '6898d09a3fcf76c5006ab271d0168643de2bf1fd',
  databaseUser: 'xiaohai_i111_app',
  databasePort: '52511',
  redisPort: '52512',
  postgresContainer: 'xiaohai-i111-planb-fixed-postgres',
  postgresContainerId: '3fdfd302d45de4f487197bdc0e335f8f3f6dec8a38cd6eb16b1ead883fe3b87f',
  postgresImage: 'sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73',
  postgresVolume: 'xiaohai_i111_planb_fixed_pgdata',
  postgresSourceId: 'fdede2cf57f70465a950b0a4ea2d13cb6894cc13bc97b540ecf660b9c1629f24',
  postgresSourceVolume: 'xiaohai_i111_planb_pgdata',
  redisContainer: 'xiaohai-i111-planb-fixed-redis',
  redisContainerId: '9a57c5bd1e310f47880c5fba3e7be21c76441359eeda82d3f897f34937be02e1',
  redisImage: 'sha256:ff02b58f971e7d7d156a1267e283fcbbeee91773b6aa36c49dac28ecfe28eadf',
  redisVolume: 'xiaohai_i111_planb_fixed_redisdata',
  redisSourceId: '920804ca22010bfe8ae8791e9f6ec88604d870151685ea6a31e66dc23182f031',
  redisSourceVolume: 'xiaohai_i111_planb_redisdata',
  dockerEndpoint: 'unix:///Users/li/.docker/run/docker.sock',
  dockerSocketPath: '/Users/li/.docker/run/docker.sock',
  dockerDaemonId: '85a4eb36-df0b-474f-854d-52a141733ea8',
  dockerCli: '/Applications/Docker.app/Contents/Resources/bin/docker',
  dockerBackendExecutable: '/Applications/Docker.app/Contents/MacOS/com.docker.backend',
  dockerBackendIdentifier: 'com.docker.docker',
  dockerBackendTeamId: '9BNSXJN65R',
  dockerBackendCdHash: '54c72e39ae7276bc1a096e7494615a690a0d31d8',
  mimiId: 'de0169d8-d975-4f1b-b04c-a15c25f54bdc',
  pipId: '249a719e-d284-46e0-a525-285e93270248',
  mimiReferenceId: 'fa526d14-9fc4-4cba-bf3e-ae9c8a888906',
  pipReferenceId: 'bed51270-3add-4d10-93fb-8ffa085ff7a7',
  bucket: 'xiaohai-i111-work-2ec3900280',
  bosEndpoint: 'https://cd.bcebos.com/',
  backupSha256: 'a920f381a1aab434cef041c6d6ab470a3d546f245426185aaea606ec4cede603',
  backupBytes: 338_025,
  mimiSha256: 'a50abb6b7195a2be7886b47351f259c930aca36ebacec500b6fbfab65136f304',
  mimiBytes: 1_843_161,
  pipSha256: 'af3845b30a28a82c7cbcc491b76c1291355009c347274437ff23968ee144c06d',
  pipBytes: 738_959,
  migrationCount: 42,
});

const PROVENANCE_FILES = Object.freeze([
  'scripts/i111-readonly-runtime-preflight.mjs',
  'scripts/i111-one-shot-policy.mjs',
  'packages/config/src/image-runtime-safety.ts',
  'apps/worker/src/private-bos-reference.ts',
  'apps/worker/src/image-processor.ts',
  'apps/worker/src/i111-paid-attempt-gate.ts',
  'apps/worker/src/index.ts',
  'apps/api/src/picture-book/image-queue.ts',
]);

const REDIS_QUEUES = Object.freeze([
  'xiaohai:ai:jobs',
  'xiaohai:image:jobs',
  'xiaohai:animation:jobs',
  'xiaohai:animation:compositions',
]);

const ALLOWED_CODES = new Set([
  'I111_ARGUMENTS_FORBIDDEN',
  'I111_ATTEMPTS_INVALID',
  'I111_ATTEMPT_COUNT_INVALID',
  'I111_ATOMIC_ISOLATION_UNVERIFIED',
  'I111_BACKUP_NOT_VERIFIED',
  'I111_BOOK_SCOPE_INVALID',
  'I111_BUDGET_INVALID',
  'I111_CODE_NOT_REVIEWED',
  'I111_DATABASE_CHECK_FAILED',
  'I111_DATABASE_IDENTITY_INVALID',
  'I111_ENV_INVALID',
  'I111_FILESYSTEM_UNTRUSTED',
  'I111_LOCAL_REFERENCE_FILES_INVALID',
  'I111_MIGRATION_STATE_INVALID',
  'I111_NEXT_SLOT_INVALID',
  'I111_POSTGRES_RESOURCE_INVALID',
  'I111_PREVIOUS_ATTEMPT_INVALID',
  'I111_PRICE_BASIS_UNVERIFIED',
  'I111_PROVIDER_CONFIG_INVALID',
  'I111_PROVIDER_CREDENTIALS_MISSING',
  'I111_REDIS_CHECK_FAILED',
  'I111_REFERENCES_INVALID',
  'I111_REMOTE_BOS_UNVERIFIED',
  'I111_RETRY_SEMANTICS_UNVERIFIED',
  'I111_RUNTIME_NOT_ISOLATED',
  'I111_SNAPSHOT_INVALID',
  'I111_UNEXPECTED_FAILURE',
]);

const SLOT_MARKER = JSON.stringify({
  benchmark: 'I111_MAC_PLAN_B',
  marker: 'PROVIDER_POST_SLOT_CONSUMED',
  inputImageCount: 2,
  outputImageCount: 1,
  expectedInputUnitMinor: 2,
  expectedOutputUnitMinor: 18,
  expectedChargeMinor: 22,
  actualChargeVerified: false,
});

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function integer(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null;
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function secretPresent(value) {
  return (
    typeof value === 'string' &&
    value.length >= 8 &&
    value.length <= 512 &&
    !value.startsWith('INJECT_') &&
    !/placeholder|example|changeme/i.test(value)
  );
}

function safeCodes(codes) {
  if (codes.some((code) => !ALLOWED_CODES.has(code))) return ['I111_UNEXPECTED_FAILURE'];
  return [...new Set(codes)].sort();
}

function validateLocalUrl(raw, kind) {
  if (typeof raw !== 'string') return null;
  try {
    const url = new URL(raw);
    const postgres = kind === 'postgres';
    const valid = postgres
      ? url.protocol === 'postgresql:' &&
        url.port === EXPECTED.databasePort &&
        url.pathname === '/' + scope.databaseName &&
        url.username === EXPECTED.databaseUser
      : url.protocol === 'redis:' &&
        url.port === EXPECTED.redisPort &&
        (url.pathname === '' || url.pathname === '/') &&
        (url.username === '' || url.username === 'default');
    if (!valid || url.hostname !== '127.0.0.1' || !url.password || url.search || url.hash) {
      return null;
    }
    return raw;
  } catch {
    return null;
  }
}

function inspectConfiguration(env, source) {
  const errors = [];
  const timeout = integer(env.PICTURE_BOOK_IMAGE_TIMEOUT_MS);
  const reservation = integer(env.PICTURE_BOOK_IMAGE_BUDGET_RESERVATION_MINOR);
  const globalLimit = integer(env.PICTURE_BOOK_IMAGE_BUDGET_GLOBAL_LIMIT_MINOR);
  const consumerLimit = integer(env.PICTURE_BOOK_IMAGE_BUDGET_CONSUMER_LIMIT_MINOR);
  let workspaceBound = false;
  let bosBound = false;
  try {
    const workspace = env.DASHSCOPE_WORKSPACE_ID;
    const endpoint = new URL(env.PICTURE_BOOK_IMAGE_BASE_URL);
    workspaceBound =
      typeof workspace === 'string' &&
      /^ws-[a-z0-9-]{6,80}$/.test(workspace) &&
      endpoint.protocol === 'https:' &&
      endpoint.hostname === workspace + '.cn-beijing.maas.aliyuncs.com' &&
      endpoint.pathname === '/compatible-mode/v1' &&
      !endpoint.port &&
      !endpoint.username &&
      !endpoint.password &&
      !endpoint.search &&
      !endpoint.hash;
    const bosEndpoint = new URL(env.BAIDU_BOS_ENDPOINT);
    const origin = new URL(env.BAIDU_BOS_PUBLIC_ORIGIN);
    bosBound =
      env.BAIDU_BOS_BUCKET === EXPECTED.bucket &&
      bosEndpoint.toString() === EXPECTED.bosEndpoint &&
      origin.protocol === 'https:' &&
      origin.hostname === EXPECTED.bucket + '.cd.bcebos.com' &&
      origin.pathname === '/' &&
      !origin.port &&
      !origin.search &&
      !origin.hash &&
      !origin.username &&
      !origin.password;
  } catch {
    workspaceBound = false;
    bosBound = false;
  }
  const imageEnabled = env.PICTURE_BOOK_IMAGE_ENABLED === 'true';
  const budgetEnabled = env.PICTURE_BOOK_IMAGE_BUDGET_ENABLED === 'true';
  if (
    env.APP_ENV !== 'dev' ||
    env.NODE_ENV === 'production' ||
    env.TEST_DATABASE_URL !== undefined
  ) {
    errors.push('I111_ENV_INVALID');
  }
  if (
    !imageEnabled ||
    env.PICTURE_BOOK_IMAGE_PROVIDER !== scope.provider ||
    env.PICTURE_BOOK_IMAGE_MODEL !== scope.model ||
    !workspaceBound ||
    !bosBound ||
    source.signedTtlSeconds !== scope.signedTtlSeconds ||
    timeout === null ||
    timeout < 600_000 ||
    timeout > 780_000
  ) {
    errors.push('I111_PROVIDER_CONFIG_INVALID');
  }
  if (
    !budgetEnabled ||
    env.PICTURE_BOOK_IMAGE_BUDGET_KEY !== scope.budgetKey ||
    env.PICTURE_BOOK_IMAGE_BUDGET_WINDOW_KEY !== scope.windowKey ||
    reservation !== scope.reservationMinor ||
    globalLimit !== scope.budgetLimitMinor ||
    consumerLimit !== scope.budgetLimitMinor
  ) {
    errors.push('I111_BUDGET_INVALID');
  }
  if (
    !secretPresent(env.DASHSCOPE_API_KEY) ||
    !secretPresent(env.BAIDU_BOS_ACCESS_KEY_ID) ||
    !secretPresent(env.BAIDU_BOS_SECRET_ACCESS_KEY)
  ) {
    errors.push('I111_PROVIDER_CREDENTIALS_MISSING');
  }
  return {
    errors,
    runtime: {
      imageEnabled,
      provider: env.PICTURE_BOOK_IMAGE_PROVIDER,
      model: env.PICTURE_BOOK_IMAGE_MODEL,
      beijingWorkspaceBound: workspaceBound,
      signedTtlSeconds: source.signedTtlSeconds,
      imageTimeoutMs: timeout,
      autoRetryEnabled: null,
    },
    budget: {
      enabled: budgetEnabled,
      budgetKey: env.PICTURE_BOOK_IMAGE_BUDGET_KEY,
      windowKey: env.PICTURE_BOOK_IMAGE_BUDGET_WINDOW_KEY,
      reservationMinor: reservation,
      globalLimitMinor: globalLimit,
      consumerLimitMinor: consumerLimit,
      costBasisVerified: false,
      providerInvoiceVerified: false,
    },
  };
}

async function trustedParents(path, dependencies) {
  if (!isAbsolute(path)) throw new Error('UNTRUSTED_PATH');
  const parts = dirname(path).split(sep).filter(Boolean);
  let current = sep;
  const snapshots = [];
  for (const part of parts) {
    current = join(current, part);
    const info = await dependencies.lstat(current);
    const allowedOwners = [0, process.getuid?.()].filter((value) => value !== undefined);
    if (
      info.isSymbolicLink() ||
      !info.isDirectory() ||
      !allowedOwners.includes(info.uid) ||
      (info.mode & 0o022) !== 0
    ) {
      throw new Error('UNTRUSTED_PARENT');
    }
    snapshots.push({ path: current, dev: info.dev, ino: info.ino, uid: info.uid, mode: info.mode });
  }
  return snapshots;
}

async function parentsUnchanged(snapshots, dependencies) {
  for (const before of snapshots) {
    const after = await dependencies.lstat(before.path);
    if (
      after.isSymbolicLink() ||
      !after.isDirectory() ||
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.uid !== before.uid ||
      after.mode !== before.mode
    ) {
      throw new Error('PARENT_CHANGED_DURING_READ');
    }
  }
}

async function boundedRead(handle, expectedSize) {
  const expected = Number(expectedSize);
  const buffer = Buffer.alloc(expected + 1);
  let offset = 0;
  while (offset < buffer.byteLength) {
    const { bytesRead } = await handle.read(buffer, offset, buffer.byteLength - offset, null);
    if (bytesRead === 0) break;
    offset += bytesRead;
  }
  if (offset !== expected) throw new Error('FILE_CHANGED_DURING_READ');
  return buffer.subarray(0, expected);
}

export async function secureReadFile(path, options = {}, dependencies = {}) {
  const adapter = {
    lstat: dependencies.lstat ?? lstat,
    open: dependencies.open ?? open,
    realpath: dependencies.realpath ?? realpath,
  };
  if ((await adapter.realpath(path)) !== resolve(path)) throw new Error('UNTRUSTED_PATH');
  const parentSnapshots = await trustedParents(path, adapter);
  const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);
  const handle = await adapter.open(path, flags);
  try {
    const before = await handle.stat({ bigint: true });
    const maxBytes = BigInt(options.maxBytes ?? 4 * 1024 * 1024);
    const allowedOwners = [0, process.getuid?.()].filter((value) => value !== undefined);
    if (
      !before.isFile() ||
      before.size > maxBytes ||
      (options.mode !== undefined && Number(before.mode & 0o777n) !== options.mode) ||
      !allowedOwners.includes(Number(before.uid))
    ) {
      throw new Error('UNTRUSTED_FILE');
    }
    const bytes = await boundedRead(handle, before.size);
    const after = await handle.stat({ bigint: true });
    await parentsUnchanged(parentSnapshots, adapter);
    if ((await adapter.realpath(path)) !== resolve(path)) throw new Error('UNTRUSTED_PATH');
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs ||
      BigInt(bytes.byteLength) !== before.size
    ) {
      throw new Error('FILE_CHANGED_DURING_READ');
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

async function inspectFiles(paths, dependencies) {
  const errors = [];
  const result = {
    backupVerified: false,
    mimiLocalPngVerified: false,
    pipLocalPngVerified: false,
    apiModeDisabled: false,
    approval: null,
  };
  try {
    const backup = await dependencies.secureRead(paths.backup, {
      mode: 0o600,
      maxBytes: EXPECTED.backupBytes,
    });
    result.backupVerified =
      backup.byteLength === EXPECTED.backupBytes &&
      backup.subarray(0, 5).toString('ascii') === 'PGDMP' &&
      sha256(backup) === EXPECTED.backupSha256;
  } catch {
    errors.push('I111_FILESYSTEM_UNTRUSTED');
  }
  for (const [name, path, digest, size] of [
    ['mimiLocalPngVerified', paths.mimi, EXPECTED.mimiSha256, EXPECTED.mimiBytes],
    ['pipLocalPngVerified', paths.pip, EXPECTED.pipSha256, EXPECTED.pipBytes],
  ]) {
    try {
      const bytes = await dependencies.secureRead(path, { mode: 0o600, maxBytes: size });
      result[name] = bytes.byteLength === size && sha256(bytes) === digest;
    } catch {
      errors.push('I111_FILESYSTEM_UNTRUSTED');
    }
  }
  try {
    const mode = await dependencies.secureRead(paths.apiMode, { mode: 0o600, maxBytes: 32 });
    result.apiModeDisabled = mode.toString('utf8').trim() === 'disabled';
  } catch {
    errors.push('I111_FILESYSTEM_UNTRUSTED');
  }
  try {
    const approval = await dependencies.secureRead(paths.approval, {
      mode: 0o600,
      maxBytes: 32_768,
    });
    result.approval = JSON.parse(approval.toString('utf8'));
  } catch {
    errors.push('I111_CODE_NOT_REVIEWED');
  }
  if (!result.backupVerified) errors.push('I111_BACKUP_NOT_VERIFIED');
  if (!result.mimiLocalPngVerified || !result.pipLocalPngVerified) {
    errors.push('I111_LOCAL_REFERENCE_FILES_INVALID');
  }
  if (!result.apiModeDisabled) errors.push('I111_RUNTIME_NOT_ISOLATED');
  return { ...result, errors };
}

function runCommand(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  });
  if (result.error || result.status === null) throw new Error('COMMAND_FAILED');
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

export async function verifyGitHubApproval(approval, checkedOutSha, dependencies = {}) {
  const match =
    /^https:\/\/github\.com\/Fredilly\/Xiaohai\/pull\/([1-9]\d*)#pullrequestreview-([1-9]\d*)$/.exec(
      approval?.approvalUrl ?? '',
    );
  if (
    !match ||
    approval?.approvedBy !== 'Fredilly' ||
    approval?.approvedCommit !== checkedOutSha ||
    !/^[0-9a-f]{40}$/.test(checkedOutSha)
  ) {
    return false;
  }
  const commandRunner = dependencies.commandRunner ?? runCommand;
  try {
    const response = await commandRunner(
      'gh',
      [
        'api',
        '--hostname',
        'github.com',
        '--method',
        'GET',
        `repos/Fredilly/Xiaohai/pulls/${match[1]}/reviews/${match[2]}`,
      ],
      dependencies.root,
    );
    if (response.status !== 0 || response.stderr.trim()) return false;
    const review = JSON.parse(response.stdout);
    return (
      String(review?.id) === match[2] &&
      review?.user?.login === 'Fredilly' &&
      review?.state === 'APPROVED' &&
      review?.commit_id === checkedOutSha &&
      review?.html_url === approval.approvalUrl
    );
  } catch {
    return false;
  }
}

function dockerArgs(args) {
  return ['--host', EXPECTED.dockerEndpoint, ...args];
}

export function validateDockerSocketEvidence({ canonicalPath, before, after, uid }) {
  return (
    canonicalPath === EXPECTED.dockerSocketPath &&
    before?.symbolicLink === false &&
    before?.socket === true &&
    before?.uid === uid &&
    (before?.mode & 0o002) === 0 &&
    after?.symbolicLink === false &&
    after?.socket === true &&
    after?.dev === before?.dev &&
    after?.ino === before?.ino &&
    after?.uid === before?.uid &&
    after?.mode === before?.mode
  );
}

function socketSnapshot(info) {
  return {
    symbolicLink: info.isSymbolicLink(),
    socket: info.isSocket(),
    dev: info.dev,
    ino: info.ino,
    uid: info.uid,
    mode: info.mode,
  };
}

async function trustedDockerSocket(dependencies) {
  const adapter = {
    lstat: dependencies.lstat ?? lstat,
    realpath: dependencies.realpath ?? realpath,
  };
  try {
    const canonicalPath = await adapter.realpath(EXPECTED.dockerSocketPath);
    const parents = await trustedParents(EXPECTED.dockerSocketPath, adapter);
    const before = socketSnapshot(await adapter.lstat(EXPECTED.dockerSocketPath));
    await parentsUnchanged(parents, adapter);
    const after = socketSnapshot(await adapter.lstat(EXPECTED.dockerSocketPath));
    const verified = validateDockerSocketEvidence({
      canonicalPath,
      before,
      after,
      uid: process.getuid?.(),
    });
    return { verified, identity: verified ? after : null };
  } catch {
    return { verified: false, identity: null };
  }
}

async function trustedDockerSocketContinuity(identity, dependencies) {
  const adapter = {
    lstat: dependencies.lstat ?? lstat,
    realpath: dependencies.realpath ?? realpath,
  };
  try {
    const canonicalPath = await adapter.realpath(EXPECTED.dockerSocketPath);
    const parents = await trustedParents(EXPECTED.dockerSocketPath, adapter);
    const before = socketSnapshot(await adapter.lstat(EXPECTED.dockerSocketPath));
    await parentsUnchanged(parents, adapter);
    const after = socketSnapshot(await adapter.lstat(EXPECTED.dockerSocketPath));
    return (
      validateDockerSocketEvidence({
        canonicalPath,
        before: identity,
        after: before,
        uid: process.getuid?.(),
      }) &&
      validateDockerSocketEvidence({
        canonicalPath,
        before: identity,
        after,
        uid: process.getuid?.(),
      })
    );
  } catch {
    return false;
  }
}

async function socketIdentityUnchanged(identity, phase, dependencies) {
  return (dependencies.socketRechecker ?? trustedDockerSocketContinuity)(
    identity,
    dependencies,
    phase,
  );
}

function parseProcessIds(result, expectedName) {
  if (result.status !== 0 || !result.stdout.trim() || result.stderr.trim()) return [];
  const lines = result.stdout.trim().split('\n');
  const rows = lines.slice(1).map((line) => ({ fields: line.trim().split(/\s+/), line }));
  if (
    rows.length === 0 ||
    rows.some(
      (row) =>
        row.fields[0] !== 'com.docke' ||
        !/^\d+$/.test(row.fields[1] ?? '') ||
        !row.line.endsWith(expectedName),
    )
  ) {
    return [];
  }
  return [...new Set(rows.map((row) => Number(row.fields[1])))];
}

async function socketServingProcesses(commandRunner) {
  const result = await commandRunner('/usr/sbin/lsof', ['-nP', EXPECTED.dockerSocketPath]);
  return parseProcessIds(result, EXPECTED.dockerSocketPath);
}

async function trustedDockerEndpoint(dependencies) {
  const environment = dependencies.env ?? process.env;
  if (
    (environment.DOCKER_HOST !== undefined &&
      environment.DOCKER_HOST !== EXPECTED.dockerEndpoint) ||
    environment.DOCKER_CONTEXT !== undefined ||
    environment.DOCKER_TLS_VERIFY !== undefined ||
    environment.DOCKER_CERT_PATH !== undefined
  ) {
    return { verified: false, socketPids: [] };
  }
  const socketEvidence = await (dependencies.socketInspector ?? trustedDockerSocket)(dependencies);
  if (!socketEvidence?.verified || !socketEvidence.identity) {
    return { verified: false, socketPids: [], socketIdentity: null };
  }
  const commandRunner = dependencies.commandRunner ?? runCommand;
  try {
    const result = await commandRunner(
      EXPECTED.dockerCli,
      dockerArgs(['info', '--format', '{{json .}}']),
    );
    if (result.status !== 0 || result.stderr.trim()) return { verified: false, socketPids: [] };
    const info = JSON.parse(result.stdout);
    const daemonVerified =
      info?.ID === EXPECTED.dockerDaemonId &&
      info?.Name === 'docker-desktop' &&
      info?.OperatingSystem === 'Docker Desktop' &&
      info?.OSType === 'linux' &&
      info?.DockerRootDir === '/var/lib/docker' &&
      /^\d+\.\d+\.\d+$/.test(info?.ServerVersion ?? '');
    if (!daemonVerified) return { verified: false, socketPids: [], socketIdentity: null };
    if (!(await socketIdentityUnchanged(socketEvidence.identity, 'after-daemon', dependencies))) {
      return { verified: false, socketPids: [], socketIdentity: null };
    }
    const socketPids = await socketServingProcesses(commandRunner);
    if (
      socketPids.length === 0 ||
      !(await socketIdentityUnchanged(
        socketEvidence.identity,
        'after-socket-process',
        dependencies,
      ))
    ) {
      return { verified: false, socketPids: [], socketIdentity: null };
    }
    return { verified: true, socketPids, socketIdentity: socketEvidence.identity };
  } catch {
    return { verified: false, socketPids: [], socketIdentity: null };
  }
}

async function dockerResource(
  name,
  expected,
  image,
  port,
  containerPort,
  volume,
  sourceId,
  sourceVolume,
  destination,
  commandRunner,
) {
  const inspected = await commandRunner(EXPECTED.dockerCli, dockerArgs(['inspect', name]));
  const volumeInfo = await commandRunner(
    EXPECTED.dockerCli,
    dockerArgs(['volume', 'inspect', volume]),
  );
  const published = await commandRunner(
    EXPECTED.dockerCli,
    dockerArgs(['port', name, `${containerPort}/tcp`]),
  );
  if (
    inspected.status !== 0 ||
    volumeInfo.status !== 0 ||
    published.status !== 0 ||
    inspected.stderr.trim() ||
    volumeInfo.stderr.trim() ||
    published.stderr.trim()
  ) {
    return false;
  }
  const [container] = JSON.parse(inspected.stdout);
  const [storedVolume] = JSON.parse(volumeInfo.stdout);
  const binding = container?.HostConfig?.PortBindings?.[`${containerPort}/tcp`];
  const actualBinding = container?.NetworkSettings?.Ports?.[`${containerPort}/tcp`];
  const mount = container?.Mounts?.filter((item) => item.Destination === destination);
  const labels = container?.Config?.Labels;
  return (
    container?.Id === expected &&
    container?.Name === `/${name}` &&
    container?.State?.Running === true &&
    container?.Image === image &&
    labels?.['com.xiaohai.issue'] === '111' &&
    labels?.['com.xiaohai.plan'] === 'plan-b' &&
    Object.values(labels).includes(sourceId) &&
    Object.values(labels).includes(sourceVolume) &&
    Array.isArray(binding) &&
    binding.length === 1 &&
    binding[0]?.HostIp === '127.0.0.1' &&
    binding[0]?.HostPort === port &&
    Array.isArray(actualBinding) &&
    actualBinding.length === 1 &&
    actualBinding[0]?.HostIp === '127.0.0.1' &&
    actualBinding[0]?.HostPort === port &&
    published.stdout.trim() === `127.0.0.1:${port}` &&
    Array.isArray(container?.Mounts) &&
    container.Mounts.length === 1 &&
    Array.isArray(mount) &&
    mount.length === 1 &&
    mount[0]?.Type === 'volume' &&
    mount[0]?.Name === volume &&
    mount[0]?.Name !== sourceVolume &&
    mount[0]?.RW === true &&
    storedVolume?.Name === volume &&
    storedVolume?.Driver === 'local' &&
    storedVolume?.Scope === 'local'
  );
}

async function listener(port, expectedPresent, commandRunner) {
  const result = await commandRunner('/usr/sbin/lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN']);
  if (!expectedPresent && result.status === 1 && !result.stdout.trim() && !result.stderr.trim()) {
    return { verified: true, present: false, pids: [] };
  }
  if (result.status !== 0 || !result.stdout.trim() || result.stderr.trim()) {
    return { verified: false, present: null, pids: [] };
  }
  const lines = result.stdout.trim().split('\n');
  const records = lines.slice(1).map((line) => ({
    fields: line.trim().split(/\s+/),
    line,
  }));
  const pids = [...new Set(records.map((record) => record.fields[1]))];
  if (
    records.length === 0 ||
    pids.length === 0 ||
    pids.some((pid) => !/^\d+$/.test(pid ?? '')) ||
    records.some(
      (record) =>
        record.fields[0] !== 'com.docke' ||
        !new RegExp(`\\bTCP 127\\.0\\.0\\.1:${port} \\(LISTEN\\)$`).test(record.line),
    )
  ) {
    return { verified: false, present: true, pids: [] };
  }
  return { verified: true, present: true, pids: pids.map(Number) };
}

function parseBackendProcesses(result) {
  if (result.status !== 0 || result.stderr.trim()) return new Map();
  const processes = new Map();
  for (const line of result.stdout.trim().split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
    if (!match) return new Map();
    processes.set(Number(match[1]), {
      pid: Number(match[1]),
      ppid: Number(match[2]),
      uid: Number(match[3]),
      executable: match[4],
    });
  }
  return processes;
}

function parseBackendSignature(result) {
  if (result.status !== 0) return false;
  const output = `${result.stdout}\n${result.stderr}`;
  return (
    new RegExp(`^Identifier=${EXPECTED.dockerBackendIdentifier}$`, 'm').test(output) &&
    new RegExp(`^TeamIdentifier=${EXPECTED.dockerBackendTeamId}$`, 'm').test(output) &&
    new RegExp(`^CDHash=${EXPECTED.dockerBackendCdHash}$`, 'm').test(output) &&
    output.includes(`certificate leaf[subject.OU] = ${EXPECTED.dockerBackendTeamId}`)
  );
}

function parseExecutableStat(result) {
  const match = /^(\d+):(\d+):(\d+):-rwxr-xr-x\s*$/.exec(result.stdout);
  if (result.status !== 0 || result.stderr.trim() || !match) return null;
  return { dev: Number(match[1]), ino: Number(match[2]), uid: Number(match[3]) };
}

function parseTextVnode(result) {
  if (result.status !== 0 || result.stderr.trim()) return null;
  const records = result.stdout.split(/^f/m).slice(1);
  for (const record of records) {
    if (record.split('\n', 1)[0].trim() !== 'txt') continue;
    const path = /^n(.+)$/m.exec(record)?.[1];
    const dev = /^D(0x[0-9a-f]+|\d+)$/im.exec(record)?.[1];
    const ino = /^i(\d+)$/m.exec(record)?.[1];
    if (path === EXPECTED.dockerBackendExecutable && dev && ino) {
      return { dev: Number(dev), ino: Number(ino) };
    }
  }
  return null;
}

function backendRoot(pid, processes, vnodes, executable, expectedUid) {
  let current = processes.get(pid);
  if (
    !current ||
    ![0, expectedUid].includes(current.uid) ||
    current.executable !== EXPECTED.dockerBackendExecutable
  ) {
    return null;
  }
  const seen = new Set();
  while (true) {
    if (seen.has(current.pid)) return null;
    seen.add(current.pid);
    const vnode = vnodes.get(current.pid);
    if (!vnode || vnode.dev !== executable.dev || vnode.ino !== executable.ino) return null;
    if (current.ppid === 1) return current.pid;
    const parent = processes.get(current.ppid);
    if (
      !parent ||
      ![0, expectedUid].includes(parent.uid) ||
      parent.executable !== EXPECTED.dockerBackendExecutable
    ) {
      return null;
    }
    current = parent;
  }
}

export function validateDockerBackendProvenance({ groups, processes, executable, vnodes, uid }) {
  if (!executable?.signatureVerified || executable.uid !== uid) {
    return {
      socketBackendVerified: false,
      postgresBackendVerified: false,
      redisBackendVerified: false,
      commonBackendVerified: false,
    };
  }
  const roots = {};
  for (const [name, pids] of Object.entries(groups)) {
    const groupRoots = new Set();
    let valid = Array.isArray(pids) && pids.length > 0;
    for (const pid of pids ?? []) {
      const root = backendRoot(pid, processes, vnodes, executable, uid);
      if (!root) {
        valid = false;
        break;
      }
      groupRoots.add(root);
    }
    roots[name] = valid && groupRoots.size === 1 ? [...groupRoots][0] : null;
  }
  return {
    socketBackendVerified: roots.socket !== null,
    postgresBackendVerified: roots.postgres !== null,
    redisBackendVerified: roots.redis !== null,
    commonBackendVerified:
      roots.socket !== null && roots.socket === roots.postgres && roots.socket === roots.redis,
  };
}

async function inspectBackendProvenance(groups, commandRunner, uid = process.getuid?.()) {
  const verify = await commandRunner('/usr/bin/codesign', [
    '--verify',
    '--strict',
    EXPECTED.dockerBackendExecutable,
  ]);
  const signature = await commandRunner('/usr/bin/codesign', [
    '-d',
    '-r-',
    '--verbose=4',
    EXPECTED.dockerBackendExecutable,
  ]);
  const stat = await commandRunner('/usr/bin/stat', [
    '-f',
    '%d:%i:%u:%Sp',
    EXPECTED.dockerBackendExecutable,
  ]);
  const ps = await commandRunner('/bin/ps', ['-axo', 'pid=,ppid=,uid=,comm=']);
  const executableStat = parseExecutableStat(stat);
  const processes = parseBackendProcesses(ps);
  const pids = [
    ...new Set([
      ...Object.values(groups).flat(),
      ...[...processes.values()]
        .filter((entry) => entry.executable === EXPECTED.dockerBackendExecutable)
        .map((entry) => entry.pid),
    ]),
  ];
  const vnodes = new Map();
  for (const pid of pids) {
    const evidence = await commandRunner('/usr/sbin/lsof', [
      '-nP',
      '-a',
      '-p',
      String(pid),
      '-d',
      'txt',
      '-FpfnDi',
    ]);
    vnodes.set(pid, parseTextVnode(evidence));
  }
  return validateDockerBackendProvenance({
    groups,
    processes,
    executable: {
      ...executableStat,
      signatureVerified:
        verify.status === 0 &&
        !verify.stdout.trim() &&
        !verify.stderr.trim() &&
        parseBackendSignature(signature),
    },
    vnodes,
    uid,
  });
}

function tcpProbe(port) {
  return new Promise((resolveProbe) => {
    const socket = createConnection({ host: '127.0.0.1', port: Number(port) });
    let settled = false;
    const finish = (state) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolveProbe(state);
    };
    socket.setTimeout(750, () => finish('failed'));
    socket.once('connect', () => finish('open'));
    socket.once('error', (error) => finish(error?.code === 'ECONNREFUSED' ? 'closed' : 'failed'));
  });
}

export async function inspectI111RuntimeResources(paths, dependencies = {}) {
  const commandRunner = dependencies.commandRunner ?? runCommand;
  const probe = dependencies.tcpProbe ?? tcpProbe;
  const workerPattern = /(?:apps\/worker|@xiaohai\/worker|dist\/[^ ]*worker)/;
  const stopped = (overrides = {}) => ({
    probesVerified: false,
    dockerEndpointVerified: false,
    backendProvenanceVerified: false,
    socketBackendVerified: false,
    postgresBackendVerified: false,
    redisBackendVerified: false,
    gateVerified: false,
    listenerTargetsVerified: false,
    resourcesVerified: false,
    apiRunning: null,
    genericWorkerRunning: null,
    ...overrides,
  });
  const inspectLocalPrerequisites = async () => {
    const [gateHead, gateStatus, processes] = await Promise.all([
      commandRunner('git', ['-C', paths.gateRoot, 'rev-parse', '--verify', 'HEAD']),
      commandRunner('git', [
        '-C',
        paths.gateRoot,
        'status',
        '--porcelain=v1',
        '--untracked-files=no',
      ]),
      commandRunner('/bin/ps', ['-axo', 'command=']),
    ]);
    const genericWorkerRunning =
      processes.status === 0 && !processes.stderr.trim()
        ? processes.stdout.split('\n').some((line) => workerPattern.test(line))
        : null;
    const verified =
      gateHead.status === 0 &&
      !gateHead.stderr.trim() &&
      gateHead.stdout.trim() === EXPECTED.gateSha &&
      gateStatus.status === 0 &&
      !gateStatus.stderr.trim() &&
      gateStatus.stdout === '' &&
      genericWorkerRunning === false;
    return { verified, genericWorkerRunning };
  };
  const localBefore = await inspectLocalPrerequisites();
  if (!localBefore.verified) {
    return stopped({ genericWorkerRunning: localBefore.genericWorkerRunning });
  }
  const dockerEndpoint = await trustedDockerEndpoint({
    ...dependencies,
    commandRunner,
  });
  if (!dockerEndpoint.verified) return stopped();
  const [api, postgres, redis] = await Promise.all([
    listener('52513', false, commandRunner),
    listener(EXPECTED.databasePort, true, commandRunner),
    listener(EXPECTED.redisPort, true, commandRunner),
  ]);
  const listenerTargetsVerified =
    postgres.verified &&
    postgres.present === true &&
    redis.verified &&
    redis.present === true &&
    api.verified &&
    api.present === false;
  if (!listenerTargetsVerified) {
    return stopped({
      dockerEndpointVerified: true,
      listenerTargetsVerified,
      apiRunning: api.present,
      genericWorkerRunning: false,
    });
  }
  if (
    !(await socketIdentityUnchanged(
      dockerEndpoint.socketIdentity,
      'before-backend-provenance',
      dependencies,
    ))
  ) {
    return stopped({ apiRunning: false, genericWorkerRunning: false });
  }
  const provenance = await inspectBackendProvenance(
    {
      socket: dockerEndpoint.socketPids,
      postgres: postgres.pids,
      redis: redis.pids,
    },
    commandRunner,
    dependencies.uid,
  );
  const socketStableAfterProvenance = await socketIdentityUnchanged(
    dockerEndpoint.socketIdentity,
    'after-backend-provenance',
    dependencies,
  );
  if (!provenance.commonBackendVerified || !socketStableAfterProvenance) {
    return stopped({
      dockerEndpointVerified: true,
      listenerTargetsVerified: true,
      apiRunning: false,
      genericWorkerRunning: false,
      ...provenance,
      backendProvenanceVerified: provenance.commonBackendVerified && socketStableAfterProvenance,
    });
  }
  const postgresResourceVerified = await dockerResource(
    EXPECTED.postgresContainer,
    EXPECTED.postgresContainerId,
    EXPECTED.postgresImage,
    EXPECTED.databasePort,
    '5432',
    EXPECTED.postgresVolume,
    EXPECTED.postgresSourceId,
    EXPECTED.postgresSourceVolume,
    '/var/lib/postgresql/data',
    commandRunner,
  );
  const redisResourceVerified = await dockerResource(
    EXPECTED.redisContainer,
    EXPECTED.redisContainerId,
    EXPECTED.redisImage,
    EXPECTED.redisPort,
    '6379',
    EXPECTED.redisVolume,
    EXPECTED.redisSourceId,
    EXPECTED.redisSourceVolume,
    '/data',
    commandRunner,
  );
  if (!postgresResourceVerified || !redisResourceVerified) {
    return stopped({
      dockerEndpointVerified: true,
      backendProvenanceVerified: true,
      listenerTargetsVerified: true,
      apiRunning: false,
      genericWorkerRunning: false,
      ...provenance,
    });
  }
  const localBeforeTcp = await inspectLocalPrerequisites();
  const socketStableBeforeTcp = await socketIdentityUnchanged(
    dockerEndpoint.socketIdentity,
    'before-tcp',
    dependencies,
  );
  if (!localBeforeTcp.verified || !socketStableBeforeTcp) {
    return stopped({
      dockerEndpointVerified: true,
      listenerTargetsVerified: true,
      apiRunning: false,
      genericWorkerRunning: localBeforeTcp.genericWorkerRunning,
      ...provenance,
      backendProvenanceVerified: provenance.commonBackendVerified && socketStableBeforeTcp,
    });
  }
  const [apiTcp, postgresTcp, redisTcp] = await Promise.all([
    probe('52513'),
    probe(EXPECTED.databasePort),
    probe(EXPECTED.redisPort),
  ]);
  const probesVerified =
    apiTcp === 'closed' &&
    postgresTcp === 'open' &&
    redisTcp === 'open' &&
    provenance.commonBackendVerified;
  return {
    probesVerified,
    dockerEndpointVerified: true,
    backendProvenanceVerified: provenance.commonBackendVerified,
    ...provenance,
    gateVerified: probesVerified,
    listenerTargetsVerified,
    resourcesVerified: postgresResourceVerified && redisResourceVerified,
    apiRunning: api.present,
    genericWorkerRunning: false,
  };
}

export async function loadI111SourceState(root, approval, dependencies) {
  const migrationRoot = resolve(root, 'packages/db/migrations');
  const journalBytes = await dependencies.secureRead(join(migrationRoot, 'meta/_journal.json'), {
    maxBytes: 256_000,
  });
  const journal = JSON.parse(journalBytes.toString('utf8'));
  if (
    !Array.isArray(journal.entries) ||
    journal.entries.length !== EXPECTED.migrationCount ||
    journal.entries.some(
      (entry, index) =>
        entry?.idx !== index ||
        !Number.isSafeInteger(entry?.when) ||
        typeof entry?.tag !== 'string' ||
        !new RegExp(`^${String(index).padStart(4, '0')}_[a-z0-9_]+$`).test(entry.tag),
    )
  ) {
    throw new Error('INVALID_JOURNAL');
  }
  const migrations = [];
  for (const entry of journal.entries) {
    const sql = await dependencies.secureRead(join(migrationRoot, `${entry.tag}.sql`), {
      maxBytes: 2_000_000,
    });
    migrations.push({ tag: entry.tag, createdAt: String(entry.when), hash: sha256(sql) });
  }
  const migrationDigest = sha256(Buffer.from(JSON.stringify(migrations)));
  const commandRunner = dependencies.commandRunner ?? runCommand;
  const head = await commandRunner('git', ['rev-parse', '--verify', 'HEAD'], root);
  const status = await commandRunner(
    'git',
    ['status', '--porcelain=v1', '--untracked-files=no', '--ignore-submodules=none'],
    root,
  );
  const diff = await commandRunner('git', ['diff', '--no-ext-diff', '--quiet', 'HEAD', '--'], root);
  const sourceHashes = {};
  for (const relative of PROVENANCE_FILES) {
    sourceHashes[relative] = sha256(
      await dependencies.secureRead(resolve(root, relative), { maxBytes: 2_000_000 }),
    );
  }
  const checkedOutSha = head.status === 0 ? head.stdout.trim() : '';
  const localApprovalRecordConsistent =
    approval?.schemaVersion === 1 &&
    approval?.approvedBy === 'Fredilly' &&
    /^https:\/\/github\.com\/Fredilly\/Xiaohai\/pull\/[1-9]\d*#pullrequestreview-[1-9]\d*$/.test(
      approval?.approvalUrl ?? '',
    ) &&
    approval?.approvedCommit === checkedOutSha &&
    /^[0-9a-f]{40}$/.test(checkedOutSha) &&
    approval?.migrationDigest === migrationDigest &&
    PROVENANCE_FILES.every(
      (relative) => approval?.sourceSha256?.[relative] === sourceHashes[relative],
    );
  const independentReviewVerified =
    localApprovalRecordConsistent &&
    (await (dependencies.reviewVerifier ?? verifyGitHubApproval)(approval, checkedOutSha, {
      commandRunner,
      root,
    }));
  const checkoutClean =
    status.status === 0 &&
    status.stdout === '' &&
    diff.status === 0 &&
    !status.stderr &&
    !diff.stderr;
  const safetyText = (
    await dependencies.secureRead(resolve(root, 'packages/config/src/image-runtime-safety.ts'), {
      maxBytes: 200_000,
    })
  ).toString('utf8');
  const signerText = (
    await dependencies.secureRead(resolve(root, 'apps/worker/src/private-bos-reference.ts'), {
      maxBytes: 300_000,
    })
  ).toString('utf8');
  const ttl = safetyText.match(
    /^export const PRIVATE_BOS_IMAGE_REFERENCE_TTL_SECONDS = ([\d_]+);$/m,
  );
  const signedTtlSeconds = ttl ? Number(ttl[1].replaceAll('_', '')) : null;
  const signerVerified =
    /PRIVATE_REFERENCE_TTL_SECONDS\s*=\s*PRIVATE_BOS_IMAGE_REFERENCE_TTL_SECONDS/.test(
      signerText,
    ) && /generatePresignedUrl\([\s\S]*?PRIVATE_REFERENCE_TTL_SECONDS/.test(signerText);
  return {
    errors:
      independentReviewVerified && checkoutClean && signerVerified
        ? []
        : ['I111_CODE_NOT_REVIEWED'],
    checkedOutSha,
    reviewedSha: independentReviewVerified ? approval.approvedCommit : '',
    versionMatch: independentReviewVerified && checkoutClean,
    checkoutClean,
    localApprovalRecordConsistent,
    independentReviewVerified,
    signedTtlSeconds: signerVerified ? signedTtlSeconds : null,
    retrySemanticsVerified: false,
    migrations,
    migrationDigest,
    sourceHashes,
  };
}

function referenceFingerprint(row) {
  const expected =
    row.name === 'Mimi'
      ? {
          id: EXPECTED.mimiId,
          referenceId: EXPECTED.mimiReferenceId,
          digest: EXPECTED.mimiSha256,
          bytes: EXPECTED.mimiBytes,
          sort: 0,
        }
      : row.name === 'Pip'
        ? {
            id: EXPECTED.pipId,
            referenceId: EXPECTED.pipReferenceId,
            digest: EXPECTED.pipSha256,
            bytes: EXPECTED.pipBytes,
            sort: 1,
          }
        : null;
  if (!expected) return { name: 'UNEXPECTED', databaseMediaMetadataMatched: false };
  const expectedKey = `picture-books/character-references/i111/${scope.ownerId}/${scope.bookId}/${expected.id}/${expected.digest}.png`;
  let urlMatched = false;
  try {
    const playback = new URL(row.playback_url);
    urlMatched =
      playback.protocol === 'https:' &&
      playback.hostname === EXPECTED.bucket + '.cd.bcebos.com' &&
      !playback.port &&
      [new URL('/' + expectedKey, playback).pathname, '//' + expectedKey].includes(
        playback.pathname,
      ) &&
      !playback.search &&
      !playback.hash &&
      !playback.username &&
      !playback.password;
  } catch {
    urlMatched = false;
  }
  const databaseMediaMetadataMatched =
    row.character_id === expected.id &&
    row.reference_id === expected.referenceId &&
    row.sort_order === expected.sort &&
    row.confirmed === true &&
    row.locked === true &&
    row.reference_media_asset_id === row.reference_row_media_asset_id &&
    row.reference_status === 'READY' &&
    row.reference_provider === 'IMPORTED' &&
    row.media_provider === 'BAIDU_BOS' &&
    row.media_status === 'READY' &&
    row.mime_type === 'image/png' &&
    row.object_key === expectedKey &&
    Number(row.byte_size) === expected.bytes &&
    urlMatched;
  return {
    name: row.name,
    characterId: row.character_id,
    locked: row.locked === true,
    confirmed: row.confirmed === true,
    status: row.reference_status,
    imported: row.reference_provider === 'IMPORTED',
    privateBos: databaseMediaMetadataMatched,
    objectKeyMatched: row.object_key === expectedKey,
    databaseMediaMetadataMatched,
    remoteBosVerified: false,
  };
}

function emptyWindow() {
  return { actualMinor: 0, reservedMinor: 0 };
}

function illustrationMediaValid(row) {
  if (row.status !== 'READY') return row.media_asset_id === null;
  if (!row.media_asset_id || row.media_id !== row.media_asset_id) return false;
  const key = `picture-books/bailian/${row.id}.png`;
  try {
    const url = new URL(row.media_playback_url);
    return (
      row.media_provider === 'BAIDU_BOS' &&
      row.media_status === 'READY' &&
      row.media_mime_type === 'image/png' &&
      row.media_object_key === key &&
      Number.isSafeInteger(Number(row.media_byte_size)) &&
      Number(row.media_byte_size) > 0 &&
      url.protocol === 'https:' &&
      url.hostname === EXPECTED.bucket + '.cd.bcebos.com' &&
      !url.port &&
      url.pathname === '/' + key &&
      !url.search &&
      !url.hash &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

function classifyCosts(illustrations, reservations, ledgers, windows) {
  const plan = [
    { pageId: scope.page1Id, revisionNumber: 1 },
    { pageId: scope.page2Id, revisionNumber: 1 },
    { pageId: scope.page2Id, revisionNumber: 2 },
  ];
  const attempts = [];
  let invalid = false;
  for (let index = 0; index < illustrations.length; index += 1) {
    const illustration = illustrations[index];
    const expected = plan[index];
    const matches = reservations.filter((item) => item.resource_id === illustration.id);
    const reservation = matches[0];
    const ledgerMatches = reservation
      ? ledgers.filter((item) => item.reservation_id === reservation.id)
      : [];
    const ledger = ledgerMatches[0];
    if (
      !expected ||
      illustration.book_id !== scope.bookId ||
      illustration.page_id !== expected.pageId ||
      illustration.revision_number !== expected.revisionNumber ||
      illustration.provider !== scope.provider ||
      illustration.model !== scope.model ||
      !illustrationMediaValid(illustration) ||
      matches.length !== 1 ||
      ledgerMatches.length !== 1 ||
      reservation.budget_key !== scope.budgetKey ||
      reservation.window_key !== scope.windowKey ||
      reservation.consumer_user_id !== scope.ownerId ||
      reservation.resource_type !== 'PICTURE_BOOK_IMAGE' ||
      reservation.provider !== scope.provider ||
      reservation.model !== scope.model ||
      reservation.reserved_minor !== scope.reservationMinor ||
      ledger.consumer_user_id !== scope.ownerId ||
      ledger.resource_type !== 'PICTURE_BOOK_IMAGE' ||
      ledger.resource_id !== illustration.id ||
      ledger.provider !== scope.provider ||
      ledger.model !== scope.model ||
      ledger.usage !== SLOT_MARKER
    ) {
      invalid = true;
      continue;
    }
    const ledgerConsistent =
      ledger.outcome === 'SUCCEEDED' &&
      reservation.actual_minor !== null &&
      ledger.amount_minor === reservation.actual_minor;
    attempts.push({
      pageId: illustration.page_id,
      revisionNumber: illustration.revision_number,
      outcome: ledger.outcome,
      mediaReady: illustration.status === 'READY' && illustrationMediaValid(illustration),
      settled: reservation.status === 'SETTLED' && reservation.uncertainty === 'NONE',
      completeCostVerified: ledgerConsistent,
      ledgerAmountConsistent: ledgerConsistent,
      providerInvoiceVerified: false,
      providerRequestIdPresent:
        Boolean(reservation.provider_request_id) &&
        reservation.provider_request_id === ledger.provider_request_id,
      reservedMinor: reservation.reserved_minor,
      actualMinor: reservation.actual_minor,
    });
  }
  if (reservations.length !== illustrations.length || ledgers.length !== illustrations.length) {
    invalid = true;
  }
  if (![0, 2].includes(windows.length)) invalid = true;
  const globalRows = windows.filter(
    (row) =>
      row.budget_key === scope.budgetKey &&
      row.window_key === scope.windowKey &&
      row.scope_type === 'GLOBAL' &&
      row.consumer_user_id === null,
  );
  const consumerRows = windows.filter(
    (row) =>
      row.budget_key === scope.budgetKey &&
      row.window_key === scope.windowKey &&
      row.scope_type === 'CONSUMER' &&
      row.consumer_user_id === scope.ownerId,
  );
  const noCosts = illustrations.length === 0 && reservations.length === 0 && ledgers.length === 0;
  const window = (rows) => {
    if (rows.length === 0 && noCosts) return emptyWindow();
    if (rows.length !== 1 || rows[0].limit_minor !== scope.budgetLimitMinor) {
      invalid = true;
      return {};
    }
    return { actualMinor: rows[0].actual_minor, reservedMinor: rows[0].reserved_minor };
  };
  if (globalRows.length + consumerRows.length !== windows.length) invalid = true;
  const unsettledAtRisk =
    reservations.filter((row) => row.uncertainty === 'AT_RISK').length +
    ledgers.filter((row) => row.outcome === 'AT_RISK').length;
  return {
    attempts,
    invalid,
    unsettledAtRisk,
    globalWindow: window(globalRows),
    consumerWindow: window(consumerRows),
  };
}

export async function collectI111Database(connectionString, openDatabase, expectedMigrations) {
  const client = await openDatabase(connectionString);
  let transaction = false;
  try {
    await client.connect();
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    transaction = true;
    await client.query("SET LOCAL lock_timeout = '1500ms'");
    await client.query("SET LOCAL statement_timeout = '8000ms'");
    const identity = await client.query(
      `/* I111_IDENTITY */ SELECT current_database() AS database_name,
       current_user AS database_user, current_setting('transaction_read_only') AS transaction_read_only,
       pg_is_in_recovery() AS is_replica, inet_server_port() AS server_port,
       current_setting('server_version_num') AS server_version_num`,
    );
    const role = await client.query(
      `/* I111_ROLE */ SELECT rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb,
       rolcanlogin, rolreplication, rolbypassrls,
       has_database_privilege(current_user, current_database(), 'CONNECT') AS can_connect
       FROM pg_roles WHERE rolname = current_user`,
    );
    const id = identity.rows[0];
    const account = role.rows[0];
    if (
      identity.rows.length !== 1 ||
      role.rows.length !== 1 ||
      id.database_name !== scope.databaseName ||
      id.database_user !== EXPECTED.databaseUser ||
      id.transaction_read_only !== 'on' ||
      id.is_replica !== false ||
      Number(id.server_port) !== 5432 ||
      !/^17\d{4}$/.test(String(id.server_version_num)) ||
      account.rolname !== EXPECTED.databaseUser ||
      account.rolsuper !== false ||
      account.rolinherit !== false ||
      account.rolcreaterole !== false ||
      account.rolcreatedb !== false ||
      account.rolcanlogin !== true ||
      account.rolreplication !== false ||
      account.rolbypassrls !== false ||
      account.can_connect !== true
    ) {
      return { errors: ['I111_DATABASE_IDENTITY_INVALID'] };
    }
    const migration = await client.query(
      '/* I111_MIGRATIONS */ SELECT id, hash, created_at::text AS created_at FROM drizzle.__drizzle_migrations ORDER BY id',
    );
    const migrationValid =
      expectedMigrations.length === EXPECTED.migrationCount &&
      migration.rows.length === EXPECTED.migrationCount &&
      migration.rows.every(
        (row, index) =>
          Number(row.id) === index + 1 &&
          row.hash === expectedMigrations[index]?.hash &&
          String(row.created_at) === expectedMigrations[index]?.createdAt,
      );
    const bookResult = await client.query(
      '/* I111_BOOK */ SELECT id, consumer_user_id, ai_project_id, status FROM picture_books WHERE id = $1',
      [scope.bookId],
    );
    const pageResult = await client.query(
      '/* I111_PAGES */ SELECT id, page_number, page_kind, source_ai_job_id, character_ids FROM work_pages WHERE picture_book_id = $1 ORDER BY page_number',
      [scope.bookId],
    );
    const referenceResult = await client.query(
      `/* I111_REFERENCES */ SELECT c.id AS character_id, c.name, c.sort_order, c.confirmed,
       c.locked, c.reference_media_asset_id, r.id AS reference_id,
       r.media_asset_id AS reference_row_media_asset_id, r.status AS reference_status,
       r.provider AS reference_provider, m.provider AS media_provider, m.status AS media_status,
       m.mime_type, m.object_key, m.playback_url, m.byte_size
       FROM character_profiles c
       LEFT JOIN character_reference_images r
         ON r.id = CASE
           WHEN c.id = $2 THEN $4::uuid
           WHEN c.id = $3 THEN $5::uuid
           ELSE NULL
         END
        AND r.character_profile_id = c.id
        AND r.media_asset_id = c.reference_media_asset_id
       LEFT JOIN media_assets m ON m.id = c.reference_media_asset_id
       WHERE c.picture_book_id = $1 ORDER BY c.sort_order, c.id`,
      [
        scope.bookId,
        EXPECTED.mimiId,
        EXPECTED.pipId,
        EXPECTED.mimiReferenceId,
        EXPECTED.pipReferenceId,
      ],
    );
    const activity = await client.query(
      `/* I111_ACTIVITY */ SELECT
       (SELECT count(*)::int FROM ai_jobs WHERE status IN ('QUEUED','RUNNING')) AS active_ai_jobs,
       (SELECT count(*)::int FROM work_page_illustrations WHERE status IN ('QUEUED','RUNNING')) AS active_illustrations,
       (SELECT count(*)::int FROM character_reference_images WHERE status IN ('QUEUED','RUNNING')) AS active_references,
       (SELECT count(*)::int FROM character_reference_images r JOIN character_profiles c
          ON c.id = r.character_profile_id WHERE c.picture_book_id = $1) AS book_reference_rows`,
      [scope.bookId],
    );
    const illustrations = await client.query(
      `/* I111_ILLUSTRATIONS */ SELECT i.id, p.picture_book_id AS book_id, i.page_id,
       i.revision_number, i.provider, i.model, i.status, i.media_asset_id,
       m.id AS media_id, m.provider AS media_provider, m.status AS media_status,
       m.mime_type AS media_mime_type, m.object_key AS media_object_key,
       m.playback_url AS media_playback_url, m.byte_size AS media_byte_size
       FROM work_page_illustrations i
       JOIN work_pages p ON p.id = i.page_id
       LEFT JOIN media_assets m ON m.id = i.media_asset_id
       ORDER BY i.created_at, i.id`,
    );
    const reservations = await client.query(
      `/* I111_RESERVATIONS */ SELECT id, budget_key, window_key, consumer_user_id,
       resource_type, resource_id, status, uncertainty, provider, model, reserved_minor,
       actual_minor, provider_request_id FROM ai_cost_reservations ORDER BY created_at, id`,
    );
    const ledgers = await client.query(
      `/* I111_LEDGERS */ SELECT reservation_id, consumer_user_id, resource_type,
       resource_id, provider, model, outcome, amount_minor, usage, provider_request_id
       FROM ai_cost_ledger ORDER BY created_at, id`,
    );
    const windows = await client.query(
      `/* I111_WINDOWS */ SELECT budget_key, window_key, scope_type, consumer_user_id,
       limit_minor, reserved_minor, actual_minor FROM ai_budget_windows ORDER BY created_at, id`,
    );
    const book = bookResult.rows[0];
    const pages = pageResult.rows;
    const orderedCharacterIds = [EXPECTED.mimiId, EXPECTED.pipId];
    const pageValid =
      pages.length === 3 &&
      pages[0]?.id === scope.coverId &&
      pages[0]?.page_number === 0 &&
      pages[0]?.page_kind === 'COVER' &&
      pages[1]?.id === scope.page1Id &&
      pages[1]?.page_number === 1 &&
      pages[1]?.page_kind === 'CONTENT' &&
      pages[2]?.id === scope.page2Id &&
      pages[2]?.page_number === 2 &&
      pages[2]?.page_kind === 'CONTENT' &&
      pages.every(
        (page) =>
          page.source_ai_job_id === null &&
          Array.isArray(page.character_ids) &&
          page.character_ids.length === 2 &&
          page.character_ids[0] === orderedCharacterIds[0] &&
          page.character_ids[1] === orderedCharacterIds[1] &&
          new Set(page.character_ids).size === 2,
      );
    const bookValid =
      bookResult.rows.length === 1 &&
      book.id === scope.bookId &&
      book.consumer_user_id === scope.ownerId &&
      ['PLANNED', 'ILLUSTRATING', 'READY'].includes(book.status) &&
      pageValid;
    const references = referenceResult.rows.map(referenceFingerprint);
    const referencesValid =
      references.length === 2 &&
      references[0]?.name === 'Mimi' &&
      references[0]?.characterId === EXPECTED.mimiId &&
      references[1]?.name === 'Pip' &&
      references[1]?.characterId === EXPECTED.pipId &&
      references.every((item) => item.databaseMediaMetadataMatched === true) &&
      activity.rows[0]?.book_reference_rows === 2;
    const costs = classifyCosts(illustrations.rows, reservations.rows, ledgers.rows, windows.rows);
    const errors = [];
    if (!migrationValid) errors.push('I111_MIGRATION_STATE_INVALID');
    if (!bookValid) errors.push('I111_BOOK_SCOPE_INVALID');
    if (!referencesValid) errors.push('I111_REFERENCES_INVALID');
    if (
      activity.rows.length !== 1 ||
      activity.rows[0]?.active_ai_jobs !== 0 ||
      activity.rows[0]?.active_illustrations !== 0 ||
      activity.rows[0]?.active_references !== 0
    ) {
      errors.push('I111_RUNTIME_NOT_ISOLATED');
    }
    if (costs.invalid || costs.unsettledAtRisk > 0) errors.push('I111_BUDGET_INVALID');
    return {
      errors,
      databaseName: id.database_name,
      dbIdentityVerified: true,
      migrationsVerified: migrationValid,
      book: bookValid
        ? {
            id: book.id,
            ownerId: book.consumer_user_id,
            coverId: pages[0].id,
            page1Id: pages[1].id,
            page2Id: pages[2].id,
            status: book.status,
          }
        : {},
      references,
      referenceMetadataVerified: referencesValid,
      activity: {
        unrelatedQueuedJobs:
          (activity.rows[0]?.active_ai_jobs ?? -1) +
          (activity.rows[0]?.active_illustrations ?? -1) +
          (activity.rows[0]?.active_references ?? -1),
        otherActiveJobs: activity.rows[0]?.active_illustrations ?? -1,
      },
      attempts: costs.attempts,
      budget: {
        unaccountedReservations: costs.invalid ? 1 : 0,
        unaccountedLedgerEntries: costs.invalid ? 1 : 0,
        unsettledAtRisk: costs.unsettledAtRisk,
        globalWindow: costs.globalWindow,
        consumerWindow: costs.consumerWindow,
        ledgerConsistencyVerified: !costs.invalid,
        providerInvoiceVerified: false,
      },
    };
  } finally {
    if (transaction) await client.query('ROLLBACK').catch(() => undefined);
    await client.end().catch(() => undefined);
  }
}

function defaultOpenDatabase(connectionString) {
  const pg = requireFromDb('pg');
  return new pg.Client({
    connectionString,
    ssl: false,
    connectionTimeoutMillis: 3_000,
    query_timeout: 8_000,
    options: '-c default_transaction_read_only=on',
  });
}

async function defaultRedisInspector(redisUrl) {
  const { createClient } = requireFromApi('redis');
  const client = createClient({ url: redisUrl, socket: { connectTimeout: 3_000 } });
  client.on('error', () => undefined);
  try {
    await client.connect();
    const lengths = await Promise.all(REDIS_QUEUES.map((queue) => client.lLen(queue)));
    return {
      verified: lengths.every((length) => Number.isSafeInteger(length) && length === 0),
      queuedJobs: lengths.reduce((sum, length) => sum + length, 0),
    };
  } finally {
    if (client.isOpen) await client.quit().catch(() => client.disconnect());
  }
}

export async function runI111ReadonlyRuntimePreflight(options = {}) {
  const root = options.root ?? resolve(fileURLToPath(new URL('..', import.meta.url)));
  const env = options.env ?? process.env;
  const paths = options.paths ?? I111_READONLY_PATHS;
  const dependencies = {
    secureRead:
      options.dependencies?.secureRead ??
      ((path, settings) => secureReadFile(path, settings, options.dependencies)),
    runtimeInspector: options.dependencies?.runtimeInspector ?? inspectI111RuntimeResources,
    openDatabase: options.dependencies?.openDatabase ?? defaultOpenDatabase,
    redisInspector: options.dependencies?.redisInspector ?? defaultRedisInspector,
    fileInspector: options.dependencies?.fileInspector ?? inspectFiles,
    sourceInspector: options.dependencies?.sourceInspector ?? loadI111SourceState,
  };
  const errors = [];
  try {
    if ((options.argv ?? process.argv.slice(2)).length !== 0) {
      return {
        result: 'STOP',
        errorCodes: ['I111_ARGUMENTS_FORBIDDEN'],
        paidExecutionAuthorized: false,
        checks: {},
      };
    }
    const connectionString = validateLocalUrl(env.DATABASE_URL, 'postgres');
    const redisUrl = validateLocalUrl(env.REDIS_URL, 'redis');
    if (!connectionString) errors.push('I111_DATABASE_IDENTITY_INVALID');
    if (!redisUrl) errors.push('I111_REDIS_CHECK_FAILED');

    const files = await dependencies.fileInspector(paths, dependencies);
    errors.push(...files.errors);
    let source;
    try {
      source = await dependencies.sourceInspector(root, files.approval, dependencies);
      errors.push(...source.errors);
    } catch {
      source = {
        errors: ['I111_CODE_NOT_REVIEWED'],
        checkedOutSha: '',
        reviewedSha: '',
        versionMatch: false,
        signedTtlSeconds: null,
        retrySemanticsVerified: false,
        migrations: [],
      };
      errors.push(...source.errors);
    }
    const config = inspectConfiguration(env, source);
    errors.push(...config.errors);

    errors.push(
      'I111_ATOMIC_ISOLATION_UNVERIFIED',
      'I111_RETRY_SEMANTICS_UNVERIFIED',
      'I111_REMOTE_BOS_UNVERIFIED',
      'I111_PRICE_BASIS_UNVERIFIED',
    );

    // A STOP verdict alone is insufficient: a rejected local prerequisite must
    // prevent even Docker inspection and unauthenticated TCP probes.
    const filesVerified =
      files.errors.length === 0 &&
      files.backupVerified === true &&
      files.mimiLocalPngVerified === true &&
      files.pipLocalPngVerified === true &&
      files.apiModeDisabled === true;
    const sourceVerified =
      source.errors.length === 0 &&
      source.versionMatch === true &&
      source.checkoutClean === true &&
      source.independentReviewVerified === true &&
      Array.isArray(source.migrations) &&
      source.migrations.length === EXPECTED.migrationCount;
    if (!files.backupVerified) errors.push('I111_BACKUP_NOT_VERIFIED');
    if (!files.mimiLocalPngVerified || !files.pipLocalPngVerified) {
      errors.push('I111_LOCAL_REFERENCE_FILES_INVALID');
    }
    if (!files.apiModeDisabled) errors.push('I111_RUNTIME_NOT_ISOLATED');
    if (!sourceVerified) errors.push('I111_CODE_NOT_REVIEWED');
    if (!Array.isArray(source.migrations) || source.migrations.length !== EXPECTED.migrationCount) {
      errors.push('I111_MIGRATION_STATE_INVALID');
    }
    if (
      !connectionString ||
      !redisUrl ||
      !filesVerified ||
      !sourceVerified ||
      config.errors.length
    ) {
      const errorCodes = safeCodes(errors);
      return {
        result: 'STOP',
        errorCodes,
        paidExecutionAuthorized: false,
        checks: {
          code: sourceVerified ? 'PASS' : 'STOP',
          database: 'STOP',
          postgresResource: 'STOP',
          backup: files.backupVerified === true ? 'PASS' : 'STOP',
          localPngFingerprints:
            files.mimiLocalPngVerified === true && files.pipLocalPngVerified === true
              ? 'PASS'
              : 'STOP',
          databaseReferenceMetadata: 'STOP',
          remoteBos: 'STOP',
          processAndRedisSampling: 'STOP',
          atomicIsolation: 'STOP',
          retrySemantics: 'STOP',
          runtime: 'STOP',
          redis: 'STOP',
          providerConfig: config.errors.some((code) =>
            ['I111_PROVIDER_CONFIG_INVALID', 'I111_PROVIDER_CREDENTIALS_MISSING'].includes(code),
          )
            ? 'STOP'
            : 'PASS',
          budget: 'STOP',
        },
      };
    }

    let runtimeBefore;
    try {
      runtimeBefore = await dependencies.runtimeInspector(paths);
      if (
        !runtimeBefore.probesVerified ||
        !runtimeBefore.dockerEndpointVerified ||
        !runtimeBefore.backendProvenanceVerified ||
        !runtimeBefore.gateVerified ||
        !runtimeBefore.listenerTargetsVerified ||
        !runtimeBefore.resourcesVerified ||
        runtimeBefore.apiRunning !== false ||
        runtimeBefore.genericWorkerRunning !== false
      ) {
        errors.push('I111_RUNTIME_NOT_ISOLATED');
      }
      if (!runtimeBefore.resourcesVerified || !runtimeBefore.listenerTargetsVerified) {
        errors.push('I111_POSTGRES_RESOURCE_INVALID');
      }
    } catch {
      runtimeBefore = {
        probesVerified: false,
        dockerEndpointVerified: false,
        backendProvenanceVerified: false,
        gateVerified: false,
        listenerTargetsVerified: false,
        resourcesVerified: false,
        apiRunning: null,
        genericWorkerRunning: null,
      };
      errors.push('I111_RUNTIME_NOT_ISOLATED', 'I111_POSTGRES_RESOURCE_INVALID');
    }

    const resourcesVerifiedBeforeConnections =
      runtimeBefore.probesVerified === true &&
      runtimeBefore.dockerEndpointVerified === true &&
      runtimeBefore.backendProvenanceVerified === true &&
      runtimeBefore.gateVerified === true &&
      runtimeBefore.listenerTargetsVerified === true &&
      runtimeBefore.resourcesVerified === true &&
      runtimeBefore.apiRunning === false &&
      runtimeBefore.genericWorkerRunning === false;
    let redisBefore = { verified: false, queuedJobs: -1 };
    let redisAfter = { verified: false, queuedJobs: -1 };
    if (resourcesVerifiedBeforeConnections && redisUrl) {
      try {
        redisBefore = await dependencies.redisInspector(redisUrl);
      } catch {
        errors.push('I111_REDIS_CHECK_FAILED');
      }
    }
    if (!redisBefore.verified || redisBefore.queuedJobs !== 0) {
      errors.push('I111_REDIS_CHECK_FAILED', 'I111_RUNTIME_NOT_ISOLATED');
    }

    let database = { errors: ['I111_DATABASE_CHECK_FAILED'] };
    if (
      resourcesVerifiedBeforeConnections &&
      redisBefore.verified === true &&
      redisBefore.queuedJobs === 0 &&
      connectionString &&
      source.migrations.length === EXPECTED.migrationCount
    ) {
      try {
        database = await collectI111Database(
          connectionString,
          dependencies.openDatabase,
          source.migrations,
        );
      } catch {
        database = { errors: ['I111_DATABASE_CHECK_FAILED'] };
      }
    } else if (resourcesVerifiedBeforeConnections && connectionString) {
      database = { errors: ['I111_MIGRATION_STATE_INVALID'] };
    }
    errors.push(...database.errors);

    if (resourcesVerifiedBeforeConnections && redisUrl && redisBefore.verified) {
      try {
        redisAfter = await dependencies.redisInspector(redisUrl);
      } catch {
        errors.push('I111_REDIS_CHECK_FAILED');
      }
    }
    if (!redisAfter.verified || redisAfter.queuedJobs !== 0) {
      errors.push('I111_REDIS_CHECK_FAILED', 'I111_RUNTIME_NOT_ISOLATED');
    }

    let runtimeAfter = {
      probesVerified: false,
      dockerEndpointVerified: false,
      backendProvenanceVerified: false,
      gateVerified: false,
      listenerTargetsVerified: false,
      resourcesVerified: false,
      apiRunning: null,
      genericWorkerRunning: null,
    };
    if (resourcesVerifiedBeforeConnections) {
      try {
        runtimeAfter = await dependencies.runtimeInspector(paths);
      } catch {
        errors.push('I111_RUNTIME_NOT_ISOLATED', 'I111_POSTGRES_RESOURCE_INVALID');
      }
    }
    const runtimeSamplesIdle =
      resourcesVerifiedBeforeConnections &&
      runtimeAfter.probesVerified === true &&
      runtimeAfter.dockerEndpointVerified === true &&
      runtimeAfter.backendProvenanceVerified === true &&
      runtimeAfter.gateVerified === true &&
      runtimeAfter.listenerTargetsVerified === true &&
      runtimeAfter.resourcesVerified === true &&
      runtimeAfter.apiRunning === false &&
      runtimeAfter.genericWorkerRunning === false &&
      redisBefore.verified === true &&
      redisBefore.queuedJobs === 0 &&
      redisAfter.verified === true &&
      redisAfter.queuedJobs === 0;
    if (!runtimeSamplesIdle) errors.push('I111_RUNTIME_NOT_ISOLATED');

    const attempts = database.attempts ?? [];
    const next = [
      { pageId: scope.page1Id, revisionNumber: 1 },
      { pageId: scope.page2Id, revisionNumber: 1 },
      { pageId: scope.page2Id, revisionNumber: 2 },
    ][attempts.length] ?? { pageId: '', revisionNumber: 0 };
    const snapshot = {
      checkedOutSha: source.checkedOutSha,
      reviewedSha: source.reviewedSha,
      appEnv: env.APP_ENV,
      databaseName: database.databaseName,
      dbIdentityVerified: database.dbIdentityVerified === true && runtimeSamplesIdle,
      originalBackupVerified: files.backupVerified,
      backupSha256Matched: files.backupVerified,
      book: database.book ?? {},
      references: (database.references ?? []).map((item) => ({
        ...item,
        sha256Matched:
          item.name === 'Mimi'
            ? files.mimiLocalPngVerified
            : item.name === 'Pip' && files.pipLocalPngVerified,
      })),
      runtime: {
        ...config.runtime,
        apiRunning:
          runtimeBefore.apiRunning === false && runtimeAfter.apiRunning === false
            ? false
            : runtimeAfter.apiRunning,
        genericWorkerRunning:
          runtimeBefore.genericWorkerRunning === false &&
          runtimeAfter.genericWorkerRunning === false
            ? false
            : runtimeAfter.genericWorkerRunning,
        unrelatedQueuedJobs:
          (database.activity?.unrelatedQueuedJobs ?? -1) +
          Math.max(redisBefore.queuedJobs ?? -1, redisAfter.queuedJobs ?? -1),
        otherActiveJobs: database.activity?.otherActiveJobs ?? -1,
      },
      budget: { ...config.budget, ...(database.budget ?? {}) },
      attempts,
      requestedPageId: next.pageId,
      requestedRevisionNumber: next.revisionNumber,
    };
    const policy = assessI111OneShotSnapshot(snapshot);
    errors.push(...policy.errorCodes);
    const errorCodes = safeCodes(errors);
    const databaseStop = (database.errors ?? []).some((code) =>
      [
        'I111_DATABASE_CHECK_FAILED',
        'I111_DATABASE_IDENTITY_INVALID',
        'I111_MIGRATION_STATE_INVALID',
        'I111_BOOK_SCOPE_INVALID',
        'I111_REFERENCES_INVALID',
      ].includes(code),
    );
    return {
      result: errorCodes.length === 0 && policy.verdict === 'STATIC_REVIEW_ONLY' ? 'PASS' : 'STOP',
      errorCodes,
      paidExecutionAuthorized: false,
      checks: {
        code:
          source.versionMatch && !errorCodes.includes('I111_CODE_NOT_REVIEWED') ? 'PASS' : 'STOP',
        database: databaseStop ? 'STOP' : 'PASS',
        postgresResource: runtimeSamplesIdle ? 'PASS' : 'STOP',
        backup: files.backupVerified ? 'PASS' : 'STOP',
        localPngFingerprints:
          files.mimiLocalPngVerified && files.pipLocalPngVerified ? 'PASS' : 'STOP',
        databaseReferenceMetadata: database.referenceMetadataVerified === true ? 'PASS' : 'STOP',
        remoteBos: 'STOP',
        processAndRedisSampling: runtimeSamplesIdle ? 'PASS' : 'STOP',
        atomicIsolation: 'STOP',
        retrySemantics: 'STOP',
        runtime: 'STOP',
        redis:
          redisBefore.verified &&
          redisBefore.queuedJobs === 0 &&
          redisAfter.verified &&
          redisAfter.queuedJobs === 0
            ? 'PASS'
            : 'STOP',
        providerConfig: errorCodes.some((code) =>
          ['I111_PROVIDER_CONFIG_INVALID', 'I111_PROVIDER_CREDENTIALS_MISSING'].includes(code),
        )
          ? 'STOP'
          : 'PASS',
        budget: errorCodes.some((code) =>
          ['I111_BUDGET_INVALID', 'I111_PRICE_BASIS_UNVERIFIED'].includes(code),
        )
          ? 'STOP'
          : 'PASS',
      },
    };
  } catch {
    return {
      result: 'STOP',
      errorCodes: ['I111_UNEXPECTED_FAILURE'],
      paidExecutionAuthorized: false,
      checks: {},
    };
  }
}

const invokedDirectly =
  Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const result = await runI111ReadonlyRuntimePreflight();
  console.log(JSON.stringify(result));
  process.exitCode = result.result === 'PASS' ? 0 : 1;
}

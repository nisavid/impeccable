import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs, { mkdtempSync, readFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { allocateVersion, selectRelease, reserveCandidate } from '../scripts/repack.mjs';

test('allocates matching upstream version, then monotonic packaging and upstream corrections', () => {
  const inventory = { complete: true, records: [] };
  assert.equal(allocateVersion('4.8.0', inventory), '4.8.0');
  inventory.records.push({ version: '4.8.1+from.4.8.0' });
  assert.equal(allocateVersion('4.8.0', inventory), '4.8.2+from.4.8.0');
  inventory.records.push({ version: '4.8.2+from.4.8.0', status: 'withdrawn' });
  assert.equal(allocateVersion('4.8.1', inventory), '4.8.3+from.4.8.1');
  assert.equal(allocateVersion('4.9.0', inventory), '4.9.0');
  assert.equal(allocateVersion('4.9.0', inventory, { advance: true }), '4.9.1+from.4.9.0');
  assert.throws(() => allocateVersion('4.7.0', inventory), /older.*line/);
  assert.throws(() => allocateVersion('4.8.0', { ...inventory, complete: false }), /complete/);
  assert.throws(() => allocateVersion('4.8.0', { complete: true, records: [
    { version: '4.8.0', archiveSha256: 'a'.repeat(64) },
    { version: '4.8.0', archiveSha256: 'b'.repeat(64) },
  ] }), /conflict/i);
});

test('selects numerically highest stable skill release only after complete enumeration', () => {
  const listing = { complete: true, releases: [
    { id: 1, tag_name: 'skill-v4.9.0', draft: false, prerelease: false },
    { id: 2, tag_name: 'skill-v4.10.0', draft: false, prerelease: false },
    { id: 3, tag_name: 'cli-v99.0.0', draft: false, prerelease: false },
    { id: 4, tag_name: 'skill-v9.0.0', draft: true, prerelease: false },
    { id: 5, tag_name: 'skill-v8.0.0', draft: false, prerelease: true },
  ] };
  assert.equal(selectRelease(listing).id, 2);
  assert.throws(() => selectRelease({ ...listing, complete: false }), /complete/);
});

test('stops selection when a higher canonical skill release has unknown eligibility', () => {
  const eligible = { tag_name: 'skill-v4.8.0', draft: false, prerelease: false };
  const higher = { ...eligible, tag_name: 'skill-v4.9.0' };
  const listing = release => ({ complete: true, releases: [eligible, { ...higher, ...release }] });
  for (const flags of [{ prerelease: undefined }, { draft: undefined }, { prerelease: null }, { draft: 'false' }]) {
    assert.throws(() => selectRelease(listing(flags)), /Cannot determine eligibility for upstream release: skill-v4\.9\.0/);
  }
  for (const flags of [{ prerelease: true }, { draft: true }, { draft: true, prerelease: undefined }, { draft: undefined, prerelease: true }]) {
    assert.equal(selectRelease(listing(flags)), eligible);
  }
});

test('excludes noncanonical tags and rejects out-of-range stable tags before sorting', () => {
  const stable = tag_name => ({ tag_name, draft: false, prerelease: false });
  const valid = stable('skill-v4.8.0');
  const invalid = [stable('skill-v04.8.0'), stable('skill-v4.8.0\n')];
  for (const release of invalid) {
    assert.throws(() => selectRelease({ complete: true, releases: [release] }), /No stable skill release/);
    assert.equal(selectRelease({ complete: true, releases: [release, valid] }), valid);
  }
  const oversized = stable('skill-v4.8.9007199254740992');
  for (const releases of [[oversized], [valid, oversized]]) {
    assert.throws(() => selectRelease({ complete: true, releases }), /Version exceeds safe integer range/);
  }
});

test('reservations are create-only and include failed candidates in later allocation', t => {
  const request = reservationRequest(t);
  const { directory } = request;
  const first = reserveCandidate(request);
  assert.equal(first.version, '4.8.0');
  assert.deepEqual(JSON.parse(readFileSync(path.join(directory, 'repack-v4.8.0.json'))), first);
  assert.equal(reserveCandidate(request).version, '4.8.1+from.4.8.0');
  mkdirSync(path.join(directory, '.allocation-lock'));
  assert.throws(() => reserveCandidate(request), /lock/);
});

function reservationRequest(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'impeccable-reservation-recovery-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const binding = { procedureRevision: 'a'.repeat(40), inputsSha256: 'b'.repeat(64) };
  return { upstream: '4.8.0', inventory: { complete: true, records: [] }, binding, directory };
}

test('allocate and reserve require the caller to supply an exposure records array', t => {
  const request = reservationRequest(t);
  const command = fileURLToPath(new URL('../scripts/repack.mjs', import.meta.url));
  const requestFile = path.join(request.directory, 'request.json');
  function run(verb, records) {
    writeFileSync(requestFile, JSON.stringify({ ...request, inventory: { complete: true, records } }));
    return spawnSync(process.execPath, [command, verb, requestFile], { encoding: 'utf8' });
  }
  for (const verb of ['allocate', 'reserve']) {
    for (const records of [undefined, null, '', 'records', {}, 0, false]) {
      const result = run(verb, records);
      assert.equal(result.status, 1, `${verb} accepted records ${JSON.stringify(records)}`);
      assert.match(result.stderr, /complete exposure inventory is required/i);
      assert.deepEqual(readdirSync(request.directory), ['request.json']);
    }
  }
  const preview = run('allocate', []);
  assert.equal(preview.status, 0, preview.stderr);
  assert.equal(JSON.parse(preview.stdout).version, '4.8.0');
  assert.deepEqual(readdirSync(request.directory), ['request.json']);
  const reserved = run('reserve', []);
  assert.equal(reserved.status, 0, reserved.stderr);
  assert.equal(JSON.parse(reserved.stdout).reservation.version, '4.8.0');
  assert.deepEqual(readdirSync(request.directory).sort(), ['repack-v4.8.0.json', 'request.json']);
});

test('reconciles matching local and exposure identities and rejects conflicting input digests', t => {
  const request = reservationRequest(t);
  const first = reserveCandidate(request);
  request.inventory.records = [{ version: first.version, inputsSha256: 'c'.repeat(64) }];
  assert.throws(() => reserveCandidate(request), /Conflicting exposed version identity/);
  assert.deepEqual(readdirSync(request.directory), ['repack-v4.8.0.json']);
  request.inventory.records[0].inputsSha256 = request.binding.inputsSha256;
  assert.equal(reserveCandidate(request).version, '4.8.1+from.4.8.0');
});

test('preserves retained reservations with invalid schemas or unresolved bindings', t => {
  const request = reservationRequest(t);
  const filename = 'repack-v4.8.0.json';
  const reservation = { schema: 1, version: '4.8.0', binding: request.binding };
  const variants = [
    { version: reservation.version },
    { ...reservation, schema: 2 },
    { ...reservation, binding: undefined },
    { ...reservation, binding: { inputsSha256: request.binding.inputsSha256 } },
    { ...reservation, binding: { procedureRevision: request.binding.procedureRevision } },
    { ...reservation, binding: { ...request.binding, procedureRevision: [request.binding.procedureRevision] } },
    { ...reservation, binding: { ...request.binding, inputsSha256: 'bad digest' } },
  ];
  for (const record of variants) {
    const retained = Buffer.from(JSON.stringify(record));
    writeFileSync(path.join(request.directory, filename), retained);
    assert.throws(() => reserveCandidate(request), /Retained reservation needs schema 1 and immutable procedure and input identities/);
    assert.deepEqual(readdirSync(request.directory), [filename]);
    assert.deepEqual(readFileSync(path.join(request.directory, filename)), retained);
  }
});

test('rejects misnamed local reservations and releases the allocation lock', t => {
  const request = reservationRequest(t);
  writeFileSync(path.join(request.directory, 'repack-v4.8.0.json'), JSON.stringify({ version: '4.9.0' }));
  assert.throws(() => reserveCandidate(request), /Reservation filename and version disagree/);
  assert.deepEqual(readdirSync(request.directory), ['repack-v4.8.0.json']);
});

test('reports filesystem errors acquiring the lock separately from contention', t => {
  const request = reservationRequest(t);
  const mkdir = fs.mkdirSync;
  t.mock.method(fs, 'mkdirSync', (filename, options) => {
    if (path.basename(filename) === '.allocation-lock') {
      throw Object.assign(new Error('lock parent is read-only'), { code: 'EROFS' });
    }
    return mkdir(filename, options);
  });
  syncBuiltinESMExports();
  try {
    assert.throws(() => reserveCandidate(request), { code: 'EROFS', message: 'lock parent is read-only' });
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

test('reports lock cleanup failure alongside the primary error or written reservation', t => {
  const request = reservationRequest(t);
  const lock = path.join(request.directory, '.allocation-lock');
  t.mock.method(fs, 'rmdirSync', () => {
    throw Object.assign(new Error('lock removal denied'), { code: 'EACCES' });
  });
  syncBuiltinESMExports();
  try {
    const cleanup = { lock, code: 'EACCES', error: 'lock removal denied' };
    assert.throws(() => reserveCandidate({ ...request, inventory: { complete: false } }), {
      message: 'A complete exposure inventory is required.',
      lockCleanup: cleanup,
    });
    assert.deepEqual(readdirSync(request.directory), ['.allocation-lock']);
    fs.rmSync(lock, { recursive: true });

    const reservation = path.join(request.directory, 'repack-v4.8.0.json');
    assert.throws(() => reserveCandidate(request), {
      message: 'Reservation was written; reconcile it before retrying allocation.',
      lockCleanup: { ...cleanup, reservation },
    });
    assert.deepEqual(readdirSync(request.directory).sort(), ['.allocation-lock', 'repack-v4.8.0.json']);
    const retained = JSON.parse(readFileSync(reservation));
    assert.equal(retained.version, '4.8.0');
    assert.deepEqual(retained.binding, request.binding);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

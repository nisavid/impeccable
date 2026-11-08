import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, mkdirSync } from 'node:fs';
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

test('reservations are create-only and include failed candidates in later allocation', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'impeccable-reservations-'));
  const binding = { procedureRevision: 'a'.repeat(40), inputsSha256: 'b'.repeat(64) };
  const inventory = { complete: true, records: [] };
  const first = reserveCandidate({ upstream: '4.8.0', inventory, binding, directory });
  assert.equal(first.version, '4.8.0');
  assert.deepEqual(JSON.parse(readFileSync(path.join(directory, 'repack-v4.8.0.json'))), first);
  assert.equal(reserveCandidate({ upstream: '4.8.0', inventory, binding, directory }).version, '4.8.1+from.4.8.0');
  mkdirSync(path.join(directory, '.allocation-lock'));
  assert.throws(() => reserveCandidate({ upstream: '4.8.0', inventory, binding, directory }), /lock/);
});

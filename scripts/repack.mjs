#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readdirSync, readFileSync, rmdirSync, writeFileSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCandidate, jsonBytes } from './lib/repack-package.mjs';
import { safePath } from './lib/repack-zip.mjs';

export { allocateVersion, selectRelease } from './lib/repack-version.mjs';
import { allocateVersion, selectRelease } from './lib/repack-version.mjs';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function reserveCandidate({ upstream, inventory, binding, directory, advance = false }) {
  if (!/^[0-9a-f]{40}$/.test(binding?.procedureRevision) || !/^[0-9a-f]{64}$/.test(binding?.inputsSha256)) throw new Error('Reservation needs immutable procedure and input identities.');
  mkdirSync(directory, { recursive: true });
  const lock = path.join(directory, '.allocation-lock');
  try { mkdirSync(lock); } catch { throw new Error('Allocation lock unavailable; reconcile concurrent or interrupted allocation.'); }
  try {
    const local = readdirSync(directory).filter(name => name.startsWith('repack-v')).map(name => {
      const bytes = readFileSync(path.join(directory, name));
      const record = JSON.parse(bytes);
      if (name !== `repack-v${record.version}.json`) throw new Error('Reservation filename and version disagree.');
      return { version: record.version, status: 'reserved', reservationSha256: sha256(bytes) };
    });
    const exposureInventory = { ...inventory, records: [...(inventory?.records ?? []), ...local] };
    const version = allocateVersion(upstream, exposureInventory, { advance });
    const reservation = { schema: 1, version, upstream, binding, advance, exposureInventory, exposureInventorySha256: sha256(jsonBytes(exposureInventory)) };
    writeFileSync(path.join(directory, `repack-v${version}.json`), `${JSON.stringify(reservation, null, 2)}\n`, { flag: 'wx', mode: 0o644 });
    return reservation;
  } finally { rmdirSync(lock); }
}

const readJson = filename => JSON.parse(readFileSync(filename, 'utf8'));
export function loadBuildRequest(filename) {
  const request = readJson(filename);
  const resolve = name => path.resolve(path.dirname(filename), name);
  const pin = readJson(resolve(request.pin));
  const policy = readJson(resolve(request.policy));
  const reservation = readJson(resolve(request.reservation));
  if (reservation.schema !== 1 || reservation.upstream !== pin.version || reservation.binding?.inputsSha256 !== sha256(jsonBytes({ pin, policy })) || !/^[0-9a-f]{64}$/.test(reservation.exposureInventorySha256)) throw new Error('Reservation does not bind these pinned inputs and enrolled policy.');
  const sourceRoot = resolve(request.sourceRoot);
  const sources = pin.sourceFiles.map(expected => {
    safePath(expected.sourcePath);
    let current = sourceRoot;
    for (const part of expected.sourcePath.split('/')) {
      current = path.join(current, part);
      if (lstatSync(current).isSymbolicLink()) throw new Error('Supplemental source links are unsupported.');
    }
    const info = lstatSync(current);
    if (!info.isFile()) throw new Error('Supplemental source must be a regular file.');
    return { name: expected.name, bytes: readFileSync(current), mode: info.mode & 0o777 };
  });
  return { universal: readFileSync(resolve(request.universal)), signature: readFileSync(resolve(request.signature)), pin, policy, sources, reservation, version: reservation.version, procedureRevision: reservation.binding.procedureRevision };
}

function outputFiles(result) {
  return [
    { name: result.candidate.archive.name, bytes: result.archive, mode: 0o644 },
    { name: 'candidate.json', bytes: jsonBytes(result.candidate), mode: 0o644 },
    { name: 'marketplace/.agents/plugins/marketplace.json', bytes: jsonBytes(result.catalog), mode: 0o644 },
    ...result.payload.map(file => ({ ...file, name: `marketplace/plugins/impeccable/${file.name}` })),
  ];
}

export function writeCandidate(input, output) {
  const result = buildCandidate(input);
  mkdirSync(output, { mode: 0o755 });
  for (const file of outputFiles(result)) {
    safePath(file.name);
    const destination = path.join(output, file.name);
    mkdirSync(path.dirname(destination), { recursive: true, mode: 0o755 });
    writeFileSync(destination, file.bytes, { flag: 'wx', mode: file.mode });
    chmodSync(destination, file.mode);
  }
  validateCandidate(input, output);
  return result.candidate;
}

export function validateCandidate(input, output) {
  const result = buildCandidate(input);
  const expected = outputFiles(result);
  const found = [];
  function walk(directory, prefix = '') {
    for (const name of readdirSync(directory)) {
      const filename = path.join(directory, name);
      const info = lstatSync(filename);
      if (info.isDirectory()) walk(filename, `${prefix}${name}/`);
      else if (info.isFile()) found.push(`${prefix}${name}`);
      else throw new Error('Candidate contains links or special files.');
    }
  }
  if (!lstatSync(output).isDirectory() || lstatSync(output).isSymbolicLink()) throw new Error('Candidate output must be a directory.');
  walk(output);
  if (JSON.stringify(found.sort()) !== JSON.stringify(expected.map(file => file.name).sort())) throw new Error('Candidate output inventory mismatch.');
  for (const file of expected) {
    const filename = path.join(output, file.name);
    if ((lstatSync(filename).mode & 0o777) !== file.mode || !readFileSync(filename).equals(file.bytes)) throw new Error(`Candidate bytes or mode mismatch: ${file.name}`);
  }
  return result.candidate;
}

async function main() {
  const [verb, filename, output, ...extra] = process.argv.slice(2);
  if (extra.length || !filename || !['select', 'allocate', 'reserve', 'build', 'validate'].includes(verb) || (['build', 'validate'].includes(verb) ? !output : output !== undefined)) {
    console.error('Usage: node scripts/repack.mjs <select|allocate|reserve> <request.json> OR <build|validate> <build-request.json> <output-directory>');
    process.exitCode = 2;
    return;
  }
  try {
    let result;
    if (verb === 'select') result = { outcome: 'selected', release: selectRelease(readJson(filename)) };
    else if (verb === 'allocate') {
      const request = readJson(filename);
      result = { outcome: 'allocated-preview', version: allocateVersion(request.upstream, request.inventory, { advance: request.advance }) };
    } else if (verb === 'reserve') {
      const request = readJson(filename);
      result = { outcome: 'reserved', reservation: reserveCandidate(request) };
    } else {
      const input = loadBuildRequest(filename);
      result = { outcome: verb === 'build' ? 'candidate' : 'validated', candidate: verb === 'build' ? writeCandidate(input, output) : validateCandidate(input, output) };
    }
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(JSON.stringify({ outcome: 'failed', error: error.message }));
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

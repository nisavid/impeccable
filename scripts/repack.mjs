#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readdirSync, readFileSync, rmdirSync, writeFileSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCandidate, checkEnrollment, jsonBytes, sourcePins } from './lib/repack-package.mjs';
import { safePath } from './lib/repack-zip.mjs';
import { CLAUDE_MARKETPLACE_DIRECTORY } from './lib/repack-claude.mjs';
import { commitSnapshot } from './lib/repack-git-commit.mjs';

export { allocateVersion, selectRelease } from './lib/repack-version.mjs';
import { allocateVersion, requireExposureInventory, selectRelease } from './lib/repack-version.mjs';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function isProcedureRevision(value) {
  return typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
}

function isReservationBinding(binding) {
  return isProcedureRevision(binding?.procedureRevision) &&
    typeof binding.inputsSha256 === 'string' && /^[0-9a-f]{64}$/.test(binding.inputsSha256);
}

const reservationFields = ['schema', 'version', 'upstream', 'binding', 'advance', 'exposureInventory', 'exposureInventorySha256'];

function reservationBytes(reservation) {
  return jsonBytes(Object.fromEntries(reservationFields.map(field => [field, reservation[field]])));
}

function readReservation(filename) {
  const bytes = readFileSync(filename);
  const reservation = JSON.parse(bytes);
  if (!reservation || !reservationFields.every(field => Object.hasOwn(reservation, field)) || !bytes.equals(reservationBytes(reservation))) {
    throw new Error(`Reservation must match the exact serialization emitted by reserve: ${path.basename(filename)}`);
  }
  return { reservation, bytes };
}

export function reserveCandidate({ upstream, inventory, binding, directory, advance = false }) {
  if (!isReservationBinding(binding)) throw new Error('Reservation needs immutable procedure and input identities.');
  mkdirSync(directory, { recursive: true });
  const lock = path.join(directory, '.allocation-lock');
  try {
    mkdirSync(lock);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    throw new Error('Allocation lock unavailable; reconcile concurrent or interrupted allocation.', { cause: error });
  }
  let written;
  let reservation;
  let failure;
  try {
    requireExposureInventory(inventory);
    const local = readdirSync(directory).filter(name => name.startsWith('repack-v')).map(name => {
      const { reservation: record, bytes } = readReservation(path.join(directory, name));
      if (name !== `repack-v${record?.version}.json`) throw new Error('Reservation filename and version disagree.');
      if (record?.schema !== 1 || !isReservationBinding(record.binding)) {
        throw new Error(`Retained reservation needs schema 1 and immutable procedure and input identities: ${name}`);
      }
      return { version: record.version, status: 'reserved', inputsSha256: record.binding.inputsSha256, reservationSha256: sha256(bytes) };
    });
    const exposureInventory = { ...inventory, records: [...inventory.records, ...local] };
    const version = allocateVersion(upstream, exposureInventory, { advance });
    reservation = { schema: 1, version, upstream, binding, advance, exposureInventory, exposureInventorySha256: sha256(jsonBytes(exposureInventory)) };
    const filename = path.join(directory, `repack-v${version}.json`);
    writeFileSync(filename, reservationBytes(reservation), { flag: 'wx', mode: 0o644 });
    written = filename;
  } catch (error) {
    failure = error;
  }
  try {
    rmdirSync(lock);
  } catch (error) {
    failure ??= new Error('Reservation was written; reconcile it before retrying allocation.', { cause: error });
    failure.lockCleanup = { lock, code: error.code, error: error.message, ...(written && { reservation: written }) };
  }
  if (failure) throw failure;
  return reservation;
}

function readSupplemental(sourceRoot, sourcePath) {
  safePath(sourcePath);
  let current = sourceRoot;
  let info;
  for (const part of sourcePath.split('/')) {
    current = path.join(current, part);
    info = lstatSync(current, { throwIfNoEntry: false });
    if (!info) throw new Error(`Missing pinned supplemental source: ${sourcePath}`);
    if (info.isSymbolicLink()) throw new Error('Supplemental source links are unsupported.');
  }
  if (!info.isFile()) throw new Error('Supplemental source must be a regular file.');
  return { bytes: readFileSync(current), mode: info.mode & 0o100 ? 0o755 : 0o644 };
}

// Every regular file under sourceRoot/<directory>, as sourceRoot-relative paths.
function listStagedFiles(sourceRoot, directory) {
  const root = path.join(sourceRoot, directory);
  if (!lstatSync(root, { throwIfNoEntry: false })?.isDirectory()) return [];
  const files = [];
  (function walk(current, prefix) {
    for (const name of readdirSync(current).sort()) {
      const info = lstatSync(path.join(current, name));
      if (info.isSymbolicLink()) throw new Error('Supplemental source links are unsupported.');
      if (info.isDirectory()) walk(path.join(current, name), `${prefix}${name}/`);
      else if (info.isFile()) files.push(`${prefix}${name}`);
      else throw new Error('Supplemental source must be a regular file.');
    }
  })(root, `${directory}/`);
  return files;
}

const readJson = filename => JSON.parse(readFileSync(filename, 'utf8'));
function readRequest(filename) {
  const request = readJson(filename);
  const resolve = name => path.resolve(path.dirname(filename), name);
  return { request, resolve, pin: readJson(resolve(request.pin)), policy: readJson(resolve(request.policy)) };
}

function readInputs({ request, resolve, pin, policy }) {
  const sourceRoot = resolve(request.sourceRoot);
  if (!lstatSync(sourceRoot).isDirectory()) throw new Error('Supplemental source root must be a directory.');
  const sources = sourcePins(pin, policy).map(expected => ({ path: expected.path, ...readSupplemental(sourceRoot, expected.path) }));
  const pluginListing = Object.hasOwn(policy, 'claude') ? listStagedFiles(sourceRoot, 'plugin') : undefined;
  return { universal: readFileSync(resolve(request.universal)), signature: readFileSync(resolve(request.signature)), pin, policy, sources, pluginListing, procedureRevision: request.procedureRevision };
}

// A check request is a build request without a reservation.
export function loadCheckRequest(filename) {
  const loaded = readRequest(filename);
  if (!isProcedureRevision(loaded.request.procedureRevision)) throw new Error('Procedure revision must be supplied.');
  return readInputs(loaded);
}

export function loadBuildRequest(filename) {
  const loaded = readRequest(filename);
  const { request, resolve, pin, policy } = loaded;
  const { reservation } = readReservation(resolve(request.reservation));
  if (reservation.schema !== 1 || reservation.upstream !== pin.version || reservation.binding?.inputsSha256 !== sha256(jsonBytes({ pin, policy })) || !/^[0-9a-f]{64}$/.test(reservation.exposureInventorySha256)) throw new Error('Reservation does not bind these pinned inputs and enrolled policy.');
  const { procedureRevision } = request;
  if (!isProcedureRevision(procedureRevision) || reservation.binding.procedureRevision !== procedureRevision) {
    throw new Error('Procedure revision must be supplied and match the reservation.');
  }
  return { ...readInputs(loaded), reservation, version: reservation.version };
}

function outputFiles(result) {
  return [
    { name: result.candidate.archive.name, bytes: result.archive, mode: 0o644 },
    { name: 'candidate.json', bytes: jsonBytes(result.candidate), mode: 0o644 },
    { name: 'marketplace/.agents/plugins/marketplace.json', bytes: jsonBytes(result.catalog), mode: 0o644 },
    ...result.payload.map(file => ({ ...file, name: `marketplace/plugins/impeccable/${file.name}` })),
    ...(result.claude?.files ?? []).map(file => ({ ...file, name: `${CLAUDE_MARKETPLACE_DIRECTORY}/${file.name}` })),
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
  const pending = new Set();
  for (const file of expected) {
    pending.add(file.name);
    for (let parent = path.posix.dirname(file.name); parent !== '.'; parent = path.posix.dirname(parent)) {
      pending.add(`${parent}/`);
    }
  }
  function walk(directory, prefix = '') {
    for (const name of readdirSync(directory)) {
      const filename = path.join(directory, name);
      const info = lstatSync(filename);
      const isDirectory = info.isDirectory();
      if (!isDirectory && !info.isFile()) throw new Error('Candidate contains links or special files.');
      const entry = `${prefix}${name}${isDirectory ? '/' : ''}`;
      if (!pending.delete(entry)) throw new Error(`Candidate output inventory mismatch: unexpected ${entry}`);
      if (isDirectory) walk(filename, entry);
    }
  }
  if (!lstatSync(output).isDirectory()) throw new Error('Candidate output must be a directory.');
  walk(output);
  if (pending.size) throw new Error('Candidate output inventory mismatch: missing expected paths.');
  for (const file of expected) {
    const filename = path.join(output, file.name);
    if ((lstatSync(filename).mode & 0o7777) !== file.mode || !readFileSync(filename).equals(file.bytes)) throw new Error(`Candidate bytes or mode mismatch: ${file.name}`);
  }
  return result.candidate;
}

// Commit the validated Claude marketplace tree of a retained candidate. The
// request carries every Git condition and identity explicitly; relative
// buildRequest and output paths resolve from the request file's directory.
export function commitCandidate(filename) {
  const request = readJson(filename);
  const resolve = name => path.resolve(path.dirname(filename), name);
  if (typeof request.buildRequest !== 'string' || typeof request.output !== 'string') throw new Error('Commit request needs buildRequest and output.');
  const input = loadBuildRequest(resolve(request.buildRequest));
  const output = resolve(request.output);
  validateCandidate(input, output);
  const prefix = `${CLAUDE_MARKETPLACE_DIRECTORY}/`;
  const files = outputFiles(buildCandidate(input)).filter(file => file.name.startsWith(prefix)).map(file => ({ ...file, name: file.name.slice(prefix.length) }));
  if (!files.length) throw new Error('Candidate has no Claude marketplace tree.');
  return commitSnapshot({
    git: request.git, repository: request.repository, hooksDirectory: request.hooksDirectory, objectFormat: request.objectFormat,
    ref: request.branch, createRepository: request.createRepository === true, files,
    author: request.author, committer: request.committer, message: request.message,
  });
}

async function main() {
  const [verb, filename, output, ...extra] = process.argv.slice(2);
  if (extra.length || !filename || !['select', 'allocate', 'check', 'reserve', 'build', 'validate', 'commit'].includes(verb) || (['build', 'validate'].includes(verb) ? !output : output !== undefined)) {
    console.error('Usage: node scripts/repack.mjs <select|allocate|check|reserve|commit> <request.json> OR <build|validate> <build-request.json> <output-directory>');
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
    } else if (verb === 'check') {
      result = { outcome: 'checked', check: checkEnrollment(loadCheckRequest(filename)) };
    } else if (verb === 'commit') {
      result = { outcome: 'committed', commit: commitCandidate(filename) };
    } else {
      const input = loadBuildRequest(filename);
      result = { outcome: verb === 'build' ? 'candidate' : 'validated', candidate: verb === 'build' ? writeCandidate(input, output) : validateCandidate(input, output) };
    }
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(JSON.stringify({ outcome: 'failed', error: error.message, lockCleanup: error.lockCleanup }));
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

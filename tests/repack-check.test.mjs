import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildCandidate, checkEnrollment } from '../scripts/lib/repack-package.mjs';
import { fixture, json, rebind, repin, source, stagePluginFile, stageSources, unpin } from './lib/repack-fixture.mjs';

// Each case breaks one input or enrollment check that build runs.
const cases = {
  'corrupt archive': input => { input.universal[40] ^= 1; },
  'changed Codex hooks enrollment': input => { input.policy.hooks.hooks.Stop[0].hooks[0].timeout = 31; },
  'changed runtime baseline': input => { input.policy.runtimeBaseline.files[0].sha256 = '0'.repeat(64); },
  'malformed upstream manifest': input => repin(input, '.claude-plugin/plugin.json', { bytes: json({ name: 'impeccable', mcpServers: {} }) }),
  'changed Claude source': input => { source(input, 'plugin/skills/impeccable/SKILL.md').bytes = Buffer.from('changed\n'); },
  'missing Claude inventory entry': input => unpin(input, 'plugin/skills/impeccable/reference/guide.md'),
  'Claude runtime differing from Codex': input => repin(input, 'plugin/skills/impeccable/scripts/impeccable', { bytes: '#!/bin/sh\nexit 0\n' }),
  'changed Claude hooks enrollment': input => { input.policy.claude.hooks.hooks.Stop[0].hooks[0].timeout = 31; },
  'old Claude enrollment shape': input => { input.policy.claude.agents = ['impeccable-documenter.md']; },
  'plugin-only file in neither the archive nor the pins': input => stagePluginFile(input, 'plugin/skills/impeccable/reference/plugin-only.md', 'Plugin only\n'),
  'file in a new area of plugin/': input => stagePluginFile(input, 'plugin/commands/design.md', 'Command\n'),
  'unclassified plugin entry': input => stagePluginFile(input, 'plugin/README.md', 'Readme\n'),
  'excluded hooks-area file': input => {
    stagePluginFile(input, 'plugin/hooks/helper.sh', '#!/bin/sh\n');
    input.policy.claude.excludedSourcePaths = [...input.policy.claude.excludedSourcePaths, 'plugin/hooks/helper.sh'].sort();
  },
  'stale exclusion': input => { input.pluginListing = input.pluginListing.filter(entry => entry !== 'plugin/.grok-plugin/plugin.json'); },
};

test('check runs the build checks without a reservation and fails wherever build fails', () => {
  const input = fixture();
  const check = checkEnrollment(input);
  assert.equal(check.inputsSha256, input.reservation.binding.inputsSha256, 'a later reservation binds the checked inputs');
  assert.equal(check.claude, true);
  assert.deepEqual(check.pluginTree, buildCandidate(input).candidate.claude.pluginTree);
  assert.deepEqual(check.upstream, { version: '4.8.0', tag: 'skill-v4.8.0', commit: input.pin.commit });
  assert.equal(check.policySha256, buildCandidate(input).candidate.policySha256);
  assert.equal(checkEnrollment({ ...input, reservation: undefined, version: undefined }).inputsSha256, check.inputsSha256);

  for (const [name, change] of Object.entries(cases)) {
    const broken = fixture();
    change(broken);
    rebind(broken);
    let buildError;
    assert.throws(() => buildCandidate(broken), error => { buildError = error.message; return true; }, name);
    assert.throws(() => checkEnrollment(broken), { message: buildError }, name);
  }
});

function inputs(t) {
  const input = fixture();
  const root = mkdtempSync(path.join(tmpdir(), 'impeccable-repack-check-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (name, bytes) => {
    const filename = path.join(root, name);
    mkdirSync(path.dirname(filename), { recursive: true });
    writeFileSync(filename, bytes);
    return filename;
  };
  put('universal.zip', input.universal);
  put('signature.json', input.signature);
  put('pin.json', json(input.pin));
  put('policy.json', json(input.policy));
  stageSources(input, put);
  const request = { universal: 'universal.zip', signature: 'signature.json', pin: 'pin.json', policy: 'policy.json', sourceRoot: 'source', procedureRevision: input.procedureRevision };
  const checkFile = put('check.json', json(request));
  const command = fileURLToPath(new URL('../scripts/repack.mjs', import.meta.url));
  const run = (...args) => spawnSync(process.execPath, [command, ...args], { encoding: 'utf8', cwd: root });
  return { input, root, put, run, request, checkFile };
}

function snapshot(directory, prefix = '') {
  return readdirSync(directory).sort().flatMap(name => {
    const filename = path.join(directory, name);
    const info = statSync(filename);
    return info.isDirectory() ? [`${prefix}${name}/`, ...snapshot(filename, `${prefix}${name}/`)] : [`${prefix}${name} ${info.size} ${info.mtimeMs}`];
  });
}

test('CLI check makes no reservation, writes no candidate, and fails where build fails', t => {
  const { input, root, put, run, request, checkFile } = inputs(t);
  const before = snapshot(root);
  const checked = run('check', checkFile);
  assert.equal(checked.status, 0, checked.stderr);
  const { outcome, check } = JSON.parse(checked.stdout);
  assert.equal(outcome, 'checked');
  assert.equal(check.inputsSha256, input.reservation.binding.inputsSha256);
  assert.deepEqual(snapshot(root), before, 'check writes nothing');

  put('source/plugin/hooks/hooks.json', '{}\n');
  const failedCheck = run('check', checkFile);
  assert.equal(failedCheck.status, 1);
  const checkError = JSON.parse(failedCheck.stderr).error;
  assert.match(checkError, /Source-file hash or mode mismatch: plugin\/hooks\/hooks\.json/);
  put(`reservations/repack-v${input.version}.json`, json(input.reservation));
  const buildFile = put('build.json', json({ ...request, reservation: `reservations/repack-v${input.version}.json` }));
  const failedBuild = run('build', buildFile, path.join(root, 'candidate'));
  assert.equal(failedBuild.status, 1);
  assert.equal(JSON.parse(failedBuild.stderr).error, checkError);
  assert.deepEqual(readdirSync(path.join(root, 'reservations')), [`repack-v${input.version}.json`]);
  assert.equal(readdirSync(root).includes('candidate'), false);
});

test('CLI check requires a procedure revision', t => {
  const { put, run, request } = inputs(t);
  const missing = run('check', put('missing.json', json({ ...request, procedureRevision: undefined })));
  assert.equal(missing.status, 1);
  assert.match(JSON.parse(missing.stderr).error, /Procedure revision must be supplied/);
});

test('CLI check and build both refuse a staged plugin file the enrollment omits', t => {
  const { input, root, put, run, request, checkFile } = inputs(t);
  put('source/plugin/agents/plugin-only.md', 'Plugin only\n');
  const failedCheck = run('check', checkFile);
  assert.equal(failedCheck.status, 1);
  const checkError = JSON.parse(failedCheck.stderr).error;
  assert.equal(checkError, 'Staged plugin file is not enrolled: plugin/agents/plugin-only.md');
  put(`reservations/repack-v${input.version}.json`, json(input.reservation));
  const failedBuild = run('build', put('build.json', json({ ...request, reservation: `reservations/repack-v${input.version}.json` })), path.join(root, 'candidate'));
  assert.equal(failedBuild.status, 1);
  assert.equal(JSON.parse(failedBuild.stderr).error, checkError);
  assert.equal(readdirSync(root).includes('candidate'), false);
});


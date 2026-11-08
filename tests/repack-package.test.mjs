import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { signBundle, publicKeyHex } from '../scripts/sign-bundle.mjs';
import { writeZip, readZip } from '../scripts/lib/repack-zip.mjs';
import { buildCandidate } from '../scripts/lib/repack-package.mjs';
import { sha256 } from '../scripts/repack.mjs';
import { writeCandidate, validateCandidate } from '../scripts/repack.mjs';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const json = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const file = (name, content, mode = 0o644) => ({ name, bytes: Buffer.isBuffer(content) ? content : Buffer.from(content), mode });
function fixture() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const skills = [file('SKILL.md', '---\nname: impeccable\nversion: 4.8.0\n---\nRead [guide](reference/guide.md).\n'), file('reference/guide.md', 'Guide\n'), file('scripts/impeccable', '#!/bin/sh\nprintf "fixture engine\\n"\n', 0o755), file('scripts/impeccable.cmd', '@echo off\r\n'), file('scripts/VERSION', '0.1.18\n')];
  const windows = 'cmd /c if exist ".codex\\skills\\impeccable\\scripts\\impeccable.cmd" ".codex\\skills\\impeccable\\scripts\\impeccable.cmd" hook';
  const nativeWindows = 'cmd /c if exist "${PLUGIN_ROOT}\\skills\\impeccable\\scripts\\impeccable.cmd" "${PLUGIN_ROOT}\\skills\\impeccable\\scripts\\impeccable.cmd" hook';
  const projectHooks = { hooks: { PostToolUse: [{ matcher: 'Edit|Write|apply_patch', hooks: [{ type: 'command', command: '".codex/skills/impeccable/scripts/impeccable" hook', commandWindows: windows, timeout: 5, statusMessage: 'Checking UI changes' }] }], Stop: [{ hooks: [{ type: 'command', command: '".codex/skills/impeccable/scripts/impeccable" hook', commandWindows: windows, timeout: 30, statusMessage: 'Design deep pass' }] }] } };
  const hooks = JSON.parse(JSON.stringify(projectHooks).replaceAll('.codex/skills/impeccable', '${PLUGIN_ROOT}/skills/impeccable'));
  hooks.hooks.PostToolUse[0].hooks[0].commandWindows = nativeWindows;
  hooks.hooks.Stop[0].hooks[0].commandWindows = nativeWindows;
  const manifest = { name: 'impeccable', version: '4.8.0', description: 'Design', author: { name: 'Upstream author' }, homepage: 'https://impeccable.style', repository: 'https://github.com/pbakaus/impeccable', skills: './.claude/skills/' };
  const universal = writeZip([...skills.map(f => ({ ...f, name: `.codex/skills/impeccable/${f.name}` })), file('.codex/hooks.json', json(projectHooks))]);
  const signature = json(signBundle(universal, '4.8.0', privateKey, { enrolled: publicKeyHex(publicKey) }));
  const sources = [file('LICENSE', 'Apache fixture\n'), file('NOTICE.md', 'Attribution fixture\n'), file('.claude-plugin/plugin.json', json(manifest)), file('scripts/lib/assets/plugin-icon.png', 'icon')];
  const asset = (id, name, bytes) => ({ id, name, size: bytes.length, sha256: sha256(bytes) });
  const pin = { schema: 1, repository: 'pbakaus/impeccable', version: '4.8.0', releaseId: 101, tag: 'skill-v4.8.0', tagObject: 'a'.repeat(40), commit: 'b'.repeat(40), assets: [asset(1, 'universal.zip', universal), asset(2, 'universal.zip.sig.json', signature)], sourceFiles: sources.map(f => ({ name: f.name, sourcePath: f.name, sha256: sha256(f.bytes), mode: f.mode })) };
  const policy = { schema: 1, repository: 'pbakaus/impeccable', keyId: 'enrolled', publicKey: publicKeyHex(publicKey), license: 'Apache-2.0', skillPrefix: '.codex/skills/impeccable/', projectHooksPath: '.codex/hooks.json', projectSkillPath: '.codex/skills/impeccable', hooks, licenseFiles: sources.slice(0, 2).map(f => ({ name: f.name, sha256: sha256(f.bytes) })), requiredSkillFiles: ['SKILL.md', 'scripts/impeccable', 'scripts/impeccable.cmd', 'scripts/VERSION'], executableFiles: ['scripts/impeccable'], runtimeFiles: ['scripts/VERSION', 'scripts/impeccable', 'scripts/impeccable.cmd'], runtimeOrigins: [] };
  const procedureRevision = 'c'.repeat(40);
  const version = '4.8.1+from.4.8.0';
  const exposureInventory = { complete: true, records: [{ version: '4.8.0' }] };
  const reservation = { schema: 1, version, upstream: pin.version, binding: { procedureRevision, inputsSha256: sha256(json({ pin, policy })) }, advance: false, exposureInventory, exposureInventorySha256: sha256(json(exposureInventory)) };
  return { universal, signature, sources, pin, policy, version, procedureRevision, reservation };
}

test('builds byte-identical portable and marketplace payloads preserving upstream files and hooks', () => {
  const input = fixture();
  const first = buildCandidate(input);
  const second = buildCandidate(input);
  assert.deepEqual(first, second);
  const entries = new Map(readZip(first.archive).map(f => [f.name, f]));
  assert.equal(entries.get('skills/impeccable/scripts/impeccable').mode, 0o755);
  assert.equal(entries.get('skills/impeccable/SKILL.md').bytes.toString(), '---\nname: impeccable\nversion: 4.8.0\n---\nRead [guide](reference/guide.md).\n');
  const root = JSON.parse(entries.get('plugin.json').bytes);
  const overlay = JSON.parse(entries.get('.codex-plugin/plugin.json').bytes);
  assert.equal(root.version, '4.8.1+from.4.8.0');
  assert.deepEqual(root.extensions['com.openai'], overlay);
  assert.equal(overlay.repository, 'https://github.com/nisavid/impeccable');
  assert.equal(overlay.hooks, './hooks/hooks.json');
  assert.deepEqual(JSON.parse(entries.get('hooks/hooks.json').bytes), input.policy.hooks);
  assert.equal(first.candidate.archive.sha256, sha256(first.archive));
  assert.equal(first.candidate.upstream.commit, input.pin.commit);
  assert.equal(first.candidate.qualification, 'required');
  assert.deepEqual(first.catalog, { name: 'impeccable', interface: { displayName: 'Impeccable' }, plugins: [{ name: 'impeccable', source: { source: 'local', path: './plugins/impeccable' }, policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Creativity' }] });
});

test('rejects corrupt assets, changed input bindings, changed trust and unsupported manifests', () => {
  const mutate = change => { const input = fixture(); change(input); input.reservation.binding.inputsSha256 = sha256(json({ pin: input.pin, policy: input.policy })); return () => buildCandidate(input); };
  assert.throws(mutate(input => { input.universal[40] ^= 1; }), /digest/);
  assert.throws(mutate(input => { input.pin.tag = 'skill-v4.8.1'; }), /tag/);
  assert.throws(mutate(input => { input.pin.assets[0].sha256 = '0'.repeat(64); }), /digest/);
  assert.throws(mutate(input => { input.policy.publicKey = '0'.repeat(64); }), /signature/);
  assert.throws(mutate(input => { input.policy.licenseFiles[0].sha256 = '0'.repeat(64); }), /license/);
  assert.throws(mutate(input => { input.version = '4.8.1'; }), /Reservation/);
  assert.throws(mutate(input => {
    const manifest = input.sources.find(f => f.name === '.claude-plugin/plugin.json');
    manifest.bytes = json({ name: 'impeccable', version: '4.8.0', mcpServers: { bad: {} } });
    input.pin.sourceFiles.find(f => f.name === manifest.name).sha256 = sha256(manifest.bytes);
  }), /manifest/);
});

test('requires complete signed support tree and reviewed hook and runtime enrollment', () => {
  const input = fixture();
  input.policy.requiredSkillFiles.push('reference/missing.md');
  input.reservation.binding.inputsSha256 = sha256(json({ pin: input.pin, policy: input.policy }));
  assert.throws(() => buildCandidate(input), /Missing support/);
  input.policy.requiredSkillFiles.pop();
  input.policy.hooks.hooks.Stop = [];
  input.reservation.binding.inputsSha256 = sha256(json({ pin: input.pin, policy: input.policy }));
  assert.throws(() => buildCandidate(input), /hooks changed/);
  const runtime = fixture();
  runtime.policy.executableFiles = [];
  runtime.reservation.binding.inputsSha256 = sha256(json({ pin: runtime.pin, policy: runtime.policy }));
  assert.throws(() => buildCandidate(runtime), /executable inventory/);
});

test('validates promoted bytes, rejects mismatched package versions, and preserves existing candidate output', () => {
  const input = fixture();
  const directory = path.join(mkdtempSync(path.join(tmpdir(), 'impeccable-package-')), 'candidate');
  const candidate = writeCandidate(input, directory);
  assert.equal(validateCandidate(input, directory).archive.sha256, candidate.archive.sha256);
  const archive = readFileSync(path.join(directory, candidate.archive.name));
  assert.throws(() => writeCandidate(input, directory), /EEXIST/);
  assert.deepEqual(readFileSync(path.join(directory, candidate.archive.name)), archive);
  const manifest = path.join(directory, 'marketplace/plugins/impeccable/.codex-plugin/plugin.json');
  const changed = JSON.parse(readFileSync(manifest));
  changed.version = '99.0.0';
  writeFileSync(manifest, json(changed));
  assert.throws(() => validateCandidate(input, directory), /Candidate bytes or mode mismatch/);
  assert.deepEqual(readFileSync(path.join(directory, candidate.archive.name)), archive);
});

test('public provenance retains exposure versions and hashes without private account records', () => {
  const input = fixture();
  input.reservation.exposureInventory.records[0].account = 'private account fixture';
  input.reservation.exposureInventorySha256 = sha256(json(input.reservation.exposureInventory));
  const candidate = buildCandidate(input);
  const provenance = readZip(candidate.archive).find(file => file.name === 'RELEASE.json').bytes.toString();
  assert.doesNotMatch(provenance, /private account fixture/);
  assert.match(provenance, /exposureInventorySha256/);
  assert.match(provenance, /4\.8\.0/);
});

test('CLI reserves, builds twice in independent processes, and validates without changing qualified files', () => {
  const input = fixture();
  const root = mkdtempSync(path.join(tmpdir(), 'impeccable-repack-cli-'));
  const put = (name, bytes) => {
    const filename = path.join(root, name);
    mkdirSync(path.dirname(filename), { recursive: true });
    writeFileSync(filename, bytes);
    return filename;
  };
  put('universal.zip', input.universal); put('signature.json', input.signature);
  put('pin.json', json(input.pin)); put('policy.json', json(input.policy));
  for (const file of input.sources) put(`source/${file.name}`, file.bytes);
  const reserve = put('reserve.json', json({ upstream: '4.8.0', inventory: { complete: true, records: [{ version: '4.8.0' }] }, binding: input.reservation.binding, directory: path.join(root, 'reservations') }));
  const command = fileURLToPath(new URL('../scripts/repack.mjs', import.meta.url));
  const run = (...args) => spawnSync(process.execPath, [command, ...args], { encoding: 'utf8' });
  const reserved = run('reserve', reserve);
  assert.equal(reserved.status, 0, reserved.stderr);
  assert.equal(JSON.parse(reserved.stdout).reservation.version, '4.8.1+from.4.8.0');
  const request = put('build.json', json({ universal: 'universal.zip', signature: 'signature.json', pin: 'pin.json', policy: 'policy.json', reservation: 'reservations/repack-v4.8.1+from.4.8.0.json', sourceRoot: 'source' }));
  for (const directory of ['first', 'second']) {
    const result = run('build', request, path.join(root, directory));
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).outcome, 'candidate');
  }
  const archive = 'impeccable-4.8.1+from.4.8.0.zip';
  assert.deepEqual(readFileSync(path.join(root, 'first', archive)), readFileSync(path.join(root, 'second', archive)));
  assert.equal(run('validate', request, path.join(root, 'first')).status, 0);
  assert.equal(run('build', request, path.join(root, 'first')).status, 1);
  put('universal.zip', 'corrupt');
  const failure = run('build', request, path.join(root, 'failed'));
  assert.equal(failure.status, 1);
  assert.match(failure.stderr, /digest or size mismatch/);
  assert.equal(existsSync(path.join(root, 'failed')), false);
  assert.deepEqual(readFileSync(path.join(root, 'first', archive)), readFileSync(path.join(root, 'second', archive)));
});

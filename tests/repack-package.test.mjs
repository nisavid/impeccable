import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { signBundle, publicKeyHex } from '../scripts/sign-bundle.mjs';
import { writeZip, readZip } from '../scripts/lib/repack-zip.mjs';
import { buildCandidate } from '../scripts/lib/repack-package.mjs';
import { sha256 } from '../scripts/repack.mjs';
import { writeCandidate, validateCandidate } from '../scripts/repack.mjs';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const json = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const file = (name, content, mode = 0o644) => ({ name, bytes: Buffer.isBuffer(content) ? content : Buffer.from(content), mode });
function fixture(changeSkill = () => {}) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const skills = [file('SKILL.md', '---\nname: impeccable\nversion: 4.8.0\n---\nRead [guide](reference/guide.md).\n'), file('reference/guide.md', 'Guide\n'), file('scripts/impeccable', '#!/bin/sh\nprintf "fixture engine\\n"\n', 0o755), file('scripts/impeccable.cmd', '@echo off\r\n'), file('scripts/VERSION', '0.1.18\n')];
  const windows = 'cmd /c if exist ".codex\\skills\\impeccable\\scripts\\impeccable.cmd" ".codex\\skills\\impeccable\\scripts\\impeccable.cmd" hook';
  const nativeWindows = 'cmd /c if exist "${PLUGIN_ROOT}\\skills\\impeccable\\scripts\\impeccable.cmd" "${PLUGIN_ROOT}\\skills\\impeccable\\scripts\\impeccable.cmd" hook';
  const projectHooks = { hooks: { PostToolUse: [{ matcher: 'Edit|Write|apply_patch', hooks: [{ type: 'command', command: '".codex/skills/impeccable/scripts/impeccable" hook', commandWindows: windows, timeout: 5, statusMessage: 'Checking UI changes' }] }], Stop: [{ hooks: [{ type: 'command', command: '".codex/skills/impeccable/scripts/impeccable" hook', commandWindows: windows, timeout: 30, statusMessage: 'Design deep pass' }] }] } };
  const hooks = JSON.parse(JSON.stringify(projectHooks).replaceAll('.codex/skills/impeccable', '${PLUGIN_ROOT}/skills/impeccable'));
  hooks.hooks.PostToolUse[0].hooks[0].commandWindows = nativeWindows;
  hooks.hooks.Stop[0].hooks[0].commandWindows = nativeWindows;
  const manifest = { name: 'impeccable', version: '4.8.0', description: 'Design', author: { name: 'Upstream author' }, homepage: 'https://impeccable.style', repository: 'https://github.com/pbakaus/impeccable', skills: './.claude/skills/' };
  changeSkill(skills);
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
  assert.throws(mutate(input => { input.policy.publicKey = publicKeyHex(generateKeyPairSync('ed25519').publicKey); }), /signature/);
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

test('rejects runtime inventory changes, new literal origins and nested skills', () => {
  assert.throws(() => buildCandidate(fixture(files => files.push(file('scripts/extra.js', '')))), /runtime-file inventory changed/);
  assert.throws(() => buildCandidate(fixture(files => {
    files.find(entry => entry.name === 'scripts/impeccable').bytes = Buffer.from('# https://new.example\n');
  })), /literal runtime origins changed/);
  assert.throws(() => buildCandidate(fixture(files => files.push(file('reference/SKILL.md', '')))), /Unexpected nested skill/);
});

function guide(content, extraFiles = []) {
  return fixture(files => {
    files.find(entry => entry.name === 'reference/guide.md').bytes = Buffer.from(content);
    files.push(...extraFiles);
  });
}

test('checks real inline links while ignoring code spans and indented fences', () => {
  const examples = [
    '`[inline](missing.md)`',
    '``Use `[nested](missing.md)` here``',
    '  ```md\n[fenced](missing.md)\n  ```',
    '   ~~~~md\n[tilde fence](missing.md)\n   ~~~~',
    'Read [`skill`](../SKILL.md).',
  ].join('\n\n');
  assert.doesNotThrow(() => buildCandidate(guide(examples)));
  assert.throws(() => buildCandidate(guide(examples + '\n\n[real](missing.md)')), /Missing or escaping relative support reference: reference\/guide\.md: missing\.md/);
});

test('skips fenced examples when the opening info string contains Unicode line separators', () => {
  for (const marker of ['~~~', '```']) {
    for (const separator of ['\u2028', '\u2029']) {
      const fence = `${marker}text${separator}example\n[example](inside-fence.md)\n${marker}`;
      assert.doesNotThrow(() => buildCandidate(guide(fence + '\n[present](guide.md)')));
      assert.throws(
        () => buildCandidate(guide(fence + '\n[missing](after-fence.md)')),
        { message: 'Missing or escaping relative support reference: reference/guide.md: after-fence.md' },
      );
    }
  }
});

test('keeps marker-like body lines with non-ASCII whitespace inside fences', () => {
  for (const marker of ['~~~', '```']) {
    for (const separator of ['\u2028', '\u2029', '\u00a0']) {
      const open = `${marker}md\n${marker} ${separator} `;
      const close = `${marker} \t`;
      const missing = '\n[missing](after-fence.md)';
      const expected = { message: 'Missing or escaping relative support reference: reference/guide.md: after-fence.md' };
      assert.throws(() => buildCandidate(guide(`${open}\n${close}${missing}`)), expected);

      const fence = `${open}\n[example](inside-fence.md)\n${close}`;
      assert.doesNotThrow(() => buildCandidate(guide(fence + '\n[present](guide.md)')));
      assert.throws(() => buildCandidate(guide(fence + missing)), expected);
    }
  }
});

test('checks relative links with single-quoted titles', () => {
  assert.doesNotThrow(() => buildCandidate(guide("[present](../SKILL.md 'Skill title')")));
  assert.throws(
    () => buildCandidate(guide("[missing](missing.md 'Missing guide')")),
    /Missing or escaping relative support reference: reference\/guide\.md: missing\.md/,
  );
});

test('checks angle-bracket relative link destinations without the delimiters', () => {
  assert.doesNotThrow(() => buildCandidate(guide("[present](<../SKILL.md>) [also present](<../SKILL.md> 'Skill title')")));
  assert.throws(
    () => buildCandidate(guide('[missing](<missing.md>)')),
    /Missing or escaping relative support reference: reference\/guide\.md: missing\.md/,
  );
});

const inlineLinkCases = [
  {
    feature: 'whitespace around the destination',
    link: target => `[guide]( <${target}> )`,
    target: 'guide.md',
  },
  {
    feature: 'escaped apostrophes in a title',
    link: target => `[guide](${target} 'Editor\\'s guide')`,
    target: 'guide.md',
  },
  {
    feature: 'escaped double quotes in a title',
    link: target => `[guide](${target} "The \\"guide\\"")`,
    target: 'guide.md',
  },
  {
    feature: 'line breaks between link components',
    link: target => `[guide](\n  <${target}>\n  "title"\n)`,
    target: 'guide.md',
  },
  {
    feature: 'balanced parentheses in the bare destination',
    link: target => `[guide](${target})`,
    target: 'guide(v2(draft)).md',
    extraFiles: [file('reference/guide(v2(draft)).md', 'Versioned guide')],
  },
];
for (const { feature, link, target, extraFiles } of inlineLinkCases) {
  test(`validates present and missing inline targets with ${feature}`, () => {
    assert.doesNotThrow(() => buildCandidate(guide(link(target), extraFiles)));
    const missing = target.replace('guide', 'missing');
    assert.throws(
      () => buildCandidate(guide(link(missing), extraFiles)),
      { message: `Missing or escaping relative support reference: reference/guide.md: ${missing}` },
    );
  });
}

test('distinguishes escaped syntax, code, and nested inline link labels', () => {
  const examples = [
    '\\[plain text](missing.md)',
    "[one [nested] label](guide.md 'literal [example](missing.md)')",
    '[escape punctuation](guide\\(v2\\).md#example)',
  ].join('\n\n');
  assert.doesNotThrow(() => buildCandidate(guide(examples, [file('reference/guide(v2).md', 'Versioned guide')])));
  assert.throws(
    () => buildCandidate(guide('\\`literal backtick [link](missing.md)`')),
    { message: 'Missing or escaping relative support reference: reference/guide.md: missing.md' },
  );
});

const blockLinkCases = [
  {
    boundary: 'ATX headings',
    content: target => `# First \`\n[guide](${target})\n## Second \``,
  },
  {
    boundary: 'a thematic break',
    content: target => `First \`\n* * *\n[guide](${target}) \``,
  },
  {
    boundary: 'a Setext heading',
    content: target => `First \`\n===\n[guide](${target}) \``,
  },
];
for (const { boundary, content } of blockLinkCases) {
  test(`keeps inline links visible across ${boundary}`, () => {
    assert.doesNotThrow(() => buildCandidate(guide(content('guide.md'))));
    assert.throws(
      () => buildCandidate(guide(content('missing.md'))),
      { message: 'Missing or escaping relative support reference: reference/guide.md: missing.md' },
    );
  });
}

test('ignores multiline code spans inside a block and checks links inside headings', () => {
  const code = 'First ``\n[example](missing.md)\nlast line``';
  assert.doesNotThrow(() => buildCandidate(guide(code + '\n## [present](guide.md)')));
  assert.throws(
    () => buildCandidate(guide(code + '\n## [missing](missing-heading.md)')),
    { message: 'Missing or escaping relative support reference: reference/guide.md: missing-heading.md' },
  );
});

test('checks the inner link and treats its outer link syntax as plain text', () => {
  assert.doesNotThrow(() => buildCandidate(guide('[Read [guide](guide.md)](missing-outer.md)')));
  assert.doesNotThrow(() => buildCandidate(guide('[Read [site](https://example.invalid)](missing-outer.md)')));
  assert.throws(
    () => buildCandidate(guide('[Read [guide](missing-inner.md)](guide.md)')),
    { message: 'Missing or escaping relative support reference: reference/guide.md: missing-inner.md' },
  );
  assert.throws(
    () => buildCandidate(guide('[Read [guide]](missing.md)')),
    { message: 'Missing or escaping relative support reference: reference/guide.md: missing.md' },
  );
});

test('checks both an inline image and the enclosing link', () => {
  assert.doesNotThrow(() => buildCandidate(guide('[![image](guide.md)](../SKILL.md)')));
  for (const link of ['[![image](guide.md)](missing.md)', '[![image](missing.md)](../SKILL.md)']) {
    assert.throws(
      () => buildCandidate(guide(link)),
      { message: 'Missing or escaping relative support reference: reference/guide.md: missing.md' },
    );
  }
});

test('resolves relative destinations to the skill root and rejects escapes', () => {
  assert.doesNotThrow(() => buildCandidate(guide('[parent](..) [root](<../>) [normalized](../reference/..) [current](./)')));
  for (const target of ['../missing.md', '../..', '../../SKILL.md', '%2e%2e/%2e%2e/', '/guide.md']) {
    assert.throws(
      () => buildCandidate(guide(`[bad](${target})`)),
      { message: `Missing or escaping relative support reference: reference/guide.md: ${target}` },
    );
  }
});

test('checks percent-decoded local paths and ignores fragment-only, external, and template destinations', () => {
  const content = '[encoded](../%53KILL.md#heading) [section](#heading) [site](https://example.invalid) [template]({{path}})';
  assert.doesNotThrow(() => buildCandidate(guide(content)));
  assert.throws(
    () => buildCandidate(guide('[encoded](%6Dissing.md#heading)')),
    { message: 'Missing or escaping relative support reference: reference/guide.md: %6Dissing.md' },
  );
});

test('identifies the referring file and target when an inline link has invalid encoding', () => {
  assert.throws(() => buildCandidate(guide('[invalid](bad%ZZ.md)')), /Invalid percent encoding in relative support reference: reference\/guide\.md: bad%ZZ\.md/);
});

test('requires impeccable identity in the opening skill frontmatter', () => {
  for (const frontmatter of ['name: renamed\n', '']) {
    const input = fixture(files => {
      files.find(entry => entry.name === 'SKILL.md').bytes = Buffer.from(`---\n${frontmatter}---\nname: impeccable\n---\n`);
    });
    assert.throws(() => buildCandidate(input), /Unexpected upstream skill identity/);
  }
});

test('validates retained bytes, rejects mismatched package versions, and preserves existing candidate output', t => {
  const input = fixture();
  const root = mkdtempSync(path.join(tmpdir(), 'impeccable-package-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, 'candidate');
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

function cliFixture(t, { input = fixture(), umask = 0o022 } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'impeccable-repack-cli-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (name, bytes) => {
    const filename = path.join(root, name);
    mkdirSync(path.dirname(filename), { recursive: true });
    writeFileSync(filename, bytes);
    return filename;
  };
  const withUmask = action => {
    const previous = process.umask(umask);
    try {
      return action();
    } finally {
      process.umask(previous);
    }
  };
  withUmask(() => {
    put('universal.zip', input.universal);
    put('signature.json', input.signature);
    put('pin.json', json(input.pin));
    put('policy.json', json(input.policy));
    for (const file of input.sources) put(`source/${file.name}`, file.bytes);
  });

  const command = fileURLToPath(new URL('../scripts/repack.mjs', import.meta.url));
  const run = (...args) => withUmask(() => spawnSync(process.execPath, [command, ...args], { encoding: 'utf8' }));
  const directory = path.join(root, 'reservations');
  function reserve({ records = [], advance = false } = {}) {
    const request = { upstream: input.pin.version, inventory: { complete: true, records }, binding: input.reservation.binding, directory, advance };
    const result = run('reserve', put('reserve.json', json(request)));
    assert.equal(result.status, 0, result.stderr);
    const { reservation } = JSON.parse(result.stdout);
    const buildRequest = {
      universal: 'universal.zip', signature: 'signature.json', pin: 'pin.json', policy: 'policy.json',
      reservation: `reservations/repack-v${reservation.version}.json`, sourceRoot: 'source',
      procedureRevision: input.procedureRevision,
    };
    return { reservation, buildRequest, requestFile: put('build.json', json(buildRequest)) };
  }
  return { input, root, directory, put, run, reserve };
}

for (const { label, options, umask, version } of [
  { label: 'matching upstream version', options: {}, umask: 0o022, version: '4.8.0' },
  { label: 'explicit patch advance', options: { advance: true }, umask: 0o002, version: '4.8.1+from.4.8.0' },
  { label: 'patch advance after exposure', options: { records: [{ version: '4.8.0' }] }, umask: 0o022, version: '4.8.1+from.4.8.0' },
]) {
  test(`CLI reserves ${label} and repeats the build under umask ${umask.toString(8)}`, t => {
    const { root, reserve, run } = cliFixture(t, { umask });
    assert.equal(statSync(path.join(root, 'source/LICENSE')).mode & 0o777, 0o666 & ~umask);
    const { reservation, requestFile } = reserve(options);
    assert.equal(reservation.version, version);
    assert.equal(reservation.advance, options.advance ?? false);
    for (const directory of ['first', 'second']) {
      const result = run('build', requestFile, path.join(root, directory));
      assert.equal(result.status, 0, result.stderr);
      const { outcome, candidate } = JSON.parse(result.stdout);
      assert.equal(outcome, 'candidate');
      assert.equal(candidate.version, version);
      assert.match(candidate.limits.join(' '), /caller verifies the executing procedure/i);
    }
    for (const name of [`impeccable-${version}.zip`, 'candidate.json']) {
      assert.deepEqual(readFileSync(path.join(root, 'first', name)), readFileSync(path.join(root, 'second', name)));
    }
    const validated = run('validate', requestFile, path.join(root, 'first'));
    assert.equal(validated.status, 0, validated.stderr);
    assert.equal(JSON.parse(validated.stdout).outcome, 'validated');
  });
}

test('CLI preview and usage do not create reservations', t => {
  const { directory, put, run } = cliFixture(t);
  const requestFile = put('allocate.json', json({ upstream: '4.8.0', inventory: { complete: true, records: [] }, directory }));
  const preview = run('allocate', requestFile);
  assert.equal(preview.status, 0, preview.stderr);
  assert.deepEqual(JSON.parse(preview.stdout), { outcome: 'allocated-preview', version: '4.8.0' });
  const usage = run('allocate', requestFile, 'unexpected');
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /^Usage:/);
  assert.equal(existsSync(directory), false);
});

test('CLI builds, validates, and reconciles only the exact serialized reservation', t => {
  const input = fixture();
  const { procedureRevision, inputsSha256 } = input.reservation.binding;
  input.reservation.binding = { inputsSha256, procedureRevision };
  const { root, directory, put, run, reserve } = cliFixture(t, { input });
  const { buildRequest, requestFile, reservation } = reserve();
  const filename = path.join(root, buildRequest.reservation);
  const original = readFileSync(filename);
  assert.deepEqual(Object.keys(JSON.parse(original).binding), ['inputsSha256', 'procedureRevision']);
  const reservationSha256 = sha256(original);
  const output = path.join(root, 'retained');
  const build = run('build', requestFile, output);
  assert.equal(build.status, 0, build.stderr);
  const { candidate } = JSON.parse(build.stdout);
  assert.equal(candidate.reservationSha256, reservationSha256);
  const archivePath = path.join(output, candidate.archive.name);
  const recordPath = path.join(output, 'candidate.json');
  const archive = readFileSync(archivePath);
  const candidateRecord = readFileSync(recordPath);
  const release = readZip(archive).find(entry => entry.name === 'RELEASE.json');
  assert.equal(JSON.parse(release.bytes).reservationSha256, reservationSha256);
  const validate = run('validate', requestFile, output);
  assert.equal(validate.status, 0, validate.stderr);
  assert.equal(JSON.parse(validate.stdout).candidate.reservationSha256, reservationSha256);

  const records = [{ version: reservation.version, reservationSha256, inputsSha256: reservation.binding.inputsSha256 }];
  const reconcileFile = put('reconcile.json', json({
    upstream: reservation.upstream, inventory: { complete: true, records }, binding: reservation.binding, directory,
  }));
  const reconcile = run('reserve', reconcileFile);
  assert.equal(reconcile.status, 0, reconcile.stderr);
  assert.equal(JSON.parse(reconcile.stdout).reservation.version, '4.8.1+from.4.8.0');
  assert.deepEqual(readFileSync(filename), original);
  const inventory = readdirSync(directory).sort();

  assert.equal(original.at(-1), 0x0a);
  const reordered = json({ version: reservation.version, ...reservation });
  assert.deepEqual(JSON.parse(reordered), reservation);
  assert.notDeepEqual(reordered, original);
  assert.equal(reservation.advance, false);
  const withoutAdvance = { ...reservation };
  delete withoutAdvance.advance;
  const retry = path.join(root, 'retry');
  for (const rewritten of [json(withoutAdvance), original.subarray(0, -1), reordered]) {
    writeFileSync(filename, rewritten);
    for (const args of [['build', requestFile, retry], ['validate', requestFile, output], ['reserve', reconcileFile]]) {
      const result = run(...args);
      assert.equal(result.status, 1, `${args[0]} accepted a rewritten reservation`);
      assert.match(result.stderr, /Reservation must match the exact serialization emitted by reserve/);
    }
    assert.equal(existsSync(retry), false);
    assert.equal(existsSync(path.join(directory, '.allocation-lock')), false);
    assert.deepEqual(readdirSync(directory).sort(), inventory);
    assert.deepEqual(readFileSync(filename), rewritten);
    assert.deepEqual(readFileSync(archivePath), archive);
    assert.deepEqual(readFileSync(recordPath), candidateRecord);
  }

  // Nested field order is valid writer input, but changing it alters the retained identity.
  const changedBinding = json({ ...reservation, binding: { procedureRevision, inputsSha256 } });
  assert.deepEqual(JSON.parse(changedBinding), reservation);
  writeFileSync(filename, changedBinding);
  const changedOutput = run('validate', requestFile, output);
  assert.equal(changedOutput.status, 1);
  assert.match(changedOutput.stderr, /Candidate bytes or mode mismatch/);
  const conflictingRecord = run('reserve', reconcileFile);
  assert.equal(conflictingRecord.status, 1);
  assert.match(conflictingRecord.stderr, /Conflicting exposed version identity/);
  assert.deepEqual(readdirSync(directory).sort(), inventory);
  assert.deepEqual(readFileSync(filename), changedBinding);
  assert.deepEqual(readFileSync(archivePath), archive);
  assert.deepEqual(readFileSync(recordPath), candidateRecord);

  writeFileSync(filename, original);
  const restored = run('validate', requestFile, output);
  assert.equal(restored.status, 0, restored.stderr);
  assert.deepEqual(readFileSync(filename), original);
});

test('CLI rejects procedure changes and retained archive disagreement under the same reservation', t => {
  const { root, put, run, reserve } = cliFixture(t);
  const { buildRequest, requestFile, reservation } = reserve();
  const output = path.join(root, 'retained');
  const built = run('build', requestFile, output);
  assert.equal(built.status, 0, built.stderr);
  assert.equal(run('build', requestFile, output).status, 1);
  for (const procedureRevision of [undefined, 'd'.repeat(40)]) {
    const different = put('different.json', json({ ...buildRequest, procedureRevision }));
    for (const [verb, destination] of [['build', path.join(root, 'retry')], ['validate', output]]) {
      const mismatch = run(verb, different, destination);
      assert.equal(mismatch.status, 1);
      assert.match(mismatch.stderr, /Procedure revision.*reservation/);
    }
    assert.equal(existsSync(path.join(root, 'retry')), false);
  }
  const archiveName = `impeccable-${reservation.version}.zip`;
  const archive = readFileSync(path.join(output, archiveName));
  put(`retained/${archiveName}`, 'different bytes');
  const invalid = run('validate', requestFile, output);
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /Candidate bytes or mode mismatch: impeccable-4\.8\.0\.zip/);
  assert.equal(readFileSync(path.join(output, archiveName), 'utf8'), 'different bytes');

  put(`retained/${archiveName}`, archive);
  put('universal.zip', 'corrupt');
  const retry = path.join(root, 'retry');
  const corrupt = run('build', requestFile, retry);
  assert.equal(corrupt.status, 1);
  assert.match(corrupt.stderr, /Pinned asset digest or size mismatch: universal\.zip/);
  assert.equal(existsSync(retry), false);
  assert.deepEqual(readFileSync(path.join(output, archiveName)), archive);
});

function fixtureWithManifestFields(fields) {
  const input = fixture();
  const manifest = input.sources.find(entry => entry.name === '.claude-plugin/plugin.json');
  manifest.bytes = json({ ...JSON.parse(manifest.bytes), ...fields });
  input.pin.sourceFiles.find(entry => entry.name === manifest.name).sha256 = sha256(manifest.bytes);
  input.reservation.binding.inputsSha256 = sha256(json({ pin: input.pin, policy: input.policy }));
  return input;
}

test('CLI allows an omitted or matching upstream license and rejects invalid values before writing', t => {
  for (const license of [undefined, 'Apache-2.0', false, 0, '', null, 'MIT']) {
    const input = fixtureWithManifestFields({ license });
    const { root, run, reserve } = cliFixture(t, { input });
    const { requestFile, reservation } = reserve();
    const output = path.join(root, 'candidate');
    const result = run('build', requestFile, output);
    if (license === undefined || license === 'Apache-2.0') {
      assert.equal(result.status, 0, result.stderr);
      const entries = readZip(readFileSync(path.join(output, `impeccable-${reservation.version}.zip`)));
      for (const name of ['plugin.json', '.codex-plugin/plugin.json']) {
        assert.equal(JSON.parse(entries.find(entry => entry.name === name).bytes).license, 'Apache-2.0');
      }
    } else {
      assert.equal(result.status, 1, `Accepted license ${JSON.stringify(license)}`);
      assert.match(result.stderr, /Malformed or unsupported upstream manifest/);
      assert.equal(existsSync(output), false);
    }
  }
});

test('CLI rejects present malformed manifest keywords before creating output', t => {
  for (const keywords of [false, null, 0, '', ['design', 42], { category: 'design' }]) {
    const input = fixtureWithManifestFields({ keywords });
    const { root, run, reserve } = cliFixture(t, { input });
    const { requestFile } = reserve();
    const output = path.join(root, 'rejected');
    const result = run('build', requestFile, output);
    assert.equal(result.status, 1, `Accepted keywords ${JSON.stringify(keywords)}`);
    assert.match(result.stderr, /Malformed or unsupported upstream manifest/);
    assert.equal(existsSync(output), false);
  }
});

test('CLI rejects malformed signature JSON whose bytes match the pin', t => {
  const input = fixture();
  input.signature = Buffer.from('{');
  Object.assign(input.pin.assets[1], { size: input.signature.length, sha256: sha256(input.signature) });
  input.reservation.binding.inputsSha256 = sha256(json({ pin: input.pin, policy: input.policy }));
  const { root, run, reserve } = cliFixture(t, { input });
  const { requestFile } = reserve();
  const output = path.join(root, 'failed');
  const failure = run('build', requestFile, output);
  assert.equal(failure.status, 1);
  assert.match(failure.stderr, /Malformed upstream signature JSON/);
  assert.equal(existsSync(output), false);
});

test('CLI rejects missing, executable, or symlinked supplemental source files', t => {
  const { root, put, run, reserve } = cliFixture(t);
  const { requestFile } = reserve();
  const filename = path.join(root, 'source/NOTICE.md');
  const bytes = readFileSync(filename);
  const output = path.join(root, 'failed');
  function rejects(error) {
    const failed = run('build', requestFile, output);
    assert.equal(failed.status, 1);
    assert.match(failed.stderr, error);
    assert.equal(existsSync(output), false);
  }
  unlinkSync(filename);
  rejects(/Missing pinned supplemental source: NOTICE\.md/);
  put('source/NOTICE.md', bytes);
  chmodSync(filename, 0o755);
  rejects(/Source-file hash or mode mismatch: NOTICE\.md/);
  unlinkSync(filename);
  symlinkSync(put('notice-target', bytes), filename);
  rejects(/Supplemental source links are unsupported/);
  unlinkSync(filename);
  put('source/NOTICE.md', bytes);
  symlinkSync(path.join(root, 'source'), path.join(root, 'linked-source'), 'dir');
  const linked = put('linked.json', json({ ...JSON.parse(readFileSync(requestFile)), sourceRoot: 'linked-source' }));
  const failed = run('build', linked, output);
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /Supplemental source root must be a directory/);
  assert.equal(existsSync(output), false);
});

test('validation rejects extra files, links within output, and a linked output root', t => {
  const root = mkdtempSync(path.join(tmpdir(), 'impeccable-validate-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const input = fixture();
  const output = path.join(root, 'retained');
  writeCandidate(input, output);
  const extra = path.join(output, 'extra.txt');
  writeFileSync(extra, 'unexpected');
  assert.throws(() => validateCandidate(input, output), /Candidate output inventory mismatch/);
  unlinkSync(extra);
  symlinkSync(path.join(output, 'candidate.json'), extra);
  assert.throws(() => validateCandidate(input, output), /Candidate contains links or special files/);
  unlinkSync(extra);
  const link = path.join(root, 'link');
  symlinkSync(output, link, 'dir');
  assert.throws(() => validateCandidate(input, link), /Candidate output must be a directory/);
});

test('validation rejects an extra empty output directory', t => {
  const root = mkdtempSync(path.join(tmpdir(), 'impeccable-validate-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const input = fixture();
  const output = path.join(root, 'retained');
  const candidate = writeCandidate(input, output);
  assert.deepEqual(validateCandidate(input, output), candidate);
  mkdirSync(path.join(output, 'marketplace', 'empty'));
  assert.throws(() => validateCandidate(input, output), /Candidate output inventory mismatch/);
});

test('validation rejects a mode-only change when the filesystem retains special bits', t => {
  const root = mkdtempSync(path.join(tmpdir(), 'impeccable-validate-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const input = fixture();
  const output = path.join(root, 'retained');
  const candidate = writeCandidate(input, output);
  const filename = path.join(output, 'candidate.json');
  const original = readFileSync(filename);
  const mode = statSync(filename).mode & 0o7777;
  assert.equal(mode, 0o644);
  const changed = mode | 0o4000;
  chmodSync(filename, changed);
  if ((statSync(filename).mode & 0o7777) !== changed) {
    t.skip('The test filesystem did not retain the requested special mode bit.');
    return;
  }
  assert.deepEqual(readFileSync(filename), original);
  assert.throws(
    () => validateCandidate(input, output),
    { message: 'Candidate bytes or mode mismatch: candidate.json' },
  );
  chmodSync(filename, mode);
  assert.deepEqual(validateCandidate(input, output), candidate);
});

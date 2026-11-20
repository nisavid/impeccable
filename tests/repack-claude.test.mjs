import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readZip } from '../scripts/lib/repack-zip.mjs';
import { buildCandidate } from '../scripts/lib/repack-package.mjs';
import { sha256, validateCandidate, writeCandidate } from '../scripts/repack.mjs';
import { claudePluginAgent, claudePluginSkill, file, fixture, json, rebind } from './lib/repack-fixture.mjs';

const claudeFiles = result => new Map(result.claude.files.map(entry => [entry.name, entry]));
const plugin = 'plugins/impeccable/';

test('builds a deterministic Claude plugin tree and catalog beside the portable package', () => {
  const input = fixture();
  const first = buildCandidate(input);
  assert.deepEqual(buildCandidate(input), first);
  const files = claudeFiles(first);
  assert.deepEqual([...files.keys()].sort(), [
    '.claude-plugin/marketplace.json',
    `${plugin}.claude-plugin/plugin.json`,
    `${plugin}LICENSE`,
    `${plugin}NOTICE.md`,
    `${plugin}RELEASE.json`,
    `${plugin}agents/impeccable-documenter.md`,
    `${plugin}hooks/hooks.json`,
    `${plugin}skills/impeccable/SKILL.md`,
    `${plugin}skills/impeccable/reference/guide.md`,
    `${plugin}skills/impeccable/scripts/VERSION`,
    `${plugin}skills/impeccable/scripts/engine-checksums.txt`,
    `${plugin}skills/impeccable/scripts/impeccable`,
    `${plugin}skills/impeccable/scripts/impeccable.cmd`,
  ]);
  assert.deepEqual(JSON.parse(files.get(`${plugin}.claude-plugin/plugin.json`).bytes), {
    name: 'impeccable', version: '4.8.1+from.4.8.0', description: 'Design', author: { name: 'Upstream author' },
    homepage: 'https://impeccable.style', repository: 'https://github.com/nisavid/impeccable', skills: './skills/',
  });
  assert.equal(files.get(`${plugin}skills/impeccable/SKILL.md`).bytes.toString(), claudePluginSkill);
  assert.equal(files.get(`${plugin}agents/impeccable-documenter.md`).bytes.toString(), claudePluginAgent);
  assert.equal(files.get(`${plugin}skills/impeccable/scripts/impeccable`).mode, 0o755);
  assert.equal(files.get(`${plugin}skills/impeccable/reference/guide.md`).bytes.toString(), 'Guide\n');
  assert.deepEqual(files.get(`${plugin}hooks/hooks.json`).bytes, input.claudeSources.find(entry => entry.name === 'plugin/hooks/hooks.json').bytes);
  for (const [name, entry] of files) {
    if (name.endsWith('.md')) assert.doesNotMatch(entry.bytes.toString(), /\.claude\/skills\/impeccable\/scripts/, name);
  }
  const provenance = JSON.parse(files.get(`${plugin}RELEASE.json`).bytes);
  assert.equal(provenance.format, 'claude-code-plugin');
  const mapping = new Map(provenance.inputMapping.map(entry => [entry.destination, entry]));
  assert.deepEqual(mapping.get('skills/impeccable/reference/guide.md'), { origin: 'signed-archive', source: '.claude/skills/impeccable/reference/guide.md', destination: 'skills/impeccable/reference/guide.md', mode: 0o644, sha256: sha256('Guide\n') });
  assert.deepEqual(mapping.get('skills/impeccable/SKILL.md'), { origin: 'source-commit', source: 'plugin/skills/impeccable/SKILL.md', destination: 'skills/impeccable/SKILL.md', mode: 0o644, sha256: sha256(claudePluginSkill) });
  assert.equal(mapping.get('hooks/hooks.json').origin, 'source-commit');
  assert.equal(mapping.get('agents/impeccable-documenter.md').origin, 'source-commit');
  assert.equal(mapping.get('LICENSE').origin, 'source-commit');
  assert.deepEqual(provenance.inventory.map(entry => entry.path), [...files.keys()].filter(name => name.startsWith(plugin) && name !== `${plugin}RELEASE.json`).map(name => name.slice(plugin.length)).sort());
  assert.ok(provenance.transformations.length > 0);
});

test('Claude manifest, catalog, and candidate record agree on name and version', () => {
  const result = buildCandidate(fixture());
  const files = claudeFiles(result);
  const manifest = JSON.parse(files.get(`${plugin}.claude-plugin/plugin.json`).bytes);
  const catalog = JSON.parse(files.get('.claude-plugin/marketplace.json').bytes);
  assert.deepEqual(catalog, result.claude.catalog);
  assert.deepEqual(catalog.plugins, [{ name: 'impeccable', source: './plugins/impeccable', description: 'Design', version: '4.8.1+from.4.8.0' }]);
  assert.equal(catalog.name, result.candidate.claude.catalogName);
  assert.equal(result.candidate.claude.name, manifest.name);
  assert.equal(result.candidate.claude.version, manifest.version);
  assert.equal(result.candidate.version, manifest.version);
  assert.equal(result.candidate.claude.marketplaceCatalogSha256, sha256(files.get('.claude-plugin/marketplace.json').bytes));
  assert.deepEqual(result.candidate.claude.tree.map(entry => entry.path), [...files.keys()].sort());
});

test('carries the enrolled license only when the upstream manifest supplies one', () => {
  const input = fixture();
  const manifest = input.sources.find(entry => entry.name === '.claude-plugin/plugin.json');
  manifest.bytes = json({ ...JSON.parse(manifest.bytes), license: 'Apache-2.0', keywords: ['design'] });
  input.pin.sourceFiles.find(entry => entry.name === manifest.name).sha256 = sha256(manifest.bytes);
  const generated = JSON.parse(claudeFiles(buildCandidate(rebind(input))).get(`${plugin}.claude-plugin/plugin.json`).bytes);
  assert.equal(generated.license, 'Apache-2.0');
  assert.deepEqual(generated.keywords, ['design']);
  assert.deepEqual(Object.keys(generated), ['name', 'version', 'description', 'author', 'homepage', 'repository', 'license', 'keywords', 'skills']);
});

test('portable archive differs only in recorded input identities when Claude output is enabled', () => {
  const enabled = fixture();
  const disabled = { ...enabled, policy: structuredClone(enabled.policy), reservation: structuredClone(enabled.reservation), claudeSources: [] };
  delete disabled.policy.claude;
  rebind(disabled);
  const withClaude = buildCandidate(enabled);
  const withoutClaude = buildCandidate(disabled);
  assert.equal(withoutClaude.claude, undefined);
  assert.equal(withoutClaude.candidate.claude, undefined);
  const a = new Map(readZip(withClaude.archive).map(entry => [entry.name, entry]));
  const b = new Map(readZip(withoutClaude.archive).map(entry => [entry.name, entry]));
  assert.deepEqual([...a.keys()], [...b.keys()]);
  for (const [name, entry] of a) {
    if (name !== 'RELEASE.json') assert.deepEqual(entry, b.get(name), name);
  }
  const left = JSON.parse(a.get('RELEASE.json').bytes);
  const right = JSON.parse(b.get('RELEASE.json').bytes);
  const differing = Object.keys(left).filter(key => JSON.stringify(left[key]) !== JSON.stringify(right[key]));
  // The policy digest and the reservation digest bind the enrolled Claude surface.
  assert.deepEqual(differing.sort(), ['policySha256', 'reservationSha256']);
  assert.deepEqual(Object.keys(left), Object.keys(right));
});

test('Claude hooks equal the enrolled policy and keep the upstream Claude event set', () => {
  const input = fixture();
  const hooks = JSON.parse(claudeFiles(buildCandidate(input)).get(`${plugin}hooks/hooks.json`).bytes);
  assert.deepEqual(hooks, input.policy.claude.hooks);
  for (const [event, groups] of Object.entries(hooks.hooks)) {
    for (const handler of groups.flatMap(group => group.hooks)) {
      assert.deepEqual(Object.keys(handler), ['type', 'command', 'windows', 'env', 'timeout', 'statusMessage'], event);
    }
  }

  const changedPolicy = fixture();
  changedPolicy.policy.claude.hooks.hooks.Stop[0].hooks[0].timeout = 31;
  assert.throws(() => buildCandidate(rebind(changedPolicy)), /Upstream Claude hooks changed/);

  const extraEvent = fixture(undefined, [], { changeClaude: ({ sources }) => {
    const entry = sources.find(source => source.name === 'plugin/hooks/hooks.json');
    const value = JSON.parse(entry.bytes);
    value.hooks.UserPromptSubmit = value.hooks.Stop;
    entry.bytes = json(value);
  } });
  assert.throws(() => buildCandidate(extraEvent), /Claude plugin hook events differ from upstream Claude events/);

  const projectRooted = fixture(undefined, [], { changeClaude: ({ sources }) => {
    const entry = sources.find(source => source.name === 'plugin/hooks/hooks.json');
    entry.bytes = Buffer.from(entry.bytes.toString().replaceAll('${CLAUDE_PLUGIN_ROOT}/skills', '${CLAUDE_PROJECT_DIR}/.claude/skills'));
  } });
  assert.throws(() => buildCandidate(projectRooted), /Claude hooks must be rooted at CLAUDE_PLUGIN_ROOT/);
});

test('fails closed on changed, missing, malformed, or unsafe Claude inputs', () => {
  const rejects = (input, pattern) => assert.throws(() => buildCandidate(input), pattern);

  const changed = fixture();
  changed.claudeSources[0].bytes = Buffer.from('changed\n');
  rejects(changed, /Claude source hash or mode mismatch: plugin\/skills\/impeccable\/SKILL\.md/);

  const executable = fixture();
  executable.claudeSources[1].mode = 0o755;
  rejects(executable, /Claude source hash or mode mismatch/);

  const missingSource = fixture();
  missingSource.claudeSources = missingSource.claudeSources.filter(entry => entry.name !== 'plugin/hooks/hooks.json');
  rejects(missingSource, /Claude source inventory mismatch/);

  const missingHookEnrollment = fixture();
  missingHookEnrollment.policy.claude.sourceFiles = missingHookEnrollment.policy.claude.sourceFiles.filter(entry => entry.path !== 'plugin/hooks/hooks.json');
  missingHookEnrollment.claudeSources = missingHookEnrollment.claudeSources.filter(entry => entry.name !== 'plugin/hooks/hooks.json');
  rejects(rebind(missingHookEnrollment), /Claude hooks source required/);

  rejects(fixture(undefined, [], { changeClaude: ({ archive }) => { archive.agents = []; } }), /Upstream Claude agents changed/);
  rejects(fixture(undefined, [], { changeClaude: ({ archive }) => { archive.agents.push(file('extra.md', 'Extra\n')); } }), /Upstream Claude agents changed/);
  rejects(fixture(undefined, [], { changeClaude: ({ archive }) => { archive.agents.push(file('nested/extra.md', 'Extra\n')); } }), /Unexpected nested Claude agent path/);
  rejects(fixture(undefined, [], { changeClaude: ({ archive }) => { delete archive.settings; } }), /Missing support file: \.claude\/settings\.json/);

  const malformedHooks = fixture();
  malformedHooks.claudeSources[2].bytes = Buffer.from('{');
  malformedHooks.policy.claude.sourceFiles[2].sha256 = sha256(malformedHooks.claudeSources[2].bytes);
  rejects(rebind(malformedHooks), /Malformed Claude hooks manifest/);

  for (const unsafe of ['plugin/agents/../../escape.md', '/plugin/agents/x.md', 'plugin/agents/.git/x.md']) {
    const input = fixture();
    input.policy.claude.sourceFiles[1].path = unsafe;
    input.claudeSources[1].name = unsafe;
    rejects(rebind(input), /Unsafe archive path/);
  }

  for (const [unsupported, pattern] of [
    ['plugin/other.txt', /Unsupported Claude supplemental source/],
    ['plugin/agents/nested/x.md', /Unsupported Claude supplemental source/],
    ['plugin/skills/impeccable/scripts/impeccable', /Claude source cannot replace runtime or non-markdown skill file/],
    ['plugin/skills/impeccable/reference/new.md', /Claude source has no signed archive counterpart/],
    ['plugin/agents/unknown.md', /Claude source has no signed archive counterpart/],
  ]) {
    const input = fixture();
    const extra = file(unsupported, 'Extra\n');
    input.claudeSources.push(extra);
    input.policy.claude.sourceFiles.push({ path: unsupported, mode: 0o644, sha256: sha256(extra.bytes) });
    rejects(rebind(input), pattern);
  }

  rejects(fixture(undefined, [], { changeClaude: ({ archive }) => {
    archive.skill.find(entry => entry.name === 'scripts/impeccable').bytes = Buffer.from('#!/bin/sh\nexit 0\n');
  } }), /Claude runtime differs from the enrolled Codex runtime: scripts\/impeccable/);

  const unrewritten = fixture();
  unrewritten.policy.claude.sourceFiles = unrewritten.policy.claude.sourceFiles.filter(entry => entry.path !== 'plugin/skills/impeccable/SKILL.md');
  unrewritten.claudeSources = unrewritten.claudeSources.filter(entry => entry.name !== 'plugin/skills/impeccable/SKILL.md');
  rejects(rebind(unrewritten), /Claude package references the project-relative skill path: skills\/impeccable\/SKILL\.md/);

  const renamed = fixture(undefined, [], { changeClaude: ({ sources }) => {
    sources[0].bytes = Buffer.from(claudePluginSkill.replace('name: impeccable', 'name: renamed'));
  } });
  rejects(renamed, /Unexpected upstream skill identity/);

  const malformed = fixture();
  malformed.policy.claude.agents = 'impeccable-documenter.md';
  rejects(rebind(malformed), /Complete Claude enrollment required/);
});

const noPosixShell = process.platform === 'win32' ? 'POSIX hook commands require /bin/sh' : false;

test('runs each Claude hook command against the generated plugin root', { skip: noPosixShell }, t => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'impeccable-claude-runtime-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const output = path.join(root, 'generated candidate');
  writeCandidate(fixture(files => {
    files.find(entry => entry.name === 'scripts/impeccable').bytes = readFileSync(new URL('../skill/scripts/impeccable', import.meta.url));
  }, ['https://github.com', 'https://impeccable.style']), output);
  const pluginRoot = path.join(output, 'claude-marketplace/plugins/impeccable');
  const skill = path.join(pluginRoot, 'skills/impeccable');
  const launcher = path.join(skill, 'scripts/impeccable');
  const cwd = path.join(root, 'separate project');
  const home = path.join(root, 'isolated home');
  const bin = path.join(root, 'bin');
  for (const directory of [cwd, home, bin]) mkdirSync(directory);
  // The plugin hook runs the launcher through `sh`, so keep sh beside the launcher's utilities.
  for (const utility of ['sh', 'dirname', 'cat']) {
    const resolved = spawnSync('/bin/sh', ['-c', 'command -v "$1"', 'sh', utility], { env: { PATH: process.env.PATH }, encoding: 'utf8' });
    assert.equal(resolved.status, 0, `Required POSIX utility is missing from PATH: ${utility}`);
    symlinkSync(path.resolve(resolved.stdout.replace(/\n$/, '')), path.join(bin, utility));
  }
  const engine = path.join(root, 'fixture engine');
  writeFileSync(engine, '#!/bin/sh\nset -eu\nprintf \'%s\\n\' "$0" "$PWD" "$IMPECCABLE_SKILL_DIR" "$IMPECCABLE_SELF" "$@"\nif [ "$1" = hook ]; then cat; fi\n', { mode: 0o755 });
  const env = { HOME: home, PATH: bin, CLAUDE_PLUGIN_ROOT: pluginRoot, IMPECCABLE_NO_TELEMETRY: '1', IMPECCABLE_BIN: engine };
  const run = (command, environment) => spawnSync('/bin/sh', ['-c', command], { cwd, env: environment, encoding: 'utf8', timeout: 5000, input: environment.input });
  const { hooks } = JSON.parse(readFileSync(path.join(pluginRoot, 'hooks/hooks.json'), 'utf8'));
  const events = {
    SessionStart: { hook_event_name: 'SessionStart', session_id: 'fixture', cwd, source: 'startup' },
    PostToolUse: { hook_event_name: 'PostToolUse', session_id: 'fixture', cwd, tool_name: 'Edit', tool_input: { file_path: path.join(cwd, 'page.css') } },
    Stop: { hook_event_name: 'Stop', session_id: 'fixture', cwd, stop_hook_active: false },
  };
  assert.deepEqual(Object.keys(hooks).sort(), Object.keys(events).sort());
  for (const [event, payload] of Object.entries(events)) {
    const [{ hooks: [{ command }] }] = hooks[event];
    const input = JSON.stringify(payload);
    const forwarded = run(command, { ...env, input });
    assert.equal(forwarded.status, 0, forwarded.stderr);
    assert.equal(forwarded.stdout, [engine, cwd, skill, launcher, 'hook', ''].join('\n') + input, event);
    const absent = run(command, { ...env, CLAUDE_PLUGIN_ROOT: path.join(root, 'missing package'), input });
    assert.deepEqual({ status: absent.status, stdout: absent.stdout, stderr: absent.stderr }, { status: 0, stdout: '', stderr: '' }, `${event} with a missing plugin root`);
  }
});

function cliFixture(t) {
  const input = fixture();
  const root = mkdtempSync(path.join(tmpdir(), 'impeccable-claude-cli-'));
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
  for (const entry of [...input.sources, ...input.claudeSources]) put(`source/${entry.name}`, entry.bytes);
  put(`reservations/repack-v${input.version}.json`, json(input.reservation));
  const requestFile = put('build.json', json({
    universal: 'universal.zip', signature: 'signature.json', pin: 'pin.json', policy: 'policy.json',
    reservation: `reservations/repack-v${input.version}.json`, sourceRoot: 'source', procedureRevision: input.procedureRevision,
  }));
  const command = fileURLToPath(new URL('../scripts/repack.mjs', import.meta.url));
  const run = (...args) => spawnSync(process.execPath, [command, ...args], { encoding: 'utf8' });
  return { input, root, put, run, requestFile };
}

function tree(directory, prefix = '') {
  return readdirSync(directory).sort().flatMap(name => {
    const filename = path.join(directory, name);
    const info = lstatSync(filename);
    return info.isDirectory() ? tree(filename, `${prefix}${name}/`) : [[`${prefix}${name}`, info.mode & 0o7777, sha256(readFileSync(filename))]];
  });
}

test('CLI builds byte-identical Claude outputs twice and validates them', t => {
  const { root, run, requestFile } = cliFixture(t);
  for (const directory of ['first', 'second']) {
    const result = run('build', requestFile, path.join(root, directory));
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).candidate.claude.version, '4.8.1+from.4.8.0');
  }
  const first = tree(path.join(root, 'first'));
  assert.deepEqual(first, tree(path.join(root, 'second')));
  assert.ok(first.some(([name]) => name === 'claude-marketplace/plugins/impeccable/hooks/hooks.json'));
  const validated = run('validate', requestFile, path.join(root, 'first'));
  assert.equal(validated.status, 0, validated.stderr);
});

test('validation rejects extra entries, links, and changed bytes inside the Claude tree', t => {
  const { input, root } = cliFixture(t);
  const output = path.join(root, 'retained');
  const loaded = { ...input, sources: input.sources.map(entry => ({ ...entry })), claudeSources: input.claudeSources.map(entry => ({ ...entry })) };
  writeCandidate(loaded, output);
  const pluginRoot = path.join(output, 'claude-marketplace/plugins/impeccable');
  const extra = path.join(pluginRoot, 'agents/extra.md');
  writeFileSync(extra, 'unexpected');
  assert.throws(() => validateCandidate(loaded, output), /Candidate output inventory mismatch: unexpected claude-marketplace\/plugins\/impeccable\/agents\/extra\.md/);
  unlinkSync(extra);
  symlinkSync(path.join(pluginRoot, 'hooks/hooks.json'), extra);
  assert.throws(() => validateCandidate(loaded, output), /Candidate contains links or special files/);
  unlinkSync(extra);
  const hooks = path.join(pluginRoot, 'hooks/hooks.json');
  const original = readFileSync(hooks);
  writeFileSync(hooks, original.toString().replace('"timeout": 30', '"timeout": 31'));
  assert.throws(() => validateCandidate(loaded, output), /Candidate bytes or mode mismatch: claude-marketplace\/plugins\/impeccable\/hooks\/hooks\.json/);
  writeFileSync(hooks, original);
  assert.doesNotThrow(() => validateCandidate(loaded, output));
});

test('CLI rejects missing, executable, or symlinked Claude supplemental sources', t => {
  const { root, put, run, requestFile } = cliFixture(t);
  const filename = path.join(root, 'source/plugin/hooks/hooks.json');
  const bytes = readFileSync(filename);
  const output = path.join(root, 'failed');
  const rejects = pattern => {
    const failed = run('build', requestFile, output);
    assert.equal(failed.status, 1);
    assert.match(failed.stderr, pattern);
    assert.throws(() => lstatSync(output));
  };
  unlinkSync(filename);
  rejects(/Missing pinned supplemental source: plugin\/hooks\/hooks\.json/);
  put('source/plugin/hooks/hooks.json', bytes);
  spawnSync('chmod', ['755', filename]);
  rejects(/Claude source hash or mode mismatch: plugin\/hooks\/hooks\.json/);
  unlinkSync(filename);
  symlinkSync(put('hooks-target.json', bytes), filename);
  rejects(/Supplemental source links are unsupported/);
});

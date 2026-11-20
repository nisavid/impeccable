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
import { claudePluginAgent, claudePluginSkill, claudeProjectSkill, file, fixture, json, rebind, repin, source, sourcePin, stagePluginFile, stageSources, unpin } from './lib/repack-fixture.mjs';

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
  assert.deepEqual(files.get(`${plugin}hooks/hooks.json`).bytes, source(input, 'plugin/hooks/hooks.json').bytes);
  // The built skill, agents, and hooks equal the pinned upstream plugin inventory exactly.
  const built = [...files].filter(([name]) => /^plugins\/impeccable\/(skills|agents|hooks)\//.test(name)).map(([name, entry]) => [`plugin/${name.slice(plugin.length)}`, entry.mode, sha256(entry.bytes)]).sort();
  assert.deepEqual(built, input.policy.claude.sourceFiles.map(pin => [pin.path, pin.mode, pin.sha256]).sort());
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
  assert.deepEqual(mapping.get('skills/impeccable/scripts/impeccable'), { origin: 'signed-archive', source: '.claude/skills/impeccable/scripts/impeccable', destination: 'skills/impeccable/scripts/impeccable', mode: 0o755, sha256: sha256(files.get(`${plugin}skills/impeccable/scripts/impeccable`).bytes) });
  assert.equal(mapping.get('LICENSE').origin, 'source-commit');
  assert.deepEqual(provenance.inventory.map(entry => entry.path), [...files.keys()].filter(name => name.startsWith(plugin) && name !== `${plugin}RELEASE.json`).map(name => name.slice(plugin.length)).sort());
  assert.ok(provenance.transformations.length > 0);
  // The release and candidate records identify the staged plugin tree and the reviewed exclusions.
  const listing = [...input.pluginListing].sort();
  assert.deepEqual(provenance.pluginTree, { listingSha256: sha256(json(listing)), files: listing.length, excludedSourcePaths: ['plugin/.claude-plugin/plugin.json', 'plugin/.grok-plugin/plugin.json'] });
  assert.deepEqual(first.candidate.claude.pluginTree, provenance.pluginTree);
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
  repin(input, '.claude-plugin/plugin.json', { bytes: json({ ...JSON.parse(source(input, '.claude-plugin/plugin.json').bytes), license: 'Apache-2.0', keywords: ['design'] }) });
  const generated = JSON.parse(claudeFiles(buildCandidate(input)).get(`${plugin}.claude-plugin/plugin.json`).bytes);
  assert.equal(generated.license, 'Apache-2.0');
  assert.deepEqual(generated.keywords, ['design']);
  assert.deepEqual(Object.keys(generated), ['name', 'version', 'description', 'author', 'homepage', 'repository', 'license', 'keywords', 'skills']);
});

test('portable archive differs only in recorded input identities when Claude output is enabled', () => {
  const enabled = fixture();
  const disabled = { ...enabled, policy: structuredClone(enabled.policy), reservation: structuredClone(enabled.reservation), sources: enabled.sources.filter(entry => !entry.path.startsWith('plugin/')) };
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
    const entry = sources.find(candidate => candidate.name === 'plugin/hooks/hooks.json');
    const value = JSON.parse(entry.bytes);
    value.hooks.UserPromptSubmit = value.hooks.Stop;
    entry.bytes = json(value);
  } });
  assert.throws(() => buildCandidate(extraEvent), /Claude plugin hook events differ from upstream Claude events/);

  const projectRooted = fixture(undefined, [], { changeClaude: ({ sources }) => {
    const entry = sources.find(candidate => candidate.name === 'plugin/hooks/hooks.json');
    entry.bytes = Buffer.from(entry.bytes.toString().replaceAll('${CLAUDE_PLUGIN_ROOT}/skills', '${CLAUDE_PROJECT_DIR}/.claude/skills'));
  } });
  assert.throws(() => buildCandidate(projectRooted), /Claude hooks must be rooted at CLAUDE_PLUGIN_ROOT/);
});

test('fails closed on changed, missing, malformed, or unsafe Claude inputs', () => {
  const rejects = (input, pattern) => assert.throws(() => buildCandidate(input), pattern);
  const withArchive = change => fixture(undefined, [], { changeClaude: ({ archive }) => change(archive) });

  // Every staged source must match its pin, whether or not the archive supplies its bytes.
  for (const path of ['plugin/skills/impeccable/SKILL.md', 'plugin/skills/impeccable/reference/guide.md']) {
    const changed = fixture();
    source(changed, path).bytes = Buffer.from('changed\n');
    rejects(changed, new RegExp(`Source-file hash or mode mismatch: ${path.replaceAll('.', '\\.')}`));
  }
  const executable = fixture();
  source(executable, 'plugin/agents/impeccable-documenter.md').mode = 0o755;
  rejects(executable, /Source-file hash or mode mismatch: plugin\/agents\/impeccable-documenter\.md/);
  const missingSource = fixture();
  missingSource.sources = missingSource.sources.filter(entry => entry.path !== 'plugin/hooks/hooks.json');
  rejects(missingSource, /Source-file inventory mismatch/);

  // The pinned inventory and the signed Claude copy must hold the same paths.
  rejects(unpin(fixture(), 'plugin/skills/impeccable/reference/guide.md'), /Claude skill inventory differs from the pinned upstream plugin inventory/);
  rejects(stagePluginFile(fixture(), 'plugin/skills/impeccable/reference/new.md', 'New\n', { pin: true }), /Claude skill inventory differs from the pinned upstream plugin inventory/);

  // The enrollment equals the staged plugin tree: a plugin-only file in neither the
  // archive nor the pins, an unclassified plugin entry, and a stale pin or exclusion all fail.
  for (const path of ['plugin/skills/impeccable/reference/plugin-only.md', 'plugin/agents/plugin-only.md', 'plugin/commands/design.md', 'plugin/README.md']) {
    rejects(stagePluginFile(fixture(), path, 'Plugin only\n'), new RegExp(`Staged plugin file is not enrolled: ${path.replaceAll('.', '\\.')}`));
  }
  const stalePin = fixture();
  stalePin.pluginListing = stalePin.pluginListing.filter(entry => entry !== 'plugin/agents/impeccable-documenter.md');
  rejects(stalePin, /Enrolled plugin path is missing from the staged plugin tree: plugin\/agents\/impeccable-documenter\.md/);
  const staleExclusion = fixture();
  staleExclusion.pluginListing = staleExclusion.pluginListing.filter(entry => entry !== 'plugin/.claude-plugin/plugin.json');
  rejects(staleExclusion, /Enrolled plugin path is missing from the staged plugin tree: plugin\/\.claude-plugin\/plugin\.json/);
  for (const excluded of ['plugin/hooks/hooks.json', 'plugin/hooks/helper.sh', 'plugin/agents/x.md', 'plugin/skills/impeccable/x.md', 'other/x.json']) {
    const input = fixture();
    input.policy.claude.excludedSourcePaths = [excluded, ...input.policy.claude.excludedSourcePaths].sort();
    rejects(rebind(input), /Claude exclusion must name a plugin file outside the skill, agents, and hooks/);
  }
  const unlistedTree = fixture();
  delete unlistedTree.pluginListing;
  rejects(unlistedTree, /A staged listing of the plugin tree is required/);
  rejects(unpin(fixture(), 'plugin/hooks/hooks.json'), /Claude hooks source required/);

  // A non-markdown upstream plugin file that differs from the signed copy is taken from
  // the source commit, and then fails the runtime equality with the Codex skill.
  rejects(repin(fixture(), 'plugin/skills/impeccable/scripts/impeccable', { bytes: '#!/bin/sh\nexit 0\n' }), /Claude runtime differs from the enrolled Codex runtime: scripts\/impeccable/);

  // The Claude runtime, executable, and required inventories equal the enrolled ones.
  const droppedRuntime = withArchive(archive => { archive.skill = archive.skill.filter(entry => entry.name !== 'scripts/engine-checksums.txt'); });
  unpin(droppedRuntime, 'plugin/skills/impeccable/scripts/engine-checksums.txt');
  rejects(droppedRuntime, /Claude runtime-file inventory differs from the enrolled runtime/);
  const droppedRequired = withArchive(archive => { archive.skill = archive.skill.filter(entry => entry.name !== 'reference/guide.md'); });
  unpin(droppedRequired, 'plugin/skills/impeccable/reference/guide.md');
  droppedRequired.policy.requiredSkillFiles.push('reference/guide.md');
  rejects(rebind(droppedRequired), /Missing support file: reference\/guide\.md/);
  const extraExecutable = withArchive(archive => { archive.skill.find(entry => entry.name === 'reference/guide.md').mode = 0o755; });
  repin(extraExecutable, 'plugin/skills/impeccable/reference/guide.md', { mode: 0o755 });
  rejects(extraExecutable, /Claude executable inventory differs from the enrolled executables/);

  rejects(withArchive(archive => { archive.agents = []; }), /Claude agents differ from the pinned upstream plugin inventory/);
  rejects(withArchive(archive => { archive.agents.push(file('extra.md', 'Extra\n')); }), /Claude agents differ from the pinned upstream plugin inventory/);
  rejects(withArchive(archive => { archive.agents.push(file('nested/extra.md', 'Extra\n')); }), /Unexpected nested Claude agent path/);
  rejects(withArchive(archive => { delete archive.settings; }), /Missing support file: \.claude\/settings\.json/);
  rejects(repin(fixture(), 'plugin/hooks/hooks.json', { bytes: '{' }), /Malformed Claude hooks manifest/);

  for (const unsafe of ['plugin/agents/../../escape.md', '/plugin/agents/x.md', 'plugin/agents/.git/x.md']) {
    const input = fixture();
    sourcePin(input, 'plugin/agents/impeccable-documenter.md').path = unsafe;
    source(input, 'plugin/agents/impeccable-documenter.md').path = unsafe;
    rejects(rebind(input), /Unsafe archive path/);
  }
  for (const unsupported of ['plugin/other.txt', 'plugin/agents/nested/x.md']) {
    // Pinning a path outside the three inventory shapes fails before completeness.
    const input = fixture();
    input.sources.push({ path: unsupported, bytes: Buffer.from('Extra\n'), mode: 0o644 });
    input.policy.claude.sourceFiles.push({ path: unsupported, mode: 0o644, sha256: sha256('Extra\n') });
    rejects(rebind(input), /Unsupported Claude supplemental source/);
  }

  // The scripts-path search stays as a second guard: an upstream plugin SKILL.md that
  // kept the project path is refused even though it hashes to its pin.
  rejects(repin(fixture(), 'plugin/skills/impeccable/SKILL.md', { bytes: claudeProjectSkill }), /Claude package references the project-relative skill path: skills\/impeccable\/SKILL\.md/);
  rejects(repin(fixture(), 'plugin/skills/impeccable/SKILL.md', { bytes: claudePluginSkill.replace('name: impeccable', 'name: renamed') }), /Unexpected upstream skill identity/);

  // One pin shape, and no enrollment field that carries nothing.
  const oldShape = fixture();
  oldShape.policy.claude.agents = ['impeccable-documenter.md'];
  rejects(rebind(oldShape), /Complete Claude enrollment required/);
  const namedPin = fixture();
  namedPin.pin.sourceFiles[0].name = namedPin.pin.sourceFiles[0].path;
  rejects(rebind(namedPin), /Source pins need exactly path, mode \(420 or 493\), and sha256/);
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
  stageSources(input, put);
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
  const loaded = input;
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
  rejects(/Source-file hash or mode mismatch: plugin\/hooks\/hooks\.json/);
  unlinkSync(filename);
  symlinkSync(put('hooks-target.json', bytes), filename);
  rejects(/Supplemental source links are unsupported/);
});

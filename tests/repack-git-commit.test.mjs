import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expectedSnapshot, fencedEnvironment, commitSnapshot, gitArguments } from '../scripts/lib/repack-git-commit.mjs';
import { buildCandidate } from '../scripts/lib/repack-package.mjs';
import { writeCandidate } from '../scripts/repack.mjs';
import { fixture, json, stageSources } from './lib/repack-fixture.mjs';

const GIT = '/usr/bin/git';
const skip = process.platform === 'win32' || !existsSync(GIT) ? `the local-commit step needs ${GIT}` : false;
const author = { name: 'Repack Fixture', email: 'repack@example.invalid', date: '1700000000 +0000' };
const committer = { name: 'Repack Fixture', email: 'repack@example.invalid', date: '1700000100 +0200' };
const message = 'Claude marketplace snapshot 4.8.1+from.4.8.0\n';

// Every store lives in a fresh directory outside any repository, removed afterwards.
function scratch(t) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'impeccable-local-commit-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const probe = spawnSync(GIT, ['rev-parse', '--is-inside-work-tree'], { cwd: root, env: fencedEnvironment(), encoding: 'utf8' });
  assert.notEqual(probe.status, 0, 'scratch directory must be outside every repository');
  const hooks = path.join(root, 'empty-hooks');
  mkdirSync(hooks);
  return { root, hooks };
}

const fenced = (args, options = {}) => spawnSync(GIT, args, { cwd: '/', encoding: 'utf8', ...options, env: fencedEnvironment(options.env) });

// Plant hooks, an init template, a required filter, and signing in a throwaway
// global configuration, and point repository-redirecting variables at decoys.
function plantedEnvironment(root) {
  const log = path.join(root, 'activity.log');
  const script = (name, body) => {
    const filename = path.join(root, name);
    mkdirSync(path.dirname(filename), { recursive: true });
    writeFileSync(filename, `#!/bin/sh\necho "${name} $*" >> "${log}"\n${body}`);
    chmodSync(filename, 0o755);
    return filename;
  };
  for (const hook of ['reference-transaction', 'post-commit', 'pre-commit']) {
    script(`planted-hooks/${hook}`, 'exit 0\n');
    script(`template/hooks/${hook}`, 'exit 0\n');
  }
  const clean = script('evil-clean', 'tr a-z A-Z\n');
  const gpg = script('fake-gpg', "echo '[GNUPG:] SIG_CREATED D 1 8 00 0 FAKE' >&2\nprintf -- '-----BEGIN PGP SIGNATURE-----\\nfake\\n-----END PGP SIGNATURE-----\\n'\n");
  writeFileSync(path.join(root, 'attributes'), '* filter=evil\n');
  const global = path.join(root, 'planted-global.cfg');
  writeFileSync(global, [
    `[core]\n\thooksPath = ${root}/planted-hooks\n\tattributesFile = ${root}/attributes`,
    `[init]\n\ttemplateDir = ${root}/template\n\tdefaultObjectFormat = sha256`,
    `[filter "evil"]\n\tclean = ${clean}\n\tsmudge = cat\n\trequired = true`,
    `[commit]\n\tgpgSign = true`, `[gpg]\n\tprogram = ${gpg}`,
    `[user]\n\tsigningKey = FAKEKEY\n\tname = Planted\n\temail = planted@example.invalid`, '',
  ].join('\n'));
  const decoy = path.join(root, 'decoy');
  mkdirSync(decoy);
  return {
    log, global, decoy,
    env: { ...process.env, GIT_CONFIG_GLOBAL: global, GIT_DIR: decoy, GIT_INDEX_FILE: path.join(decoy, 'index'), GIT_OBJECT_DIRECTORY: decoy,
      GIT_ALTERNATE_OBJECT_DIRECTORIES: decoy, GIT_CONFIG_PARAMETERS: "'core.hookspath'='/nonexistent'", GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'commit.gpgSign', GIT_CONFIG_VALUE_0: 'true' },
  };
}

function candidateTree(input = fixture()) {
  return buildCandidate(input).claude.files.map(file => ({ ...file }));
}

function commitRequest(root, hooks, overrides = {}) {
  const input = fixture();
  const output = path.join(root, 'candidate');
  writeCandidate(input, output);
  const put = (name, bytes) => { const filename = path.join(root, name); mkdirSync(path.dirname(filename), { recursive: true }); writeFileSync(filename, bytes); return filename; };
  put('inputs/universal.zip', input.universal);
  put('inputs/signature.json', input.signature);
  put('inputs/pin.json', json(input.pin));
  put('inputs/policy.json', json(input.policy));
  put(`inputs/repack-v${input.version}.json`, json(input.reservation));
  stageSources(input, put, 'inputs/source');
  put('inputs/build.json', json({ universal: 'universal.zip', signature: 'signature.json', pin: 'pin.json', policy: 'policy.json', reservation: `repack-v${input.version}.json`, sourceRoot: 'source', procedureRevision: input.procedureRevision }));
  const request = { buildRequest: 'inputs/build.json', output: 'candidate', git: GIT, repository: path.join(root, 'store.git'), createRepository: true, objectFormat: 'sha1', branch: 'refs/heads/claude-marketplace/v4.8.1', hooksDirectory: hooks, author, committer, message, ...overrides };
  return { input, output, requestFile: put('commit.json', json(request)), request };
}

const runCli = (requestFile, env) => spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/repack.mjs', import.meta.url)), 'commit', requestFile], { encoding: 'utf8', env });

test('commits the validated Claude tree in a fresh store with no planted hook, filter, or signer active', { skip }, t => {
  const { root, hooks } = scratch(t);
  const planted = plantedEnvironment(root);
  const { input, requestFile, request } = commitRequest(root, hooks);
  const result = runCli(requestFile, planted.env);
  assert.equal(result.status, 0, result.stderr);
  const { outcome, commit } = JSON.parse(result.stdout);
  assert.equal(outcome, 'committed');
  const expected = expectedSnapshot({ files: candidateTree(input), objectFormat: 'sha1', author, committer, message });
  assert.equal(commit.commit, expected.commit);
  assert.equal(commit.tree, expected.tree);
  assert.deepEqual({ author: commit.author, committer: commit.committer, message: commit.message }, { author, committer, message });

  assert.equal(existsSync(planted.log), false, existsSync(planted.log) ? readFileSync(planted.log, 'utf8') : '');
  assert.deepEqual(readdirSync(planted.decoy), []);
  assert.deepEqual(readdirSync(hooks), []);
  const store = request.repository;
  assert.equal(existsSync(path.join(store, 'hooks')), false);
  assert.deepEqual(readdirSync(store).sort(), ['HEAD', 'config', 'objects', 'refs']);
  assert.equal(fenced([`--git-dir=${store}`, 'config', '--local', '--list']).stdout, 'core.repositoryformatversion=0\ncore.filemode=true\ncore.bare=true\n');
  assert.equal(fenced([`--git-dir=${store}`, 'rev-parse', '--show-object-format']).stdout, 'sha1\n');
  assert.equal(fenced([`--git-dir=${store}`, 'rev-parse', request.branch]).stdout.trim(), expected.commit);
  const body = fenced([`--git-dir=${store}`, 'cat-file', 'commit', expected.commit]).stdout;
  assert.doesNotMatch(body, /^gpgsig/m);
  assert.match(body, /^committer Repack Fixture <repack@example\.invalid> 1700000100 \+0200$/m);
  // The uppercase clean filter would change these blob IDs if it had run.
  const listed = fenced([`--git-dir=${store}`, 'ls-tree', '-r', '--full-tree', expected.commit]).stdout.trim().split('\n');
  assert.deepEqual(listed.sort(), expected.blobs.map(file => `${file.mode === 0o755 ? '100755' : '100644'} blob ${file.oid}\t${file.name}`).sort());
  const hookFile = expected.blobs.find(file => file.name === 'plugins/impeccable/hooks/hooks.json');
  assert.equal(fenced([`--git-dir=${store}`, 'cat-file', 'blob', hookFile.oid], { encoding: 'buffer' }).stdout.equals(hookFile.bytes), true);

  // Controls: the same planted configuration is live outside the fence.
  const control = path.join(root, 'control.git');
  assert.equal(spawnSync(GIT, ['init', '-q', '--bare', control], { cwd: root, env: { PATH: process.env.PATH, GIT_CONFIG_GLOBAL: planted.global, GIT_CONFIG_NOSYSTEM: '1' } }).status, 0);
  assert.ok(existsSync(path.join(control, 'hooks/reference-transaction')), 'init template is live without the fence');
  // Compare filtered and unfiltered IDs from the same control store: it takes
  // the planted SHA-256 default, so its IDs never equal the SHA-1 store's.
  const controlHash = flags => spawnSync(GIT, [`--git-dir=${control}`, 'hash-object', ...flags, '--stdin'], { input: hookFile.bytes, encoding: 'utf8', env: { PATH: process.env.PATH, GIT_CONFIG_GLOBAL: planted.global, GIT_CONFIG_NOSYSTEM: '1' } });
  const filtered = controlHash([`--path=${hookFile.name}`]);
  const unfiltered = controlHash(['--no-filters']);
  assert.equal(filtered.status, 0, filtered.stderr);
  assert.equal(unfiltered.status, 0, unfiltered.stderr);
  assert.notEqual(filtered.stdout.trim(), unfiltered.stdout.trim(), 'required global filter is live without the fence');
});

test('produces the same commit ID in two fresh stores', { skip }, t => {
  const { root, hooks } = scratch(t);
  const files = candidateTree();
  const ids = ['first.git', 'second.git'].map(name => commitSnapshot({ git: GIT, repository: path.join(root, name), hooksDirectory: hooks, objectFormat: 'sha1', ref: 'refs/heads/snapshot', createRepository: true, files, author, committer, message }).commit);
  assert.equal(ids[0], ids[1]);
  assert.equal(ids[0], expectedSnapshot({ files, objectFormat: 'sha1', author, committer, message }).commit);
});

test('commits into a SHA-256 store when that format is requested', { skip }, t => {
  const { root, hooks } = scratch(t);
  const files = candidateTree();
  const result = commitSnapshot({ git: GIT, repository: path.join(root, 'store.git'), hooksDirectory: hooks, objectFormat: 'sha256', ref: 'refs/heads/snapshot', createRepository: true, files, author, committer, message });
  assert.match(result.commit, /^[0-9a-f]{64}$/);
  assert.equal(result.commit, expectedSnapshot({ files, objectFormat: 'sha256', author, committer, message }).commit);
});

test('does not run a hook planted in the repository hooks directory', { skip }, t => {
  const { root, hooks } = scratch(t);
  const store = path.join(root, 'store.git');
  assert.equal(fenced(['init', '-q', '--bare', '--template=', '--object-format=sha1', store]).status, 0);
  const log = path.join(root, 'hook.log');
  mkdirSync(path.join(store, 'hooks'));
  writeFileSync(path.join(store, 'hooks/reference-transaction'), `#!/bin/sh\necho "$1" >> "${log}"\n`, { mode: 0o755 });
  const files = candidateTree();
  const result = commitSnapshot({ git: GIT, repository: store, hooksDirectory: hooks, objectFormat: 'sha1', ref: 'refs/heads/snapshot', files, author, committer, message });
  assert.equal(existsSync(log), false);
  // Control: without the empty hooks path, the planted hook runs on a ref update.
  const control = fenced([`--git-dir=${store}`, 'update-ref', 'refs/heads/control', result.commit, '0'.repeat(40)]);
  assert.equal(control.status, 0, control.stderr);
  assert.match(readFileSync(log, 'utf8'), /committed/);
});

test('refuses repositories and requests outside the controlled conditions', { skip }, t => {
  const { root, hooks } = scratch(t);
  const files = candidateTree();
  const base = { git: GIT, hooksDirectory: hooks, objectFormat: 'sha1', ref: 'refs/heads/snapshot', files, author, committer, message };
  let count = 0;
  const store = (setup = () => {}, { bare = true, format = 'sha1' } = {}) => {
    const repository = path.join(root, `store-${count++}.git`);
    assert.equal(fenced(['init', '-q', ...(bare ? ['--bare'] : []), '--template=', `--object-format=${format}`, repository]).status, 0);
    setup(repository);
    return repository;
  };
  const config = (key, value) => repository => assert.equal(fenced([`--git-dir=${repository}`, 'config', key, value]).status, 0);
  const refuses = (options, pattern) => {
    assert.throws(() => commitSnapshot({ ...base, ...options }), pattern);
    if (options.repository && existsSync(options.repository)) {
      assert.notEqual(fenced([`--git-dir=${options.repository}`, 'rev-parse', '--verify', '--quiet', options.ref ?? base.ref]).status, 0, 'no ref is written');
    }
  };
  refuses({ repository: store(config('core.hooksPath', '/tmp')) }, /must not define hooks, filters, signing, or a commit encoding: core\.hookspath/);
  refuses({ repository: store(config('filter.lfs.clean', 'cat')) }, /filter\.lfs\.clean/);
  refuses({ repository: store(config('user.signingKey', 'KEY')) }, /user\.signingkey/);
  refuses({ repository: store(config('gpg.program', '/bin/false')) }, /gpg\.program/);
  const encoded = store(config('i18n.commitEncoding', 'ISO-8859-1'));
  refuses({ repository: encoded }, /must not define hooks, filters, signing, or a commit encoding: i18n\.commitencoding/);
  assert.equal(fenced([`--git-dir=${encoded}`, 'count-objects']).stdout, '0 objects, 0 kilobytes\n', 'no object is written');
  // Control: the key is live and adds an `encoding` header the expected commit does not carry.
  const emptyTree = fenced([`--git-dir=${encoded}`, 'mktree'], { input: '' }).stdout.trim();
  const encodedCommit = fenced([`--git-dir=${encoded}`, 'commit-tree', '--no-gpg-sign', emptyTree], { input: message, env: {
    GIT_AUTHOR_NAME: author.name, GIT_AUTHOR_EMAIL: author.email, GIT_AUTHOR_DATE: `@${author.date}`,
    GIT_COMMITTER_NAME: committer.name, GIT_COMMITTER_EMAIL: committer.email, GIT_COMMITTER_DATE: `@${committer.date}`,
  } }).stdout.trim();
  assert.match(fenced([`--git-dir=${encoded}`, 'cat-file', 'commit', encodedCommit]).stdout, /^encoding ISO-8859-1$/m);
  refuses({ repository: store(repository => {
    mkdirSync(path.join(repository, 'objects/info'), { recursive: true });
    writeFileSync(path.join(repository, 'objects/info/alternates'), `${root}\n`);
  }) }, /must not have alternates/);
  const existing = store();
  commitSnapshot({ ...base, repository: existing });
  assert.throws(() => commitSnapshot({ ...base, repository: existing }), /Target branch already exists/);
  refuses({ repository: store(undefined, { format: 'sha256' }) }, /object format is sha256, expected sha1/);
  const working = store(repository => assert.equal(fenced([`--git-dir=${path.join(repository, '.git')}`, 'symbolic-ref', 'HEAD', 'refs/heads/snapshot']).status, 0), { bare: false });
  refuses({ repository: path.join(working, '.git') }, /checked out in a worktree: refs\/heads\/snapshot/);
  refuses({ repository: 'relative/store.git' }, /Repository must be a normalized absolute path/);
  refuses({ repository: store(), git: 'git' }, /Git binary must be a normalized absolute path/);
  const busy = path.join(root, 'busy-hooks');
  mkdirSync(busy);
  writeFileSync(path.join(busy, 'reference-transaction'), '');
  refuses({ repository: store(), hooksDirectory: busy }, /Hooks directory must be an existing empty directory/);
  refuses({ repository: store(), author: { ...author, date: 'yesterday' } }, /Explicit author name, email, and date/);
  refuses({ repository: store(), committer: undefined }, /Explicit committer/);
  refuses({ repository: store(), message: '' }, /explicit commit message/);
  refuses({ repository: store(), ref: 'snapshot' }, /full refs\/heads\/ name/);
  refuses({ repository: existing, createRepository: true, ref: 'refs/heads/other' }, /absent repository path/);
});

test('settles whether plumbing commit creation honors signing configuration', { skip }, t => {
  const { root, hooks } = scratch(t);
  const planted = plantedEnvironment(root);
  const store = path.join(root, 'store.git');
  assert.equal(fenced(['init', '-q', '--bare', '--template=', '--object-format=sha1', store]).status, 0);
  const tree = fenced([`--git-dir=${store}`, 'mktree'], { input: '' }).stdout.trim();
  const identity = { GIT_AUTHOR_NAME: 'A', GIT_AUTHOR_EMAIL: 'a@example.invalid', GIT_AUTHOR_DATE: '@1700000000 +0000', GIT_COMMITTER_NAME: 'A', GIT_COMMITTER_EMAIL: 'a@example.invalid', GIT_COMMITTER_DATE: '@1700000000 +0000' };
  const unfenced = args => spawnSync(GIT, [`--git-dir=${store}`, ...args], { cwd: '/', input: 'msg\n', encoding: 'utf8', env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: planted.global, ...identity } });
  const implicit = unfenced(['commit-tree', tree]);
  const explicit = unfenced(['commit-tree', '-S', tree]);
  const signed = id => /^gpgsig/m.test(fenced([`--git-dir=${store}`, 'cat-file', 'commit', id.trim()]).stdout);
  const calls = () => existsSync(planted.log) ? readFileSync(planted.log, 'utf8').split('\n').filter(line => line.startsWith('fake-gpg')).length : 0;
  // Repository configuration: plant signing in the scratch store's own config and
  // ask commit-tree directly, since the step's preflight refuses such keys.
  const local = path.join(root, 'local-signing.git');
  assert.equal(fenced(['init', '-q', '--bare', '--template=', '--object-format=sha1', local]).status, 0);
  for (const [key, value] of [['commit.gpgSign', 'true'], ['gpg.program', path.join(root, 'fake-gpg')], ['user.signingKey', 'FAKEKEY']]) {
    assert.equal(fenced([`--git-dir=${local}`, 'config', key, value]).status, 0);
  }
  const localImplicit = fenced([`--git-dir=${local}`, 'commit-tree', tree], { input: 'msg\n', env: identity });
  assert.equal(localImplicit.status, 0, localImplicit.stderr);
  const localSigned = /^gpgsig/m.test(fenced([`--git-dir=${local}`, 'cat-file', 'commit', localImplicit.stdout.trim()]).stdout);
  const observation = { git: fenced(['--version']).stdout.trim(), globalImplicitSigned: signed(implicit.stdout), localImplicitSigned: localSigned, explicitSigned: signed(explicit.stdout), gpgCalls: calls() };
  t.diagnostic(JSON.stringify(observation));
  assert.equal(observation.explicitSigned, true, 'the planted signer is live when signing is requested');
  assert.equal(observation.globalImplicitSigned, false, 'commit-tree ignores commit.gpgSign in global configuration');
  assert.equal(observation.localImplicitSigned, false, 'commit-tree ignores commit.gpgSign in repository configuration');
  assert.equal(observation.gpgCalls, 1, 'only the explicit -S request ran the signer');
  // The step never relies on that default: it passes --no-gpg-sign and excludes global configuration.
  const before = calls();
  const result = commitSnapshot({ git: GIT, repository: path.join(root, 'step.git'), hooksDirectory: hooks, objectFormat: 'sha1', ref: 'refs/heads/snapshot', createRepository: true, files: candidateTree(), author, committer, message });
  assert.equal(calls(), before);
  assert.doesNotMatch(fenced([`--git-dir=${path.join(root, 'step.git')}`, 'cat-file', 'commit', result.commit]).stdout, /^gpgsig/m);
});

test('validates the retained candidate before writing any object', { skip }, t => {
  const { root, hooks } = scratch(t);
  const { output, requestFile, request } = commitRequest(root, hooks);
  const hooksFile = path.join(output, 'claude-marketplace/plugins/impeccable/hooks/hooks.json');
  writeFileSync(hooksFile, `${readFileSync(hooksFile, 'utf8')} `);
  const result = runCli(requestFile, { PATH: process.env.PATH });
  assert.equal(result.status, 1);
  assert.match(JSON.parse(result.stderr).error, /Candidate bytes or mode mismatch: claude-marketplace\/plugins\/impeccable\/hooks\/hooks\.json/);
  assert.equal(existsSync(request.repository), false);
});

test('refuses configuration-defined hooks before writing any object', { skip }, t => {
  const { root, hooks } = scratch(t);
  const log = path.join(root, 'hook.log');
  const script = path.join(root, 'config-hook');
  writeFileSync(script, `#!/bin/sh\necho "$*" >> "${log}"\n`, { mode: 0o755 });
  const init = name => {
    const repository = path.join(root, name);
    assert.equal(fenced(['init', '-q', '--bare', '--template=', '--object-format=sha1', repository]).status, 0);
    return repository;
  };
  const config = (repository, key, value) => assert.equal(fenced([`--git-dir=${repository}`, 'config', key, value]).status, 0);
  const direct = init('direct.git');
  config(direct, 'hook.evil.command', script);
  config(direct, 'hook.evil.event', 'reference-transaction');
  const included = init('included.git');
  const include = path.join(root, 'hooks.cfg');
  writeFileSync(include, `[hook "inc"]\n\tcommand = ${script}\n\tevent = reference-transaction\n`);
  config(included, 'include.path', include);
  const files = candidateTree();
  for (const [repository, name] of [[direct, 'evil'], [included, 'inc']]) {
    assert.throws(
      () => commitSnapshot({ git: GIT, repository, hooksDirectory: hooks, objectFormat: 'sha1', ref: 'refs/heads/snapshot', files, author, committer, message }),
      new RegExp(`must not define hooks, filters, signing, or a commit encoding: hook\\.${name}\\.command`),
    );
    assert.equal(fenced([`--git-dir=${repository}`, 'count-objects']).stdout, '0 objects, 0 kilobytes\n', 'no object is written');
  }
  assert.equal(existsSync(log), false);

  // Control: the planted hook is live. An empty hooks path alone does not stop it.
  const tree = fenced([`--git-dir=${direct}`, 'mktree'], { input: '' }).stdout.trim();
  const identity = { GIT_AUTHOR_NAME: 'A', GIT_AUTHOR_EMAIL: 'a@example.invalid', GIT_AUTHOR_DATE: '@1700000000 +0000', GIT_COMMITTER_NAME: 'A', GIT_COMMITTER_EMAIL: 'a@example.invalid', GIT_COMMITTER_DATE: '@1700000000 +0000' };
  const commit = fenced([`--git-dir=${direct}`, 'commit-tree', '--no-gpg-sign', tree], { input: 'msg\n', env: identity }).stdout.trim();
  assert.equal(existsSync(log), false, 'object writes run no hook');
  const live = fenced(['-c', `core.hooksPath=${hooks}`, `--git-dir=${direct}`, 'update-ref', 'refs/heads/control', commit, '0'.repeat(40)]);
  assert.equal(live.status, 0, live.stderr);
  const fired = readFileSync(log, 'utf8');
  assert.match(fired, /committed/);
  // Defense in depth: the step's own arguments also disable the event.
  const defended = spawnSync(GIT, gitArguments({ hooksDirectory: hooks }, [`--git-dir=${direct}`, 'update-ref', 'refs/heads/defended', commit, '0'.repeat(40)]), { cwd: '/', encoding: 'utf8', env: fencedEnvironment() });
  assert.equal(defended.status, 0, defended.stderr);
  assert.equal(readFileSync(log, 'utf8'), fired);
});

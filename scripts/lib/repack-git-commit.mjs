import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { safePath } from './repack-zip.mjs';

// Turns a validated marketplace tree into one local commit under controlled
// Git conditions. Every command runs in a cleared environment with system
// and global configuration excluded, names the repository explicitly, writes
// objects by plumbing, and never touches an index, a working tree, or HEAD.

const FORMATS = { sha1: 40, sha256: 64 };
const fail = message => { throw new Error(message); };

export function fencedEnvironment(extra = {}) {
  return { PATH: '/usr/bin:/bin', LC_ALL: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0', ...extra };
}

function requireAbsolute(value, label) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || path.normalize(value) !== value) fail(`${label} must be a normalized absolute path.`);
}

export function requireEmptyDirectory(directory, label) {
  requireAbsolute(directory, label);
  const info = lstatSync(directory, { throwIfNoEntry: false });
  if (!info?.isDirectory() || readdirSync(directory).length) fail(`${label} must be an existing empty directory.`);
}

function git(context, args, { input, env = {}, allow = [0] } = {}) {
  const result = spawnSync(context.git, ['-c', `core.hooksPath=${context.hooksDirectory}`, ...args], {
    cwd: '/', env: fencedEnvironment(env), input, maxBuffer: 512 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (!allow.includes(result.status)) fail(`git ${args.find(arg => !arg.startsWith('-')) ?? ''} failed: ${result.stderr.toString().trim()}`);
  return result;
}
const repo = (context, args, options) => git(context, [`--git-dir=${context.repository}`, ...args], options);
const text = result => result.stdout.toString('utf8').trim();

function objectId(objectFormat, type, body) {
  return createHash(objectFormat).update(Buffer.concat([Buffer.from(`${type} ${body.length}\0`), body])).digest('hex');
}

// Git orders tree entries by name, comparing a subtree's name as if it ended in "/".
function treeObject(entries) {
  const key = entry => entry.type === 'tree' ? `${entry.name}/` : entry.name;
  const sorted = [...entries].sort((a, b) => Buffer.compare(Buffer.from(key(a)), Buffer.from(key(b))));
  return Buffer.concat(sorted.map(entry => Buffer.concat([
    Buffer.from(`${entry.type === 'tree' ? '40000' : entry.mode === 0o755 ? '100755' : '100644'} ${entry.name}\0`),
    Buffer.from(entry.oid, 'hex'),
  ])));
}

function requireIdentity(person, label) {
  if (!person || typeof person.name !== 'string' || typeof person.email !== 'string' || typeof person.date !== 'string' ||
      !/^[^<>\n\0]+$/.test(person.name) || person.name !== person.name.trim() || /^[.,:;"'\\]|[.,:;"'\\]$/.test(person.name) ||
      !/^[^<>\s\0]+$/.test(person.email) || !/^(0|[1-9]\d{0,11}) [+-](?:[01]\d|2[0-3])[0-5]\d$/.test(person.date)) {
    fail(`Explicit ${label} name, email, and date ("<seconds> <+hhmm>") are required.`);
  }
}

// Compute every object ID from the validated bytes alone, so the commit ID is
// known before Git writes anything and readback compares against it.
export function expectedSnapshot({ files, objectFormat, author, committer, message }) {
  if (!Object.hasOwn(FORMATS, objectFormat)) fail('Unsupported object format.');
  requireIdentity(author, 'author'); requireIdentity(committer, 'committer');
  if (typeof message !== 'string' || !message || message.includes('\0')) fail('An explicit commit message is required.');
  if (!Array.isArray(files) || !files.length) fail('The marketplace tree has no files.');
  const blobs = files.map(file => {
    safePath(file.name);
    if (!Buffer.isBuffer(file.bytes) || ![0o644, 0o755].includes(file.mode)) fail(`Unsupported marketplace file: ${file.name}`);
    return { ...file, oid: objectId(objectFormat, 'blob', file.bytes) };
  });
  if (new Set(blobs.map(file => file.name)).size !== blobs.length) fail('Duplicate marketplace path.');
  const directories = new Map([['', []]]);
  for (const file of blobs) {
    const parts = file.name.split('/');
    for (let depth = 1; depth < parts.length; depth++) {
      const directory = parts.slice(0, depth).join('/');
      if (!directories.has(directory)) {
        directories.set(directory, []);
        directories.get(parts.slice(0, depth - 1).join('/')).push({ type: 'tree', name: parts[depth - 1], path: directory });
      }
    }
    directories.get(parts.slice(0, -1).join('/')).push({ type: 'blob', name: parts.at(-1), mode: file.mode, oid: file.oid });
  }
  const trees = [];
  const resolve = directory => {
    const entries = directories.get(directory).map(entry => entry.type === 'tree' ? { ...entry, oid: resolve(entry.path) } : entry);
    const oid = objectId(objectFormat, 'tree', treeObject(entries));
    trees.push({ path: directory, entries, oid });
    return oid;
  };
  const tree = resolve('');
  const person = ({ name, email, date }) => `${name} <${email}> ${date}`;
  const commitBody = Buffer.from(`tree ${tree}\nauthor ${person(author)}\ncommitter ${person(committer)}\n\n${message}`);
  return { blobs, trees, tree, commitBody, commit: objectId(objectFormat, 'commit', commitBody) };
}

function configKeys(context) {
  return text(repo(context, ['config', '--list', '--name-only', '--show-scope'])).split('\n').filter(Boolean)
    .map(line => line.split('\t')).filter(([scope]) => scope !== 'command').map(([, key]) => key.toLowerCase());
}

export function preflight(context, { ref }) {
  const forbidden = configKeys(context).filter(key => key === 'core.hookspath' || key.startsWith('filter.') ||
    key === 'user.signingkey' || key.startsWith('gpg.') || key === 'commit.gpgsign');
  if (forbidden.length) fail(`Repository configuration must not define hooks, filters, or signing: ${[...new Set(forbidden)].join(', ')}`);
  const format = text(repo(context, ['rev-parse', '--show-object-format']));
  if (format !== context.objectFormat) fail(`Repository object format is ${format}, expected ${context.objectFormat}.`);
  for (const name of ['objects/info/alternates', 'objects/info/http-alternates']) {
    const location = path.resolve('/', text(repo(context, ['rev-parse', '--git-path', name])));
    if (lstatSync(location, { throwIfNoEntry: false })) fail('Repository object store must not have alternates.');
  }
  const checkedOut = text(repo(context, ['worktree', 'list', '--porcelain'])).split('\n').filter(line => line.startsWith('branch ')).map(line => line.slice(7));
  if (checkedOut.includes(ref)) fail(`Target branch is checked out in a worktree: ${ref}`);
  if (repo(context, ['show-ref', '--verify', '--quiet', ref], { allow: [0, 1] }).status === 0) fail(`Target branch already exists: ${ref}`);
}

export function initializeStore(context) {
  const parent = path.dirname(context.repository);
  if (!lstatSync(parent, { throwIfNoEntry: false })?.isDirectory() || lstatSync(context.repository, { throwIfNoEntry: false })) {
    fail('A new store needs an existing parent and an absent repository path.');
  }
  git(context, ['init', '--quiet', '--bare', '--template=', `--object-format=${context.objectFormat}`, '--', context.repository]);
  const config = Object.fromEntries(text(repo(context, ['config', '--local', '--list'])).split('\n').map(line => line.split(/=(.*)/s).slice(0, 2)));
  const expected = { 'core.repositoryformatversion': context.objectFormat === 'sha1' ? '0' : '1', 'core.filemode': 'true', 'core.bare': 'true',
    ...(context.objectFormat === 'sha256' && { 'extensions.objectformat': 'sha256' }) };
  const platform = ['core.ignorecase', 'core.precomposeunicode', 'core.symlinks'];
  if (Object.entries(expected).some(([key, value]) => config[key] !== value) || Object.keys(config).some(key => !Object.hasOwn(expected, key) && !platform.includes(key))) {
    fail(`New store configuration is not the minimal set: ${Object.keys(config).join(', ')}`);
  }
  const hooks = path.join(context.repository, 'hooks');
  if (lstatSync(hooks, { throwIfNoEntry: false }) && (!lstatSync(hooks).isDirectory() || readdirSync(hooks).length)) fail('New store hooks directory must be absent or empty.');
}

function readBatch(context, oids) {
  const output = repo(context, ['cat-file', '--batch'], { input: `${oids.join('\n')}\n` }).stdout;
  const objects = new Map();
  let offset = 0;
  for (const oid of oids) {
    const end = output.indexOf(0x0a, offset);
    const [name, type, size] = output.subarray(offset, end).toString('utf8').split(' ');
    if (name !== oid || type !== 'blob') fail(`Readback found an unexpected object: ${oid}`);
    objects.set(oid, output.subarray(end + 1, end + 1 + Number(size)));
    offset = end + 2 + Number(size);
  }
  return objects;
}

function readback(context, expected, ref) {
  if (text(repo(context, ['rev-parse', '--verify', '--quiet', '--end-of-options', ref])) !== expected.commit) fail('Branch does not point at the expected commit.');
  if (!repo(context, ['cat-file', 'commit', expected.commit]).stdout.equals(expected.commitBody)) fail('Commit object differs from the expected commit.');
  const listed = repo(context, ['ls-tree', '-r', '-z', '--full-tree', expected.commit]).stdout.toString('utf8').split('\0').filter(Boolean).map(line => {
    const [meta, name] = line.split('\t');
    const [mode, type, oid] = meta.split(' ');
    return { name, mode, type, oid };
  });
  const wanted = expected.blobs.map(file => ({ name: file.name, mode: file.mode === 0o755 ? '100755' : '100644', type: 'blob', oid: file.oid }))
    .sort((a, b) => Buffer.compare(Buffer.from(a.name), Buffer.from(b.name)));
  listed.sort((a, b) => Buffer.compare(Buffer.from(a.name), Buffer.from(b.name)));
  if (JSON.stringify(listed) !== JSON.stringify(wanted)) fail('Committed tree differs from the validated marketplace tree.');
  const bytes = readBatch(context, wanted.map(entry => entry.oid));
  for (const file of expected.blobs) {
    if (!bytes.get(file.oid).equals(file.bytes)) fail(`Committed bytes differ from the validated marketplace tree: ${file.name}`);
  }
}

export function commitSnapshot({ git: gitBinary, repository, hooksDirectory, objectFormat, ref, createRepository = false, files, author, committer, message }) {
  requireAbsolute(gitBinary, 'Git binary'); requireAbsolute(repository, 'Repository');
  requireEmptyDirectory(hooksDirectory, 'Hooks directory');
  if (typeof ref !== 'string' || !ref.startsWith('refs/heads/')) fail('Target branch must be a full refs/heads/ name.');
  const expected = expectedSnapshot({ files, objectFormat, author, committer, message });
  const context = { git: gitBinary, repository, hooksDirectory, objectFormat };
  git(context, ['check-ref-format', ref]);
  if (createRepository) initializeStore(context);
  preflight(context, { ref });
  for (const file of expected.blobs) {
    if (text(repo(context, ['hash-object', '-w', '--no-filters', '--stdin'], { input: file.bytes })) !== file.oid) fail(`Blob ID differs from the validated bytes: ${file.name}`);
  }
  for (const tree of expected.trees) {
    const input = Buffer.concat(tree.entries.map(entry => Buffer.from(`${entry.type === 'tree' ? '040000' : entry.mode === 0o755 ? '100755' : '100644'} ${entry.type} ${entry.oid}\t${entry.name}\0`)));
    if (text(repo(context, ['mktree', '-z'], { input })) !== tree.oid) fail(`Tree ID differs from the validated tree: ${tree.path || '.'}`);
  }
  const identity = {
    GIT_AUTHOR_NAME: author.name, GIT_AUTHOR_EMAIL: author.email, GIT_AUTHOR_DATE: `@${author.date}`,
    GIT_COMMITTER_NAME: committer.name, GIT_COMMITTER_EMAIL: committer.email, GIT_COMMITTER_DATE: `@${committer.date}`,
  };
  const commit = text(repo(context, ['commit-tree', '--no-gpg-sign', expected.tree], { input: message, env: identity }));
  if (commit !== expected.commit) fail('Commit ID differs from the expected commit.');
  repo(context, ['update-ref', '--no-deref', ref, commit, '0'.repeat(FORMATS[objectFormat])], { env: identity });
  readback(context, expected, ref);
  requireEmptyDirectory(hooksDirectory, 'Hooks directory');
  return { repository, ref, objectFormat, createdRepository: createRepository, commit, tree: expected.tree, author, committer, message, files: expected.blobs.length };
}

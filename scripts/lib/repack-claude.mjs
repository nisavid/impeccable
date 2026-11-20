import { safePath } from './repack-zip.mjs';
import { checkedFile, digest, fail, hash, inventory, isRuntimeFile, jsonBytes, requireSkillIdentity, same, validateSupportLinks } from './repack-common.mjs';

// Catalog identity for the Claude marketplace snapshot. A distinct name keeps
// the fork's catalog beside upstream's `impeccable` marketplace in one client
// configuration; the plugin itself keeps the name `impeccable`.
export const CLAUDE_MARKETPLACE_NAME = 'nisavid-impeccable';
export const CLAUDE_MARKETPLACE_OWNER = { name: 'nisavid' };
export const CLAUDE_MARKETPLACE_DIRECTORY = 'claude-marketplace';

const PLUGIN_PREFIX = 'plugins/impeccable/';
const PROJECT_SCRIPTS = '.claude/skills/impeccable/scripts';
const PLUGIN_LAUNCHER = '${CLAUDE_PLUGIN_ROOT}/skills/impeccable/scripts/impeccable';
const HOOKS_SOURCE = 'plugin/hooks/hooks.json';
const SKILL_SOURCE_PREFIX = 'plugin/skills/impeccable/';
const AGENT_SOURCE_PREFIX = 'plugin/agents/';

function requireEnrollment(claude) {
  const strings = value => Array.isArray(value) && value.every(item => typeof item === 'string');
  if (!claude || typeof claude !== 'object' || typeof claude.skillPrefix !== 'string' || typeof claude.agentsPrefix !== 'string' ||
      typeof claude.projectHooksPath !== 'string' || !claude.hooks || typeof claude.hooks !== 'object' ||
      !strings(claude.agents) || !Array.isArray(claude.sourceFiles)) {
    fail('Complete Claude enrollment required.');
  }
  safePath(claude.skillPrefix, true); safePath(claude.agentsPrefix, true); safePath(claude.projectHooksPath);
  if (!claude.skillPrefix.endsWith('/') || !claude.agentsPrefix.endsWith('/')) fail('Unsupported Claude layout enrollment.');
  same(claude.agents, [...new Set(claude.agents)].sort(), 'Claude agent enrollment must be sorted and unique.');
  for (const name of claude.agents) {
    if (name.includes('/') || !name.endsWith('.md')) fail('Unsupported Claude agent enrollment.');
  }
}

// Map a pinned source-commit path to its place in the plugin tree. Only three
// shapes are supported: upstream's plugin hooks manifest, a plugin-root agent,
// and a markdown file of the plugin skill.
function sourceDestination(sourcePath) {
  safePath(sourcePath);
  if (sourcePath === HOOKS_SOURCE) return { kind: 'hooks', destination: 'hooks/hooks.json' };
  if (sourcePath.startsWith(AGENT_SOURCE_PREFIX) && !sourcePath.slice(AGENT_SOURCE_PREFIX.length).includes('/') && sourcePath.endsWith('.md')) {
    return { kind: 'agent', name: sourcePath.slice(AGENT_SOURCE_PREFIX.length), destination: sourcePath.slice('plugin/'.length) };
  }
  if (sourcePath.startsWith(SKILL_SOURCE_PREFIX)) {
    return { kind: 'skill', name: sourcePath.slice(SKILL_SOURCE_PREFIX.length), destination: sourcePath.slice('plugin/'.length) };
  }
  fail(`Unsupported Claude supplemental source: ${sourcePath}`);
}

export function verifyClaudeSources(sources, claude) {
  requireEnrollment(claude);
  const paths = claude.sourceFiles.map(expected => expected?.path);
  if (!Array.isArray(sources) || sources.length !== claude.sourceFiles.length || new Set(paths).size !== paths.length ||
      new Set(sources.map(file => file.name)).size !== sources.length) {
    fail('Claude source inventory mismatch.');
  }
  const given = new Map(sources.map(file => [file.name, file]));
  const verified = new Map();
  for (const expected of claude.sourceFiles) {
    const target = sourceDestination(expected.path);
    digest(expected.sha256);
    const file = given.get(expected.path);
    if (!file) fail('Claude source inventory mismatch.');
    if (file.mode !== expected.mode || file.mode !== 0o644 || !Buffer.isBuffer(file.bytes) || hash(file.bytes) !== expected.sha256) {
      fail(`Claude source hash or mode mismatch: ${expected.path}`);
    }
    verified.set(expected.path, { ...target, source: expected.path, bytes: file.bytes, mode: file.mode });
  }
  if (!verified.has(HOOKS_SOURCE)) fail('Claude hooks source required.');
  return verified;
}

function requirePluginRootedHooks(hooks) {
  const handlers = Object.values(hooks.hooks ?? {}).flatMap(groups => Array.isArray(groups) ? groups.flatMap(group => group?.hooks ?? []) : []);
  const strings = [];
  (function collect(value) {
    if (typeof value === 'string') strings.push(value);
    else if (value && typeof value === 'object') Object.values(value).forEach(collect);
  })(hooks);
  if (!handlers.length || handlers.some(handler => handler?.type !== 'command' || typeof handler.command !== 'string' || !handler.command.includes(PLUGIN_LAUNCHER)) ||
      strings.some(value => value.includes('CLAUDE_PROJECT_DIR') || value.includes('.claude/skills') || value.includes('.claude\\skills'))) {
    fail('Claude hooks must be rooted at CLAUDE_PLUGIN_ROOT.');
  }
}

function claudeHooks(archiveFiles, claude, verified) {
  const source = verified.get(HOOKS_SOURCE);
  let hooks;
  try {
    hooks = JSON.parse(source.bytes);
  } catch (error) {
    throw new Error('Malformed Claude hooks manifest.', { cause: error });
  }
  same(hooks, claude.hooks, 'Upstream Claude hooks changed; review integration enrollment.');
  let project;
  try {
    project = JSON.parse(checkedFile(archiveFiles, claude.projectHooksPath).bytes);
  } catch (error) {
    if (error.message.startsWith('Missing support file')) throw error;
    throw new Error('Malformed upstream Claude project hooks.', { cause: error });
  }
  if (!hooks?.hooks || typeof hooks.hooks !== 'object' || !project?.hooks || typeof project.hooks !== 'object') fail('Malformed Claude hooks manifest.');
  same(Object.keys(hooks.hooks).sort(), Object.keys(project.hooks).sort(), 'Claude plugin hook events differ from upstream Claude events.');
  requirePluginRootedHooks(hooks);
  return { name: 'hooks/hooks.json', mode: 0o644, bytes: source.bytes, origin: 'source-commit', source: HOOKS_SOURCE };
}

// The plugin skill keeps the signed Claude provider copy and takes a pinned
// source-commit file only for markdown that upstream rewrites for its plugin.
function claudeSkill(archive, claude, codexSkill, verified) {
  const skill = archive.filter(file => file.name.startsWith(claude.skillPrefix)).map(file => ({ ...file, name: file.name.slice(claude.skillPrefix.length) }));
  const files = new Map(skill.map(file => [file.name, file]));
  for (const name of ['SKILL.md', 'scripts/impeccable', 'scripts/impeccable.cmd', 'scripts/VERSION']) checkedFile(files, name);
  const codex = new Map(codexSkill.map(file => [file.name, file]));
  for (const file of skill) {
    if (!isRuntimeFile(file.name) && !(file.mode & 0o111)) continue;
    const expected = codex.get(file.name);
    if (!expected || expected.mode !== file.mode || !expected.bytes.equals(file.bytes)) fail(`Claude runtime differs from the enrolled Codex runtime: ${file.name}`);
  }
  const overrides = new Map([...verified.values()].filter(entry => entry.kind === 'skill').map(entry => [entry.name, entry]));
  for (const [name, entry] of overrides) {
    const original = files.get(name);
    if (!original) fail(`Claude source has no signed archive counterpart: ${entry.source}`);
    if (!name.endsWith('.md') || isRuntimeFile(name) || original.mode !== entry.mode) fail(`Claude source cannot replace runtime or non-markdown skill file: ${entry.source}`);
  }
  return skill.map(file => {
    const override = overrides.get(file.name);
    return override ? { name: file.name, mode: file.mode, bytes: override.bytes, origin: 'source-commit', source: override.source }
      : { ...file, origin: 'signed-archive', source: `${claude.skillPrefix}${file.name}` };
  });
}

function claudeAgents(archive, claude, verified) {
  const agents = archive.filter(file => file.name.startsWith(claude.agentsPrefix)).map(file => ({ ...file, name: file.name.slice(claude.agentsPrefix.length) }));
  if (agents.some(file => file.name.includes('/'))) fail('Unexpected nested Claude agent path.');
  same(agents.map(file => file.name).sort(), claude.agents, 'Upstream Claude agents changed; review enrollment.');
  const names = new Set(claude.agents);
  const overrides = new Map([...verified.values()].filter(entry => entry.kind === 'agent').map(entry => [entry.name, entry]));
  for (const entry of overrides.values()) {
    if (!names.has(entry.name)) fail(`Claude source has no signed archive counterpart: ${entry.source}`);
  }
  return agents.map(file => {
    if (file.mode !== 0o644) fail(`Unexpected Claude agent mode: ${file.name}`);
    const override = overrides.get(file.name);
    return override ? { name: file.name, mode: 0o644, bytes: override.bytes, origin: 'source-commit', source: override.source }
      : { ...file, origin: 'signed-archive', source: `${claude.agentsPrefix}${file.name}` };
  });
}

export function buildClaudePackage({ archive, codexSkill, policy, verified, sourceMap, manifest, version, provenance }) {
  const { claude } = policy;
  const archiveFiles = new Map(archive.map(file => [file.name, file]));
  const skill = claudeSkill(archive, claude, codexSkill, verified);
  requireSkillIdentity(skill);
  validateSupportLinks(skill, new Map(skill.map(file => [file.name, file])));
  const agents = claudeAgents(archive, claude, verified);
  const hooks = claudeHooks(archiveFiles, claude, verified);
  const metadata = {
    name: manifest.name,
    version,
    description: manifest.description,
    author: manifest.author,
    homepage: manifest.homepage,
    repository: 'https://github.com/nisavid/impeccable',
    ...(Object.hasOwn(manifest, 'license') && { license: policy.license }),
    ...(Object.hasOwn(manifest, 'keywords') && { keywords: manifest.keywords }),
    skills: './skills/',
  };
  const payload = [
    ...skill.map(file => ({ ...file, name: `skills/impeccable/${file.name}` })),
    ...agents.map(file => ({ ...file, name: `agents/${file.name}` })),
    hooks,
    ...policy.licenseFiles.map(license => ({ ...checkedFile(sourceMap, license.name), origin: 'source-commit', source: license.name })),
    { name: '.claude-plugin/plugin.json', mode: 0o644, bytes: jsonBytes(metadata), origin: 'generated' },
  ].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  for (const file of payload) {
    safePath(file.name);
    if (file.name.endsWith('.md') && file.bytes.toString('utf8').includes(PROJECT_SCRIPTS)) fail(`Claude package references the project-relative skill path: ${file.name}`);
  }
  const files = payload.map(({ name, mode, bytes }) => ({ name, mode, bytes }));
  const release = {
    schema: 1,
    format: 'claude-code-plugin',
    ...provenance,
    transformations: [
      'Copy the signed Claude provider skill subtree to skills/impeccable, retaining Unix modes; require its runtime files to equal the enrolled Codex runtime.',
      'Replace only the skill and agent markdown that upstream rewrites for its Claude plugin with pinned source-commit files.',
      'Copy the enrolled plugin-root agents and upstream plugin hooks, rooted at CLAUDE_PLUGIN_ROOT, without changing any handler field.',
      'Copy source-bound license and notices; generate the Claude manifest with upstream authorship and metadata, the fork repository, and the allocated repack version.',
    ],
    inputMapping: payload.filter(file => file.origin !== 'generated')
      .map(file => ({ origin: file.origin, source: file.source, destination: file.name, mode: file.mode, sha256: hash(file.bytes) })),
    inventory: inventory(files),
  };
  files.push({ name: 'RELEASE.json', mode: 0o644, bytes: jsonBytes(release) });
  const catalog = {
    name: CLAUDE_MARKETPLACE_NAME,
    owner: CLAUDE_MARKETPLACE_OWNER,
    plugins: [{ name: metadata.name, source: './plugins/impeccable', description: metadata.description, version }],
  };
  const tree = [
    { name: '.claude-plugin/marketplace.json', mode: 0o644, bytes: jsonBytes(catalog) },
    ...files.map(file => ({ ...file, name: `${PLUGIN_PREFIX}${file.name}` })),
  ].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const record = {
    marketplace: CLAUDE_MARKETPLACE_DIRECTORY,
    catalogName: catalog.name,
    name: metadata.name,
    version,
    manifestSha256: hash(jsonBytes(metadata)),
    marketplaceCatalogSha256: hash(jsonBytes(catalog)),
    provenanceSha256: hash(jsonBytes(release)),
    agents: claude.agents,
    hookEvents: Object.keys(claude.hooks.hooks).sort(),
    tree: inventory(tree),
  };
  return { files: tree, catalog, record };
}

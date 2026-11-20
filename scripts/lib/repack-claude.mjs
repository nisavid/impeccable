import { safePath } from './repack-zip.mjs';
import { checkedFile, fail, hash, inventory, isRuntimeFile, jsonBytes, requireSkillIdentity, same, validateSupportLinks } from './repack-common.mjs';

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

const ENROLLMENT_KEYS = ['agentsPrefix', 'excludedSourcePaths', 'hooks', 'projectHooksPath', 'skillPrefix', 'sourceFiles'];

function requireEnrollment(claude) {
  if (!claude || typeof claude !== 'object' || Object.keys(claude).sort().join() !== ENROLLMENT_KEYS.join() ||
      typeof claude.skillPrefix !== 'string' || typeof claude.agentsPrefix !== 'string' || typeof claude.projectHooksPath !== 'string' ||
      !claude.hooks || typeof claude.hooks !== 'object' || !Array.isArray(claude.sourceFiles) ||
      !Array.isArray(claude.excludedSourcePaths) || claude.excludedSourcePaths.some(entry => typeof entry !== 'string')) {
    fail('Complete Claude enrollment required.');
  }
  safePath(claude.skillPrefix, true); safePath(claude.agentsPrefix, true); safePath(claude.projectHooksPath);
  if (!claude.skillPrefix.endsWith('/') || !claude.agentsPrefix.endsWith('/')) fail('Unsupported Claude layout enrollment.');
  same(claude.excludedSourcePaths, [...new Set(claude.excludedSourcePaths)].sort(), 'Claude exclusions must be sorted and unique.');
  for (const excluded of claude.excludedSourcePaths) {
    safePath(excluded);
    if (!excluded.startsWith('plugin/') || excluded === HOOKS_SOURCE || excluded.startsWith(AGENT_SOURCE_PREFIX) || excluded.startsWith(SKILL_SOURCE_PREFIX)) {
      fail(`Claude exclusion must name a plugin file outside the skill, agents, and hooks: ${excluded}`);
    }
  }
}

// The staged listing is every file of the selected commit's plugin/ subtree.
// Each must be pinned or on the reviewed exclusion list, and each pinned or
// excluded path must be staged, so a plugin-only file cannot go unenrolled.
function requireCompleteInventory(listing, claude) {
  if (!Array.isArray(listing) || listing.some(entry => typeof entry !== 'string')) fail('A staged listing of the plugin tree is required.');
  const enrolled = new Set([...claude.sourceFiles.map(pin => pin.path), ...claude.excludedSourcePaths]);
  const staged = new Set(listing);
  const unlisted = listing.filter(entry => !enrolled.has(entry)).sort();
  if (unlisted.length) fail(`Staged plugin file is not enrolled: ${unlisted[0]}`);
  const missing = [...enrolled].filter(entry => !staged.has(entry)).sort();
  if (missing.length) fail(`Enrolled plugin path is missing from the staged plugin tree: ${missing[0]}`);
}

// The enrollment pins upstream's complete plugin skill, agents, and hooks at
// the selected commit. Each pin lands at its plugin path without `plugin/`.
function classifyPins(pins) {
  const skill = new Map();
  const agents = new Map();
  let hooks;
  for (const pin of pins) {
    if (pin.path === HOOKS_SOURCE) hooks = pin;
    else if (pin.path.startsWith(AGENT_SOURCE_PREFIX) && !pin.path.slice(AGENT_SOURCE_PREFIX.length).includes('/')) agents.set(pin.path.slice(AGENT_SOURCE_PREFIX.length), pin);
    else if (pin.path.startsWith(SKILL_SOURCE_PREFIX)) skill.set(pin.path.slice(SKILL_SOURCE_PREFIX.length), pin);
    else fail(`Unsupported Claude supplemental source: ${pin.path}`);
  }
  if (!hooks) fail('Claude hooks source required.');
  if (hooks.mode !== 0o644 || [...agents.values()].some(pin => pin.mode !== 0o644)) fail('Claude hooks and agents must be pinned as 0644 files.');
  return { skill, agents, hooks };
}

// Bytes come from the signed archive when they hash to the pin, and from the
// verified source-commit file otherwise. Either way the result is the pin.
function pinned(pin, archiveFile, archivePath) {
  const fromArchive = archiveFile && archiveFile.mode === pin.mode && hash(archiveFile.bytes) === pin.sha256;
  return fromArchive ? { mode: pin.mode, bytes: archiveFile.bytes, origin: 'signed-archive', source: archivePath }
    : { mode: pin.mode, bytes: pin.bytes, origin: 'source-commit', source: pin.path };
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

function claudeHooks(archiveFiles, claude, pin) {
  let hooks;
  try {
    hooks = JSON.parse(pin.bytes);
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
  return { name: 'hooks/hooks.json', ...pinned(pin) };
}

const sortedNames = files => files.map(file => file.name).sort();

// The plugin skill equals the pinned upstream inventory, which must hold the
// same paths as the signed Claude provider copy.
function claudeSkill(archive, claude, pins) {
  const skill = archive.filter(file => file.name.startsWith(claude.skillPrefix)).map(file => ({ ...file, name: file.name.slice(claude.skillPrefix.length) }));
  same(sortedNames(skill), [...pins.keys()].sort(), 'Claude skill inventory differs from the pinned upstream plugin inventory.');
  const files = new Map(skill.map(file => [file.name, file]));
  return [...pins].map(([name, pin]) => ({ name, ...pinned(pin, files.get(name), `${claude.skillPrefix}${name}`) }));
}

// The Codex skill nests its own subagents under agents/; the Claude plugin
// ships agents at its root instead, so that folder is Codex-only. Everything
// else in the enrolled runtime, executable, and required inventories applies
// to the Claude skill exactly, byte for byte and mode for mode.
function requireEnrolledRuntime(skill, codexSkill, policy) {
  const shared = names => names.filter(name => !name.startsWith('agents/')).sort();
  const files = new Map(skill.map(file => [file.name, file]));
  for (const name of new Set(['SKILL.md', 'scripts/impeccable', 'scripts/impeccable.cmd', 'scripts/VERSION', ...shared(policy.requiredSkillFiles)])) checkedFile(files, name);
  same(sortedNames(skill.filter(file => isRuntimeFile(file.name))), shared(policy.runtimeFiles), 'Claude runtime-file inventory differs from the enrolled runtime.');
  same(sortedNames(skill.filter(file => file.mode & 0o111)), shared(policy.executableFiles), 'Claude executable inventory differs from the enrolled executables.');
  const codex = new Map(codexSkill.map(file => [file.name, file]));
  for (const file of skill.filter(file => isRuntimeFile(file.name) || file.mode & 0o111)) {
    const expected = codex.get(file.name);
    if (!expected || expected.mode !== file.mode || !expected.bytes.equals(file.bytes)) fail(`Claude runtime differs from the enrolled Codex runtime: ${file.name}`);
  }
}

function claudeAgents(archive, claude, pins) {
  const agents = archive.filter(file => file.name.startsWith(claude.agentsPrefix)).map(file => ({ ...file, name: file.name.slice(claude.agentsPrefix.length) }));
  if (agents.some(file => file.name.includes('/'))) fail('Unexpected nested Claude agent path.');
  same(sortedNames(agents), [...pins.keys()].sort(), 'Claude agents differ from the pinned upstream plugin inventory.');
  const files = new Map(agents.map(file => [file.name, file]));
  return [...pins].map(([name, pin]) => ({ name, ...pinned(pin, files.get(name), `${claude.agentsPrefix}${name}`) }));
}

export function buildClaudePackage({ archive, codexSkill, policy, pins: pinList, pluginListing, sourceMap, manifest, version, provenance }) {
  const { claude } = policy;
  requireEnrollment(claude);
  const pins = classifyPins(pinList);
  requireCompleteInventory(pluginListing, claude);
  // The staged listing equals the enrolled pins and exclusions, which the
  // reservation binds through the policy; the records identify it as well.
  const pluginTree = { listingSha256: hash(jsonBytes([...pluginListing].sort())), files: pluginListing.length, excludedSourcePaths: claude.excludedSourcePaths };
  const archiveFiles = new Map(archive.map(file => [file.name, file]));
  const skill = claudeSkill(archive, claude, pins.skill);
  requireEnrolledRuntime(skill, codexSkill, policy);
  requireSkillIdentity(skill);
  validateSupportLinks(skill, new Map(skill.map(file => [file.name, file])));
  const agents = claudeAgents(archive, claude, pins.agents);
  const hooks = claudeHooks(archiveFiles, claude, pins.hooks);
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
    pluginTree,
    ...provenance,
    transformations: [
      'Reproduce the pinned upstream plugin skill, agents, and hooks exactly, taking each file from the signed Claude provider copy where it hashes to the pin and from the source commit otherwise.',
      'Require the skill runtime, executable, and required inventories to equal the enrolled ones apart from the Codex-only agents folder, byte for byte against the Codex runtime.',
      'Keep upstream plugin hooks, rooted at CLAUDE_PLUGIN_ROOT, without changing any handler field.',
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
    agents: [...pins.agents.keys()].sort(),
    hookEvents: Object.keys(claude.hooks.hooks).sort(),
    pluginTree,
    tree: inventory(tree),
  };
  return { files: tree, catalog, record };
}

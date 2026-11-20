import { createPublicKey, verify } from 'node:crypto';
import { readZip, writeZip, safePath } from './repack-zip.mjs';
import { signaturePayload } from '../sign-bundle.mjs';
import { allocateVersion } from './repack-version.mjs';
import { checkedFile, digest, fail, hash, inventory, isRuntimeFile, jsonBytes, requireSkillIdentity, same, validateSupportLinks } from './repack-common.mjs';
import { buildClaudePackage } from './repack-claude.mjs';

export { jsonBytes };
function commit(value) {
  if (!/^[0-9a-f]{40}$/.test(value)) fail('Invalid pinned Git object.');
}

// Every source-commit file is pinned as {path, mode, sha256}: the portable
// supplemental files in the pin, and the Claude plugin inventory in the policy.
export function sourcePins(pin, policy) {
  if (!Array.isArray(pin?.sourceFiles)) fail('Source-file inventory mismatch.');
  if (Object.hasOwn(policy ?? {}, 'claude') && !Array.isArray(policy.claude?.sourceFiles)) fail('Complete Claude enrollment required.');
  const pins = [...pin.sourceFiles, ...(policy?.claude?.sourceFiles ?? [])];
  for (const record of pins) {
    if (!record || typeof record !== 'object' || Object.keys(record).sort().join() !== 'mode,path,sha256' || ![0o644, 0o755].includes(record.mode)) {
      fail('Source pins need exactly path, mode (420 or 493), and sha256.');
    }
    safePath(record.path);
    digest(record.sha256);
  }
  if (new Set(pins.map(record => record.path)).size !== pins.length) fail('Duplicate source pin.');
  return pins;
}

export function verifyInputs({ universal, signature, sources, pin, policy, procedureRevision }) {
  if (pin?.schema !== 1 || policy?.schema !== 1 || pin.repository !== policy.repository || pin.repository !== 'pbakaus/impeccable') fail('Unsupported publisher or input schema.');
  if (typeof policy.license !== 'string' || !policy.license || !/^[a-z0-9-]{1,64}$/.test(policy.keyId)) fail('Accepted license and signing identity are required.');
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(pin.version) || pin.tag !== `skill-v${pin.version}` || !Number.isSafeInteger(pin.releaseId) || pin.releaseId <= 0) fail('Pinned release tag or identity disagrees.');
  commit(pin.tagObject); commit(pin.commit); commit(procedureRevision);
  if (!Array.isArray(pin.assets) || pin.assets.length !== 2 || new Set(pin.assets.map(asset => asset.id)).size !== 2) fail('Expected exact signed asset inventory.');
  for (const [name, bytes] of [['universal.zip', universal], ['universal.zip.sig.json', signature]]) {
    const assets = pin.assets.filter(asset => asset.name === name);
    if (assets.length !== 1 || !Number.isSafeInteger(assets[0].id) || assets[0].id <= 0) fail('Missing or duplicate pinned asset.');
    digest(assets[0].sha256);
    if (!Buffer.isBuffer(bytes) || bytes.length !== assets[0].size || hash(bytes) !== assets[0].sha256) fail(`Pinned asset digest or size mismatch: ${name}`);
  }
  let envelope;
  try {
    envelope = JSON.parse(signature);
  } catch (error) {
    throw new Error('Malformed upstream signature JSON.', { cause: error });
  }
  if (envelope?.schema !== 1 || envelope.keyId !== policy.keyId || envelope.version !== pin.version || envelope.artifact !== 'universal.zip' || envelope.size !== universal.length || envelope.sha256 !== hash(universal) || !/^[0-9a-f]{128}$/.test(envelope.signature) || !/^[0-9a-f]{64}$/.test(policy.publicKey)) fail('Upstream signature identity mismatch.');
  const key = createPublicKey({ format: 'der', type: 'spki', key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(policy.publicKey, 'hex')]) });
  if (!verify(null, signaturePayload(envelope), key, Buffer.from(envelope.signature, 'hex'))) fail('Upstream signature verification failed.');
  const pins = sourcePins(pin, policy);
  if (!Array.isArray(sources) || sources.length !== pins.length || new Set(sources.map(file => file.path)).size !== sources.length) fail('Source-file inventory mismatch.');
  const given = new Map(sources.map(file => [file.path, file]));
  for (const expected of pins) {
    const file = given.get(expected.path);
    if (!file) fail('Source-file inventory mismatch.');
    if (file.mode !== expected.mode || !Buffer.isBuffer(file.bytes) || hash(file.bytes) !== expected.sha256) fail(`Source-file hash or mode mismatch: ${expected.path}`);
  }
  const sourceMap = new Map(pin.sourceFiles.map(expected => {
    if (expected.mode !== 0o644) fail(`Source-file hash or mode mismatch: ${expected.path}`);
    return [expected.path, { ...given.get(expected.path), name: expected.path }];
  }));
  if (!Array.isArray(policy.licenseFiles) || !policy.licenseFiles.some(file => file.name === 'LICENSE')) fail('Enrolled license inventory required.');
  for (const expected of policy.licenseFiles) {
    digest(expected.sha256);
    if (hash(checkedFile(sourceMap, expected.name).bytes) !== expected.sha256) fail('Upstream license or notice changed; review enrollment.');
  }
  const expectedSources = ['.claude-plugin/plugin.json', 'scripts/lib/assets/plugin-icon.png', ...policy.licenseFiles.map(file => file.name)].sort();
  same([...sourceMap.keys()].sort(), expectedSources, 'Unsupported supplemental source layout.');
  const archive = readZip(universal);
  safePath(policy.skillPrefix, true); safePath(policy.projectHooksPath); safePath(policy.projectSkillPath);
  if (!policy.skillPrefix.endsWith('/') || policy.projectSkillPath + '/' !== policy.skillPrefix) fail('Unsupported skill layout enrollment.');
  const skill = archive.filter(file => file.name.startsWith(policy.skillPrefix)).map(file => ({ ...file, name: file.name.slice(policy.skillPrefix.length) }));
  const capabilities = validateSkill(skill, policy);
  // The Claude output is built only when the reviewed policy enrolls it.
  const claudePins = Object.hasOwn(policy, 'claude')
    ? policy.claude.sourceFiles.map(expected => ({ ...expected, bytes: given.get(expected.path).bytes }))
    : null;
  return { archive, sourceMap, claudePins, skill, signature: { keyId: envelope.keyId, sha256: envelope.sha256, verified: true }, capabilities };
}

function transformHooks(hooks, projectSkillPath) {
  function visit(value) {
    if (typeof value === 'string') return value.replaceAll(projectSkillPath, '${PLUGIN_ROOT}/skills/impeccable').replaceAll(projectSkillPath.replaceAll('/', '\\'), '${PLUGIN_ROOT}\\skills\\impeccable');
    if (Array.isArray(value)) return value.map(visit);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, visit(item)]));
    return value;
  }
  return visit(hooks);
}

function validateRuntimeBaseline(runtime, files, baseline) {
  const areas = ['hookExecution', 'executableSelection', 'engineAcquisition', 'cacheMutation', 'networkDestinations', 'browserLoopback', 'processAndFilesystemAuthority'];
  if (!baseline || !Array.isArray(baseline.files) || !areas.every(area => typeof baseline.capabilities?.[area] === 'string' && baseline.capabilities[area].trim())) {
    fail('Complete reviewed runtime baseline required.');
  }
  const engine = baseline.engine;
  if (typeof engine?.version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(engine.version) ||
      typeof engine.checksumManifestSha256 !== 'string' || !engine.checksums || Array.isArray(engine.checksums) ||
      typeof engine.checksums !== 'object' || !Object.keys(engine.checksums).length) {
    fail('Complete reviewed engine identity required.');
  }
  digest(engine.checksumManifestSha256);
  for (const [asset, checksum] of Object.entries(engine.checksums)) {
    if (!/^impeccable-[a-z0-9-]+(?:\.exe)?$/.test(asset) || typeof checksum !== 'string') fail('Invalid enrolled engine checksum.');
    digest(checksum);
  }
  const version = checkedFile(files, 'scripts/VERSION').bytes.toString('utf8').trim();
  const manifest = checkedFile(files, 'scripts/engine-checksums.txt').bytes;
  if (version !== engine.version || hash(manifest) !== engine.checksumManifestSha256) {
    fail('Engine identity changed; investigate before construction.');
  }
  const rows = manifest.toString('utf8').split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'));
  const checksums = {};
  for (const row of rows) {
    const [rowVersion, asset, checksum, extra] = row.split(/\s+/);
    if (rowVersion !== version || extra !== undefined || !/^impeccable-[a-z0-9-]+(?:\.exe)?$/.test(asset) ||
        !/^[0-9a-f]{64}$/.test(checksum) || Object.hasOwn(checksums, asset)) {
      fail('Malformed or duplicate engine checksum record.');
    }
    checksums[asset] = checksum;
  }
  same(Object.entries(checksums).sort(), Object.entries(engine.checksums).sort(), 'Engine checksum records changed; investigate before construction.');
  same(baseline.files.map(file => file?.path).sort(), runtime.map(file => file.name).sort(), 'Runtime baseline must bind every runtime file exactly once.');
  for (const expected of baseline.files) {
    if (typeof expected.sha256 !== 'string') fail('Invalid runtime baseline digest.');
    digest(expected.sha256);
    if (hash(files.get(expected.path).bytes) !== expected.sha256) fail(`Runtime bytes changed; investigate before construction: ${expected.path}`);
  }
  return { runtimeBaselineSha256: hash(jsonBytes(baseline)), engine };
}

function validateSkill(skill, policy) {
  const files = new Map(skill.map(file => [file.name, file]));
  if (![policy.requiredSkillFiles, policy.executableFiles, policy.runtimeFiles, policy.runtimeOrigins].every(Array.isArray)) fail('Complete upstream capability enrollment required.');
  for (const name of ['SKILL.md', 'scripts/impeccable', 'scripts/impeccable.cmd', 'scripts/VERSION', ...policy.requiredSkillFiles]) checkedFile(files, safePath(name));
  requireSkillIdentity(skill);
  const executables = skill.filter(file => file.mode & 0o111).map(file => file.name).sort();
  same(executables, [...policy.executableFiles].sort(), 'Upstream executable inventory changed; review capabilities.');
  const runtime = skill.filter(file => isRuntimeFile(file.name));
  same(runtime.map(file => file.name).sort(), [...policy.runtimeFiles].sort(), 'Upstream runtime-file inventory changed; review capabilities.');
  const origins = [...new Set(runtime.flatMap(file => [...file.bytes.toString('utf8').matchAll(/https?:\/\/[a-zA-Z0-9.-]+(?::[0-9]+)?/g)].map(match => match[0])))].sort();
  same(origins, [...policy.runtimeOrigins].sort(), 'Upstream literal runtime origins changed; review capabilities.');
  const baselineEvidence = validateRuntimeBaseline(runtime, files, policy.runtimeBaseline);
  validateSupportLinks(skill, files);
  return { executables, runtimeFiles: runtime.map(file => file.name).sort(), literalRuntimeOrigins: origins, ...baselineEvidence };
}

export function buildCandidate(input) {
  const { pin, policy, version, procedureRevision, reservation } = input;
  if (reservation?.schema !== 1 || reservation.upstream !== pin.version || reservation.version !== version || reservation.binding?.procedureRevision !== procedureRevision || reservation.binding.inputsSha256 !== hash(jsonBytes({ pin, policy })) || reservation.exposureInventorySha256 !== hash(jsonBytes(reservation.exposureInventory)) || allocateVersion(pin.version, reservation.exposureInventory, { advance: reservation.advance }) !== version) fail('Reservation does not bind this allocation, procedure, and input identity.');
  return assembleCandidate(input);
}

// Runs every input and enrollment check that build runs, on the same code
// path, before any reservation exists. Outputs are assembled in memory under
// the upstream version as a placeholder and discarded.
export function checkEnrollment(input) {
  const { pin, policy, procedureRevision } = input;
  const result = assembleCandidate({ ...input, version: pin?.version, reservation: null });
  return {
    schema: 1, upstream: { version: pin.version, tag: pin.tag, commit: pin.commit }, procedureRevision,
    inputsSha256: hash(jsonBytes({ pin, policy })), policySha256: result.candidate.policySha256,
    claude: Boolean(result.claude), checks: result.candidate.checks,
  };
}

function assembleCandidate(input) {
  const { pin, policy, version, procedureRevision, reservation } = input;
  const { archive, sourceMap, claudePins, skill, signature, capabilities } = verifyInputs(input);
  const projectHooks = JSON.parse(checkedFile(new Map(archive.map(file => [file.name, file])), policy.projectHooksPath).bytes);
  const hooks = transformHooks(projectHooks, policy.projectSkillPath);
  same(hooks, policy.hooks, 'Upstream hooks changed; review integration enrollment.');
  same(Object.keys(hooks.hooks).sort(), ['PostToolUse', 'Stop'], 'Unsupported hook events.');
  const manifest = JSON.parse(checkedFile(sourceMap, '.claude-plugin/plugin.json').bytes);
  const allowed = ['name', 'version', 'description', 'author', 'homepage', 'repository', 'license', 'keywords', 'skills'];
  const invalidLicense = Object.hasOwn(manifest, 'license') && manifest.license !== policy.license;
  const invalidKeywords = Object.hasOwn(manifest, 'keywords') &&
    (!Array.isArray(manifest.keywords) || manifest.keywords.some(value => typeof value !== 'string'));
  if (Object.keys(manifest).some(key => !allowed.includes(key)) || manifest.name !== 'impeccable' || manifest.version !== pin.version || typeof manifest.description !== 'string' || !manifest.description || typeof manifest.author?.name !== 'string' || Object.entries(manifest.author).some(([key, value]) => !['name', 'email', 'url'].includes(key) || typeof value !== 'string') || typeof manifest.homepage !== 'string' || !manifest.homepage.startsWith('https://') || manifest.repository !== 'https://github.com/pbakaus/impeccable' || invalidLicense || invalidKeywords) fail('Malformed or unsupported upstream manifest.');
  const metadata = Object.fromEntries(['name', 'description', 'author', 'homepage', 'keywords'].filter(key => key in manifest).map(key => [key, manifest[key]]));
  metadata.version = version;
  metadata.repository = 'https://github.com/nisavid/impeccable';
  metadata.license = policy.license;
  const overlay = { ...metadata, skills: './skills/', hooks: './hooks/hooks.json', interface: { displayName: 'Impeccable', shortDescription: 'Design and refine interfaces', developerName: manifest.author.name, websiteURL: manifest.homepage, composerIcon: './assets/icon.png', logo: './assets/icon.png' } };
  const root = { $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', ...metadata, extensions: { 'com.openai': overlay } };
  const payload = skill.map(file => ({ ...file, name: `skills/impeccable/${file.name}` }));
  payload.push({ name: 'assets/icon.png', mode: 0o644, bytes: checkedFile(sourceMap, 'scripts/lib/assets/plugin-icon.png').bytes });
  for (const license of policy.licenseFiles) payload.push({ ...checkedFile(sourceMap, license.name) });
  for (const [name, value] of [['plugin.json', root], ['.codex-plugin/plugin.json', overlay], ['hooks/hooks.json', hooks]]) payload.push({ name, mode: 0o644, bytes: jsonBytes(value) });
  const allocation = reservation && { version, upstream: pin.version, advance: reservation.advance ?? false, exposureInventorySha256: reservation.exposureInventorySha256, exposedVersions: [...new Set(reservation.exposureInventory.records.map(record => record.version))].sort() };
  const reservationSha256 = reservation && hash(jsonBytes(reservation));
  const provenance = { schema: 1, upstream: pin, procedureRevision, reservationSha256, allocation, policySha256: hash(jsonBytes(policy)), signature, capabilities, transformations: [
    'Copy complete signed Codex skill subtree verbatim to skills/impeccable, retaining Unix modes.',
    'Copy source-bound license, notices, and icon; preserve upstream manifest authorship and metadata.',
    'Set wrapper repository and allocated repack version; add portable manifest and full OpenAI overlay.',
    'Relocate upstream hook launcher paths to PLUGIN_ROOT; retain events, commands, and all other hook fields.',
  ], inputMapping: skill.map(file => ({ source: `${policy.skillPrefix}${file.name}`, destination: `skills/impeccable/${file.name}`, mode: file.mode, sha256: hash(file.bytes) })), inventory: inventory(payload) };
  payload.push({ name: 'RELEASE.json', mode: 0o644, bytes: jsonBytes(provenance) });
  const claude = claudePins && buildClaudePackage({
    archive, codexSkill: skill, policy, pins: claudePins, sourceMap, manifest, version,
    provenance: { upstream: pin, procedureRevision, reservationSha256, allocation, policySha256: provenance.policySha256, signature, capabilities },
  });
  const bytes = writeZip(payload);
  const catalog = { name: 'impeccable', interface: { displayName: 'Impeccable' }, plugins: [{ name: 'impeccable', source: { source: 'local', path: './plugins/impeccable' }, policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Creativity' }] };
  const candidate = { schema: 1, version, tag: `repack-v${version}`, qualification: 'required', upstream: pin, procedureRevision, reservationSha256, policySha256: provenance.policySha256, archive: { name: `impeccable-${version}.zip`, size: bytes.length, sha256: hash(bytes) }, inventory: inventory(payload), marketplaceCatalogSha256: hash(jsonBytes(catalog)), checks: { signature, payloadFidelity: true, archiveStructure: true }, limits: ['The caller verifies the executing procedure revision. The repacker compares the supplied revision with the reservation.', 'Source supplemental hashes identify inputs but do not independently authenticate their publisher.', 'Runtime-origin inventory recognizes literal http(s) origins only; dynamic behavior requires reviewed enrollment and runtime qualification.', 'Relative-link validation checks inline angle-bracket destinations and bare destinations with balanced parentheses. It allows surrounding whitespace and optional quoted titles and skips code spans and line-leading fences. Client discovery, hook delivery, engine execution, and synchronization require separate observations.'] };
  if (claude) {
    candidate.claude = claude.record;
    candidate.limits.push('The Claude tree equals the pinned upstream plugin inventory; files that differ from the signed archive come from the source commit, whose hashes identify inputs and do not authenticate their publisher. Client loading, hook delivery, and the local commit require separate observations.');
  }
  return { archive: bytes, payload: readZip(bytes), catalog, candidate, ...(claude && { claude: { files: claude.files, catalog: claude.catalog } }) };
}

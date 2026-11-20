import { generateKeyPairSync } from 'node:crypto';
import { signBundle, publicKeyHex } from '../../scripts/sign-bundle.mjs';
import { writeZip } from '../../scripts/lib/repack-zip.mjs';
import { sha256 } from '../../scripts/repack.mjs';

export const json = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
export const file = (name, content, mode = 0o644) => ({ name, bytes: Buffer.isBuffer(content) ? content : Buffer.from(content), mode });

// Mirrors the shape of upstream's Claude project hooks and plugin hooks: the
// project form roots at CLAUDE_PROJECT_DIR, the plugin form at CLAUDE_PLUGIN_ROOT
// with the sh guard, the VS Code `windows` sibling, and an `env` field.
function claudeHooks(scripts, { plugin = false } = {}) {
  const launcher = `${scripts}/impeccable`;
  const command = plugin ? `[ ! -f "${launcher}" ] || sh "${launcher}" hook` : `[ ! -f "${launcher}" ] || "${launcher}" hook`;
  const windowsPath = `${scripts}/impeccable.cmd`.replaceAll('/', '\\');
  const fields = plugin ? { windows: `cmd /c if exist ${windowsPath} ${windowsPath} hook`, env: { IMPECCABLE_HOOK_HARNESS: 'vscode' } } : {};
  const handler = (timeout, statusMessage) => ({ type: 'command', command, ...fields, timeout, statusMessage });
  return {
    hooks: {
      SessionStart: [{ hooks: [handler(5, 'Preparing build session')] }],
      PostToolUse: [{ matcher: 'Edit|Write', hooks: [handler(5, 'Checking UI changes')] }],
      Stop: [{ hooks: [handler(30, 'Design deep pass')] }],
    },
  };
}

export const claudeProjectSkill = '---\nname: impeccable\nversion: 4.8.0\nallowed-tools:\n  - Bash(.claude/skills/impeccable/scripts/impeccable *)\n---\nRun `.claude/skills/impeccable/scripts/impeccable context`. Read [guide](reference/guide.md).\n';
export const claudePluginSkill = '---\nname: impeccable\nversion: 4.8.0\n---\nRun `"${CLAUDE_SKILL_DIR}/scripts/impeccable" context`. Read [guide](reference/guide.md).\n';
export const claudeProjectAgent = '---\nname: impeccable-documenter\n---\nRun `.claude/skills/impeccable/scripts/impeccable document`.\n';
export const claudePluginAgent = '---\nname: impeccable-documenter\n---\nRun `"${CLAUDE_PLUGIN_ROOT}/skills/impeccable/scripts/impeccable" document`.\n';

export function fixture(changeSkill = () => {}, runtimeOrigins = [], { claude = true, changeClaude = () => {} } = {}) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const skills = [file('SKILL.md', '---\nname: impeccable\nversion: 4.8.0\n---\nRead [guide](reference/guide.md).\n'), file('reference/guide.md', 'Guide\n'), file('scripts/impeccable', '#!/bin/sh\nprintf "fixture engine\\n"\n', 0o755), file('scripts/impeccable.cmd', '@echo off\r\n'), file('scripts/VERSION', '0.1.18\n'), file('scripts/engine-checksums.txt', '0.1.18 impeccable-linux-x64 ' + 'd'.repeat(64) + '\n')];
  const windows = 'cmd /c if exist ".codex\\skills\\impeccable\\scripts\\impeccable.cmd" ".codex\\skills\\impeccable\\scripts\\impeccable.cmd" hook';
  const nativeWindows = 'cmd /c if exist "${PLUGIN_ROOT}\\skills\\impeccable\\scripts\\impeccable.cmd" "${PLUGIN_ROOT}\\skills\\impeccable\\scripts\\impeccable.cmd" hook';
  const launcher = '".codex/skills/impeccable/scripts/impeccable"';
  const command = `[ ! -f ${launcher} ] || ${launcher} hook`;
  const projectHooks = { hooks: { PostToolUse: [{ matcher: 'Edit|Write|apply_patch', hooks: [{ type: 'command', command, commandWindows: windows, timeout: 5, statusMessage: 'Checking UI changes' }] }], Stop: [{ hooks: [{ type: 'command', command, commandWindows: windows, timeout: 30, statusMessage: 'Design deep pass' }] }] } };
  const hooks = JSON.parse(JSON.stringify(projectHooks).replaceAll('.codex/skills/impeccable', '${PLUGIN_ROOT}/skills/impeccable'));
  hooks.hooks.PostToolUse[0].hooks[0].commandWindows = nativeWindows;
  hooks.hooks.Stop[0].hooks[0].commandWindows = nativeWindows;
  const manifest = { name: 'impeccable', version: '4.8.0', description: 'Design', author: { name: 'Upstream author' }, homepage: 'https://impeccable.style', repository: 'https://github.com/pbakaus/impeccable', skills: './.claude/skills/' };
  changeSkill(skills);
  // The Claude provider copy shares the runtime bytes and differs in markdown.
  const claudeArchive = {
    skill: [file('SKILL.md', claudeProjectSkill), ...skills.filter(entry => entry.name !== 'SKILL.md' && !entry.name.startsWith('agents/')).map(entry => ({ ...entry }))],
    agents: [file('impeccable-documenter.md', claudeProjectAgent)],
    settings: file('.claude/settings.json', json(claudeHooks('${CLAUDE_PROJECT_DIR}/.claude/skills/impeccable/scripts'))),
  };
  const claudeSources = [
    file('plugin/skills/impeccable/SKILL.md', claudePluginSkill),
    file('plugin/agents/impeccable-documenter.md', claudePluginAgent),
    file('plugin/hooks/hooks.json', json(claudeHooks('${CLAUDE_PLUGIN_ROOT}/skills/impeccable/scripts', { plugin: true }))),
  ];
  changeClaude({ archive: claudeArchive, sources: claudeSources });
  const universal = writeZip([
    ...skills.map(f => ({ ...f, name: `.codex/skills/impeccable/${f.name}` })),
    file('.codex/hooks.json', json(projectHooks)),
    ...claudeArchive.skill.map(f => ({ ...f, name: `.claude/skills/impeccable/${f.name}` })),
    ...claudeArchive.agents.map(f => ({ ...f, name: `.claude/agents/${f.name}` })),
    ...(claudeArchive.settings ? [claudeArchive.settings] : []),
  ]);
  const signature = json(signBundle(universal, '4.8.0', privateKey, { enrolled: publicKeyHex(publicKey) }));
  const sources = [file('LICENSE', 'Apache fixture\n'), file('NOTICE.md', 'Attribution fixture\n'), file('.claude-plugin/plugin.json', json(manifest)), file('scripts/lib/assets/plugin-icon.png', 'icon')];
  const asset = (id, name, bytes) => ({ id, name, size: bytes.length, sha256: sha256(bytes) });
  const pin = { schema: 1, repository: 'pbakaus/impeccable', version: '4.8.0', releaseId: 101, tag: 'skill-v4.8.0', tagObject: 'a'.repeat(40), commit: 'b'.repeat(40), assets: [asset(1, 'universal.zip', universal), asset(2, 'universal.zip.sig.json', signature)], sourceFiles: sources.map(f => ({ name: f.name, sourcePath: f.name, sha256: sha256(f.bytes), mode: f.mode })) };
  const policy = { schema: 1, repository: 'pbakaus/impeccable', keyId: 'enrolled', publicKey: publicKeyHex(publicKey), license: 'Apache-2.0', skillPrefix: '.codex/skills/impeccable/', projectHooksPath: '.codex/hooks.json', projectSkillPath: '.codex/skills/impeccable', hooks, licenseFiles: sources.slice(0, 2).map(f => ({ name: f.name, sha256: sha256(f.bytes) })), requiredSkillFiles: ['SKILL.md', 'scripts/impeccable', 'scripts/impeccable.cmd', 'scripts/VERSION'], executableFiles: ['scripts/impeccable'], runtimeFiles: ['scripts/VERSION', 'scripts/engine-checksums.txt', 'scripts/impeccable', 'scripts/impeccable.cmd'], runtimeOrigins };
  policy.runtimeBaseline = {
    capabilities: {
      hookExecution: 'Synthetic hook receives JSON stdin.',
      executableSelection: 'Synthetic launcher or explicit test-engine override.',
      engineAcquisition: 'Synthetic engine identity with no downloads.',
      cacheMutation: 'Synthetic temporary workspace only.',
      networkDestinations: 'No network operations in this fixture.',
      browserLoopback: 'No browser operations in this fixture.',
      processAndFilesystemAuthority: 'Local fixture subprocesses and temporary files.',
    },
    files: skills.filter(file => policy.runtimeFiles.includes(file.name)).map(file => ({ path: file.name, sha256: sha256(file.bytes) })),
    engine: {
      version: skills.find(file => file.name === 'scripts/VERSION').bytes.toString().trim(),
      checksumManifestSha256: sha256(skills.find(file => file.name === 'scripts/engine-checksums.txt').bytes),
      checksums: { 'impeccable-linux-x64': 'd'.repeat(64) },
    },
  };
  if (claude) {
    policy.claude = {
      skillPrefix: '.claude/skills/impeccable/',
      agentsPrefix: '.claude/agents/',
      projectHooksPath: '.claude/settings.json',
      hooks: JSON.parse(claudeSources.find(entry => entry.name === 'plugin/hooks/hooks.json').bytes),
      agents: ['impeccable-documenter.md'],
      sourceFiles: claudeSources.map(f => ({ path: f.name, mode: f.mode, sha256: sha256(f.bytes) })),
    };
  }
  const procedureRevision = 'c'.repeat(40);
  const version = '4.8.1+from.4.8.0';
  const exposureInventory = { complete: true, records: [{ version: '4.8.0' }] };
  const reservation = { schema: 1, version, upstream: pin.version, binding: { procedureRevision, inputsSha256: sha256(json({ pin, policy })) }, advance: false, exposureInventory, exposureInventorySha256: sha256(json(exposureInventory)) };
  return { universal, signature, sources, claudeSources: claude ? claudeSources : [], pin, policy, version, procedureRevision, reservation };
}

// Recompute the reservation's input binding after a test edits the pin or policy.
export function rebind(input) {
  input.reservation.binding.inputsSha256 = sha256(json({ pin: input.pin, policy: input.policy }));
  return input;
}

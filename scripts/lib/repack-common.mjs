import { createHash } from 'node:crypto';
import path from 'node:path';
import { inlineLinkDestinations } from './repack-markdown.mjs';

export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const jsonBytes = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
export const fail = message => { throw new Error(message); };

export function same(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(message);
}

export function digest(value) {
  if (!/^[0-9a-f]{64}$/.test(value)) fail('Invalid pinned SHA-256.');
}

export function checkedFile(files, name) {
  const file = files.get(name);
  if (!file) fail(`Missing support file: ${name}`);
  return file;
}

export function inventory(files) {
  return [...files].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    .map(file => ({ path: file.name, mode: file.mode, size: file.bytes.length, sha256: hash(file.bytes) }));
}

// Files the capability gate treats as runtime: everything under scripts/ and
// agents/ in the skill tree, plus executable extensions anywhere.
export const isRuntimeFile = name => name.startsWith('scripts/') || name.startsWith('agents/') ||
  /\.(?:js|mjs|cjs|sh|cmd|bat|ps1|py|rb|pl|wasm|exe|dll|so|dylib)$/.test(name);

export function requireSkillIdentity(skill) {
  const files = new Map(skill.map(file => [file.name, file]));
  const skillText = checkedFile(files, 'SKILL.md').bytes.toString('utf8');
  const frontmatter = /^---\r?\n([\s\S]*?)(?<=\n)---[ \t]*(?:\r?\n|$)/.exec(skillText)?.[1] ?? '';
  const names = [...frontmatter.matchAll(/^name:[ \t]*(.*)$/gm)];
  if (names.length !== 1 || names[0][1].trim() !== 'impeccable') fail('Unexpected upstream skill identity.');
  if (skill.some(file => file.name !== 'SKILL.md' && file.name.endsWith('/SKILL.md'))) fail('Unexpected nested skill.');
}

export function validateSupportLinks(skill, files) {
  for (const file of skill.filter(file => file.name.endsWith('.md'))) {
    for (const destination of inlineLinkDestinations(file.bytes.toString('utf8'))) {
      const target = destination.split('#')[0];
      if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.includes('{{')) continue;
      let decoded;
      try {
        decoded = decodeURIComponent(target);
      } catch {
        fail(`Invalid percent encoding in relative support reference: ${file.name}: ${target}`);
      }
      const resolved = path.posix.join(path.posix.dirname(file.name), decoded);
      const directory = resolved.replace(/\/$/, '');
      const escapesRoot = path.posix.isAbsolute(decoded) || directory === '..' || directory.startsWith('../');
      const missing = directory !== '.' && !files.has(resolved) && !skill.some(entry => entry.name.startsWith(`${directory}/`));
      if (escapesRoot || missing) {
        fail(`Missing or escaping relative support reference: ${file.name}: ${target}`);
      }
    }
  }
}

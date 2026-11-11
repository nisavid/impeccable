const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const REPACK_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+from\.(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*))?$/;

function numeric(version, pattern = VERSION) {
  const match = typeof version === 'string' && version.match(pattern);
  if (!match || match[0] !== version) throw new Error(`Invalid stable version: ${version}`);
  const parts = match.slice(1).filter(value => value !== undefined).map(Number);
  if (parts.some(value => !Number.isSafeInteger(value))) throw new Error('Version exceeds safe integer range.');
  if (parts.length === 6 && (parts[0] !== parts[3] || parts[1] !== parts[4] || parts[2] <= parts[5])) throw new Error('Invalid upstream provenance in exposed version.');
  return parts.slice(0, 3);
}

function compare(a, b) {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return Math.sign(a[i] - b[i]);
  return 0;
}

export function requireExposureInventory(inventory) {
  if (inventory?.complete !== true || !Array.isArray(inventory.records)) throw new Error('A complete exposure inventory is required.');
}

export function allocateVersion(upstream, inventory, { advance = false } = {}) {
  const base = numeric(upstream);
  requireExposureInventory(inventory);
  const identities = new Map();
  for (const record of inventory.records) {
    const known = identities.get(record.version) ?? {};
    for (const key of ['archiveSha256', 'inputsSha256', 'reservationSha256']) {
      if (record[key] !== undefined) {
        if (!/^[0-9a-f]{64}$/.test(record[key])) throw new Error('Invalid exposed identity digest.');
        if (known[key] && known[key] !== record[key]) throw new Error(`Conflicting exposed version identity: ${record.version}`);
        known[key] = record[key];
      }
    }
    identities.set(record.version, known);
  }
  const exposed = inventory.records.map(record => numeric(record.version, REPACK_VERSION));
  if (exposed.some(v => compare(v.slice(0, 2), base.slice(0, 2)) > 0)) throw new Error('Upstream is on an older release line; allocation requires a decision.');
  if (!advance && exposed.every(v => compare(base, v) > 0)) return upstream;
  const patch = Math.max(base[2], ...exposed.filter(v => v[0] === base[0] && v[1] === base[1]).map(v => v[2])) + 1;
  if (!Number.isSafeInteger(patch)) throw new Error('Version exceeds safe integer range.');
  return `${base[0]}.${base[1]}.${patch}+from.${upstream}`;
}

export function selectRelease(listing) {
  if (listing?.complete !== true || !Array.isArray(listing.releases)) throw new Error('A complete release enumeration is required.');
  const releases = [];
  for (const release of listing.releases) {
    const tag = release?.tag_name;
    if (typeof tag !== 'string' || !tag.startsWith('skill-v')) continue;
    const version = tag.slice(7);
    const match = version.match(VERSION);
    if (!match || match[0] !== version) continue;
    if (release.draft === true || release.prerelease === true) continue;
    if (release.draft !== false || release.prerelease !== false) {
      throw new Error(`Cannot determine eligibility for upstream release: ${tag}`);
    }
    releases.push({ release, parts: numeric(version) });
  }
  releases.sort((a, b) => compare(b.parts, a.parts));
  if (!releases.length) throw new Error('No stable skill release found.');
  if (releases.length > 1 && compare(releases[0].parts, releases[1].parts) === 0) throw new Error('Duplicate upstream release identity.');
  return releases[0].release;
}

import { inflateRawSync } from 'node:zlib';

const MAX_BYTES = 256 * 1024 * 1024;
const MAX_FILES = 20000;
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  for (let bit = 0; bit < 8; bit++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const value of bytes) crc = CRC_TABLE[(crc ^ value) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function safePath(name, directory = false) {
  if (typeof name !== 'string' || !name || /[\x00-\x20\x7f\\:<>"|?*]/.test(name) || name.startsWith('/') || name.normalize('NFC') !== name) throw new Error(`Unsafe archive path: ${JSON.stringify(name)}`);
  const parts = (directory && name.endsWith('/') ? name.slice(0, -1) : name).split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || part.endsWith('.') || part.toLowerCase() === '.git' || /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part))) throw new Error(`Unsafe archive path: ${name}`);
  return name;
}

function uniquePaths(entries) {
  const seen = new Map();
  for (const entry of entries) {
    const name = entry.name.replace(/\/$/, '');
    const key = name.toLowerCase();
    if (seen.has(key)) throw new Error(`Duplicate archive path: ${name}`);
    seen.set(key, entry.directory);
  }
  for (const name of seen.keys()) {
    const parts = name.split('/');
    while (parts.length > 1) {
      parts.pop();
      if (seen.get(parts.join('/')) === false) throw new Error(`Archive file/directory collision: ${name}`);
    }
  }
}

// Read before writing anything to disk. ZIP64, encryption, split archives and
// special Unix entries are outside the enrolled layout and fail closed.
export function readZip(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 22 || bytes.length > MAX_BYTES) throw new Error('Invalid ZIP size.');
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
    if (bytes.readUInt32LE(offset) === 0x06054b50 && offset + 22 + bytes.readUInt16LE(offset + 20) === bytes.length) { end = offset; break; }
  }
  if (end < 0) throw new Error('Corrupt ZIP end record.');
  const count = bytes.readUInt16LE(end + 10);
  const centralSize = bytes.readUInt32LE(end + 12);
  const centralStart = bytes.readUInt32LE(end + 16);
  if (bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6) || bytes.readUInt16LE(end + 8) !== count || !count || count > MAX_FILES || centralStart + centralSize !== end) throw new Error('Unsupported or corrupt ZIP directory.');
  const entries = [];
  const ranges = [];
  let cursor = centralStart;
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== 0x02014b50) throw new Error('Corrupt ZIP central entry.');
    const flags = bytes.readUInt16LE(cursor + 8);
    const method = bytes.readUInt16LE(cursor + 10);
    const crc = bytes.readUInt32LE(cursor + 16);
    const compressed = bytes.readUInt32LE(cursor + 20);
    const size = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const disk = bytes.readUInt16LE(cursor + 34);
    const attributes = bytes.readUInt32LE(cursor + 38);
    const local = bytes.readUInt32LE(cursor + 42);
    if (flags & ~0x808 || ![0, 8].includes(method) || disk || size === 0xffffffff || compressed === 0xffffffff || local === 0xffffffff || cursor + 46 + nameLength + extraLength + commentLength > end) throw new Error('Unsupported ZIP entry encoding.');
    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
    const name = new TextDecoder('utf-8', { fatal: true }).decode(nameBytes);
    const directory = name.endsWith('/');
    safePath(name, directory);
    const unix = attributes >>> 16;
    const kind = unix & 0o170000;
    if (kind && kind !== (directory ? 0o040000 : 0o100000)) throw new Error('ZIP links and special types are unsupported.');
    if (unix & 0o7000) throw new Error('Unsupported privileged ZIP mode.');
    const mode = unix & 0o777 || (directory ? 0o755 : 0o644);
    if (local + 30 > centralStart || bytes.readUInt32LE(local) !== 0x04034b50 || bytes.readUInt16LE(local + 6) !== flags || bytes.readUInt16LE(local + 8) !== method) throw new Error('Corrupt ZIP local header.');
    const localNameLength = bytes.readUInt16LE(local + 26);
    const localExtraLength = bytes.readUInt16LE(local + 28);
    const start = local + 30 + localNameLength + localExtraLength;
    if (start + compressed > centralStart || !bytes.subarray(local + 30, local + 30 + localNameLength).equals(nameBytes)) throw new Error('Corrupt ZIP local path or bounds.');
    if (!(flags & 8) && (bytes.readUInt32LE(local + 14) !== crc || bytes.readUInt32LE(local + 18) !== compressed || bytes.readUInt32LE(local + 22) !== size)) throw new Error('Corrupt ZIP local size or CRC.');
    let rangeEnd = start + compressed;
    if (flags & 8) {
      const descriptor = rangeEnd + (rangeEnd + 4 <= centralStart && bytes.readUInt32LE(rangeEnd) === 0x08074b50 ? 4 : 0);
      if (descriptor + 12 > centralStart || bytes.readUInt32LE(descriptor) !== crc || bytes.readUInt32LE(descriptor + 4) !== compressed || bytes.readUInt32LE(descriptor + 8) !== size) throw new Error('Corrupt ZIP data descriptor.');
      rangeEnd = descriptor + 12;
    }
    ranges.push([local, rangeEnd]);
    total += size;
    if (total > MAX_BYTES || (directory && size)) throw new Error('Invalid ZIP expanded size.');
    const encoded = bytes.subarray(start, start + compressed);
    const payload = method === 0 ? encoded : inflateRawSync(encoded, { maxOutputLength: Math.max(1, size) });
    if (payload.length !== size || crc32(payload) !== crc) throw new Error('Corrupt ZIP payload CRC.');
    entries.push({ name, bytes: payload, mode, directory });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  if (cursor !== end) throw new Error('Corrupt ZIP central size.');
  ranges.sort((a, b) => a[0] - b[0]);
  if (ranges[0][0] !== 0 || ranges.some((range, index) => range[1] !== (ranges[index + 1]?.[0] ?? centralStart))) throw new Error('ZIP contains overlapping or unaccounted records.');
  uniquePaths(entries);
  return entries.filter(entry => !entry.directory).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}

// Stored entries avoid zlib-version drift. Names, modes, timestamps and order
// are fixed; bytes from upstream are kept verbatim.
export function writeZip(entries) {
  uniquePaths(entries.map(entry => ({ ...entry, directory: false })));
  if (!entries.length || entries.length > MAX_FILES) throw new Error('Invalid ZIP entry count.');
  const localChunks = [];
  const centralChunks = [];
  let offset = 0;
  for (const entry of [...entries].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    safePath(entry.name);
    if (![0o644, 0o755].includes(entry.mode) || !Buffer.isBuffer(entry.bytes)) throw new Error('Unsupported output file mode or payload.');
    const name = Buffer.from(entry.name);
    const crc = crc32(entry.bytes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(33, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(entry.bytes.length, 18);
    local.writeUInt32LE(entry.bytes.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(0x314, 4);
    local.copy(central, 6, 4, 30);
    central.writeUInt32LE(((0o100000 | entry.mode) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    localChunks.push(local, name, entry.bytes);
    centralChunks.push(central, name);
    offset += local.length + name.length + entry.bytes.length;
  }
  const central = Buffer.concat(centralChunks);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  const output = Buffer.concat([...localChunks, central, end]);
  if (output.length > MAX_BYTES) throw new Error('Output ZIP exceeds supported size.');
  return output;
}

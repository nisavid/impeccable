import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readZip, writeZip } from '../scripts/lib/repack-zip.mjs';

const hello = Buffer.from('hello');
const helloCrc = 0x3610a686;
const deflatedHello = Buffer.from('cb48cdc9c90700', 'hex');

// Construct ZIP records directly so invalid names and metadata reach the
// reader unchanged. Every record uses the fixed payload "hello".
function fixture(names, { mode = 0o100644, deflated = false, descriptor, size = hello.length, overlap = false, padding = 0 } = {}) {
  const payload = deflated ? deflatedHello : hello;
  const locals = [];
  const entries = [];
  let offset = 0;
  for (const name of names) {
    const nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(descriptor ? 8 : 0, 6);
    local.writeUInt16LE(deflated ? 8 : 0, 8);
    local.writeUInt16LE(nameBytes.length, 26);
    if (!descriptor) {
      local.writeUInt32LE(helloCrc, 14);
      local.writeUInt32LE(payload.length, 18);
      local.writeUInt32LE(size, 22);
    }

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(0x314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(descriptor ? 8 : 0, 8);
    central.writeUInt16LE(deflated ? 8 : 0, 10);
    central.writeUInt32LE(helloCrc, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(mode * 65536, 38);
    central.writeUInt32LE(overlap ? 0 : offset, 42);
    entries.push(central, nameBytes);

    if (!overlap || offset === 0) {
      const data = [local, nameBytes, payload];
      if (descriptor) {
        const values = Buffer.alloc(12);
        values.writeUInt32LE(helloCrc, 0);
        values.writeUInt32LE(payload.length, 4);
        values.writeUInt32LE(size, 8);
        if (descriptor === 'signed') data.push(Buffer.from('504b0708', 'hex'));
        data.push(values);
      }
      locals.push(...data);
      offset += data.reduce((length, chunk) => length + chunk.length, 0);
    }
  }
  const central = Buffer.concat(entries);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(names.length, 8);
  end.writeUInt16LE(names.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset + padding, 16);
  return Buffer.concat([...locals, Buffer.alloc(padding), central, end]);
}

const centralOffset = zip => zip.readUInt32LE(zip.length - 6);

test('reads independent deflated input and writes reproducible archives retaining mode and bytes', () => {
  const entries = readZip(fixture(['skills/impeccable/scripts/impeccable'], { mode: 0o100755, deflated: true }));
  assert.equal(entries[0].mode, 0o755);
  assert.deepEqual(entries[0].bytes, hello);
  const one = writeZip(entries);
  assert.deepEqual(writeZip(entries), one);
  assert.deepEqual(readZip(one), entries);
});

test('checks stored payload CRC independently of the decompressor', () => {
  const corrupt = fixture(['safe']);
  corrupt[30 + Buffer.byteLength('safe')] ^= 1;
  assert.throws(() => readZip(corrupt), { message: 'Corrupt ZIP payload CRC.' });
});

test('rejects unsafe, colliding, duplicate and special archive paths', () => {
  for (const name of ['../escape', '/absolute', 'a\\b', 'a/./b', 'C:/a', 'NUL.txt', 'a?b']) {
    assert.throws(() => readZip(fixture([name])), { message: /^Unsafe archive path:/ });
  }
  assert.throws(() => readZip(fixture(['a', 'a'])), { message: 'Duplicate archive path: a' });
  assert.throws(() => readZip(fixture(['a', 'A'])), { message: 'Duplicate archive path: A' });
  assert.throws(() => readZip(fixture(['a', 'a/b'])), { message: 'Archive file/directory collision: a/b' });
  assert.throws(() => readZip(fixture(['link'], { mode: 0o120777 })), { message: 'ZIP links and special types are unsupported.' });
  assert.throws(() => readZip(fixture(['privileged'], { mode: 0o104755 })), { message: 'Unsupported privileged ZIP mode.' });
});

test('reads streamed deflate with or without a descriptor signature and rejects a mismatched descriptor', () => {
  for (const descriptor of ['signed', 'unsigned']) {
    const archive = fixture(['stream'], { descriptor, deflated: true });
    assert.deepEqual(readZip(archive)[0].bytes, hello);
    archive.writeUInt32LE(hello.length + 1, centralOffset(archive) - 4);
    assert.throws(() => readZip(archive), { message: 'Corrupt ZIP data descriptor.' });
  }
});

test('rejects encrypted and ZIP64 entries and ambiguous local record ownership', () => {
  const encrypted = fixture(['encrypted']);
  encrypted.writeUInt16LE(1, 6);
  encrypted.writeUInt16LE(1, centralOffset(encrypted) + 8);
  assert.throws(() => readZip(encrypted), { message: 'Unsupported ZIP entry encoding.' });
  const zip64 = fixture(['zip64']);
  zip64.writeUInt32LE(0xffffffff, centralOffset(zip64) + 20);
  assert.throws(() => readZip(zip64), { message: 'Unsupported ZIP entry encoding.' });
  for (const archive of [fixture(['same', 'same'], { overlap: true }), fixture(['safe'], { padding: 1 })]) {
    assert.throws(() => readZip(archive), { message: 'ZIP contains overlapping or unaccounted records.' });
  }
});

test('rejects archives beyond the reader limits and writer entries with unsupported modes', () => {
  const tooMany = fixture(['safe']);
  tooMany.writeUInt16LE(20001, tooMany.length - 14);
  tooMany.writeUInt16LE(20001, tooMany.length - 12);
  assert.throws(() => readZip(tooMany), { message: 'Unsupported or corrupt ZIP directory.' });
  assert.throws(() => readZip(fixture(['large'], { size: 256 * 1024 * 1024 + 1 })), { message: 'Invalid ZIP expanded size.' });
  assert.throws(() => writeZip([{ name: 'safe', bytes: hello, mode: 0o640 }]), { message: 'Unsupported output file mode or payload.' });
});

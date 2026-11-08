import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readZip, writeZip } from '../scripts/lib/repack-zip.mjs';

function fixture(names, mode = 0o100644) {
  return execFileSync('python3', ['-c', `import io,zipfile,sys,json,warnings
warnings.filterwarnings('ignore', message='Duplicate name:')
b=io.BytesIO()
with zipfile.ZipFile(b,'w',compression=zipfile.ZIP_DEFLATED) as z:
 for n in json.loads(sys.argv[1]):
  i=zipfile.ZipInfo(n);i.create_system=3;i.external_attr=int(sys.argv[2])<<16
  z.writestr(i,b'hello',compress_type=zipfile.ZIP_DEFLATED)
sys.stdout.buffer.write(b.getvalue())`, JSON.stringify(names), String(mode)]);
}

test('reads deflated upstream files and writes reproducible archives retaining mode and bytes', () => {
  const entries = readZip(fixture(['skills/impeccable/scripts/impeccable'], 0o100755));
  assert.equal(entries[0].mode, 0o755);
  assert.equal(entries[0].bytes.toString(), 'hello');
  const one = writeZip(entries);
  assert.deepEqual(writeZip(entries), one);
  assert.deepEqual(readZip(one), entries);
});

test('rejects ambiguous, escaping, link, corrupt and duplicate archives before extraction', () => {
  for (const names of [['../escape'], ['/absolute'], ['a\\b'], ['a/./b'], ['a', 'a'], ['a', 'a/b'], ['C:/a'], ['NUL.txt'], ['a?b']]) {
    assert.throws(() => readZip(fixture(names)), /path|duplicate|collision/i);
  }
  assert.throws(() => readZip(fixture(['link'], 0o120777)), /type|link/i);
  const corrupt = fixture(['safe']);
  corrupt[34] ^= 16;
  assert.throws(() => readZip(corrupt), /CRC|corrupt|inflate|invalid/i);
});

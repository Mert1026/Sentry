/**
 * A small ZIP writer for exports: stored entries (no compression), UTF-8 names, no ZIP64. Exports are
 * text well under 6 MB, so this keeps the dependency list as it is. Entry names are checked so an
 * archive can never contain an absolute path or a path that climbs out of the folder it is unpacked in.
 */
import { crc32 } from 'node:zlib';

export interface ZipEntry {
  readonly path: string;
  readonly content: string;
}

const MAX_NAME_BYTES = 300;

export function assertSafeZipName(name: string): void {
  const safe =
    name.length > 0 &&
    Buffer.byteLength(name, 'utf8') <= MAX_NAME_BYTES &&
    !name.startsWith('/') &&
    !name.includes('\\') &&
    !/^[A-Za-z]:/.test(name) &&
    !name.split('/').some((part) => part === '' || part === '.' || part === '..') &&
    // eslint-disable-next-line no-control-regex
    !/[\u0000-\u001f]/.test(name);
  if (!safe) throw new Error('Unsafe name for a ZIP entry: ' + JSON.stringify(name.slice(0, 80)));
}

function dosTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getUTCFullYear());
  return {
    time: (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | (date.getUTCSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
  };
}

export function buildZip(entries: readonly ZipEntry[], modified: Date = new Date()): Buffer {
  const stamp = dosTime(modified);
  const names = new Set<string>();
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    assertSafeZipName(entry.path);
    if (names.has(entry.path)) throw new Error('Duplicate ZIP entry: ' + entry.path);
    names.add(entry.path);
    const name = Buffer.from(entry.path, 'utf8');
    const data = Buffer.from(entry.content, 'utf8');
    const crc = crc32(data);

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(stamp.time, 12);
    central.writeUInt16LE(stamp.date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk
    central.writeUInt16LE(0, 36); // internal attributes
    central.writeUInt32LE(0, 38); // external attributes
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);

    locals.push(local, data);
    centrals.push(central);
    offset += local.length + data.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, ...centrals, end]);
}

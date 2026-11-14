/* توليد أرشيف ZIP بسيط من مصفوفة ملفات باستخدام zlib المدمج.
   كل ملف: { name: 'file.svg', data: Buffer }
   لا يعتمد على مكتبات خارجية. */
const zlib = require('node:zlib');

function dosDateTime(date) {
  const d = date || new Date();
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const hours = d.getHours();
  const minutes = d.getMinutes();
  const seconds = Math.floor(d.getSeconds() / 2);
  const datePart = ((year - 1980) << 9) | (month << 5) | day;
  const timePart = (hours << 11) | (minutes << 5) | seconds;
  return { date: datePart, time: timePart };
}

function writeUInt16LE(buf, offset, value) { buf.writeUInt16LE(value, offset); }
function writeUInt32LE(buf, offset, value) { buf.writeUInt32LE(value, offset); }

function localHeader(name, compressedSize, uncompressedSize, crc, dt) {
  const nameBuf = Buffer.from(name, 'utf8');
  const buf = Buffer.alloc(30 + nameBuf.length);
  writeUInt32LE(buf, 0, 0x04034b50); // local file header signature
  writeUInt16LE(buf, 4, 20); // version needed
  writeUInt16LE(buf, 6, 0); // general purpose bit flag
  writeUInt16LE(buf, 8, 8); // compression method: deflate
  writeUInt16LE(buf, 10, dt.time);
  writeUInt16LE(buf, 12, dt.date);
  writeUInt32LE(buf, 14, crc >>> 0);
  writeUInt32LE(buf, 18, compressedSize >>> 0);
  writeUInt32LE(buf, 22, uncompressedSize >>> 0);
  writeUInt16LE(buf, 26, nameBuf.length);
  writeUInt16LE(buf, 28, 0); // extra field length
  nameBuf.copy(buf, 30);
  return buf;
}

function centralDirHeader(name, compressedSize, uncompressedSize, crc, dt, offset) {
  const nameBuf = Buffer.from(name, 'utf8');
  const buf = Buffer.alloc(46 + nameBuf.length);
  writeUInt32LE(buf, 0, 0x02014b50); // central dir signature
  writeUInt16LE(buf, 4, 20); // version made by
  writeUInt16LE(buf, 6, 20); // version needed
  writeUInt16LE(buf, 8, 0); // flags
  writeUInt16LE(buf, 10, 8); // method
  writeUInt16LE(buf, 12, dt.time);
  writeUInt16LE(buf, 14, dt.date);
  writeUInt32LE(buf, 16, crc >>> 0);
  writeUInt32LE(buf, 20, compressedSize >>> 0);
  writeUInt32LE(buf, 24, uncompressedSize >>> 0);
  writeUInt16LE(buf, 28, nameBuf.length);
  writeUInt16LE(buf, 30, 0); // extra length
  writeUInt16LE(buf, 32, 0); // comment length
  writeUInt16LE(buf, 34, 0); // disk number start
  writeUInt16LE(buf, 36, 0); // internal file attributes
  writeUInt32LE(buf, 38, 0); // external file attributes
  writeUInt32LE(buf, 42, offset >>> 0);
  nameBuf.copy(buf, 46);
  return buf;
}

function eocd(totalEntries, centralDirSize, centralDirOffset) {
  const buf = Buffer.alloc(22);
  writeUInt32LE(buf, 0, 0x06054b50);
  writeUInt16LE(buf, 4, 0); // disk number
  writeUInt16LE(buf, 6, 0); // disk with CD
  writeUInt16LE(buf, 8, totalEntries);
  writeUInt16LE(buf, 10, totalEntries);
  writeUInt32LE(buf, 12, centralDirSize >>> 0);
  writeUInt32LE(buf, 16, centralDirOffset >>> 0);
  writeUInt16LE(buf, 20, 0); // comment length
  return buf;
}

function buildZip(files) {
  const dt = dosDateTime();
  const parts = [];
  const cdRecords = [];
  let offset = 0;

  for (const f of files) {
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data || '');
    const compressed = zlib.deflateRawSync(data, { level: 6 });
    const crc = zlib.crc32(data);
    const name = String(f.name || 'file').replace(/\\/g, '/');
    const lh = localHeader(name, compressed.length, data.length, crc, dt);
    parts.push(lh, compressed);
    const cd = centralDirHeader(name, compressed.length, data.length, crc, dt, offset);
    cdRecords.push(cd);
    offset += lh.length + compressed.length;
  }

  const cd = Buffer.concat(cdRecords);
  const cdOffset = offset;
  parts.push(cd);
  parts.push(eocd(files.length, cd.length, cdOffset));
  return Buffer.concat(parts);
}

module.exports = { buildZip };

/**
 * Minimal ZIP file writer — "store" method (no compression), zero dependencies.
 * Good enough for bundling text/binary files into a .zip a user can download.
 * Not a general-purpose library; built specifically for The Extractor.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function toBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  return new TextEncoder().encode(String(input));
}

function dosDateTime(date) {
  const time =
    ((date.getHours() & 0x1f) << 11) |
    ((date.getMinutes() & 0x3f) << 5) |
    ((date.getSeconds() >> 1) & 0x1f);
  const day =
    (((date.getFullYear() - 1980) & 0x7f) << 9) |
    (((date.getMonth() + 1) & 0xf) << 5) |
    (date.getDate() & 0x1f);
  return { time, day };
}

class ZipWriter {
  constructor() {
    this.files = []; // { name, data }
  }

  /** Add a file. data can be a string, Uint8Array, or ArrayBuffer. */
  addFile(name, data) {
    this.files.push({ name: name.replace(/^\/+/, ''), data: toBytes(data) });
  }

  /** Build the zip and return a Uint8Array. */
  build() {
    const chunks = [];
    const centralRecords = [];
    let offset = 0;
    const now = new Date();
    const { time, day } = dosDateTime(now);

    for (const file of this.files) {
      const nameBytes = new TextEncoder().encode(file.name);
      const crc = crc32(file.data);
      const size = file.data.length;

      const localHeader = new Uint8Array(30 + nameBytes.length);
      const dv = new DataView(localHeader.buffer);
      dv.setUint32(0, 0x04034b50, true); // local file header signature
      dv.setUint16(4, 20, true); // version needed
      dv.setUint16(6, 0, true); // flags
      dv.setUint16(8, 0, true); // compression = store
      dv.setUint16(10, time, true);
      dv.setUint16(12, day, true);
      dv.setUint32(14, crc, true);
      dv.setUint32(18, size, true); // compressed size
      dv.setUint32(22, size, true); // uncompressed size
      dv.setUint16(26, nameBytes.length, true);
      dv.setUint16(28, 0, true); // extra field length
      localHeader.set(nameBytes, 30);

      chunks.push(localHeader, file.data);

      centralRecords.push({ nameBytes, crc, size, offset, time, day });
      offset += localHeader.length + file.data.length;
    }

    const centralStart = offset;
    for (const rec of centralRecords) {
      const central = new Uint8Array(46 + rec.nameBytes.length);
      const dv = new DataView(central.buffer);
      dv.setUint32(0, 0x02014b50, true); // central dir signature
      dv.setUint16(4, 20, true); // version made by
      dv.setUint16(6, 20, true); // version needed
      dv.setUint16(8, 0, true); // flags
      dv.setUint16(10, 0, true); // compression
      dv.setUint16(12, rec.time, true);
      dv.setUint16(14, rec.day, true);
      dv.setUint32(16, rec.crc, true);
      dv.setUint32(20, rec.size, true);
      dv.setUint32(24, rec.size, true);
      dv.setUint16(28, rec.nameBytes.length, true);
      dv.setUint16(30, 0, true); // extra length
      dv.setUint16(32, 0, true); // comment length
      dv.setUint16(34, 0, true); // disk number start
      dv.setUint16(36, 0, true); // internal attrs
      dv.setUint32(38, 0, true); // external attrs
      dv.setUint32(42, rec.offset, true); // relative offset of local header
      central.set(rec.nameBytes, 46);
      chunks.push(central);
      offset += central.length;
    }
    const centralEnd = offset;

    const end = new Uint8Array(22);
    const dv = new DataView(end.buffer);
    dv.setUint32(0, 0x06054b50, true); // end of central dir signature
    dv.setUint16(4, 0, true);
    dv.setUint16(6, 0, true);
    dv.setUint16(8, centralRecords.length, true);
    dv.setUint16(10, centralRecords.length, true);
    dv.setUint32(12, centralEnd - centralStart, true);
    dv.setUint32(16, centralStart, true);
    dv.setUint16(20, 0, true); // comment length
    chunks.push(end);

    let total = 0;
    for (const c of chunks) total += c.length;
    const out = new Uint8Array(total);
    let p = 0;
    for (const c of chunks) {
      out.set(c, p);
      p += c.length;
    }
    return out;
  }
}

// Exposed as a global for popup.js (no module system needed for MV3 popup script tag)
self.ZipWriter = ZipWriter;

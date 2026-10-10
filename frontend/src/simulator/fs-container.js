import { decodeSegment } from './fs-decoder.js';

function asBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  throw new TypeError('expected Uint8Array or ArrayBuffer');
}

function word(bytes, at) {
  if (at < 0 || at + 2 > bytes.length) throw new Error('truncated 16-bit field');
  return bytes[at] | (bytes[at + 1] << 8);
}

function dword(bytes, at) {
  if (at < 0 || at + 4 > bytes.length) throw new Error('truncated 32-bit field');
  return (bytes[at] | (bytes[at + 1] << 8) |
    (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0;
}

function directory(bytes) {
  if (bytes.length < 12 || dword(bytes, 0) !== bytes.length) {
    throw new Error('not an FS segment container');
  }
  const count = word(bytes, 4);
  if (count === 0 || count > 1024 || 6 + 6 * count > bytes.length) {
    throw new Error('invalid FS directory count');
  }
  const entries = [];
  let previous = 6 + 6 * count;
  for (let i = 0; i < count; i += 1) {
    const at = 6 + i * 6;
    const entry = { id: word(bytes, at), offset: dword(bytes, at + 2) };
    if (entry.offset < previous || entry.offset >= bytes.length || (i === 0 && entry.offset !== previous)) {
      throw new Error('invalid FS directory offset');
    }
    entries.push(entry);
    previous = entry.offset;
  }
  return entries;
}

/** Fast structural check for an FS 5.x segment container. */
export function isSegmentContainer(input) {
  try {
    const bytes = asBytes(input);
    const entries = directory(bytes);
    return entries.every((entry, i) => {
      const end = i + 1 < entries.length ? entries[i + 1].offset : bytes.length;
      return end - entry.offset >= 32 && word(bytes, entry.offset + 4) === entry.id;
    });
  } catch {
    return false;
  }
}

/**
 * Parse and expand an FS 5.x module from browser-fetched or Node-read bytes.
 * The resulting segment images include the original 32-byte header and any
 * uncompressed appendix. No native binaries or filesystem APIs are involved.
 *
 * @returns {{name: string, segments: Array<{id: number, fileOffset: number,
 *   storedSize: number, compressed: boolean, image: Uint8Array}>}}
 */
export function loadModule(input, name = '') {
  try {
    const bytes = asBytes(input);
    const entries = directory(bytes);
    const segments = entries.map((entry, i) => {
      const begin = entry.offset;
      const end = i + 1 < entries.length ? entries[i + 1].offset : bytes.length;
      if (end < begin || end - begin < 32 || word(bytes, begin + 4) !== entry.id) {
        throw new Error('invalid segment record');
      }

      const imageSize = word(bytes, begin);
      if (imageSize < 32) throw new Error('invalid expanded image size');
      const compressed = (word(bytes, begin + 8) & 0x8000) !== 0;
      let image;
      if (!compressed) {
        if (imageSize > end - begin) throw new Error('truncated uncompressed image');
        image = bytes.slice(begin, begin + imageSize);
      } else {
        const packedEndField = word(bytes, begin + 14);
        const packedEnd = packedEndField === 0 ? end : begin + packedEndField;
        if (packedEnd < begin + 32 || packedEnd > end) {
          throw new Error('invalid packed stream end');
        }
        const payload = decodeSegment(bytes.subarray(begin + 32, packedEnd), imageSize - 32);
        const appendixSize = imageSize - 32 - payload.length;
        if ((packedEndField === 0 && appendixSize !== 0) || appendixSize > end - packedEnd) {
          throw new Error('invalid uncompressed appendix');
        }
        image = new Uint8Array(imageSize);
        image.set(bytes.subarray(begin, begin + 32));
        image.set(payload, 32);
        image.set(bytes.subarray(packedEnd, packedEnd + appendixSize), 32 + payload.length);
      }
      return { id: entry.id, fileOffset: begin, storedSize: end - begin, compressed, image };
    });
    return { name, segments };
  } catch (error) {
    if (!name) throw error;
    throw new Error(`${name}: ${error.message}`, { cause: error });
  }
}

/** Match the extracted corpus's `0000_0001` style segment directory names. */
export function segmentDirectoryName(index, id) {
  if (!Number.isInteger(index) || index < 0 || !Number.isInteger(id) || id < 0 || id > 0xffff) {
    throw new RangeError('invalid FS segment index or ID');
  }
  return `${String(index).padStart(4, '0')}_${id.toString(16).toUpperCase().padStart(4, '0')}`;
}

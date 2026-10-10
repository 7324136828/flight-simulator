/**
 * Expand an FS 5.x compressed segment payload. This is a direct JavaScript
 * reconstruction of the nine-bit dictionary and run decoder in FSO001.FSO.
 * It accepts Uint8Array, Buffer, or ArrayBuffer data and returns Uint8Array.
 *
 * @param {Uint8Array|ArrayBuffer} compressed packed bytes after the 32-byte header
 * @param {number} maxOutput maximum permitted expanded payload length
 * @returns {Uint8Array}
 */
export function decodeSegment(compressed, maxOutput = 16 * 1024 * 1024) {
  const input = asBytes(compressed);
  if (!Number.isSafeInteger(maxOutput) || maxOutput < 0) {
    throw new RangeError('invalid FS segment output limit');
  }

  const lengths = new Uint8Array(511);
  const dictionary = new Uint8Array(511 * 6);
  for (let code = 0; code < 256; code += 1) {
    lengths[code] = 1;
    dictionary[code * 6] = code;
  }

  const output = new Uint8Array(maxOutput);
  let outputLength = 0;
  let bitPosition = 0;
  let lastEntry = 255;
  let previousCode = -1;
  let runMode = 0;
  let runCount = 0;

  for (;;) {
    if (input.length * 8 - bitPosition < 9) {
      throw new Error('truncated FS segment code stream');
    }
    let code = 0;
    for (let bit = 0; bit < 9; bit += 1) {
      code = (code << 1) | ((input[bitPosition >> 3] >> (7 - (bitPosition & 7))) & 1);
      bitPosition += 1;
    }
    if (code === 511) {
      if (runMode !== 0) throw new Error('FS segment ends during an RLE run');
      return output.slice(0, outputLength);
    }
    if (code > lastEntry || lengths[code] === 0) {
      throw new Error('FS segment references an undefined dictionary code');
    }

    // Preserve the current entry: adding a pair may replace a dictionary slot.
    const entry = dictionary.slice(code * 6, code * 6 + lengths[code]);
    if (previousCode >= 0) {
      if (lastEntry >= 510) {
        lastEntry = 255;
      } else {
        const previousLength = lengths[previousCode];
        if (entry.length + previousLength < 7) {
          const added = ++lastEntry;
          const at = added * 6;
          dictionary.set(dictionary.subarray(previousCode * 6, previousCode * 6 + previousLength), at);
          dictionary.set(entry, at + previousLength);
          lengths[added] = previousLength + entry.length;
        }
      }
      previousCode = -1;
    } else {
      previousCode = code;
    }

    for (const value of entry) {
      if (runMode === 0) {
        runCount = value & 0x7f;
        if ((value & 0x80) !== 0) {
          runMode = 1;
          if (runCount === 0) runCount = 256;
        } else {
          runMode = 2;
        }
      } else if (runMode === 1) {
        if (outputLength >= maxOutput) {
          throw new Error('FS segment output exceeds the supplied limit');
        }
        output[outputLength++] = value;
        if (--runCount === 0) runMode = 0;
      } else {
        if (runCount > maxOutput - outputLength) {
          throw new Error('FS segment output exceeds the supplied limit');
        }
        output.fill(value, outputLength, outputLength + runCount);
        outputLength += runCount;
        runMode = 0;
      }
    }
  }
}

function asBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  throw new TypeError('expected Uint8Array or ArrayBuffer');
}

import { createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { createInterface } from 'node:readline';

/** Raw lines of a file, streamed. */
export async function* readLines(file) {
  const rl = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  try {
    for await (const line of rl) yield line;
  } finally {
    rl.close();
  }
}

/** Parsed records of a JSONL file. Blank and malformed lines are skipped. */
export async function* readJsonl(file) {
  for await (const line of readLines(file)) {
    if (!line.trim()) continue;
    try {
      yield JSON.parse(line);
    } catch {
      // skip malformed line
    }
  }
}

/** First line of a file without reading the rest. Returns '' for an empty file. */
export async function readFirstLine(file, { chunkSize = 65536, maxBytes = 16 * 1024 * 1024 } = {}) {
  const fh = await open(file, 'r');
  try {
    const chunks = [];
    let total = 0;
    const buf = Buffer.alloc(chunkSize);
    while (total < maxBytes) {
      const { bytesRead } = await fh.read(buf, 0, chunkSize, total);
      if (bytesRead === 0) break;
      const nl = buf.subarray(0, bytesRead).indexOf(10);
      if (nl !== -1) {
        chunks.push(Buffer.from(buf.subarray(0, nl)));
        break;
      }
      chunks.push(Buffer.from(buf.subarray(0, bytesRead)));
      total += bytesRead;
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally {
    await fh.close();
  }
}

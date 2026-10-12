// Quick-and-dirty string extractor for bytenode .jsc files (V8 bytecode).
// Finds runs of printable ASCII characters of length >= MIN.
// Usage: npx tsx src/extract-strings.ts <path-to-.jsc> [<min-length>]
import * as fs from "fs";

const path = process.argv[2];
const min = parseInt(process.argv[3] ?? "4", 10);
if (!path) {
  console.error("usage: extract-strings.ts <file> [<min-length>]");
  process.exit(2);
}

const buf = fs.readFileSync(path);
const out: string[] = [];
let cur: number[] = [];

for (let i = 0; i < buf.length; i++) {
  const b = buf[i]!;
  if (b >= 0x20 && b <= 0x7e) {
    cur.push(b);
  } else {
    if (cur.length >= min) out.push(Buffer.from(cur).toString("utf-8"));
    cur = [];
  }
}
if (cur.length >= min) out.push(Buffer.from(cur).toString("utf-8"));

for (const s of out) console.log(s);
console.error(`# total: ${out.length} strings`);

/**
 * Usage: node tools/fvar-dump.mjs path/to/font.otf
 * Prints fvar axes (tags + min/default/max) for pasting into app.js
 */
import fs from "fs";

const path = process.argv[2];
if (!path) {
  console.error("Usage: node tools/fvar-dump.mjs <font.otf|ttf>");
  process.exit(1);
}

const b = fs.readFileSync(path);
const numTables = b.readUInt16BE(4);
let fvarOff = null;
let fvarLen = 0;
for (let i = 0, off = 12; i < numTables; i++) {
  const tag = b.slice(off, off + 4).toString("ascii");
  const offset = b.readUInt32BE(off + 8);
  const length = b.readUInt32BE(off + 12);
  if (tag === "fvar") {
    fvarOff = offset;
    fvarLen = length;
  }
  off += 16;
}

if (fvarOff == null) {
  console.error("No fvar table — file is not a variable font (or use the variable export).");
  process.exit(2);
}

/** OpenType Fixed 16.16 */
function fixed32(o) {
  return b.readInt32BE(o) / 65536;
}

const base = fvarOff;
const axisArrayOffset = b.readUInt16BE(base + 4);
const axisCount = b.readUInt16BE(base + 8);
const axisSize = b.readUInt16BE(base + 10);
const axBase = base + axisArrayOffset;

console.log("// fvar axes from", path);
for (let a = 0; a < axisCount; a++) {
  const o = axBase + a * axisSize;
  const tag = b.slice(o, o + 4).toString("ascii");
  const min = fixed32(o + 4);
  const def = fixed32(o + 8);
  const max = fixed32(o + 12);
  console.log(JSON.stringify({ tag, min, def, max }));
}

// Squeeze screenshots into the smallest PNG, 27 November 2026.
// A lossless re-encoder, written for speed: it reads each 1280x720 RGBA
// screenshot, tries the cheap exact shapes for it (palette, grey, grey+alpha,
// RGB or RGBA, with a transparent key where one fits), screens row filters,
// and keeps the smallest deflate stream it can build from the standard
// library. The deflate is an optimal parser over one match pass, three
// cost rounds, and a short list of candidate lengths per match.
//
// This is the first pass: it encodes and writes, with no proof step yet.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';

const SRC_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const DST_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const PNG_MAGIC = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/* ----- checksums and PNG assembly ----- */

const CRC_TABLE = ((): Int32Array => {
  const tab = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tab[n] = c;
  }
  return tab;
})();

function crc32(buf: Uint8Array, from = 0, to = buf.length): number {
  let c = -1;
  for (let i = from; i < to; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function adler32(buf: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < buf.length; ) {
    const stop = Math.min(buf.length, i + 5552);
    for (; i < stop; i++) {
      a += buf[i];
      b += a;
    }
    a %= 65521;
    b %= 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function latin(s: string): Uint8Array {
  return Uint8Array.from(s, (ch) => ch.charCodeAt(0));
}

function buildPng(parts: Array<[string, Uint8Array]>): Uint8Array {
  let total = PNG_MAGIC.length;
  for (const [, data] of parts) total += 12 + data.length;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  out.set(PNG_MAGIC, 0);
  let at = PNG_MAGIC.length;
  for (const [kind, data] of parts) {
    view.setUint32(at, data.length);
    out.set(latin(kind), at + 4);
    out.set(data, at + 8);
    view.setUint32(at + 8 + data.length, crc32(out, at + 4, at + 8 + data.length));
    at += 12 + data.length;
  }
  return out;
}

function ihdr(width: number, height: number, colourType: number): Uint8Array {
  const d = new Uint8Array(13);
  const v = new DataView(d.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  d[8] = 8;
  d[9] = colourType;
  return d;
}

/** Raw bytes as a zlib stream of stored blocks: the fallback that always works. */
function storedStream(raw: Uint8Array): Uint8Array {
  const blocks = Math.max(1, Math.ceil(raw.length / 65535));
  const out = new Uint8Array(2 + raw.length + 5 * blocks + 4);
  out[0] = 0x78;
  out[1] = 0x01;
  let at = 2;
  for (let k = 0; k < blocks; k++) {
    const from = k * 65535;
    const len = Math.min(65535, raw.length - from);
    out[at] = k === blocks - 1 ? 1 : 0;
    out[at + 1] = len & 0xff;
    out[at + 2] = len >>> 8;
    out[at + 3] = ~len & 0xff;
    out[at + 4] = (~len >>> 8) & 0xff;
    out.set(raw.subarray(from, from + len), at + 5);
    at += 5 + len;
  }
  new DataView(out.buffer).setUint32(at, adler32(raw));
  return out;
}

/* ----- reading a PNG back to RGBA ----- */

function paethPick(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = p > a ? p - a : a - p;
  const pb = p > b ? p - b : b - p;
  const pc = p > c ? p - c : c - p;
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

type Decoded =
  | { ok: true; width: number; height: number; rgba: Uint8Array }
  | { ok: false; why: string };

function decodePng(bytes: Uint8Array): Decoded {
  if (bytes.length < PNG_MAGIC.length || PNG_MAGIC.some((b, i) => bytes[i] !== b)) {
    return { ok: false, why: 'no PNG signature' };
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = PNG_MAGIC.length;
  let head: { width: number; height: number; colourType: number } | null = null;
  let palette: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  let ended = false;
  while (at < bytes.length) {
    if (ended) return { ok: false, why: 'bytes after IEND' };
    if (at + 12 > bytes.length) return { ok: false, why: 'cut chunk' };
    const len = view.getUint32(at);
    if (len > 0x7fffffff || at + 12 + len > bytes.length) return { ok: false, why: 'chunk overruns file' };
    const type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
    if (crc32(bytes, at + 4, at + 8 + len) !== view.getUint32(at + 8 + len)) {
      return { ok: false, why: type + ' CRC fails' };
    }
    const data = bytes.subarray(at + 8, at + 8 + len);
    at += 12 + len;
    if (type === 'IHDR') {
      if (head !== null || len !== 13) return { ok: false, why: 'bad IHDR' };
      const dv = new DataView(data.buffer, data.byteOffset, 13);
      head = { width: dv.getUint32(0), height: dv.getUint32(4), colourType: data[9] };
      if (data[8] !== 8 || !(head.colourType in CHANNELS) || data[10] !== 0 || data[11] !== 0 || data[12] !== 0) {
        return { ok: false, why: 'unsupported IHDR' };
      }
    } else if (type === 'PLTE') {
      if (palette !== null || head === null || head.colourType !== 3 || idat.length > 0) return { ok: false, why: 'bad PLTE' };
      if (len === 0 || len % 3 !== 0 || len > 768) return { ok: false, why: 'bad PLTE size' };
      palette = data;
    } else if (type === 'tRNS') {
      if (trns !== null || head === null || idat.length > 0) return { ok: false, why: 'bad tRNS' };
      const ct = head.colourType;
      if (ct === 3) {
        if (palette === null || len > palette.length / 3) return { ok: false, why: 'bad palette tRNS' };
      } else if (ct === 0 || ct === 2) {
        if (len !== (ct === 0 ? 2 : 6)) return { ok: false, why: 'bad key tRNS' };
      } else return { ok: false, why: 'tRNS on alpha type' };
      trns = data;
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      if (len !== 0) return { ok: false, why: 'non-empty IEND' };
      ended = true;
    } else {
      return { ok: false, why: 'unknown chunk ' + type };
    }
  }
  if (!ended || head === null || idat.length === 0) return { ok: false, why: 'missing IEND/IHDR/IDAT' };
  const { width, height, colourType } = head;
  const bpp = CHANNELS[colourType];
  const stride = width * bpp;
  const want = height * (stride + 1);
  let raw: Uint8Array;
  try {
    raw = zlib.inflateSync(idat.length === 1 ? idat[0] : Buffer.concat(idat), { maxOutputLength: want + 1 });
  } catch {
    return { ok: false, why: 'IDAT does not inflate' };
  }
  if (raw.length !== want) return { ok: false, why: 'inflated size mismatch' };
  const samples = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const ft = raw[y * (stride + 1)];
    if (ft > 4) return { ok: false, why: 'row filter ' + ft };
    const src = y * (stride + 1) + 1;
    const o = y * stride;
    const p = o - stride;
    if (ft === 0) samples.set(raw.subarray(src, src + stride), o);
    else if (ft === 1) {
      for (let i = 0; i < stride; i++) samples[o + i] = raw[src + i] + (i >= bpp ? samples[o + i - bpp] : 0);
    } else if (ft === 2) {
      for (let i = 0; i < stride; i++) samples[o + i] = raw[src + i] + (y > 0 ? samples[p + i] : 0);
    } else if (ft === 3) {
      for (let i = 0; i < stride; i++) {
        samples[o + i] = raw[src + i] + (((i >= bpp ? samples[o + i - bpp] : 0) + (y > 0 ? samples[p + i] : 0)) >> 1);
      }
    } else {
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? samples[o + i - bpp] : 0;
        const b = y > 0 ? samples[p + i] : 0;
        const c = y > 0 && i >= bpp ? samples[p + i - bpp] : 0;
        samples[o + i] = raw[src + i] + paethPick(a, b, c);
      }
    }
  }
  const n = width * height;
  const rgba = new Uint8Array(n * 4);
  if (colourType === 6) rgba.set(samples);
  else if (colourType === 2) {
    const key = trns === null ? -1 : (trns[1] << 16) | (trns[3] << 8) | trns[5];
    for (let i = 0, s = 0, d = 0; i < n; i++, s += 3, d += 4) {
      rgba[d] = samples[s];
      rgba[d + 1] = samples[s + 1];
      rgba[d + 2] = samples[s + 2];
      rgba[d + 3] = ((samples[s] << 16) | (samples[s + 1] << 8) | samples[s + 2]) === key ? 0 : 255;
    }
  } else if (colourType === 0) {
    const key = trns === null ? -1 : trns[1];
    for (let i = 0, d = 0; i < n; i++, d += 4) {
      const g = samples[i];
      rgba[d] = rgba[d + 1] = rgba[d + 2] = g;
      rgba[d + 3] = g === key ? 0 : 255;
    }
  } else if (colourType === 4) {
    for (let i = 0, s = 0, d = 0; i < n; i++, s += 2, d += 4) {
      rgba[d] = rgba[d + 1] = rgba[d + 2] = samples[s];
      rgba[d + 3] = samples[s + 1];
    }
  } else {
    const entries = (palette as Uint8Array).length / 3;
    for (let i = 0, d = 0; i < n; i++, d += 4) {
      const e = samples[i];
      if (e >= entries) return { ok: false, why: 'palette index out of range' };
      rgba[d] = (palette as Uint8Array)[e * 3];
      rgba[d + 1] = (palette as Uint8Array)[e * 3 + 1];
      rgba[d + 2] = (palette as Uint8Array)[e * 3 + 2];
      rgba[d + 3] = trns !== null && e < (trns as Uint8Array).length ? (trns as Uint8Array)[e] : 255;
    }
  }
  return { ok: true, width, height, rgba };
}

/* ----- taking stock of the pixels ----- */

type Swatch = { word: number; rgba: [number, number, number, number]; count: number };

function census(rgba: Uint8Array): { opaque: boolean; grey: boolean; swatches: Swatch[] | null } {
  const n = rgba.length >>> 2;
  const u32 = new Uint32Array(rgba.buffer, rgba.byteOffset, n);
  let opaque = true;
  let grey = true;
  const counts = new Map<number, number>();
  let overflow = false;
  for (let i = 0, d = 0; i < n; i++, d += 4) {
    if (rgba[d + 3] !== 255) opaque = false;
    if (rgba[d] !== rgba[d + 1] || rgba[d] !== rgba[d + 2]) grey = false;
    if (!overflow) {
      const c = u32[i];
      const k = counts.get(c);
      if (k === undefined) {
        if (counts.size === 256) overflow = true;
        else counts.set(c, 1);
      } else counts.set(c, k + 1);
    }
  }
  if (overflow) return { opaque, grey, swatches: null };
  const swatches: Swatch[] = [...counts.keys()].map((c) => {
    const b = new Uint8Array(Uint32Array.of(c).buffer);
    return { word: c, rgba: [b[0], b[1], b[2], b[3]] as [number, number, number, number], count: counts.get(c) as number };
  });
  return { opaque, grey, swatches };
}

/** The single fully transparent value a keyed tRNS can stand in for, else null. */
function transparentKey(rgba: Uint8Array, grey: boolean): number | null {
  let key = -1;
  for (let d = 0; d < rgba.length; d += 4) {
    const a = rgba[d + 3];
    if (a === 255) continue;
    if (a !== 0) return null;
    const v = grey ? rgba[d] : (rgba[d] << 16) | (rgba[d + 1] << 8) | rgba[d + 2];
    if (key === -1) key = v;
    else if (key !== v) return null;
  }
  if (key === -1) return null;
  for (let d = 0; d < rgba.length; d += 4) {
    if (rgba[d + 3] !== 255) continue;
    const v = grey ? rgba[d] : (rgba[d] << 16) | (rgba[d + 1] << 8) | rgba[d + 2];
    if (v === key) return null;
  }
  return key;
}

function toSamples(rgba: Uint8Array, ct: number): Uint8Array {
  const n = rgba.length >>> 2;
  if (ct === 6) return rgba;
  const ch = CHANNELS[ct];
  const out = new Uint8Array(n * ch);
  for (let i = 0, d = 0, s = 0; i < n; i++, d += 4, s += ch) {
    if (ct === 0) out[s] = rgba[d];
    else if (ct === 4) {
      out[s] = rgba[d];
      out[s + 1] = rgba[d + 3];
    } else {
      out[s] = rgba[d];
      out[s + 1] = rgba[d + 1];
      out[s + 2] = rgba[d + 2];
    }
  }
  return out;
}

function makePalette(rgba: Uint8Array, swatches: Swatch[], order: 'count' | 'luminance'): { plte: Uint8Array; trns: Uint8Array | null; indices: Uint8Array } {
  const bright = (c: Swatch) => 299 * c.rgba[0] + 587 * c.rgba[1] + 114 * c.rgba[2];
  const entries = [...swatches].sort((x, y) => {
    const tx = x.rgba[3] === 255 ? 1 : 0;
    const ty = y.rgba[3] === 255 ? 1 : 0;
    if (tx !== ty) return tx - ty;
    if (tx === 0 && x.rgba[3] !== y.rgba[3]) return x.rgba[3] - y.rgba[3];
    if (order === 'luminance') return bright(x) - bright(y) || x.word - y.word;
    return y.count - x.count || x.word - y.word;
  });
  const index = new Map(entries.map((c, i) => [c.word, i]));
  const plte = new Uint8Array(entries.length * 3);
  let lastClear = 0;
  entries.forEach((c, i) => {
    plte[i * 3] = c.rgba[0];
    plte[i * 3 + 1] = c.rgba[1];
    plte[i * 3 + 2] = c.rgba[2];
    if (c.rgba[3] !== 255) lastClear = i + 1;
  });
  const trns = lastClear === 0 ? null : Uint8Array.from(entries.slice(0, lastClear), (c) => c.rgba[3]);
  const n = rgba.length >>> 2;
  const u32 = new Uint32Array(rgba.buffer, rgba.byteOffset, n);
  const indices = new Uint8Array(n);
  for (let i = 0; i < n; i++) indices[i] = index.get(u32[i]) as number;
  return { plte, trns, indices };
}

/* ----- row filters ----- */

function filterRow(kind: number, cur: Uint8Array, prev: Uint8Array | null, bpp: number, out: Uint8Array): void {
  const n = cur.length;
  if (kind === 0) out.set(cur);
  else if (kind === 1) {
    for (let i = 0; i < n; i++) out[i] = cur[i] - (i >= bpp ? cur[i - bpp] : 0);
  } else if (kind === 2) {
    for (let i = 0; i < n; i++) out[i] = cur[i] - (prev === null ? 0 : prev[i]);
  } else if (kind === 3) {
    for (let i = 0; i < n; i++) out[i] = cur[i] - (((i >= bpp ? cur[i - bpp] : 0) + (prev === null ? 0 : prev[i])) >> 1);
  } else {
    for (let i = 0; i < n; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev === null ? 0 : prev[i];
      const c = prev !== null && i >= bpp ? prev[i - bpp] : 0;
      out[i] = cur[i] - paethPick(a, b, c);
    }
  }
}

function absSum(row: Uint8Array): number {
  let s = 0;
  for (let i = 0; i < row.length; i++) {
    const v = row[i];
    s += v < 128 ? v : 256 - v;
  }
  return s;
}

function pairVariety(row: Uint8Array, seen: Uint32Array, stamp: number): number {
  let n = 0;
  for (let i = 1; i < row.length; i++) {
    const pair = (row[i - 1] << 8) | row[i];
    if (seen[pair] !== stamp) {
      seen[pair] = stamp;
      n++;
    }
  }
  return n;
}

type FilterPick = number | 'minsum' | 'pairs' | 'brute';

/**
 * Filter every row of `samples` by `pick`, writing into `raw` when it fits.
 * Brute force weighs each row's five filters by a short deflate run after
 * the 32 KiB written before it, as the kit's own screen does.
 */
function filterImage(samples: Uint8Array, width: number, height: number, bpp: number, pick: FilterPick, raw?: Uint8Array): Uint8Array {
  const stride = width * bpp;
  const out = raw !== undefined && raw.length === height * (stride + 1) ? raw : new Uint8Array(height * (stride + 1));
  const trial = Array.from({ length: 5 }, () => new Uint8Array(stride + 1));
  for (let t = 0; t < 5; t++) trial[t][0] = t;
  const seen = new Uint32Array(65536);
  let stamp = 0;
  for (let y = 0; y < height; y++) {
    const cur = samples.subarray(y * stride, (y + 1) * stride);
    const prev = y === 0 ? null : samples.subarray((y - 1) * stride, y * stride);
    const at = y * (stride + 1);
    if (typeof pick === 'number') {
      out[at] = pick;
      filterRow(pick, cur, prev, bpp, out.subarray(at + 1, at + 1 + stride));
      continue;
    }
    const before = out.subarray(Math.max(0, at - 32768), at);
    let kind = 0;
    let best = Infinity;
    for (let t = 0; t < 5; t++) {
      filterRow(t, cur, prev, bpp, trial[t].subarray(1));
      let cost: number;
      if (pick === 'minsum') cost = absSum(trial[t].subarray(1));
      else if (pick === 'pairs') cost = pairVariety(trial[t].subarray(1), seen, ++stamp);
      else {
        cost = zlib.deflateSync(trial[t], before.length === 0 ? { level: 4, memLevel: 9 } : { level: 4, memLevel: 9, dictionary: before }).length;
      }
      if (cost < best) {
        best = cost;
        kind = t;
      }
    }
    out.set(trial[kind], at);
  }
  return out;
}

/* ----- candidate shapes and screening ----- */

type Shape = { colourType: number; bpp: number; samples: Uint8Array; plte: Uint8Array | null; trns: Uint8Array | null; filters: FilterPick[] };

function candidateShapes(rgba: Uint8Array): Shape[] {
  const { opaque, grey, swatches } = census(rgba);
  const shapes: Shape[] = [];
  if (swatches !== null) {
    for (const [order, filters] of [
      ['count', [0]],
      ['luminance', [0, 'minsum', 'brute']],
    ] as Array<['count' | 'luminance', FilterPick[]]>) {
      const p = makePalette(rgba, swatches, order);
      shapes.push({ colourType: 3, bpp: 1, samples: p.indices, plte: p.plte, trns: p.trns, filters });
    }
    if (!grey) return shapes;
  }
  const key = opaque ? null : transparentKey(rgba, grey);
  let ct: number;
  let trns: Uint8Array | null = null;
  if (grey) {
    ct = opaque || key !== null ? 0 : 4;
    if (key !== null) trns = Uint8Array.of(0, key);
  } else {
    ct = opaque || key !== null ? 2 : 6;
    if (key !== null) trns = Uint8Array.of(0, key >>> 16, 0, (key >>> 8) & 0xff, 0, key & 0xff);
  }
  shapes.push({ colourType: ct, bpp: CHANNELS[ct], samples: toSamples(rgba, ct), plte: null, trns, filters: [0, 1, 2, 3, 4, 'minsum', 'pairs', 'brute'] });
  return shapes;
}

const SCREEN_OPTS = { level: 6, memLevel: 8, strategy: zlib.constants.Z_DEFAULT_STRATEGY };

function extraChunks(shape: Shape): number {
  return (shape.plte === null ? 0 : 12 + shape.plte.length) + (shape.trns === null ? 0 : 12 + shape.trns.length);
}

/** The cheapest (shape, filter) by a level-6 screening run, first on a tie. */
function pickEncoding(rgba: Uint8Array, width: number, height: number): { shape: Shape; pick: FilterPick; data: Uint8Array; bytes: number } {
  let best: { shape: Shape; pick: FilterPick; data: Uint8Array; bytes: number } | null = null;
  let spare: Uint8Array | null = null;
  for (const shape of candidateShapes(rgba)) {
    const size = height * (width * shape.bpp + 1);
    const overhead = extraChunks(shape);
    for (const pick of shape.filters) {
      const data = filterImage(shape.samples, width, height, shape.bpp, pick, spare !== null && spare.length === size ? spare : undefined);
      spare = null;
      let bytes: number;
      try {
        bytes = zlib.deflateSync(data, SCREEN_OPTS).length + overhead;
      } catch {
        spare = data;
        continue;
      }
      if (best === null || bytes < best.bytes) {
        if (best !== null) spare = best.data;
        best = { shape, pick, data, bytes };
      } else spare = data;
    }
  }
  if (best === null) throw new Error('no shape screened');
  return best;
}

/** The smallest zlib stream for filtered data among the standard finalists. */
function zlibFinalists(data: Uint8Array): Uint8Array {
  const tries = [
    { level: 9, memLevel: 9, strategy: zlib.constants.Z_DEFAULT_STRATEGY },
    { level: 6, memLevel: 8, strategy: zlib.constants.Z_DEFAULT_STRATEGY },
  ];
  let best: Uint8Array | null = null;
  for (const opts of tries) {
    try {
      const z = zlib.deflateSync(data, opts);
      if (best === null || z.length < best.length) best = z;
    } catch {
      continue;
    }
  }
  if (best === null) throw new Error('all deflate finalists failed');
  return best;
}

/* ----- the squeeze deflater: one match pass, three parsing rounds ----- */

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];

function lenCode(len: number): [number, number, number] {
  let lo = 0;
  let hi = LEN_BASE.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (LEN_BASE[mid] <= len) lo = mid;
    else hi = mid - 1;
  }
  return [257 + lo, LEN_EXTRA[lo], len - LEN_BASE[lo]];
}

function distCode(dist: number): [number, number, number] {
  let lo = 0;
  let hi = DIST_BASE.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (DIST_BASE[mid] <= dist) lo = mid;
    else hi = mid - 1;
  }
  return [lo, DIST_EXTRA[lo], dist - DIST_BASE[lo]];
}

const FIXED_LIT_BITS = ((): Uint8Array => {
  const t = new Uint8Array(288);
  for (let s = 0; s < 288; s++) t[s] = s < 144 ? 8 : s < 256 ? 9 : s < 280 ? 7 : 8;
  return t;
})();

/** Best bit lengths for `freqs`, capped at `cap`; null when the cap cannot be met. */
function huffmanLengths(freqs: Uint32Array, cap: number): Uint8Array | null {
  const n = freqs.length;
  const lens = new Uint8Array(n);
  const live: number[] = [];
  for (let s = 0; s < n; s++) if (freqs[s] > 0) live.push(s);
  if (live.length === 0) return lens;
  if (live.length === 1) {
    lens[live[0]] = 1;
    const other = live[0] === 0 ? 1 : 0;
    if (other < n) lens[other] = 1;
    return lens;
  }
  const order = [...live].sort((a, b) => freqs[a] - freqs[b] || a - b);
  const weight: number[] = [];
  const left: number[] = [];
  const right: number[] = [];
  const sym: number[] = [];
  for (const s of order) {
    weight.push(freqs[s]);
    left.push(-1);
    right.push(-1);
    sym.push(s);
  }
  const merged: number[] = [];
  let li = 0;
  let mi = 0;
  const takeLightest = (): number => {
    const lw = li < order.length ? weight[li] : Infinity;
    const mw = mi < merged.length ? weight[merged[mi]] : Infinity;
    return lw <= mw ? li++ : merged[mi++];
  };
  while (order.length - li + (merged.length - mi) > 1) {
    const a = takeLightest();
    const b = takeLightest();
    const id = weight.length;
    weight.push(weight[a] + weight[b]);
    left.push(a);
    right.push(b);
    sym.push(-1);
    merged.push(id);
  }
  const root = merged.length > 0 ? merged[merged.length - 1] : 0;
  const stack: Array<[number, number]> = [[root, 0]];
  while (stack.length > 0) {
    const item = stack.pop();
    if (item === undefined) break;
    const [node, d] = item;
    if (sym[node] >= 0) lens[sym[node]] = d;
    else {
      stack.push([left[node], d + 1]);
      stack.push([right[node], d + 1]);
    }
  }
  let deepest = 0;
  for (const s of live) if (lens[s] > deepest) deepest = lens[s];
  if (deepest <= cap) return lens;
  for (const s of live) if (lens[s] > cap) lens[s] = cap;
  const kraftUnit = (l: number) => 1 << (cap - l);
  let over = 0;
  for (const s of live) over += kraftUnit(lens[s]);
  over -= 1 << cap;
  if (over <= 0) return lens;
  const rarest = [...live].sort((a, b) => freqs[a] - freqs[b] || a - b);
  let guard = 0;
  while (over > 0) {
    if (++guard > 100000) return null;
    let pick = -1;
    let frees = 0;
    for (const s of rarest) {
      if (lens[s] >= cap) continue;
      const f = 1 << (cap - lens[s] - 1);
      if (f <= over) {
        pick = s;
        frees = f;
        break;
      }
    }
    if (pick === -1) return null;
    lens[pick]++;
    over -= frees;
  }
  return lens;
}

/** Canonical Huffman codes for `lens` (0 = unused). */
function canonicalCodes(lens: Uint8Array): Uint16Array {
  let top = 0;
  for (let s = 0; s < lens.length; s++) if (lens[s] > top) top = lens[s];
  const blCount = new Int32Array(top + 1);
  for (let s = 0; s < lens.length; s++) if (lens[s] > 0) blCount[lens[s]]++;
  const nextCode = new Int32Array(top + 1);
  let code = 0;
  for (let l = 1; l <= top; l++) {
    code = (code + blCount[l - 1]) << 1;
    nextCode[l] = code;
  }
  const codes = new Uint16Array(lens.length);
  for (let s = 0; s < lens.length; s++) {
    const l = lens[s];
    if (l > 0) codes[s] = nextCode[l]++;
  }
  return codes;
}

class BitWriter {
  bytes: Uint8Array;
  used = 0;
  acc = 0;
  nbits = 0;
  constructor(capacity: number) {
    this.bytes = new Uint8Array(Math.max(1024, capacity));
  }
  grow(need: number): void {
    if (this.used + need > this.bytes.length) {
      const nb = new Uint8Array(Math.max(this.bytes.length * 2, this.used + need));
      nb.set(this.bytes.subarray(0, this.used));
      this.bytes = nb;
    }
  }
  byte(b: number): void {
    this.grow(1);
    this.bytes[this.used++] = b & 0xff;
  }
  bits(value: number, len: number): void {
    if (len === 0) return;
    this.acc |= (value & ((1 << len) - 1)) << this.nbits;
    this.nbits += len;
    while (this.nbits >= 8) {
      this.byte(this.acc & 0xff);
      this.acc >>>= 8;
      this.nbits -= 8;
    }
  }
  code(v: number, len: number): void {
    let rev = 0;
    for (let i = 0; i < len; i++) rev = (rev << 1) | ((v >> i) & 1);
    this.bits(rev, len);
  }
  align(): void {
    if (this.nbits > 0) {
      this.byte(this.acc & 0xff);
      this.acc = 0;
      this.nbits = 0;
    }
  }
  u16(v: number): void {
    this.byte(v & 0xff);
    this.byte((v >> 8) & 0xff);
  }
  raw(b: Uint8Array): void {
    this.grow(b.length);
    this.bytes.set(b, this.used);
    this.used += b.length;
  }
  finish(): Uint8Array {
    this.align();
    return this.bytes.subarray(0, this.used);
  }
  /** Bits written so far (excluding any alignment padding). */
  bitCount(): number {
    return this.used * 8 + this.nbits;
  }
  /**
   * Append another writer's bits verbatim (not its padded bytes): deflate
   * blocks follow each other at the bit level, so a block must start at the
   * exact bit where the previous one ended.
   */
  appendBits(src: BitWriter): void {
    const bits = src.bitCount();
    const full = bits >> 3;
    const data = src.bytes.subarray(0, src.used);
    if (this.nbits === 0) {
      this.raw(data.subarray(0, full));
    } else {
      for (let i = 0; i < full; i++) this.bits(data[i], 8);
    }
    const rem = bits & 7;
    if (rem > 0) this.bits(src.acc & ((1 << rem) - 1), rem);
  }
}

function tripleHash(data: Uint8Array, pos: number): number {
  return ((data[pos] << 10) ^ (data[pos + 1] << 5) ^ data[pos + 2]) & 0x7fff;
}

/**
 * Longest match at `pos` (chain walk), plus the closest match that reaches
 * at least 3 bytes: a shorter match nearby is often cheaper than the longest
 * one far away, and the parser weighs both.
 */
function longestAt(data: Uint8Array, pos: number, n: number, head: Int32Array, prev: Int32Array): { len: number; dist: number; len2: number; dist2: number } {
  const maxLen = Math.min(258, n - pos);
  if (maxLen < 3) return { len: 0, dist: 0, len2: 0, dist2: 0 };
  let cand = head[tripleHash(data, pos)];
  let bestLen = 2;
  let bestDist = 0;
  let nearLen = 0;
  let nearDist = 0;
  let steps = 0;
  while (cand >= 0 && steps++ < 32) {
    const dist = pos - cand;
    if (dist > 32768) break;
    if (data[cand + 2] === data[pos + 2]) {
      let l = 0;
      while (l < maxLen && data[cand + l] === data[pos + l]) l++;
      if (l >= 3) {
        if (l > bestLen) {
          bestLen = l;
          bestDist = dist;
          if (l >= 32) break;
        }
        if (nearLen === 0) {
          nearLen = l;
          nearDist = dist;
        }
      }
    }
    cand = prev[cand];
  }
  if (nearLen > 0 && nearDist === bestDist) {
    nearLen = 0;
    nearDist = 0;
  }
  return { len: bestLen >= 3 ? bestLen : 0, dist: bestDist, len2: nearLen, dist2: nearDist };
}

type Path = { kinds: number[]; lits: number[]; lens: number[]; dists: number[] };

function literalBits(lens: Uint8Array): Int32Array {
  const t = new Int32Array(256);
  // A symbol absent from the previous parse has no code yet; it must NOT
  // look free, or the parser fills the block with it. Price it at the
  // longest a code may be.
  for (let b = 0; b < 256; b++) t[b] = lens[b] === 0 ? 15 : lens[b];
  return t;
}

function lengthBits(lens: Uint8Array): Int32Array {
  const t = new Int32Array(259);
  for (let l = 3; l <= 258; l++) {
    const [code, extra] = lenCode(l);
    t[l] = (lens[code] === 0 ? 15 : lens[code]) + extra;
  }
  return t;
}

function distanceBits(lens: Uint8Array): Int32Array {
  const t = new Int32Array(32769);
  for (let d = 1; d <= 32768; d++) {
    const [code, extra] = distCode(d);
    t[d] = (lens[code] === 0 ? 15 : lens[code]) + extra;
  }
  return t;
}

/** For a match of length L, the lengths worth trying: the biggest length-code
 *  boundary below L, plus L itself. */
const TRY_LEN: number[][] = ((): number[][] => {
  const table: number[][] = [];
  for (let L = 0; L <= 258; L++) {
    const list: number[] = [];
    let below = 0;
    for (const b of LEN_BASE) {
      if (b >= L) break;
      below = b;
    }
    if (below >= 3) list.push(below);
    if (L >= 3 && !list.includes(L)) list.push(L);
    table.push(list);
  }
  return table;
})();

/** Cheapest literal/match path over one block, by exact bit costs. */
function cheapestPath(
  data: Uint8Array,
  blockStart: number,
  blockEnd: number,
  mlen: Uint16Array,
  mdist: Uint16Array,
  mlen2: Uint16Array,
  mdist2: Uint16Array,
  litBits: Int32Array,
  lenBits: Int32Array,
  distBits: Int32Array,
  useNear: boolean,
): Path {
  const m = blockEnd - blockStart;
  const INF = 0x3fffffff;
  const dp = new Int32Array(m + 1).fill(INF);
  const takeLen = new Uint16Array(m + 1);
  const takeDist = new Uint16Array(m + 1);
  dp[0] = 0;
  const tryMatch = (i: number, base: number, L: number, d: number, room: number) => {
    if (L > room) L = room;
    if (L < 3) return;
    const db = base + distBits[d];
    const cands = TRY_LEN[L];
    for (let k = 0; k < cands.length; k++) {
      const l = cands[k];
      const c = db + lenBits[l];
      if (c < dp[i + l]) {
        dp[i + l] = c;
        takeLen[i + l] = l;
        takeDist[i + l] = d;
      }
    }
  };
  for (let i = 0; i < m; i++) {
    const base = dp[i];
    if (base === INF) continue;
    const gpos = blockStart + i;
    const lc = base + litBits[data[gpos]];
    if (lc < dp[i + 1]) {
      dp[i + 1] = lc;
      takeLen[i + 1] = 0;
    }
    const room = blockEnd - gpos;
    tryMatch(i, base, mlen[gpos], mdist[gpos], room);
    if (useNear) tryMatch(i, base, mlen2[gpos], mdist2[gpos], room);
  }
  const kinds: number[] = [];
  const lits: number[] = [];
  const lens: number[] = [];
  const dists: number[] = [];
  let i = m;
  while (i > 0) {
    const l = takeLen[i];
    if (l === 0) {
      kinds.push(0);
      lits.push(data[blockStart + i - 1]);
      i--;
    } else {
      kinds.push(1);
      lens.push(l);
      dists.push(takeDist[i]);
      i -= l;
    }
  }
  kinds.reverse();
  lits.reverse();
  lens.reverse();
  dists.reverse();
  return { kinds, lits, lens, dists };
}

function tallyFreqs(seq: Path): { litFreq: Uint32Array; distFreq: Uint32Array } {
  const litFreq = new Uint32Array(288);
  const distFreq = new Uint32Array(30);
  let li = 0;
  let mi = 0;
  for (const k of seq.kinds) {
    if (k === 0) litFreq[seq.lits[li++]]++;
    else {
      const [lc] = lenCode(seq.lens[mi]);
      litFreq[lc]++;
      const [dc] = distCode(seq.dists[mi]);
      distFreq[dc]++;
      mi++;
    }
  }
  litFreq[256]++;
  return { litFreq, distFreq };
}

/** Run-length encoding of Huffman lengths for a dynamic header. */
function rleCodeLengths(lens: Uint8Array): Array<[number, number]> {
  const rle: Array<[number, number]> = [];
  let i = 0;
  while (i < lens.length) {
    const v = lens[i];
    if (v === 0) {
      let run = 0;
      while (i + run < lens.length && lens[i + run] === 0) run++;
      i += run;
      while (run >= 11) {
        const take = Math.min(run, 138);
        rle.push([18, take - 11]);
        run -= take;
      }
      if (run >= 3) {
        rle.push([17, run - 3]);
        run = 0;
      }
      while (run > 0) {
        rle.push([0, -1]);
        run--;
      }
    } else {
      rle.push([v, -1]);
      i++;
      let run = 0;
      while (i + run < lens.length && lens[i + run] === v) run++;
      i += run;
      while (run >= 3) {
        const take = Math.min(run, 6);
        rle.push([16, take - 3]);
        run -= take;
      }
      while (run > 0) {
        rle.push([v, -1]);
        run--;
      }
    }
  }
  return rle;
}

const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

function writeDynamic(sink: BitWriter, isFinal: boolean, litLens: Uint8Array, distLens: Uint8Array, seq: Path): void {
  let hlit = 288;
  while (hlit > 257 && litLens[hlit - 1] === 0) hlit--;
  let hdist = 30;
  while (hdist > 1 && distLens[hdist - 1] === 0) hdist--;
  const combined = new Uint8Array(hlit + hdist);
  combined.set(litLens.subarray(0, hlit), 0);
  combined.set(distLens.subarray(0, hdist), hlit);
  const rle = rleCodeLengths(combined);
  const clFreq = new Uint32Array(19);
  for (const [s] of rle) clFreq[s]++;
  const clLens = huffmanLengths(clFreq, 7);
  if (clLens === null) throw new Error('code-length code overflows');
  let hclen = 19;
  while (hclen > 4 && clLens[CL_ORDER[hclen - 1]] === 0) hclen--;
  const clCodes = canonicalCodes(clLens);
  const litCodes = canonicalCodes(litLens);
  const distCodes = canonicalCodes(distLens);
  sink.bits(isFinal ? 1 : 0, 1);
  sink.bits(2, 2);
  sink.bits(hlit - 257, 5);
  sink.bits(hdist - 1, 5);
  sink.bits(hclen - 4, 4);
  for (let k = 0; k < hclen; k++) sink.bits(clLens[CL_ORDER[k]], 3);
  for (const [s, extra] of rle) {
    sink.code(clCodes[s], clLens[s]);
    if (s === 16) sink.bits(extra, 2);
    else if (s === 17) sink.bits(extra, 3);
    else if (s === 18) sink.bits(extra, 7);
  }
  let li = 0;
  let mi = 0;
  for (const k of seq.kinds) {
    if (k === 0) {
      const b = seq.lits[li++];
      sink.code(litCodes[b], litLens[b]);
    } else {
      const len = seq.lens[mi];
      const dist = seq.dists[mi];
      mi++;
      const [lc, le, ev] = lenCode(len);
      sink.code(litCodes[lc], litLens[lc]);
      sink.bits(ev, le);
      const [dc, de, dv] = distCode(dist);
      sink.code(distCodes[dc], distLens[dc]);
      sink.bits(dv, de);
    }
  }
  sink.code(litCodes[256], litLens[256]);
}

function writeFixed(sink: BitWriter, isFinal: boolean, seq: Path): void {
  const litCodes = canonicalCodes(FIXED_LIT_BITS);
  const distLens = new Uint8Array(30).fill(5);
  const distCodes = canonicalCodes(distLens);
  sink.bits(isFinal ? 1 : 0, 1);
  sink.bits(1, 2);
  let li = 0;
  let mi = 0;
  for (const k of seq.kinds) {
    if (k === 0) {
      const b = seq.lits[li++];
      sink.code(litCodes[b], FIXED_LIT_BITS[b]);
    } else {
      const len = seq.lens[mi];
      const dist = seq.dists[mi];
      mi++;
      const [lc, le, ev] = lenCode(len);
      sink.code(litCodes[lc], FIXED_LIT_BITS[lc]);
      sink.bits(ev, le);
      const [dc, de, dv] = distCode(dist);
      sink.code(distCodes[dc], 5);
      sink.bits(dv, de);
    }
  }
  sink.code(litCodes[256], FIXED_LIT_BITS[256]);
}

function writeStored(sink: BitWriter, isFinal: boolean, raw: Uint8Array): void {
  let at = 0;
  do {
    const len = Math.min(65535, raw.length - at);
    const last = at + len >= raw.length;
    sink.bits(isFinal && last ? 1 : 0, 1);
    sink.bits(0, 2);
    sink.align();
    sink.u16(len);
    sink.u16(~len & 0xffff);
    sink.raw(raw.subarray(at, at + len));
    at += len;
  } while (at < raw.length);
}

/**
 * A raw deflate stream for `data`: one longest-match pass, then per 100 KiB
 * block three optimal-parsing rounds (first at fixed-Huffman costs, then
 * two more at each round's own code lengths), keeping the smallest of
 * dynamic, fixed and stored per block. Fully deterministic: fixed chain
 * limits, fixed block size, fixed round count.
 */
function squeezeStream(data: Uint8Array): Uint8Array {
  const n = data.length;
  if (n === 0) return Uint8Array.of(0x03, 0x00);
  const BLOCK = 100000;
  const head = new Int32Array(32768).fill(-1);
  const prev = new Int32Array(n);
  const mlen = new Uint16Array(n);
  const mdist = new Uint16Array(n);
  const mlen2 = new Uint16Array(n);
  const mdist2 = new Uint16Array(n);
  for (let pos = 0; pos < n; pos++) {
    const m = longestAt(data, pos, n, head, prev);
    mlen[pos] = m.len;
    mdist[pos] = m.dist;
    mlen2[pos] = m.len2;
    mdist2[pos] = m.dist2;
    if (pos + 2 < n) {
      const h = tripleHash(data, pos);
      prev[pos] = head[h];
      head[h] = pos;
    }
  }
  const fixedDistLens = new Uint8Array(30).fill(5);
  const sink = new BitWriter(n + 1024);
  for (let start = 0; start < n; start += BLOCK) {
    const end = Math.min(n, start + BLOCK);
    const isFinal = end === n;
    // First parse at fixed-Huffman costs, then two rounds re-parsing at the
    // previous round's own code lengths: each round's lengths fit the parse
    // better, and the parse fits the lengths better.
    let seq = cheapestPath(data, start, end, mlen, mdist, mlen2, mdist2, literalBits(FIXED_LIT_BITS), lengthBits(FIXED_LIT_BITS), distanceBits(fixedDistLens), false);
    for (let it = 0; it < 2; it++) {
      const f = tallyFreqs(seq);
      const ll = huffmanLengths(f.litFreq, 15) ?? FIXED_LIT_BITS;
      const dl = huffmanLengths(f.distFreq, 15) ?? fixedDistLens;
      seq = cheapestPath(data, start, end, mlen, mdist, mlen2, mdist2, literalBits(ll), lengthBits(ll), distanceBits(dl), true);
    }
    const f2 = tallyFreqs(seq);
    const litLens2 = huffmanLengths(f2.litFreq, 15) ?? FIXED_LIT_BITS;
    let distLens2 = huffmanLengths(f2.distFreq, 15) ?? fixedDistLens;
    if (distLens2.every((l) => l === 0)) {
      distLens2 = new Uint8Array(30);
      distLens2[0] = 1;
    }
    const variants: BitWriter[] = [];
    {
      try {
        const s = new BitWriter(end - start + 1024);
        writeDynamic(s, isFinal, litLens2, distLens2, seq);
        variants.push(s);
      } catch {
        // dynamic header did not fit: fixed and stored remain
      }
    }
    {
      const s = new BitWriter(end - start + 1024);
      writeFixed(s, isFinal, seq);
      variants.push(s);
    }
    {
      const s = new BitWriter(end - start + 1024);
      writeStored(s, isFinal, data.subarray(start, end));
      variants.push(s);
    }
    let best = variants[0];
    for (const v of variants) if (v.bitCount() < best.bitCount()) best = v;
    sink.appendBits(best);
  }
  return sink.finish();
}

/** A zlib stream (header + raw deflate + adler) around `raw`. */
function wrapZlib(raw: Uint8Array, adler: number): Uint8Array {
  const out = new Uint8Array(raw.length + 6);
  out[0] = 0x78;
  out[1] = 0xda;
  out.set(raw, 2);
  new DataView(out.buffer).setUint32(2 + raw.length, adler);
  return out;
}

function pngFromShape(width: number, height: number, shape: Shape, idat: Uint8Array): Uint8Array {
  const chunks: Array<[string, Uint8Array]> = [['IHDR', ihdr(width, height, shape.colourType)]];
  if (shape.plte !== null) chunks.push(['PLTE', shape.plte]);
  if (shape.trns !== null) chunks.push(['tRNS', shape.trns]);
  chunks.push(['IDAT', idat]);
  chunks.push(['IEND', new Uint8Array(0)]);
  return buildPng(chunks);
}

/* ----- one screenshot, end to end ----- */

/** The proof step: a candidate PNG counts only if it re-decodes to the exact
 *  RGBA pixels (every channel, transparent pixels included) and fits 4 MiB. */
function checkExact(png: Uint8Array, rgba: Uint8Array, width: number, height: number): boolean {
  if (png.length > 4194304) return false;
  const shot = decodePng(png);
  if (!shot.ok) return false;
  if (shot.width !== width || shot.height !== height) return false;
  if (shot.rgba.length !== rgba.length) return false;
  for (let i = 0; i < rgba.length; i++) if (shot.rgba[i] !== rgba[i]) return false;
  return true;
}

function encodeShot(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const winner = pickEncoding(rgba, width, height);
  const zlibBest = zlibFinalists(winner.data);
  const zlibPng = pngFromShape(width, height, winner.shape, zlibBest);
  let squeezePng: Uint8Array | null = null;
  try {
    const raw = squeezeStream(winner.data);
    const cand = pngFromShape(width, height, winner.shape, wrapZlib(raw, adler32(winner.data)));
    if (cand.length < zlibPng.length) squeezePng = cand;
  } catch {
    squeezePng = null;
  }
  const pick = squeezePng !== null ? squeezePng : zlibPng;
  if (checkExact(pick, rgba, width, height)) return pick;
  if (checkExact(zlibPng, rgba, width, height)) return zlibPng;
  const raw = new Uint8Array(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  }
  const stored = pngFromShape(
    width,
    height,
    { colourType: 6, bpp: 4, samples: rgba, plte: null, trns: null, filters: [] },
    storedStream(raw),
  );
  if (checkExact(stored, rgba, width, height)) return stored;
  throw new Error('no valid encoding for this shot');
}

for (const id of fs.readdirSync(SRC_DIR).sort()) {
  const shot = decodePng(new Uint8Array(fs.readFileSync(path.join(SRC_DIR, id, 'image.png'))));
  if (!shot.ok) throw new Error(`${id}/image.png: ${shot.why}`);
  fs.mkdirSync(path.join(DST_DIR, id), { recursive: true });
  fs.writeFileSync(path.join(DST_DIR, id, 'image.png'), encodeShot(shot.rgba, shot.width, shot.height));
}

// Squeeze screenshots into the smallest PNG, 27 November 2026.
// A lossless re-encoder: reads each 1280x720 RGBA screenshot, picks the
// cheapest exact form for it (palette, grey, grey+alpha, RGB or RGBA, with a
// tRNS key where one fits), searches row filters per form, and keeps the
// smallest zlib stream it can buy from the standard library.
//
// Stage 1: screening by zlib level 6, finalists at level 9 and friends.
// No validation gate yet: that arrives as a second, separate edit.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync, inflateSync, constants as zc } from 'node:zlib';

const IN_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const SIG = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
const LANES = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>;

/* ---------- checksums and chunk assembly ---------- */

const CRC_TAB = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crcOf(bytes: Uint8Array, from = 0, to = bytes.length): number {
  let c = -1;
  for (let i = from; i < to; i++) c = CRC_TAB[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function adlerOf(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; ) {
    const end = Math.min(bytes.length, i + 5552);
    for (; i < end; i++) {
      a += bytes[i];
      b += a;
    }
    a %= 65521;
    b %= 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function asciiOf(s: string): Uint8Array {
  return Uint8Array.from(s, (ch) => ch.charCodeAt(0));
}

function sealPng(chunks: Array<[string, Uint8Array]>): Uint8Array {
  let size = SIG.length;
  for (const [, data] of chunks) size += 12 + data.length;
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  out.set(SIG, 0);
  let at = SIG.length;
  for (const [type, data] of chunks) {
    view.setUint32(at, data.length);
    out.set(asciiOf(type), at + 4);
    out.set(data, at + 8);
    view.setUint32(at + 8 + data.length, crcOf(out, at + 4, at + 8 + data.length));
    at += 12 + data.length;
  }
  return out;
}

function headerOf(width: number, height: number, colourType: number): Uint8Array {
  const d = new Uint8Array(13);
  const v = new DataView(d.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  d[8] = 8;
  d[9] = colourType;
  return d;
}

/** A zlib stream of raw bytes in stored blocks (the always-valid fallback). */
function storedZlib(raw: Uint8Array): Uint8Array {
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
  new DataView(out.buffer).setUint32(at, adlerOf(raw));
  return out;
}

/* ---------- reading a PNG back to RGBA ---------- */

function paethGuess(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = p > a ? p - a : a - p;
  const pb = p > b ? p - b : b - p;
  const pc = p > c ? p - c : c - p;
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

type Shot = { ok: true; width: number; height: number; rgba: Uint8Array } | { ok: false; why: string };

function readShot(bytes: Uint8Array): Shot {
  if (bytes.length < SIG.length || SIG.some((b, i) => bytes[i] !== b)) return { ok: false, why: 'no PNG signature' };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = SIG.length;
  let header: { width: number; height: number; colourType: number } | null = null;
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
    if (crcOf(bytes, at + 4, at + 8 + len) !== view.getUint32(at + 8 + len)) return { ok: false, why: type + ' CRC fails' };
    const data = bytes.subarray(at + 8, at + 8 + len);
    at += 12 + len;
    if (type === 'IHDR') {
      if (header !== null || len !== 13) return { ok: false, why: 'bad IHDR' };
      const dv = new DataView(data.buffer, data.byteOffset, 13);
      header = { width: dv.getUint32(0), height: dv.getUint32(4), colourType: data[9] };
      if (data[8] !== 8 || !(header.colourType in LANES) || data[10] !== 0 || data[11] !== 0 || data[12] !== 0) {
        return { ok: false, why: 'unsupported IHDR' };
      }
    } else if (type === 'PLTE') {
      if (palette !== null || header === null || header.colourType !== 3 || idat.length > 0) return { ok: false, why: 'bad PLTE' };
      if (len === 0 || len % 3 !== 0 || len > 768) return { ok: false, why: 'bad PLTE size' };
      palette = data;
    } else if (type === 'tRNS') {
      if (trns !== null || header === null || idat.length > 0) return { ok: false, why: 'bad tRNS' };
      const ct = header.colourType;
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
  if (!ended || header === null || idat.length === 0) return { ok: false, why: 'missing IEND/IHDR/IDAT' };
  const { width, height, colourType } = header;
  const bpp = LANES[colourType];
  const stride = width * bpp;
  const expected = height * (stride + 1);
  let raw: Uint8Array;
  try {
    raw = inflateSync(idat.length === 1 ? idat[0] : Buffer.concat(idat), { maxOutputLength: expected + 1 });
  } catch {
    return { ok: false, why: 'IDAT does not inflate' };
  }
  if (raw.length !== expected) return { ok: false, why: 'inflated size mismatch' };
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
        samples[o + i] = raw[src + i] + paethGuess(a, b, c);
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

/* ---------- surveying the pixels ---------- */

type Colour = { word: number; rgba: [number, number, number, number]; count: number };

function survey(rgba: Uint8Array): { opaque: boolean; grey: boolean; colours: Colour[] | null } {
  const n = rgba.length >>> 2;
  const u32 = new Uint32Array(rgba.buffer, rgba.byteOffset, n);
  let opaque = true;
  let grey = true;
  const counts = new Map<number, number>();
  let many = false;
  for (let i = 0, d = 0; i < n; i++, d += 4) {
    if (rgba[d + 3] !== 255) opaque = false;
    if (rgba[d] !== rgba[d + 1] || rgba[d] !== rgba[d + 2]) grey = false;
    if (!many) {
      const c = u32[i];
      const k = counts.get(c);
      if (k === undefined) {
        if (counts.size === 256) many = true;
        else counts.set(c, 1);
      } else counts.set(c, k + 1);
    }
  }
  if (many) return { opaque, grey, colours: null };
  const colours: Colour[] = [...counts.keys()].map((c) => {
    const b = new Uint8Array(Uint32Array.of(c).buffer);
    return { word: c, rgba: [b[0], b[1], b[2], b[3]] as [number, number, number, number], count: counts.get(c) as number };
  });
  return { opaque, grey, colours };
}

/** The one fully transparent value a keyed tRNS can stand in for, else null. */
function clearKey(rgba: Uint8Array, grey: boolean): number | null {
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

function swatchesOf(rgba: Uint8Array, ct: number): Uint8Array {
  const n = rgba.length >>> 2;
  if (ct === 6) return rgba;
  const ch = LANES[ct];
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

function paletteBuild(rgba: Uint8Array, colours: Colour[], order: 'count' | 'luminance'): { plte: Uint8Array; trns: Uint8Array | null; indices: Uint8Array } {
  const lum = (c: Colour) => 299 * c.rgba[0] + 587 * c.rgba[1] + 114 * c.rgba[2];
  const entries = [...colours].sort((x, y) => {
    const ta = x.rgba[3] === 255 ? 1 : 0;
    const tb = y.rgba[3] === 255 ? 1 : 0;
    if (ta !== tb) return ta - tb;
    if (ta === 0 && x.rgba[3] !== y.rgba[3]) return x.rgba[3] - y.rgba[3];
    if (order === 'luminance') return lum(x) - lum(y) || x.word - y.word;
    return y.count - x.count || x.word - y.word;
  });
  const index = new Map(entries.map((c, i) => [c.word, i]));
  const plte = new Uint8Array(entries.length * 3);
  let transparent = 0;
  entries.forEach((c, i) => {
    plte[i * 3] = c.rgba[0];
    plte[i * 3 + 1] = c.rgba[1];
    plte[i * 3 + 2] = c.rgba[2];
    if (c.rgba[3] !== 255) transparent = i + 1;
  });
  const trns = transparent === 0 ? null : Uint8Array.from(entries.slice(0, transparent), (c) => c.rgba[3]);
  const n = rgba.length >>> 2;
  const u32 = new Uint32Array(rgba.buffer, rgba.byteOffset, n);
  const indices = new Uint8Array(n);
  for (let i = 0; i < n; i++) indices[i] = index.get(u32[i]) as number;
  return { plte, trns, indices };
}

/* ---------- row filters ---------- */

function strainRow(type: number, cur: Uint8Array, prev: Uint8Array | null, bpp: number, out: Uint8Array): void {
  const n = cur.length;
  if (type === 0) out.set(cur);
  else if (type === 1) {
    for (let i = 0; i < n; i++) out[i] = cur[i] - (i >= bpp ? cur[i - bpp] : 0);
  } else if (type === 2) {
    for (let i = 0; i < n; i++) out[i] = cur[i] - (prev === null ? 0 : prev[i]);
  } else if (type === 3) {
    for (let i = 0; i < n; i++) out[i] = cur[i] - (((i >= bpp ? cur[i - bpp] : 0) + (prev === null ? 0 : prev[i])) >> 1);
  } else {
    for (let i = 0; i < n; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev === null ? 0 : prev[i];
      const c = prev !== null && i >= bpp ? prev[i - bpp] : 0;
      out[i] = cur[i] - paethGuess(a, b, c);
    }
  }
}

function signedCost(row: Uint8Array): number {
  let s = 0;
  for (let i = 0; i < row.length; i++) {
    const v = row[i];
    s += v < 128 ? v : 256 - v;
  }
  return s;
}

function pairsCost(row: Uint8Array, seen: Uint32Array, stamp: number): number {
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

type Choice = number | 'minsum' | 'pairs' | 'brute';

/**
 * Filter every row of `samples` by `choice`, writing into `raw` (reused when it
 * fits). Brute force weighs each row's five filters by a short deflate run
 * after the 32 KiB written before it, as the kit's own screen does.
 */
function weave(samples: Uint8Array, width: number, height: number, bpp: number, choice: Choice, raw?: Uint8Array): Uint8Array {
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
    if (typeof choice === 'number') {
      out[at] = choice;
      strainRow(choice, cur, prev, bpp, out.subarray(at + 1, at + 1 + stride));
      continue;
    }
    const before = out.subarray(Math.max(0, at - 32768), at);
    let type = 0;
    let best = Infinity;
    for (let t = 0; t < 5; t++) {
      strainRow(t, cur, prev, bpp, trial[t].subarray(1));
      let cost: number;
      if (choice === 'minsum') cost = signedCost(trial[t].subarray(1));
      else if (choice === 'pairs') cost = pairsCost(trial[t].subarray(1), seen, ++stamp);
      else {
        cost = deflateSync(trial[t], before.length === 0 ? { level: 4, memLevel: 9 } : { level: 4, memLevel: 9, dictionary: before }).length;
      }
      if (cost < best) {
        best = cost;
        type = t;
      }
    }
    out.set(trial[type], at);
  }
  return out;
}

/* ---------- forms and screening ---------- */

type Form = { colourType: number; bpp: number; samples: Uint8Array; plte: Uint8Array | null; trns: Uint8Array | null; filters: Choice[] };

function formsOf(rgba: Uint8Array): Form[] {
  const { opaque, grey, colours } = survey(rgba);
  const forms: Form[] = [];
  if (colours !== null) {
    for (const [order, filters] of [
      ['count', [0]],
      ['luminance', [0, 'minsum', 'brute']],
    ] as Array<['count' | 'luminance', Choice[]]>) {
      const p = paletteBuild(rgba, colours, order);
      forms.push({ colourType: 3, bpp: 1, samples: p.indices, plte: p.plte, trns: p.trns, filters });
    }
    if (!grey) return forms;
  }
  const key = opaque ? null : clearKey(rgba, grey);
  let ct: number;
  let trns: Uint8Array | null = null;
  if (grey) {
    ct = opaque || key !== null ? 0 : 4;
    if (key !== null) trns = Uint8Array.of(0, key);
  } else {
    ct = opaque || key !== null ? 2 : 6;
    if (key !== null) trns = Uint8Array.of(0, key >>> 16, 0, (key >>> 8) & 0xff, 0, key & 0xff);
  }
  forms.push({ colourType: ct, bpp: LANES[ct], samples: swatchesOf(rgba, ct), plte: null, trns, filters: [0, 1, 2, 3, 4, 'minsum', 'pairs', 'brute'] });
  return forms;
}

const SCREEN = { level: 6, memLevel: 8, strategy: zc.Z_DEFAULT_STRATEGY };

function chunkOverhead(form: Form): number {
  return (form.plte === null ? 0 : 12 + form.plte.length) + (form.trns === null ? 0 : 12 + form.trns.length);
}

/** The cheapest (form, filter) by a level-6 screening run, first on a tie. */
function screenBest(rgba: Uint8Array, width: number, height: number): { form: Form; choice: Choice; data: Uint8Array; bytes: number } {
  let best: { form: Form; choice: Choice; data: Uint8Array; bytes: number } | null = null;
  let spare: Uint8Array | null = null;
  for (const form of formsOf(rgba)) {
    const size = height * (width * form.bpp + 1);
    const overhead = chunkOverhead(form);
    for (const choice of form.filters) {
      const data = weave(form.samples, width, height, form.bpp, choice, spare !== null && spare.length === size ? spare : undefined);
      spare = null;
      let bytes: number;
      try {
        bytes = deflateSync(data, SCREEN).length + overhead;
      } catch {
        spare = data;
        continue;
      }
      if (best === null || bytes < best.bytes) {
        if (best !== null) spare = best.data;
        best = { form, choice, data, bytes };
      } else spare = data;
    }
  }
  if (best === null) throw new Error('no form screened');
  return best;
}

/** The smallest zlib stream for filtered data among the standard finalists. */
function finalists(data: Uint8Array): Uint8Array {
  const tries = [
    { level: 6, memLevel: 8, strategy: zc.Z_DEFAULT_STRATEGY },
    { level: 9, memLevel: 9, strategy: zc.Z_DEFAULT_STRATEGY },
    { level: 9, memLevel: 9, strategy: zc.Z_FILTERED },
    { level: 9, memLevel: 8, strategy: zc.Z_DEFAULT_STRATEGY },
    { level: 6, memLevel: 8, strategy: zc.Z_FILTERED },
  ];
  let best: Uint8Array | null = null;
  for (const opts of tries) {
    try {
      const z = deflateSync(data, opts);
      if (best === null || z.length < best.length) best = z;
    } catch {
      continue;
    }
  }
  if (best === null) throw new Error('all deflate finalists failed');
  return best;
}

/* ---------- the squeeze deflater: lazy matches, optimal parsing ---------- */

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];

function lenSlot(len: number): [number, number, number] {
  let lo = 0;
  let hi = LEN_BASE.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (LEN_BASE[mid] <= len) lo = mid;
    else hi = mid - 1;
  }
  return [257 + lo, LEN_EXTRA[lo], len - LEN_BASE[lo]];
}

function distSlot(dist: number): [number, number, number] {
  let lo = 0;
  let hi = DIST_BASE.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (DIST_BASE[mid] <= dist) lo = mid;
    else hi = mid - 1;
  }
  return [lo, DIST_EXTRA[lo], dist - DIST_BASE[lo]];
}

const FIXED_LIT = (() => {
  const t = new Uint8Array(288);
  for (let s = 0; s < 288; s++) t[s] = s < 144 ? 8 : s < 256 ? 9 : s < 280 ? 7 : 8;
  return t;
})();

/** Optimal bit lengths for `freqs`, capped at `maxLen`; null when the cap cannot be met. */
function huffLengths(freqs: Uint32Array, maxLen: number): Uint8Array | null {
  const n = freqs.length;
  const lens = new Uint8Array(n);
  const used: number[] = [];
  for (let s = 0; s < n; s++) if (freqs[s] > 0) used.push(s);
  if (used.length === 0) return lens;
  if (used.length === 1) {
    lens[used[0]] = 1;
    const dummy = used[0] === 0 ? 1 : 0;
    if (dummy < n) lens[dummy] = 1;
    return lens;
  }
  const m = used.length;
  const order = [...used].sort((a, b) => freqs[a] - freqs[b] || a - b);
  const nf: number[] = [];
  const nl: number[] = [];
  const nr: number[] = [];
  const nsym: number[] = [];
  for (const s of order) {
    nf.push(freqs[s]);
    nl.push(-1);
    nr.push(-1);
    nsym.push(s);
  }
  const combined: number[] = [];
  let leafPtr = 0;
  let combPtr = 0;
  const smallest = (): number => {
    const lf = leafPtr < m ? nf[leafPtr] : Infinity;
    const cf = combPtr < combined.length ? nf[combined[combPtr]] : Infinity;
    if (lf <= cf) return leafPtr++;
    return combined[combPtr++];
  };
  while (m - leafPtr + (combined.length - combPtr) > 1) {
    const a = smallest();
    const b = smallest();
    const idx = nf.length;
    nf.push(nf[a] + nf[b]);
    nl.push(a);
    nr.push(b);
    nsym.push(-1);
    combined.push(idx);
  }
  const root = combined.length > 0 ? combined[combined.length - 1] : 0;
  const stack: Array<[number, number]> = [[root, 0]];
  while (stack.length > 0) {
    const item = stack.pop();
    if (item === undefined) break;
    const [node, d] = item;
    if (nsym[node] >= 0) lens[nsym[node]] = d;
    else {
      stack.push([nl[node], d + 1]);
      stack.push([nr[node], d + 1]);
    }
  }
  let maxD = 0;
  for (const s of used) if (lens[s] > maxD) maxD = lens[s];
  if (maxD <= maxLen) return lens;
  for (const s of used) if (lens[s] > maxLen) lens[s] = maxLen;
  const unit = (l: number) => 1 << (maxLen - l);
  let excess = 0;
  for (const s of used) excess += unit(lens[s]);
  excess -= 1 << maxLen;
  if (excess <= 0) return lens;
  const byFreq = [...used].sort((a, b) => freqs[a] - freqs[b] || a - b);
  let guard = 0;
  while (excess > 0) {
    if (++guard > 100000) return null;
    let pick = -1;
    let pickRemoves = 0;
    for (const s of byFreq) {
      if (lens[s] >= maxLen) continue;
      const removes = 1 << (maxLen - lens[s] - 1);
      if (removes <= excess) {
        pick = s;
        pickRemoves = removes;
        break;
      }
    }
    if (pick === -1) return null;
    lens[pick]++;
    excess -= pickRemoves;
  }
  return lens;
}

/** Canonical Huffman codes for `lens` (0 = unused). */
function canonCodes(lens: Uint8Array): Uint16Array {
  let maxLen = 0;
  for (let s = 0; s < lens.length; s++) if (lens[s] > maxLen) maxLen = lens[s];
  const blCount = new Int32Array(maxLen + 1);
  for (let s = 0; s < lens.length; s++) if (lens[s] > 0) blCount[lens[s]]++;
  const nextCode = new Int32Array(maxLen + 1);
  let code = 0;
  for (let l = 1; l <= maxLen; l++) {
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

class BitSink {
  buf: Uint8Array;
  pos = 0;
  bitbuf = 0;
  bitcnt = 0;
  constructor(capacity: number) {
    this.buf = new Uint8Array(Math.max(1024, capacity));
  }
  grow(need: number): void {
    if (this.pos + need > this.buf.length) {
      const nb = new Uint8Array(Math.max(this.buf.length * 2, this.pos + need));
      nb.set(this.buf.subarray(0, this.pos));
      this.buf = nb;
    }
  }
  pushByte(b: number): void {
    this.grow(1);
    this.buf[this.pos++] = b & 0xff;
  }
  putBits(value: number, len: number): void {
    if (len === 0) return;
    this.bitbuf |= (value & ((1 << len) - 1)) << this.bitcnt;
    this.bitcnt += len;
    while (this.bitcnt >= 8) {
      this.pushByte(this.bitbuf & 0xff);
      this.bitbuf >>>= 8;
      this.bitcnt -= 8;
    }
  }
  putCode(code: number, len: number): void {
    let r = 0;
    for (let i = 0; i < len; i++) r = (r << 1) | ((code >> i) & 1);
    this.putBits(r, len);
  }
  alignByte(): void {
    if (this.bitcnt > 0) {
      this.pushByte(this.bitbuf & 0xff);
      this.bitbuf = 0;
      this.bitcnt = 0;
    }
  }
  putU16(v: number): void {
    this.pushByte(v & 0xff);
    this.pushByte((v >> 8) & 0xff);
  }
  putBytes(b: Uint8Array): void {
    this.grow(b.length);
    this.buf.set(b, this.pos);
    this.pos += b.length;
  }
  result(): Uint8Array {
    this.alignByte();
    return this.buf.subarray(0, this.pos);
  }
  /** Bits written so far (excluding any alignment padding). */
  totalBits(): number {
    return this.pos * 8 + this.bitcnt;
  }
  /**
   * Append another sink's bits verbatim (not its padded bytes): deflate
   * blocks follow each other at the bit level, so a block must start at the
   * exact bit where the previous one ended.
   */
  appendBits(src: BitSink): void {
    const bits = src.totalBits();
    const full = bits >> 3;
    const data = src.buf.subarray(0, src.pos);
    if (this.bitcnt === 0) {
      this.putBytes(data.subarray(0, full));
    } else {
      for (let i = 0; i < full; i++) this.putBits(data[i], 8);
    }
    const rem = bits & 7;
    if (rem > 0) this.putBits(src.bitbuf & ((1 << rem) - 1), rem);
  }
}

function hash3(data: Uint8Array, pos: number): number {
  return ((data[pos] << 10) ^ (data[pos + 1] << 5) ^ data[pos + 2]) & 0x7fff;
}

/**
 * Longest match at `pos` (chain walk), plus the closest match that reaches
 * at least 3 bytes: a shorter match nearby is often cheaper than the longest
 * one far away, and the parser weighs both.
 */
function findMatch(data: Uint8Array, pos: number, n: number, head: Int32Array, prev: Int32Array): { len: number; dist: number; len2: number; dist2: number } {
  const maxLen = Math.min(258, n - pos);
  if (maxLen < 3) return { len: 0, dist: 0, len2: 0, dist2: 0 };
  let cand = head[hash3(data, pos)];
  let bestLen = 2;
  let bestDist = 0;
  let closeLen = 0;
  let closeDist = 0;
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
          if (l >= 64) break;
        }
        if (closeLen === 0) {
          closeLen = l;
          closeDist = dist;
        }
      }
    }
    cand = prev[cand];
  }
  if (closeLen > 0 && closeDist === bestDist) {
    closeLen = 0;
    closeDist = 0;
  }
  return { len: bestLen >= 3 ? bestLen : 0, dist: bestDist, len2: closeLen, dist2: closeDist };
}

type Seq = { kinds: number[]; lits: number[]; lens: number[]; dists: number[] };

function litCostTable(lens: Uint8Array): Int32Array {
  const t = new Int32Array(256);
  // A symbol absent from the previous parse has no code yet; it must NOT
  // look free, or the parser fills the block with it. Price it at the
  // longest a code may be.
  for (let b = 0; b < 256; b++) t[b] = lens[b] === 0 ? 15 : lens[b];
  return t;
}

function lenCostTable(lens: Uint8Array): Int32Array {
  const t = new Int32Array(259);
  for (let l = 3; l <= 258; l++) {
    const [code, extra] = lenSlot(l);
    t[l] = (lens[code] === 0 ? 15 : lens[code]) + extra;
  }
  return t;
}

function distCostTable(lens: Uint8Array): Int32Array {
  const t = new Int32Array(32769);
  for (let d = 1; d <= 32768; d++) {
    const [code, extra] = distSlot(d);
    t[d] = (lens[code] === 0 ? 15 : lens[code]) + extra;
  }
  return t;
}

/** For a match of length L, the lengths worth trying: every length-code
 *  boundary at or below L, plus L itself. */
const CAND: number[][] = (() => {
  const table: number[][] = [];
  for (let L = 0; L <= 258; L++) {
    const list: number[] = [];
    for (const b of LEN_BASE) {
      if (b > L) break;
      list.push(b);
    }
    if (L >= 3 && !list.includes(L)) list.push(L);
    table.push(list);
  }
  return table;
})();

/** Cheapest literal/match path over one block, by exact bit costs. */
function parseBlock(
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
  useClose: boolean,
): Seq {
  const m = blockEnd - blockStart;
  const INF = 0x3fffffff;
  const dp = new Int32Array(m + 1).fill(INF);
  const chLen = new Uint16Array(m + 1);
  const chDist = new Uint16Array(m + 1);
  dp[0] = 0;
  const offer = (i: number, base: number, L: number, d: number, room: number) => {
    if (L > room) L = room;
    if (L < 3) return;
    const db = base + distBits[d];
    const cands = CAND[L];
    for (let k = 0; k < cands.length; k++) {
      const l = cands[k];
      const c = db + lenBits[l];
      if (c < dp[i + l]) {
        dp[i + l] = c;
        chLen[i + l] = l;
        chDist[i + l] = d;
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
      chLen[i + 1] = 0;
    }
    const room = blockEnd - gpos;
    offer(i, base, mlen[gpos], mdist[gpos], room);
    if (useClose) offer(i, base, mlen2[gpos], mdist2[gpos], room);
  }
  const kinds: number[] = [];
  const lits: number[] = [];
  const lens: number[] = [];
  const dists: number[] = [];
  let i = m;
  while (i > 0) {
    const l = chLen[i];
    if (l === 0) {
      kinds.push(0);
      lits.push(data[blockStart + i - 1]);
      i--;
    } else {
      kinds.push(1);
      lens.push(l);
      dists.push(chDist[i]);
      i -= l;
    }
  }
  kinds.reverse();
  lits.reverse();
  lens.reverse();
  dists.reverse();
  return { kinds, lits, lens, dists };
}

function countFreq(seq: Seq): { litFreq: Uint32Array; distFreq: Uint32Array } {
  const litFreq = new Uint32Array(288);
  const distFreq = new Uint32Array(30);
  let li = 0;
  let mi = 0;
  for (const k of seq.kinds) {
    if (k === 0) litFreq[seq.lits[li++]]++;
    else {
      const [lc] = lenSlot(seq.lens[mi]);
      litFreq[lc]++;
      const [dc] = distSlot(seq.dists[mi]);
      distFreq[dc]++;
      mi++;
    }
  }
  litFreq[256]++;
  return { litFreq, distFreq };
}

/** Run-length encoding of Huffman lengths for a dynamic header. */
function rleLengths(lens: Uint8Array): Array<[number, number]> {
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

function emitDynamic(sink: BitSink, isFinal: boolean, litLens: Uint8Array, distLens: Uint8Array, seq: Seq): void {
  let hlit = 288;
  while (hlit > 257 && litLens[hlit - 1] === 0) hlit--;
  let hdist = 30;
  while (hdist > 1 && distLens[hdist - 1] === 0) hdist--;
  const combined = new Uint8Array(hlit + hdist);
  combined.set(litLens.subarray(0, hlit), 0);
  combined.set(distLens.subarray(0, hdist), hlit);
  const rle = rleLengths(combined);
  const clFreq = new Uint32Array(19);
  for (const [s] of rle) clFreq[s]++;
  const clLens = huffLengths(clFreq, 7);
  if (clLens === null) throw new Error('code-length code overflows');
  let hclen = 19;
  while (hclen > 4 && clLens[CL_ORDER[hclen - 1]] === 0) hclen--;
  const clCodes = canonCodes(clLens);
  const litCodes = canonCodes(litLens);
  const distCodes = canonCodes(distLens);
  sink.putBits(isFinal ? 1 : 0, 1);
  sink.putBits(2, 2);
  sink.putBits(hlit - 257, 5);
  sink.putBits(hdist - 1, 5);
  sink.putBits(hclen - 4, 4);
  for (let k = 0; k < hclen; k++) sink.putBits(clLens[CL_ORDER[k]], 3);
  for (const [s, extra] of rle) {
    sink.putCode(clCodes[s], clLens[s]);
    if (s === 16) sink.putBits(extra, 2);
    else if (s === 17) sink.putBits(extra, 3);
    else if (s === 18) sink.putBits(extra, 7);
  }
  let li = 0;
  let mi = 0;
  for (const k of seq.kinds) {
    if (k === 0) {
      const b = seq.lits[li++];
      sink.putCode(litCodes[b], litLens[b]);
    } else {
      const len = seq.lens[mi];
      const dist = seq.dists[mi];
      mi++;
      const [lc, le, ev] = lenSlot(len);
      sink.putCode(litCodes[lc], litLens[lc]);
      sink.putBits(ev, le);
      const [dc, de, dv] = distSlot(dist);
      sink.putCode(distCodes[dc], distLens[dc]);
      sink.putBits(dv, de);
    }
  }
  sink.putCode(litCodes[256], litLens[256]);
}

function emitFixed(sink: BitSink, isFinal: boolean, seq: Seq): void {
  const litCodes = canonCodes(FIXED_LIT);
  const distLens = new Uint8Array(30).fill(5);
  const distCodes = canonCodes(distLens);
  sink.putBits(isFinal ? 1 : 0, 1);
  sink.putBits(1, 2);
  let li = 0;
  let mi = 0;
  for (const k of seq.kinds) {
    if (k === 0) {
      const b = seq.lits[li++];
      sink.putCode(litCodes[b], FIXED_LIT[b]);
    } else {
      const len = seq.lens[mi];
      const dist = seq.dists[mi];
      mi++;
      const [lc, le, ev] = lenSlot(len);
      sink.putCode(litCodes[lc], FIXED_LIT[lc]);
      sink.putBits(ev, le);
      const [dc, de, dv] = distSlot(dist);
      sink.putCode(distCodes[dc], 5);
      sink.putBits(dv, de);
    }
  }
  sink.putCode(litCodes[256], FIXED_LIT[256]);
}

function emitStored(sink: BitSink, isFinal: boolean, raw: Uint8Array): void {
  let at = 0;
  do {
    const len = Math.min(65535, raw.length - at);
    const last = at + len >= raw.length;
    sink.putBits(isFinal && last ? 1 : 0, 1);
    sink.putBits(0, 2);
    sink.alignByte();
    sink.putU16(len);
    sink.putU16(~len & 0xffff);
    sink.putBytes(raw.subarray(at, at + len));
    at += len;
  } while (at < raw.length);
}

/**
 * A raw deflate stream for `data`: longest-match pass once, then per 100 KiB
 * block eight optimal-parsing rounds (first at fixed-Huffman costs, then
 * seven more at each round's own code lengths), keeping the smallest of
 * dynamic, fixed and stored per block. Fully deterministic: fixed chain
 * limits, fixed block size, fixed round count.
 */
function squeezeDeflate(data: Uint8Array): Uint8Array {
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
    const m = findMatch(data, pos, n, head, prev);
    mlen[pos] = m.len;
    mdist[pos] = m.dist;
    mlen2[pos] = m.len2;
    mdist2[pos] = m.dist2;
    if (pos + 2 < n) {
      const h = hash3(data, pos);
      prev[pos] = head[h];
      head[h] = pos;
    }
  }
  const fixedDistLens = new Uint8Array(30).fill(5);
  const sink = new BitSink(n + 1024);
  for (let start = 0; start < n; start += BLOCK) {
    const end = Math.min(n, start + BLOCK);
    const isFinal = end === n;
    // First parse at fixed-Huffman costs, then seven rounds re-parsing at
    // the previous round's own code lengths: each round's lengths fit the
    // parse better, and the parse fits the lengths better.
    let seq = parseBlock(data, start, end, mlen, mdist, mlen2, mdist2, litCostTable(FIXED_LIT), lenCostTable(FIXED_LIT), distCostTable(fixedDistLens), false);
    for (let it = 0; it < 7; it++) {
      const f = countFreq(seq);
      const ll = huffLengths(f.litFreq, 15) ?? FIXED_LIT;
      const dl = huffLengths(f.distFreq, 15) ?? fixedDistLens;
      seq = parseBlock(data, start, end, mlen, mdist, mlen2, mdist2, litCostTable(ll), lenCostTable(ll), distCostTable(dl), true);
    }
    const f2 = countFreq(seq);
    const litLens2 = huffLengths(f2.litFreq, 15) ?? FIXED_LIT;
    let distLens2 = huffLengths(f2.distFreq, 15) ?? fixedDistLens;
    if (distLens2.every((l) => l === 0)) {
      distLens2 = new Uint8Array(30);
      distLens2[0] = 1;
    }
    const variants: BitSink[] = [];
    {
      try {
        const s = new BitSink(end - start + 1024);
        emitDynamic(s, isFinal, litLens2, distLens2, seq);
        variants.push(s);
      } catch {
        // dynamic header did not fit: fixed and stored remain
      }
    }
    {
      const s = new BitSink(end - start + 1024);
      emitFixed(s, isFinal, seq);
      variants.push(s);
    }
    {
      const s = new BitSink(end - start + 1024);
      emitStored(s, isFinal, data.subarray(start, end));
      variants.push(s);
    }
    let best = variants[0];
    for (const v of variants) if (v.totalBits() < best.totalBits()) best = v;
    sink.appendBits(best);
  }
  return sink.result();
}

/** A zlib stream (header + raw deflate + adler) around `raw`. */
function zlibWrap(raw: Uint8Array, adler: number): Uint8Array {
  const out = new Uint8Array(raw.length + 6);
  out[0] = 0x78;
  out[1] = 0xda;
  out.set(raw, 2);
  new DataView(out.buffer).setUint32(2 + raw.length, adler);
  return out;
}

function pngOfForm(width: number, height: number, form: Form, idat: Uint8Array): Uint8Array {
  const chunks: Array<[string, Uint8Array]> = [['IHDR', headerOf(width, height, form.colourType)]];
  if (form.plte !== null) chunks.push(['PLTE', form.plte]);
  if (form.trns !== null) chunks.push(['tRNS', form.trns]);
  chunks.push(['IDAT', idat]);
  chunks.push(['IEND', new Uint8Array(0)]);
  return sealPng(chunks);
}

/* ---------- one screenshot, end to end ---------- */

/** The gate: a candidate PNG is accepted only if it re-decodes to the exact
 *  RGBA pixels (every channel, transparent pixels included) and fits 4 MiB. */
function prove(png: Uint8Array, rgba: Uint8Array, width: number, height: number): boolean {
  if (png.length > 4194304) return false;
  const shot = readShot(png);
  if (!shot.ok) return false;
  if (shot.width !== width || shot.height !== height) return false;
  if (shot.rgba.length !== rgba.length) return false;
  for (let i = 0; i < rgba.length; i++) if (shot.rgba[i] !== rgba[i]) return false;
  return true;
}

function squeezeOne(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const winner = screenBest(rgba, width, height);
  const zlibBest = finalists(winner.data);
  const zlibPng = pngOfForm(width, height, winner.form, zlibBest);
  let squeezePng: Uint8Array | null = null;
  try {
    const raw = squeezeDeflate(winner.data);
    const cand = pngOfForm(width, height, winner.form, zlibWrap(raw, adlerOf(winner.data)));
    if (cand.length < zlibPng.length) squeezePng = cand;
  } catch {
    squeezePng = null;
  }
  const pick = squeezePng !== null ? squeezePng : zlibPng;
  if (prove(pick, rgba, width, height)) return pick;
  if (prove(zlibPng, rgba, width, height)) return zlibPng;
  const raw = new Uint8Array(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  }
  const stored = pngOfForm(
    width,
    height,
    { colourType: 6, bpp: 4, samples: rgba, plte: null, trns: null, filters: [] },
    storedZlib(raw),
  );
  if (prove(stored, rgba, width, height)) return stored;
  throw new Error('no valid encoding for this shot');
}

for (const id of readdirSync(IN_DIR).sort()) {
  const shot = readShot(new Uint8Array(readFileSync(join(IN_DIR, id, 'image.png'))));
  if (!shot.ok) throw new Error(`${id}/image.png: ${shot.why}`);
  mkdirSync(join(OUT_DIR, id), { recursive: true });
  writeFileSync(join(OUT_DIR, id, 'image.png'), squeezeOne(shot.rgba, shot.width, shot.height));
}

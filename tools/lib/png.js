/**
 * PNG in and out for the offline tools: a writer for the pictures they produce
 * and a reader for the pictures they are held against. Nothing of this runs in
 * the game, which draws on a canvas.
 *
 * The writer is the one `klrender` has always used - eight bit greyscale, one
 * IDAT, no filtering - with a colour variant for the difference pictures of
 * `klmap`. The reader turns any non-interlaced PNG into an ink mask, because
 * that is all the comparison against the original map needs: the map is drawn
 * in the Spectrum's attribute colours on black, so "not black" is "ink".
 */

import { readFileSync } from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Anything brighter than this counts as ink; the map's paper is pure black. */
const INK_THRESHOLD = 40;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encode(width, height, colourType, raw) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;                                   // bit depth
  header[9] = colourType;
  return Buffer.concat([
    Buffer.from(SIGNATURE),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/**
 * Eight bit greyscale PNG of a surface, scaled by whole pixels.
 *
 * @param {{width: number, height: number, pixels: Uint8Array}} surface the picture
 * @param {number} scale whole number of screen pixels per surface pixel
 * @returns {Buffer} the file
 */
export function encodeGrey(surface, scale) {
  const width = surface.width*scale;
  const height = surface.height*scale;
  const raw = Buffer.alloc((width + 1)*height);
  for (let y = 0; y < height; y++) {
    const row = (width + 1)*y;
    raw[row] = 0;                                  // filter: none
    for (let x = 0; x < width; x++) {
      raw[row + 1 + x] = surface.pixels[Math.floor(y/scale)*surface.width + Math.floor(x/scale)];
    }
  }
  return encode(width, height, 0, raw);
}

/**
 * Twenty four bit colour PNG of an indexed picture, scaled by whole pixels.
 *
 * @param {{width: number, height: number, pixels: Uint8Array}} surface the picture
 * @param {number[][]} palette `[red, green, blue]` for every value in `pixels`
 * @param {number} scale whole number of screen pixels per surface pixel
 * @returns {Buffer} the file
 */
export function encodeColour(surface, palette, scale) {
  const width = surface.width*scale;
  const height = surface.height*scale;
  const raw = Buffer.alloc((width*3 + 1)*height);
  for (let y = 0; y < height; y++) {
    const row = (width*3 + 1)*y;
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const colour = palette[surface.pixels[Math.floor(y/scale)*surface.width + Math.floor(x/scale)]];
      raw[row + 1 + x*3] = colour[0];
      raw[row + 2 + x*3] = colour[1];
      raw[row + 3 + x*3] = colour[2];
    }
  }
  return encode(width, height, 2, raw);
}

/** Undoes the per row filters of the IDAT stream, giving the raw scanlines. */
function unfilter(raw, stride, height, bytesPerPixel) {
  const out = Buffer.alloc(stride*height);
  const empty = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y*(stride + 1)];
    const line = raw.subarray(y*(stride + 1) + 1, y*(stride + 1) + 1 + stride);
    const row = out.subarray(y*stride, (y + 1)*stride);
    const prior = y ? out.subarray((y - 1)*stride, y*stride) : empty;
    for (let x = 0; x < stride; x++) {
      const a = x >= bytesPerPixel ? row[x - bytesPerPixel] : 0;
      const b = prior[x];
      const c = x >= bytesPerPixel ? prior[x - bytesPerPixel] : 0;
      let value = line[x];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      } else if (filter !== 0) {
        throw new Error('unknown PNG filter ' + filter + ' on row ' + y);
      }
      row[x] = value & 0xff;
    }
  }
  return out;
}

/**
 * Reads a PNG as an ink mask: one byte per pixel, 1 where the picture is not
 * black. Greyscale, palette and true colour are understood, with or without an
 * alpha channel; interlaced files are not.
 *
 * @param {string} file path of the picture
 * @returns {{width: number, height: number, ink: Uint8Array}} the mask
 */
export function decodeMask(file) {
  const data = readFileSync(file);
  let at = 8;
  let header = null;
  let palette = null;
  const idat = [];
  while (at + 8 <= data.length) {
    const length = data.readUInt32BE(at);
    const type = data.toString('ascii', at + 4, at + 8);
    const body = data.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      header = {
        width: body.readUInt32BE(0), height: body.readUInt32BE(4),
        depth: body[8], colour: body[9], interlace: body[12]
      };
    } else if (type === 'PLTE') palette = Buffer.from(body);
    else if (type === 'IDAT') idat.push(Buffer.from(body));
    else if (type === 'IEND') break;
    at += 12 + length;
  }
  if (header === null) throw new Error('not a PNG: ' + file);
  if (header.interlace) throw new Error('interlaced PNG is not supported: ' + file);

  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[header.colour];
  if (channels === undefined) throw new Error('unknown PNG colour type ' + header.colour);
  if (header.colour !== 3 && header.depth !== 8) {
    throw new Error('only eight bit samples are supported, this one has ' + header.depth);
  }
  const stride = Math.ceil(channels*header.depth*header.width/8);
  const rows = unfilter(inflateSync(Buffer.concat(idat)), stride, header.height,
    Math.max(1, (channels*header.depth) >> 3));

  const ink = new Uint8Array(header.width*header.height);
  const perByte = 8/header.depth;
  for (let y = 0; y < header.height; y++) {
    for (let x = 0; x < header.width; x++) {
      let brightness;
      if (header.colour === 3) {
        const byte = rows[y*stride + Math.floor(x/perByte)];
        const index = (byte >> (8 - header.depth*((x%perByte) + 1))) & ((1 << header.depth) - 1);
        brightness = palette[index*3] + palette[index*3 + 1] + palette[index*3 + 2];
      } else if (header.colour === 0 || header.colour === 4) {
        brightness = rows[y*stride + x*channels]*3;
      } else {
        const from = y*stride + x*channels;
        brightness = rows[from] + rows[from + 1] + rows[from + 2];
      }
      ink[y*header.width + x] = brightness > INK_THRESHOLD*3 ? 1 : 0;
    }
  }
  return { width: header.width, height: header.height, ink };
}

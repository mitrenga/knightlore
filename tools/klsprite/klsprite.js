#!/usr/bin/env node
/**
 * klsprite - offline extractor of the original Knight Lore sprites.
 *
 * Reads the 48K snapshot built from the jonsole disassembly and writes
 * data/sprites.json: the masked sprite bitmaps exactly as the original stores
 * them, the anchor every graphic number is drawn with, and the placement of the
 * screen frame and of the panel. Nothing of this runs in the game; the game
 * reads the generated JSON through app/spriteSheet.js.
 *
 * The sprite format is documented in the disassembly itself and in
 * NOTES-ORIGINAL.md chapter 12: a width byte (bytes per row in bits 0-3, the
 * flip state the running game left behind in bits 6-7), a height byte, then
 * height rows of width byte pairs, each pair a mask byte and an image byte,
 * the first row being the bottom one.
 *
 * The anchors are not data: each graphic number has an update handler which
 * calls set_pixel_adj with a constant, so they are traced out of the
 * disassembly source (tools/lib/asm.js) and checked against the size the
 * object tables draw the graphic at (`anchors`).
 *
 * Usage:
 *   node tools/klsprite/klsprite.js list [--used]
 *   node tools/klsprite/klsprite.js sprites
 *   node tools/klsprite/klsprite.js show <graphic> [--flip h|v|hv]
 *   node tools/klsprite/klsprite.js anchors
 *   node tools/klsprite/klsprite.js verify
 *   node tools/klsprite/klsprite.js emit [--out data]
 *
 * <graphic> is a graphic number 0-187, decimal or hexadecimal with a 0x prefix.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Snapshot } from '../lib/snapshot.js';
import { Asm } from '../lib/asm.js';
import { readGraphicSizes } from '../lib/graphicObjects.js';
import { SPRITE_FORMAT, readSprites, spriteGrid, gridRow } from '../../app/spriteSheet.js';

/** Rows in one character of either font (`print_8x8` prints eight lines). */
const FONT_HEIGHT = 8;

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SNAPSHOT = join(PROJECT, 'refs/original/knightlore-jonsole-build.sna');
const SYMBOLS = join(PROJECT, 'refs/disasm/jonsole-knightlore/knightlore.sld');
const SOURCE = join(PROJECT, 'refs/disasm/jonsole-knightlore/knightlore.asm');

/** Number of entries of sprite_tbl and of upd_sprite_jmp_tbl - they are indexed alike. */
const GRAPHICS = 188;

/** Bits of the width byte of a sprite (see flip_sprite_data). */
const WIDTH_MASK = 0x0F;
const STORED_HFLIP = 0x40;
const STORED_VFLIP = 0x80;

/**
 * How print_border and display_panel repeat the pieces of the screen frame.
 * Where a piece goes is data (`border_data` and `panel_data`: graphic number,
 * flags, X, Y), but how often and with what step it repeats is written in the
 * code, so it is spelled out here next to the routine it comes from.
 *
 * `repeat` counts the sprite itself; `stepX` and `stepY` are the steps
 * multiple_print_sprite takes, in the original's pixel space, where Y is
 * counted upwards from the bottom of the screen.
 */
const FRAME_REPEATS = {
  // print_border: four corners, then the two horizontal bars (24 sprites, 8
  // pixels apart) and the two vertical ones (128 sprites, one pixel apart)
  border_data: [
    { repeat: 1, stepX: 0, stepY: 0 },
    { repeat: 1, stepX: 0, stepY: 0 },
    { repeat: 1, stepX: 0, stepY: 0 },
    { repeat: 1, stepX: 0, stepY: 0 },
    { repeat: 24, stepX: 8, stepY: 0 },
    { repeat: 24, stepX: 8, stepY: 0 },
    { repeat: 128, stepX: 0, stepY: 1 },
    { repeat: 128, stepX: 0, stepY: 1 }
  ],
  // display_panel: two runs of five sprites and four single ones
  panel_data: [
    { repeat: 5, stepX: 16, stepY: -8 },
    { repeat: 1, stepX: 0, stepY: 0 },
    { repeat: 1, stepX: 0, stepY: 0 },
    { repeat: 5, stepX: 16, stepY: 8 },
    { repeat: 1, stepX: 0, stepY: 0 },
    { repeat: 1, stepX: 0, stepY: 0 }
  ]
};

// ---------------------------------------------------------------------------

class Extractor {

  constructor(snapshot, asm) {
    this.snapshot = snapshot;
    this.asm = asm;
    this.labels = asm.wordTable('sprite_tbl');
    this.handlers = asm.wordTable('upd_sprite_jmp_tbl');
    if (this.labels.length !== GRAPHICS || this.handlers.length !== GRAPHICS) {
      throw new Error('sprite_tbl has ' + this.labels.length + ' and upd_sprite_jmp_tbl '
        + this.handlers.length + ' entries, expected ' + GRAPHICS + ' of each'
        + ' - the disassembly does not match this tool');
    }
    this.sprites = [];
    this.byAddress = new Map();
    this.graphics = [];
    const table = snapshot.address('sprite_tbl');
    for (let graphic = 0; graphic < GRAPHICS; graphic++) {
      const address = snapshot.word(table + graphic * 2);
      if (address !== snapshot.address(this.labels[graphic])) {
        throw new Error('graphic ' + graphic + ': sprite_tbl in the snapshot points at '
          + hex16(address) + ', the source says ' + this.labels[graphic] + ' at '
          + hex16(snapshot.address(this.labels[graphic])));
      }
      this.graphics.push({
        graphic,
        sprite: this.readSprite(address, this.labels[graphic]),
        handler: this.handlers[graphic],
        anchors: this.readAnchors(graphic)
      });
    }
  }

  /**
   * The sprite at an address, decoded once and shared by every graphic number
   * pointing at it. The bytes are put back into the state the original's data
   * was in before the game flipped anything in place: the snapshot is a running
   * machine, so a sprite that happened to be drawn mirrored carries the flip in
   * its width byte, and undoing that is what makes the output reproducible.
   */
  readSprite(address, label) {
    if (this.byAddress.has(address)) return this.byAddress.get(address);
    const widthByte = this.snapshot.byte(address);
    const width = widthByte & WIDTH_MASK;
    const height = this.snapshot.byte(address + 1);
    if (widthByte & ~(WIDTH_MASK | STORED_HFLIP | STORED_VFLIP)) {
      throw new Error(label + ': unexpected bits in the width byte ' + hex8(widthByte));
    }
    const sprite = {
      index: this.sprites.length,
      label,
      address,
      width,
      height,
      stored: {
        flipHorizontal: !!(widthByte & STORED_HFLIP),
        flipVertical: !!(widthByte & STORED_VFLIP)
      },
      bytes: width === 0 || height === 0 ? [] : this.snapshot.bytes(address + 2, width * height * 2)
    };
    if (sprite.stored.flipVertical) sprite.bytes = unflipVertical(sprite.bytes, width, height);
    if (sprite.stored.flipHorizontal) sprite.bytes = unflipHorizontal(sprite.bytes, width, height);
    if (width > 0 && height > 0) {
      this.sprites.push(sprite);
    }
    this.byAddress.set(address, sprite);
    return sprite;
  }

  /**
   * The anchor of a graphic number, for every combination of the flip flags.
   * The arch handlers pick a different anchor when the piece is mirrored, so
   * all four combinations are traced and the ones that differ are kept.
   */
  readAnchors(graphic) {
    const handler = this.handlers[graphic];
    const anchors = {};
    for (const flipHorizontal of [false, true]) {
      for (const flipVertical of [false, true]) {
        const traced = this.asm.traceAnchor(handler, { graphic, flipHorizontal, flipVertical });
        anchors[flipKey(flipHorizontal, flipVertical)] = traced === false ? false : traced;
      }
    }
    return anchors;
  }

  /** The placement table of the screen frame or of the panel. */
  frame(label, endLabel) {
    const data = this.snapshot.between(label, endLabel);
    const repeats = FRAME_REPEATS[label];
    if (data.length !== repeats.length * 4) {
      throw new Error(label + ': ' + data.length + ' bytes, expected ' + repeats.length * 4
        + ' - ' + repeats.length + ' pieces of four bytes');
    }
    return repeats.map((repeat, index) => ({
      graphic: data[index * 4],
      flipHorizontal: !!(data[index * 4 + 1] & STORED_HFLIP),
      flipVertical: !!(data[index * 4 + 1] & STORED_VFLIP),
      x: data[index * 4 + 2],
      y: data[index * 4 + 3],
      repeat: repeat.repeat,
      stepX: repeat.stepX,
      stepY: repeat.stepY
    }));
  }

  /** data/sprites.json. */
  emit() {
    return {
      format: SPRITE_FORMAT,
      origin: {
        source: 'Knight Lore (Ultimate Play The Game, 1984), extracted from the disassembly',
        sprites: 'sprite_tbl at ' + hex16(this.snapshot.address('sprite_tbl')) + ', '
          + GRAPHICS + ' graphic numbers over ' + this.sprites.length + ' distinct sprites',
        anchors: 'set_pixel_adj, traced through the handlers of upd_sprite_jmp_tbl',
        frame: 'border_data and panel_data, repeated as print_border and display_panel do'
      },
      sprites: this.sprites.map((sprite) => ({
        label: sprite.label,
        width: sprite.width * 8,
        height: sprite.height,
        bytes: sprite.bytes.map((value) => value.toString(16).toUpperCase().padStart(2, '0')).join('')
      })),
      graphics: this.graphics.map((graphic) => emitGraphic(graphic)),
      screen: {
        border: this.frame('border_data', 'room_size_tbl'),
        panel: this.frame('panel_data', 'colour_panel')
      },
      fonts: {
        text: this.font('font', 'menu_colours'),
        day: this.font('day_font', 'print_8x8')
      }
    };
  }

  /**
   * An 8x8 font of the original, one byte per row, as rows of `#` and `.`.
   *
   * The game has two. `font` is the alphabet the status panel and the text
   * screens are printed in (`print_8x8`, `print_BCD_number`), and its first ten
   * characters are the digits, which is all the panel of a running game needs.
   * `day_font` is the three little glyphs of the word DAY in the panel
   * (`display_day`), printed by the very same routine with a different base
   * address - so it is a font of three characters and not a picture.
   *
   * @param {string} label symbol the font starts at
   * @param {string} end symbol it runs up to
   * @returns {string[][]} one array of eight rows per character
   */
  font(label, end) {
    const start = this.snapshot.address(label);
    const bytes = this.snapshot.bytes(start, this.snapshot.address(end) - start);
    if (bytes.length === 0 || bytes.length % FONT_HEIGHT !== 0) {
      throw new Error(label + ': ' + bytes.length + ' bytes, expected a multiple of ' + FONT_HEIGHT);
    }
    const characters = [];
    for (let at = 0; at < bytes.length; at += FONT_HEIGHT) {
      characters.push(Array.from({ length: FONT_HEIGHT }, (unused, row) => {
        const value = bytes[at + row];
        let line = '';
        for (let bit = 7; bit >= 0; bit--) line += (value >> bit) & 1 ? '#' : '.';
        return line;
      }));
    }
    return characters;
  }

} // Extractor

/**
 * One entry of the emitted graphics table, or null when the graphic number
 * never reaches the screen.
 *
 * A graphic whose handler is `no_update` is not part of the world: the frame
 * and the panel are printed straight at a screen position (print_border,
 * display_panel), never through calc_pixel_XY, so their anchor is zero. The
 * only other handler without an anchor is upd_111, which the disassembly marks
 * invalid - it replaces the object with the null sprite before anything is
 * drawn - so that graphic number is emitted as null.
 */
function emitGraphic(graphic) {
  if (graphic.sprite.width === 0 || graphic.sprite.height === 0) return null;
  const plain = graphic.anchors.plain;
  const anchor = plain === false
    ? (graphic.handler === 'no_update' ? { x: 0, y: 0 } : false)
    : { x: plain.x, y: plain.y };
  if (anchor === false) return null;
  const entry = {
    sprite: graphic.sprite.index,
    anchor,
    handler: graphic.handler
  };
  for (const key of ['flipH', 'flipV', 'flipHV']) {
    const anchor = graphic.anchors[key];
    if (anchor !== false && (anchor.x !== plain.x || anchor.y !== plain.y)) {
      entry[key] = { x: anchor.x, y: anchor.y };
    }
  }
  return entry;
}

function flipKey(flipHorizontal, flipVertical) {
  if (flipHorizontal && flipVertical) return 'flipHV';
  if (flipHorizontal) return 'flipH';
  if (flipVertical) return 'flipV';
  return 'plain';
}

/** Puts the rows back in their original order (a vertical flip swaps whole rows). */
function unflipVertical(bytes, width, height) {
  const stride = width * 2;
  const result = [];
  for (let row = height - 1; row >= 0; row--) {
    for (let at = 0; at < stride; at++) result.push(bytes[row * stride + at]);
  }
  return result;
}

/**
 * Mirrors every row back: the flip reverses the order of the byte pairs and the
 * bits inside each byte, keeping the mask byte in front of the image byte.
 */
function unflipHorizontal(bytes, width, height) {
  const stride = width * 2;
  const result = [];
  for (let row = 0; row < height; row++) {
    for (let pair = width - 1; pair >= 0; pair--) {
      result.push(reverseBits(bytes[row * stride + pair * 2]));
      result.push(reverseBits(bytes[row * stride + pair * 2 + 1]));
    }
  }
  return result;
}

function reverseBits(value) {
  let result = 0;
  for (let bit = 0; bit < 8; bit++) result |= ((value >> bit) & 1) << (7 - bit);
  return result;
}

// ---------------------------------------------------------------------------
// commands

function commandList(extractor, onlyUsed) {
  const sizes = readGraphicSizes(extractor.snapshot);
  console.log('gfx        sprite      size      anchor      drawn as        handler');
  let count = 0;
  for (const graphic of extractor.graphics) {
    const drawnAs = sizes.get(graphic.graphic);
    if (onlyUsed && drawnAs === undefined) continue;
    const anchor = graphic.anchors.plain;
    console.log(
      (hex8(graphic.graphic) + ' ' + String(graphic.graphic).padStart(3)).padEnd(10),
      graphic.sprite.label.padEnd(11),
      (graphic.sprite.width === 0 ? '-' : graphic.sprite.width * 8 + 'x' + graphic.sprite.height).padEnd(9),
      (anchor === false ? '-' : anchor.x + ',' + anchor.y).padEnd(11),
      (drawnAs === undefined ? '-' : drawnAs.map(boxSize).join(' ')).padEnd(15),
      graphic.handler + (anchor !== false && anchor.ambiguous ? '  (ambiguous)' : '')
    );
    count++;
  }
  console.log('\n' + count + (onlyUsed ? ' graphic numbers used by the object tables' : ' graphic numbers'));
}

function commandSprites(extractor) {
  console.log('  #  label       size      bytes  used by graphic numbers');
  for (const sprite of extractor.sprites) {
    const users = extractor.graphics.filter((graphic) => graphic.sprite === sprite);
    console.log(
      String(sprite.index).padStart(3),
      sprite.label.padEnd(11),
      (sprite.width * 8 + 'x' + sprite.height).padEnd(9),
      String(sprite.bytes.length).padStart(5),
      ' ' + users.map((graphic) => graphic.graphic).join(', ')
    );
  }
  console.log('\n' + extractor.sprites.length + ' sprites, '
    + extractor.sprites.reduce((total, sprite) => total + sprite.bytes.length, 0) + ' bytes of data');
}

function commandShow(extractor, graphicNumber, flip) {
  const graphic = extractor.graphics[graphicNumber];
  const sheet = readSprites(extractor.emit());
  const grid = spriteGrid(sheet, graphicNumber, {
    flipHorizontal: flip.includes('h'),
    flipVertical: flip.includes('v')
  });
  if (grid === false) {
    throw new Error('graphic ' + graphicNumber + ' is the null sprite, there is nothing to show');
  }
  const drawnAs = readGraphicSizes(extractor.snapshot).get(graphicNumber);
  console.log('graphic ' + graphicNumber + '  ' + graphic.sprite.label
    + '  ' + grid.width + 'x' + grid.height
    + '  anchor ' + grid.anchor.x + ',' + grid.anchor.y
    + (drawnAs === undefined ? '' : '  box ' + drawnAs.map(boxSize).join(' '))
    + '  ' + graphic.handler
    + (flip ? '  flipped ' + flip : ''));
  for (let row = 0; row < grid.height; row++) {
    console.log(gridRow(grid, row));
  }
  console.log('\n# ink, : mask only (clears the background), . transparent');
}

/**
 * Puts every anchor next to the one the shape of the box predicts. The sprite
 * of a plain box starts at the left corner of its silhouette, which is
 * -(radiusX+radiusY) pixels from the projected centre and half of that below
 * it; everything that differs is a piece whose art is not the box itself (the
 * arches, the characters, the pieces that hang above their own position), and
 * seeing the list is the check that the traced anchors are the real ones.
 */
function commandAnchors(extractor) {
  const sizes = readGraphicSizes(extractor.snapshot);
  console.log('gfx  handler                        anchor      predicted   delta    box'
    + '              drawn by');
  let matching = 0;
  let listed = 0;
  for (const graphic of extractor.graphics) {
    const drawnAs = sizes.get(graphic.graphic);
    const anchor = graphic.anchors.plain;
    if (drawnAs === undefined || anchor === false) continue;
    for (const size of drawnAs) {
      const span = size.radiusX + size.radiusY;
      const predicted = { x: -span, y: -(span >> 1) };
      const delta = { x: anchor.x - predicted.x, y: anchor.y - predicted.y };
      listed++;
      if (delta.x === 0 && delta.y === 0) matching++;
      console.log(
        String(graphic.graphic).padStart(3),
        graphic.handler.padEnd(30),
        (anchor.x + ',' + anchor.y).padEnd(11),
        (predicted.x + ',' + predicted.y).padEnd(11),
        ((delta.x || delta.y) ? delta.x + ',' + delta.y : '-').padEnd(8),
        boxSize(size) + '  ' + size.from
      );
    }
  }
  console.log('\n' + matching + ' of ' + listed + ' anchors are exactly where the box silhouette starts');
}

/**
 * Compares every sprite against the DB block of the disassembly source. The
 * snapshot and the source are two independent copies of the same data, so a
 * mismatch means either the snapshot is from another build or this tool reads
 * the format wrongly.
 */
function commandVerify(extractor) {
  const problems = [];
  let checked = 0;
  let flippedInSnapshot = 0;
  let flippedInSource = 0;
  for (const sprite of extractor.sprites) {
    const source = extractor.asm.byteTable(sprite.label);
    // The flip state lives in the width byte, so both copies have to be put
    // into the same orientation before they can be compared: the source is a
    // build of the game and its sprites can be stored flipped just as the
    // running machine's can.
    const width = source[0] & WIDTH_MASK;
    const height = source[1];
    let bytes = source.slice(2);
    if (source[0] & STORED_VFLIP) bytes = unflipVertical(bytes, width, height);
    if (source[0] & STORED_HFLIP) bytes = unflipHorizontal(bytes, width, height);
    if (source[0] & (STORED_HFLIP | STORED_VFLIP)) flippedInSource++;
    if (sprite.stored.flipHorizontal || sprite.stored.flipVertical) flippedInSnapshot++;
    checked++;

    if (width !== sprite.width || height !== sprite.height) {
      problems.push(sprite.label + ': ' + width + 'x' + height + ' bytes in the source, '
        + sprite.width + 'x' + sprite.height + ' in the snapshot');
      continue;
    }
    if (bytes.length !== sprite.bytes.length) {
      problems.push(sprite.label + ': ' + bytes.length + ' bytes in the source, '
        + sprite.bytes.length + ' in the snapshot');
      continue;
    }
    const differs = sprite.bytes.findIndex((value, at) => value !== bytes[at]);
    if (differs >= 0) {
      problems.push(sprite.label + ': byte ' + differs + ' is ' + hex8(sprite.bytes[differs])
        + ' in the snapshot and ' + hex8(bytes[differs]) + ' in the source');
    }
  }
  console.log(checked + ' sprites compared row by row against the DB blocks of the source');
  console.log('flipped in place and put back: ' + flippedInSnapshot + ' in the snapshot, '
    + flippedInSource + ' in the source');

  const drawable = extractor.graphics.filter((graphic) => graphic.sprite.width > 0);
  const missing = drawable.filter((graphic) => graphic.anchors.plain === false);
  const ambiguous = drawable.filter((graphic) =>
    graphic.anchors.plain !== false && graphic.anchors.plain.ambiguous);
  console.log(drawable.length + ' of ' + GRAPHICS + ' graphic numbers draw a sprite, '
    + (drawable.length - missing.length) + ' of them have a traced anchor');
  if (missing.length) {
    console.log('  no anchor: ' + missing.map((graphic) => graphic.graphic + ' (' + graphic.handler + ')').join(', '));
  }
  if (ambiguous.length) {
    console.log('  traced through a condition this tool cannot evaluate: '
      + ambiguous.map((graphic) => graphic.graphic).join(', '));
  }

  const sheet = readSprites(extractor.emit());
  console.log('the emitted sheet passes app/spriteSheet.js validation ('
    + sheet.sprites.length + ' sprites, ' + sheet.graphics.length + ' graphic numbers)');

  if (problems.length) {
    console.error('\n' + problems.length + ' problem(s):\n  ' + problems.join('\n  '));
    process.exitCode = 1;
  } else {
    console.log('\nverification: ok');
  }
}

function commandEmit(extractor, outDir) {
  const sheet = extractor.emit();
  readSprites(sheet);                              // never write data the game would reject
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, 'sprites.json');
  writeFileSync(file, JSON.stringify(sheet, null, 2) + '\n');
  const drawable = sheet.graphics.filter((graphic) => graphic !== null).length;
  console.log('wrote ' + file + '  (' + sheet.sprites.length + ' sprites, '
    + drawable + ' of ' + sheet.graphics.length + ' graphic numbers drawable, '
    + sheet.screen.border.length + ' frame and ' + sheet.screen.panel.length + ' panel pieces)');
}

// ---------------------------------------------------------------------------

/** A part of an object table as a box size, radii doubled. */
function boxSize(size) {
  return size.radiusX * 2 + 'x' + size.radiusY * 2 + 'x' + size.height;
}

function hex8(value) {
  return '0x' + value.toString(16).toUpperCase().padStart(2, '0');
}

function hex16(value) {
  return '0x' + value.toString(16).toUpperCase().padStart(4, '0');
}

function parseGraphic(text) {
  const value = /^0x/i.test(text) ? parseInt(text, 16) : parseInt(text, 10);
  if (!Number.isInteger(value) || value < 0 || value >= GRAPHICS) {
    throw new Error('bad graphic number: ' + text);
  }
  return value;
}

function main(argv) {
  const args = argv.slice(2);
  const command = args.shift();
  let outDir = join(PROJECT, 'data');
  const outAt = args.indexOf('--out');
  if (outAt >= 0) {
    outDir = resolve(PROJECT, args[outAt + 1] || '');
    args.splice(outAt, 2);
  }
  let flip = '';
  const flipAt = args.indexOf('--flip');
  if (flipAt >= 0) {
    flip = (args[flipAt + 1] || '').toLowerCase();
    args.splice(flipAt, 2);
    if (!/^[hv]{1,2}$/.test(flip)) throw new Error('--flip takes h, v or hv');
  }
  const onlyUsed = args.includes('--used');

  const extractor = new Extractor(new Snapshot(SNAPSHOT, SYMBOLS), new Asm(SOURCE));
  switch (command) {
    case 'list': return commandList(extractor, onlyUsed);
    case 'sprites': return commandSprites(extractor);
    case 'show': return commandShow(extractor, parseGraphic(args[0] ?? ''), flip);
    case 'anchors': return commandAnchors(extractor);
    case 'verify': return commandVerify(extractor);
    case 'emit': return commandEmit(extractor, outDir);
    default:
      console.error('usage: klsprite.js list [--used] | sprites | show <graphic> [--flip h|v|hv]'
        + ' | anchors | verify | emit [--out data]');
      process.exitCode = 2;
  }
}

try {
  main(process.argv);
} catch (error) {
  console.error('klsprite: ' + error.message);
  process.exitCode = 1;
}

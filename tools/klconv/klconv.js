#!/usr/bin/env node
/**
 * klconv - offline converter of the original Knight Lore room data.
 *
 * Reads the 48K snapshot built from the jonsole disassembly together with its
 * symbol file (.sld), decodes the original room table and writes our own
 * data/roomNNN.json. Nothing of this runs in the game; the game only ever
 * reads the generated JSON.
 *
 * The decoding follows retrieve_screen / find_screen in the disassembly; the
 * format is described in NOTES-ORIGINAL.md.
 *
 * Usage:
 *   node tools/klconv/klconv.js list
 *   node tools/klconv/klconv.js dump <id>
 *   node tools/klconv/klconv.js emit <id|all> [--out data]
 *   node tools/klconv/klconv.js global [--out data]
 *   node tools/klconv/klconv.js verify [--out data]
 *   node tools/klconv/klconv.js info
 *
 * <id> is decimal, or hexadecimal with a 0x prefix.
 */

import { writeFileSync, mkdirSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Snapshot } from '../lib/snapshot.js';
import { readBlockParts, readBackgroundParts } from '../lib/graphicObjects.js';
import { CUBE, FORMAT, ITEM, DIRECTIONS, neighbourId, roomFileName, validateRoom, validateGlobal }
  from '../../app/roomData.js';

/** Length of `objects_required`: fourteen asks from seven kinds of object. */
const OBJECTS_REQUIRED = 14;

/** Length of `start_locations`: the four rooms a game may begin in. */
const START_LOCATIONS = 4;

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SNAPSHOT = join(PROJECT, 'refs/original/knightlore-jonsole-build.sna');
const SYMBOLS = join(PROJECT, 'refs/disasm/jonsole-knightlore/knightlore.sld');

/**
 * Meaning of the 29 entries of block_type_tbl. The names are the labels from
 * the disassembly; collision and motion say what the block does in the game.
 *
 * M5 confirmed them against the handlers the original actually runs, which are
 * indexed by the block's graphic number and not by its type
 * (`upd_sprite_jmp_tbl`). Two came out differently from the first reading:
 * the wizard's spell chases the hero but is not fatal, so it is not a hazard,
 * and `moveable_block` carries the flag that says it may be shoved but its
 * handler throws the shove away every frame, so nothing can push it. The
 * engine no longer reads either column - it dispatches on the graphic number
 * as the original does - so this is documentation and the room editor's
 * vocabulary (M11).
 */
const BLOCK_TYPES = [
  { name: 'block',                collision: 'solid',    motion: 'static' },
  { name: 'fire',                 collision: 'hazard',   motion: 'static' },
  { name: 'ball_ud_y',            collision: 'hazard',   motion: 'updown-y' },
  { name: 'rock',                 collision: 'solid',    motion: 'static' },
  { name: 'gargoyle',             collision: 'hazard',   motion: 'static' },
  { name: 'spike',                collision: 'hazard',   motion: 'static' },
  { name: 'chest',                collision: 'pushable', motion: 'static' },
  { name: 'table',                collision: 'pushable', motion: 'static' },
  { name: 'guard_ew',             collision: 'hazard',   motion: 'patrol-ew' },
  { name: 'ghost',                collision: 'hazard',   motion: 'chase' },
  { name: 'fire_ns',              collision: 'hazard',   motion: 'patrol-ns' },
  { name: 'block_high',           collision: 'solid',    motion: 'static' },
  { name: 'ball_ud_xy',           collision: 'hazard',   motion: 'updown-xy' },
  { name: 'guard_square',         collision: 'hazard',   motion: 'patrol-square' },
  { name: 'block_ew',             collision: 'platform', motion: 'patrol-ew' },
  { name: 'block_ns',             collision: 'platform', motion: 'patrol-ns' },
  { name: 'moveable_block',       collision: 'pushable', motion: 'static' },
  { name: 'spike_high',           collision: 'hazard',   motion: 'static' },
  { name: 'spike_ball_fall',      collision: 'hazard',   motion: 'fall' },
  { name: 'spike_ball_high_fall', collision: 'hazard',   motion: 'fall' },
  { name: 'fire_ew',              collision: 'hazard',   motion: 'patrol-ew' },
  { name: 'dropping_block',       collision: 'trigger',  motion: 'drop' },
  { name: 'collapsing_block',     collision: 'trigger',  motion: 'collapse' },
  { name: 'ball_bounce',          collision: 'hazard',   motion: 'bounce' },
  { name: 'ball_ud',              collision: 'hazard',   motion: 'updown' },
  { name: 'repel_spell',          collision: 'solid',    motion: 'repel' },
  { name: 'gate_ud_1',            collision: 'solid',    motion: 'gate' },
  { name: 'gate_ud_2',            collision: 'solid',    motion: 'gate' },
  { name: 'ball_ud_x',            collision: 'hazard',   motion: 'updown-x' }
];

/**
 * Meaning of the 24 entries of background_type_tbl. `exit` marks the side of
 * the room the piece opens - that is where the exits of a room come from,
 * the original has no exit list at all.
 */
const BACKGROUND_TYPES = [
  { name: 'arch_n',            exit: 'north' },
  { name: 'arch_e',            exit: 'east' },
  { name: 'arch_s',            exit: 'south' },
  { name: 'arch_w',            exit: 'west' },
  { name: 'tree_arch_n',       exit: 'north' },
  { name: 'tree_arch_e',       exit: 'east' },
  { name: 'tree_arch_s',       exit: 'south' },
  { name: 'tree_arch_w',       exit: 'west' },
  { name: 'gate_n',            exit: 'north' },
  { name: 'gate_e',            exit: 'east' },
  { name: 'gate_s',            exit: 'south' },
  { name: 'gate_w',            exit: 'west' },
  { name: 'wall_size_1',       exit: false },
  { name: 'wall_size_2',       exit: false },
  { name: 'wall_size_3',       exit: false },
  { name: 'tree_room_size_1',  exit: false },
  { name: 'tree_filler_w',     exit: false },
  { name: 'tree_filler_n',     exit: false },
  { name: 'wizard',            exit: false },
  { name: 'cauldron',          exit: false },
  { name: 'high_arch_e',       exit: 'east' },
  { name: 'high_arch_s',       exit: 'south' },
  { name: 'high_arch_e_base',  exit: false },
  { name: 'high_arch_s_base',  exit: false }
];

/** Bits of the flags byte (+7 of a graphic object), see the disassembly. */
const FLAG_VFLIP = 0x80;
const FLAG_HFLIP = 0x40;
const FLAG_DRAW = 0x10;
const FLAG_MOVEABLE = 0x04;
const FLAG_IGNORE_3D = 0x02;

// ---------------------------------------------------------------------------
// decoding the original tables

/** Room sizes: three variants of {X, Y, Z}, indexed by bits 3-7 of the attribute byte. */
function readRoomSizes(snapshot) {
  const base = snapshot.address('room_size_tbl');
  const count = (snapshot.address('location_tbl') - base) / 3;
  return Array.from({ length: count }, (unused, index) => ({
    x: snapshot.byte(base + index * 3),
    y: snapshot.byte(base + index * 3 + 1),
    z: snapshot.byte(base + index * 3 + 2)
  }));
}

/**
 * Splits location_tbl into records.
 *
 * Record: [id][size][attribute][background types...][0xFF][foreground...],
 * where `size` is counted from itself, so the whole record is 1 + size bytes
 * (see find_screen, which advances HL by `size` from the size byte).
 */
function readLocations(snapshot) {
  const data = snapshot.between('location_tbl', 'block_type_tbl');
  const rooms = [];
  let at = 0;
  while (at + 1 < data.length) {
    const size = data[at + 1];
    if (size < 2 || at + 1 + size > data.length) {
      throw new Error('location_tbl: bad record size ' + size + ' at offset ' + at);
    }
    rooms.push({
      id: data[at],
      attribute: data[at + 2],
      payload: data.slice(at + 3, at + 1 + size)
    });
    at += 1 + size;
  }
  if (at !== data.length) throw new Error('location_tbl: ' + (data.length - at) + ' trailing bytes');
  return rooms;
}

/** Splits a record payload into the background type list and the block list. */
function splitPayload(payload) {
  const terminator = payload.indexOf(0xFF);
  if (terminator < 0) return { backgrounds: payload.slice(), blocks: [] };
  return { backgrounds: payload.slice(0, terminator), blocks: payload.slice(terminator + 1) };
}

/**
 * Decodes the block list of a room.
 *
 * Entry: [block byte][position byte] x count, where the block byte holds the
 * block type in bits 3-7 and count-1 in bits 0-2 (next_fg_obj). The position
 * byte packs the cube: bits 0-2 = X, bits 3-5 = Y, bits 6-7 = Z.
 */
function decodeBlockList(bytes) {
  const placed = [];
  let at = 0;
  while (at < bytes.length) {
    const blockByte = bytes[at++];
    const type = blockByte >> 3;
    const count = (blockByte & 7) + 1;
    for (let index = 0; index < count && at < bytes.length; index++) {
      const position = bytes[at++];
      placed.push({
        type,
        cell: { x: position & 7, y: (position >> 3) & 7, z: (position >> 6) & 3 }
      });
    }
  }
  return placed;
}

// ---------------------------------------------------------------------------
// converting to our format

/** Original byte coordinate of the room's south-west floor corner. */
function roomOrigin(size) {
  return { x: 128 - size.x, y: 128 - size.y, z: size.z };
}

/**
 * Position of a block part in original byte coordinates, exactly as
 * next_fg_obj_sprite computes it: X = cell * 16 + halfCell * 8 + 72,
 * Z = cell * 12 + (offsets & 0xFC) + room_size_Z.
 */
function blockPartPosition(cell, part, size) {
  return {
    x: cell.x * 16 + ((part.offsets & 1) ? 8 : 0) + 72,
    y: cell.y * 16 + ((part.offsets & 2) ? 8 : 0) + 72,
    z: cell.z * 12 + (part.offsets & 0xFC) + size.z
  };
}

/**
 * Turns a graphic object of the original (centre X/Y, bottom Z, radii) into
 * our box (south-west floor corner of the box, size), relative to the room.
 */
function toBox(position, part, origin) {
  return {
    x: position.x - part.radiusX - origin.x,
    y: position.y - part.radiusY - origin.y,
    z: position.z - origin.z,
    sx: part.radiusX * 2,
    sy: part.radiusY * 2,
    sz: part.height
  };
}

/**
 * A collectable object where the room can see it: the original's table holds
 * the centre of its footprint, and `find_special_objs_here` gives every one of
 * them the same 5, 5, 12 radii as it puts it in a room, so the box is the same
 * shape as every other box of the room data - the south-west floor corner and
 * a size.
 */
function itemBox(item, origin) {
  return {
    index: item.index,
    x: item.x - ITEM.radiusX - origin.x,
    y: item.y - ITEM.radiusY - origin.y,
    z: item.z - origin.z
  };
}

function flagsOf(part) {
  const flags = {};
  if (part.flags & FLAG_VFLIP) flags.flipVertical = true;
  if (part.flags & FLAG_HFLIP) flags.flipHorizontal = true;
  if (!(part.flags & FLAG_DRAW)) flags.hidden = true;
  if (part.flags & FLAG_MOVEABLE) flags.moveable = true;
  if (part.flags & FLAG_IGNORE_3D) flags.ignoreIn3D = true;
  return flags;
}

function partCollision(part, fallback) {
  return (part.flags & FLAG_IGNORE_3D) ? 'decoration' : fallback;
}

class Converter {
  constructor(snapshot) {
    this.snapshot = snapshot;
    this.roomSizes = readRoomSizes(snapshot);
    this.locations = readLocations(snapshot);
    this.blockDefs = snapshot.pointerTable('block_type_tbl')
      .map((address) => readBlockParts(snapshot, address));
    this.backgroundDefs = snapshot.pointerTable('background_type_tbl')
      .map((address) => readBackgroundParts(snapshot, address));
    this.items = this.readItems();
    if (this.blockDefs.length !== BLOCK_TYPES.length) {
      throw new Error('block_type_tbl has ' + this.blockDefs.length + ' entries, expected '
        + BLOCK_TYPES.length + ' - the naming table is out of date');
    }
    if (this.backgroundDefs.length !== BACKGROUND_TYPES.length) {
      throw new Error('background_type_tbl has ' + this.backgroundDefs.length + ' entries, expected '
        + BACKGROUND_TYPES.length + ' - the naming table is out of date');
    }
  }

  /** The 32 collectable objects, 9 bytes each; only the start half is data. */
  readItems() {
    const data = this.snapshot.between('special_objs_tbl', 'special_objs_tbl_end');
    const items = [];
    for (let at = 0; at + 8 < data.length; at += 9) {
      items.push({ index: items.length, x: data[at + 1], y: data[at + 2], z: data[at + 3], room: data[at + 4] });
    }
    return items;
  }

  /**
   * `data/global.json`: everything about the game that is not one room's
   * business - the 32 collectable objects, the order the cauldron asks for them
   * in, and the four rooms a game may begin in.
   *
   * The objects are the original's `special_objs_tbl` (chapter 2.6): a table of
   * its own, outside the rooms, because an object carried through a doorway
   * stops belonging to the room it started in. Their coordinates are turned
   * into their own room's frame here, the same way the boxes of that room are,
   * so nothing downstream has to know where the original's origin was.
   *
   * The graphic number of an object is deliberately not in the file: the
   * original leaves it zero in the data and deals the eight of them out in a
   * ring from a random start when a game begins (`init_special_objects`), so it
   * is a property of the game being played and not of the castle.
   */
  globalData() {
    return {
      format: FORMAT,
      items: this.items.map((item) => ({
        ...itemBox(item, roomOrigin(this.describe(item.room).size)), room: item.room
      })),
      required: Array.from(this.snapshot.bytes(this.snapshot.address('objects_required'),
        OBJECTS_REQUIRED)),
      startRooms: Array.from(this.snapshot.bytes(this.snapshot.address('start_locations'),
        START_LOCATIONS)),
      origin: {
        source: 'Knight Lore (Ultimate Play The Game, 1984), decoded from the disassembly',
        items: 'special_objs_tbl, 32 records of 9 bytes',
        required: 'objects_required, rotated by 4-7 places at the start of a game',
        startRooms: 'start_locations, one picked at random'
      }
    };
  }

  location(id) {
    const location = this.locations.find((room) => room.id === id);
    if (!location) throw new Error('no such room: ' + id);
    return location;
  }

  /** Everything the original tables say about one room, still in byte coordinates. */
  describe(id) {
    const location = this.location(id);
    const sizeIndex = (location.attribute >> 3) & 0x1F;
    const size = this.roomSizes[sizeIndex];
    if (!size) throw new Error('room ' + id + ': unknown room size index ' + sizeIndex);
    const { backgrounds, blocks } = splitPayload(location.payload);
    return {
      id,
      ink: location.attribute & 7,
      sizeIndex,
      size,
      backgroundTypes: backgrounds,
      blocks: decodeBlockList(blocks),
      items: this.items.filter((item) => item.room === id)
    };
  }

  /** One room in our JSON format. */
  convert(id) {
    const described = this.describe(id);
    const size = described.size;
    const origin = roomOrigin(size);
    const objects = [];

    for (const typeIndex of described.backgroundTypes) {
      const type = BACKGROUND_TYPES[typeIndex];
      const parts = this.backgroundDefs[typeIndex];
      if (!type || !parts) throw new Error('room ' + id + ': unknown background type ' + typeIndex);
      const boxes = parts.map((part) => ({
        part,
        box: toBox({ x: part.x, y: part.y, z: part.z }, part, origin)
      }));
      objects.push(this.assemble(type.name, typeIndex, 'background', 'solid', 'static', boxes));
    }

    for (const placed of described.blocks) {
      const type = BLOCK_TYPES[placed.type];
      const parts = this.blockDefs[placed.type];
      if (!type || !parts) throw new Error('room ' + id + ': unknown block type ' + placed.type);
      const boxes = parts.map((part) => ({
        part,
        box: toBox(blockPartPosition(placed.cell, part, size), part, origin)
      }));
      const object = this.assemble(type.name, placed.type, 'block', type.collision, type.motion, boxes);
      object.cell = placed.cell;
      objects.push(object);
    }

    const exits = {};
    for (const direction of DIRECTIONS) {
      const open = described.backgroundTypes.some((typeIndex) => BACKGROUND_TYPES[typeIndex].exit === direction);
      exits[direction] = open ? neighbourId(id, direction) : false;
    }

    const highest = objects.reduce((top, object) => Math.max(top, object.z + object.sz), 0);

    return {
      format: FORMAT,
      id,
      grid: { column: id & 0x0f, row: id >> 4 },
      attribute: { ink: described.ink, paper: 0, bright: true },
      cube: { x: CUBE.x, y: CUBE.y, z: CUBE.z },
      bounds: { x: size.x * 2, y: size.y * 2, z: Math.max(highest, CUBE.z * 4) },
      exits,
      objects,
      items: described.items.map((item) => itemBox(item, origin)),
      origin: {
        source: 'Knight Lore (Ultimate Play The Game, 1984), decoded from the disassembly',
        sizeIndex: described.sizeIndex,
        backgroundTypes: described.backgroundTypes.map((typeIndex) => BACKGROUND_TYPES[typeIndex].name)
      }
    };
  }

  /** Builds one object out of the parts of a block or background definition. */
  assemble(name, typeIndex, source, collision, motion, boxes) {
    const main = boxes[0];
    const object = {
      type: name,
      typeIndex,
      source,
      sprite: main.part.sprite,
      collision: partCollision(main.part, collision),
      motion,
      phase: 'always',
      ...main.box
    };
    const flags = flagsOf(main.part);
    if (Object.keys(flags).length) object.flags = flags;
    const extras = boxes.slice(1).map((entry) => {
      const extra = {
        sprite: entry.part.sprite,
        collision: partCollision(entry.part, collision),
        ...entry.box
      };
      const extraFlags = flagsOf(entry.part);
      if (Object.keys(extraFlags).length) extra.flags = extraFlags;
      return extra;
    });
    if (extras.length) object.extras = extras;
    return object;
  }
}

// ---------------------------------------------------------------------------
// commands

function commandList(converter) {
  console.log('id     grid    size          ink  backgrounds  blocks  items  exits');
  for (const location of converter.locations) {
    const room = converter.describe(location.id);
    const exits = DIRECTIONS
      .filter((direction) => room.backgroundTypes.some((index) => BACKGROUND_TYPES[index].exit === direction))
      .map((direction) => direction[0].toUpperCase()).join('') || '-';
    console.log(
      hex(room.id).padEnd(6),
      ((room.id >> 4) + ',' + (room.id & 15)).padEnd(7),
      (room.size.x * 2 + 'x' + room.size.y * 2).padEnd(13),
      String(room.ink).padEnd(4),
      String(room.backgroundTypes.length).padEnd(12),
      String(room.blocks.length).padEnd(7),
      String(room.items.length).padEnd(6),
      exits
    );
  }
  console.log('\n' + converter.locations.length + ' rooms');
}

function commandDump(converter, id) {
  const room = converter.describe(id);
  const converted = converter.convert(id);
  console.log('room ' + hex(id) + '  grid ' + (id >> 4) + ',' + (id & 15)
    + '  ink ' + room.ink + '  size index ' + room.sizeIndex
    + '  room ' + room.size.x * 2 + 'x' + room.size.y * 2 + ' units');
  console.log('exits: ' + DIRECTIONS.map((direction) => direction + '='
    + (converted.exits[direction] === false ? '-' : hex(converted.exits[direction]))).join('  '));
  console.log('backgrounds: ' + converted.origin.backgroundTypes.join(', '));
  console.log('\ntype                 collision   motion         x    y    z    sx  sy  sz  sprite');
  for (const object of converted.objects) {
    console.log(
      object.type.padEnd(20),
      object.collision.padEnd(11),
      object.motion.padEnd(14),
      pad(object.x), pad(object.y), pad(object.z),
      pad(object.sx, 3), pad(object.sy, 3), pad(object.sz, 3),
      hex(object.sprite),
      object.extras ? '(+' + object.extras.length + ' parts)' : ''
    );
  }
  if (converted.items.length) {
    console.log('\nitems: ' + converted.items
      .map((item) => '#' + item.index + ' at ' + item.x + ',' + item.y + ',' + item.z).join('  '));
  }
  const problems = validateRoom(converted);
  console.log('\nvalidation: ' + (problems.length ? problems.join('\n  ') : 'ok'));
}

function commandEmit(converter, what, outDir) {
  const ids = what === 'all' ? converter.locations.map((location) => location.id) : [parseId(what)];
  mkdirSync(outDir, { recursive: true });
  let failed = 0;
  for (const id of ids) {
    const room = converter.convert(id);
    const problems = validateRoom(room);
    if (problems.length) {
      failed++;
      console.error('room ' + hex(id) + ' is invalid:\n  ' + problems.join('\n  '));
      continue;
    }
    const file = join(outDir, roomFileName(id));
    writeFileSync(file, JSON.stringify(room, null, 2) + '\n');
    console.log('wrote ' + file + '  (' + room.objects.length + ' objects, '
      + room.items.length + ' items)');
  }
  if (failed) {
    console.error(failed + ' room(s) failed validation');
    process.exitCode = 1;
  }
}

/**
 * Holds what is in `data/` against what the binary says right now.
 *
 * `emit all` is not run again as part of a check anywhere else, so nothing
 * would catch a room file edited by hand, a converter changed since the files
 * were written, or a file left behind for a room that no longer exists. This
 * does: it converts every room afresh and compares the text byte for byte.
 */
function commandVerify(converter, outDir) {
  const expected = new Map(converter.locations
    .map((location) => [roomFileName(location.id),
      JSON.stringify(converter.convert(location.id), null, 2) + '\n']));
  expected.set('global.json', JSON.stringify(converter.globalData(), null, 2) + '\n');

  let differ = 0;
  let missing = 0;
  for (const [name, text] of expected) {
    const file = join(outDir, name);
    if (!existsSync(file)) {
      console.error(name + ': missing');
      missing++;
    } else if (readFileSync(file, 'utf8') !== text) {
      console.error(name + ': differs from what the binary gives');
      differ++;
    }
  }
  const stray = readdirSync(outDir)
    .filter((name) => /^room\d+\.json$/.test(name) && !expected.has(name));
  for (const name of stray) console.error(name + ': no such room in the original');

  console.log(expected.size + ' file(s) converted afresh and compared with ' + outDir);
  if (differ + missing + stray.length === 0) {
    console.log('every one of them is exactly what the binary gives');
  } else {
    console.error(differ + ' differ, ' + missing + ' missing, ' + stray.length + ' stray');
    process.exitCode = 1;
  }
}

function commandGlobal(converter, outDir) {
  const data = converter.globalData();
  const problems = validateGlobal(data);
  if (problems.length) {
    console.error('global data is invalid:\n  ' + problems.join('\n  '));
    process.exitCode = 1;
    return;
  }
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, 'global.json');
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  console.log('wrote ' + file + '  (' + data.items.length + ' collectable objects, '
    + data.required.length + ' asks, ' + data.startRooms.length + ' start rooms)');
}

function commandInfo(converter) {
  const snapshot = converter.snapshot;
  console.log('rooms:               ' + converter.locations.length);
  console.log('room sizes:          ' + converter.roomSizes
    .map((size, index) => index + ': ' + size.x * 2 + 'x' + size.y * 2 + ', floor z ' + size.z).join('  |  '));
  console.log('block types:         ' + converter.blockDefs.length);
  console.log('background types:    ' + converter.backgroundDefs.length);
  console.log('collectable objects: ' + converter.items.length);
  console.log('start rooms:         ' + snapshot.bytes(snapshot.address('start_locations'), 4)
    .map(hex).join(', ') + '  (one picked at random)');
  const player = snapshot.bytes(snapshot.address('plyr_spr_init_data'), 8);
  console.log('player start:        x ' + player[1] + ', y ' + player[2] + ', z ' + player[3]
    + ' (centre of the room, on the floor)');
  const required = snapshot.bytes(snapshot.address('objects_required'), 14);
  console.log('cauldron asks for:   ' + required.join(', ') + '  (fixed sequence, rotated at start)');
}

// ---------------------------------------------------------------------------

function hex(value) {
  return '0x' + value.toString(16).toUpperCase().padStart(2, '0');
}

function pad(value, width = 4) {
  return String(value).padStart(width);
}

function parseId(text) {
  const id = /^0x/i.test(text) ? parseInt(text, 16) : parseInt(text, 10);
  if (!Number.isInteger(id) || id < 0 || id > 255) throw new Error('bad room id: ' + text);
  return id;
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

  const converter = new Converter(new Snapshot(SNAPSHOT, SYMBOLS));
  switch (command) {
    case 'list': return commandList(converter);
    case 'dump': return commandDump(converter, parseId(args[0] ?? ''));
    case 'emit': return commandEmit(converter, args[0] ?? '', outDir);
    case 'global': return commandGlobal(converter, outDir);
    case 'verify': return commandVerify(converter, outDir);
    case 'info': return commandInfo(converter);
    default:
      console.error('usage: klconv.js list | dump <id> | emit <id|all> [--out data]'
        + ' | global [--out data] | verify [--out data] | info');
      process.exitCode = 2;
  }
}

try {
  main(process.argv);
} catch (error) {
  console.error('klconv: ' + error.message);
  process.exitCode = 1;
}

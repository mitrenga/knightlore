/**
 * Shared reader and validator for Knight Lore room data.
 *
 * Used by the game, by the room editor and by the offline converter
 * (tools/klconv). It is deliberately dependency free so it can run both in
 * the browser and in Node.
 *
 * World units follow the original game: one cube of the castle grid is
 * 16 x 16 units in the ground plane and 12 units high. Room coordinates are
 * measured from the room's south-west floor corner, so a cube standing on the
 * floor in the corner is the box (0,0,0)-(16,16,12).
 */

// begin code

/** Size of one castle cube in world units. */
export const CUBE = Object.freeze({ x: 16, y: 16, z: 12 });

/** The castle is a fixed 16 x 16 grid of rooms, room id = row * 16 + column. */
export const CASTLE = Object.freeze({ columns: 16, rows: 16 });

/**
 * Which of the 256 cells of the grid are rooms: one string per row, the row
 * being the high nibble of the room id and the column the low one.
 *
 * The castle has 128 rooms and the grid holds 256 cells, so half of it is not
 * there at all. Nothing in the game needs this - the exits of a room are arches
 * in its walls, and an arch never points at a cell that is empty - but a tool
 * that wants to walk the whole castle needs to know what to walk, and a room
 * whose exit pointed somewhere impossible would be a converter bug worth
 * catching (`validateRoom()`).
 *
 * Reproduce with `python3 tools/recon/dump-location-table.py`; the same picture
 * is in `NOTES-ORIGINAL.md` chapter 1.
 */
export const CASTLE_MAP = Object.freeze([
  '#####...########',
  '#.#.#...#....#.#',
  '###.#..##....###',
  '#...#..##......#',
  '#########......#',
  '....#..##.....##',
  '....#..##.######',
  '....#######.....',
  '...#############',
  '...#...##..#...#',
  '...#...##.##...#',
  '...##..#..##...#',
  '...#...#.......#',
  '####..####...###',
  '#.##..####...#.#',
  '####..####...###'
]);

/**
 * Is there a room with this id?
 *
 * @param {number} id room id 0-255
 * @returns {boolean} true when the castle has that room
 */
export function roomExists(id) {
  return Number.isInteger(id) && id >= 0 && id <= 255
    && CASTLE_MAP[id >> 4][id & 0x0f] === '#';
}

/** Every room of the castle, by id, in order. */
export function castleRooms() {
  const rooms = [];
  for (let id = 0; id < 256; id++) {
    if (roomExists(id)) rooms.push(id);
  }
  return rooms;
}

/** Room data format version understood by this module. */
export const FORMAT = 1;

/** Collision classes an object can have. */
export const COLLISIONS = Object.freeze([
  'solid',        // blocks movement, can be stood on
  'platform',     // solid and carries whatever stands on it
  'hazard',       // costs a life on contact
  'pushable',     // solid, and flagged so that something else may shove it
  'collectible',  // can be picked up and dropped
  'trigger',      // solid until triggered (dropping, collapsing blocks)
  'decoration'    // drawn only, ignored by the physics
]);

/** Day/night phases an object can be present in. */
export const PHASES = Object.freeze(['always', 'day', 'night']);

/**
 * The collectable objects, which do not belong to any room.
 *
 * The original keeps them in one table of its own outside the rooms
 * (`special_objs_tbl`, 32 records of nine bytes): where the object starts, and
 * behind it the four bytes it is actually at now. A room does not own its
 * object - it looks through the table for the ones whose current room is this
 * one (`find_special_objs_here`) - because an object carried out of a room does
 * not belong to it any more. `data/global.json` is that table, and everything
 * else about the objects that is one thing for the whole game: which of them
 * the cauldron asks for and in what order, and the four rooms a game may begin
 * in.
 *
 * Their box is not in the data either: the original writes 5, 5 and 12 into
 * every one of them as it puts them in a room, so a collectable object is
 * always the same 10 x 10 x 12 box whatever it is a picture of.
 */
export const ITEM = Object.freeze({
  /** Radii and height every collectable object is given (`find_special_objs_here`). */
  radiusX: 5, radiusY: 5, height: 12,
  /**
   * Graphic numbers of the objects, in the order `init_special_objects` deals
   * them out: seven that may be picked up and carried, and the eighth, the idol,
   * which is an extra life and is taken by walking into it.
   */
  firstGraphic: 96, graphics: 8, carriable: 7,
  /** How many of them the hero may carry (`objects_carried`, three slots of four bytes). */
  carried: 3,
  /** The room the cauldron stands in (`init_cauldron_bubbles`: "cauldron room?"). */
  cauldronRoom: 136
});

/**
 * Reads and validates `data/global.json`. Throws when it is not usable, for the
 * same reason `readRoom()` does: the converter writes the file, so a problem
 * here is a bug in the converter and not something the game should paper over.
 *
 * @param {object} data parsed data/global.json
 * @returns {object} the same data, frozen
 */
export function readGlobal(data) {
  const problems = validateGlobal(data);
  if (problems.length) {
    throw new Error('invalid global data:\n  ' + problems.join('\n  '));
  }
  return Object.freeze(data);
}

/**
 * Validates parsed `data/global.json`.
 *
 * @param {object} data parsed data/global.json
 * @returns {string[]} list of problems, empty when the data is valid
 */
export function validateGlobal(data) {
  const problems = [];
  const fail = (message) => problems.push(message);

  if (!data || typeof data !== 'object') {
    return ['global data is not an object'];
  }
  if (data.format !== FORMAT) {
    fail('unsupported format: ' + data.format);
    return problems;
  }
  if (!Array.isArray(data.items)) {
    fail('items must be an array');
  } else {
    data.items.forEach((item, index) => {
      const where = 'items[' + index + ']';
      if (item.index !== index) fail(where + '.index must be ' + index + ', got ' + item.index);
      if (!roomExists(item.room)) fail(where + '.room is not a room: ' + item.room);
      if (!isVector(item)) fail(where + ' must have integer x, y, z');
    });
  }
  if (!Array.isArray(data.required) || !data.required.length) {
    fail('required must be a non empty array');
  } else if (data.required.some((want) => !Number.isInteger(want) || want < 0 || want >= ITEM.carriable)) {
    fail('required must hold object indices 0-' + (ITEM.carriable - 1));
  }
  if (!Array.isArray(data.startRooms) || !data.startRooms.length) {
    fail('startRooms must be a non empty array');
  } else if (data.startRooms.some((id) => !roomExists(id))) {
    fail('startRooms holds an id that is not a room');
  }
  return problems;
}

/** The four horizontal exits; vertical movement stays inside a room. */
export const DIRECTIONS = Object.freeze(['north', 'east', 'south', 'west']);

/**
 * Neighbouring room id in the given direction.
 *
 * Taken from screen_west / screen_east / screen_north / screen_south in the
 * original: east and west only change the low nibble (the row wraps around),
 * north and south add or subtract a whole row and wrap modulo 256.
 *
 * @param {number} id room id 0-255
 * @param {string} direction one of DIRECTIONS
 * @returns {number} neighbouring room id
 */
export function neighbourId(id, direction) {
  const row = id & 0xf0;
  const col = id & 0x0f;
  switch (direction) {
    case 'east':  return row | ((col + 1) & 0x0f);
    case 'west':  return row | ((col - 1) & 0x0f);
    case 'north': return (id + 16) & 0xff;
    case 'south': return (id - 16) & 0xff;
    default: throw new Error('unknown direction: ' + direction);
  }
}

/** The side of the neighbouring room the same doorway is in. */
export function oppositeDirection(direction) {
  switch (direction) {
    case 'east':  return 'west';
    case 'west':  return 'east';
    case 'north': return 'south';
    case 'south': return 'north';
    default: throw new Error('unknown direction: ' + direction);
  }
}

/** File name of a room, e.g. 5 -> "room005.json". */
export function roomFileName(id) {
  return 'room' + String(id).padStart(3, '0') + '.json';
}

/**
 * Validates a parsed room JSON.
 *
 * @param {object} room parsed data/roomNNN.json
 * @returns {string[]} list of problems, empty when the room is valid
 */
export function validateRoom(room) {
  const problems = [];
  const fail = (message) => problems.push(message);

  if (!room || typeof room !== 'object') {
    return ['room is not an object'];
  }
  if (room.format !== FORMAT) {
    fail('unsupported format: ' + room.format);
    return problems;
  }
  if (!Number.isInteger(room.id) || room.id < 0 || room.id > 255) {
    fail('id must be an integer 0-255, got ' + room.id);
  }
  if (!isVector(room.bounds) || room.bounds.x <= 0 || room.bounds.y <= 0 || room.bounds.z <= 0) {
    fail('bounds must be a positive vector');
  }

  const ink = room.attribute && room.attribute.ink;
  if (!Number.isInteger(ink) || ink < 0 || ink > 7) {
    fail('attribute.ink must be an integer 0-7, got ' + ink);
  }

  for (const direction of DIRECTIONS) {
    const exit = room.exits && room.exits[direction];
    if (exit === undefined) {
      fail('missing exits.' + direction);
    } else if (exit !== false && !(Number.isInteger(exit) && exit >= 0 && exit <= 255)) {
      fail('exits.' + direction + ' must be false or a room id');
    } else if (exit !== false && exit !== neighbourId(room.id, direction)) {
      fail('exits.' + direction + ' is ' + exit + ', but the grid gives '
        + neighbourId(room.id, direction));
    } else if (exit !== false && !roomExists(exit)) {
      fail('exits.' + direction + ' leads to ' + exit + ', which is not a room');
    }
  }

  if (!Array.isArray(room.objects)) {
    fail('objects must be an array');
    return problems;
  }
  room.objects.forEach((object, index) => {
    validateObject(object, 'objects[' + index + ']', room, fail);
  });

  if (room.items !== undefined) {
    if (!Array.isArray(room.items)) {
      fail('items must be an array');
    } else {
      room.items.forEach((item, index) => {
        const where = 'items[' + index + ']';
        if (!Number.isInteger(item.index)) fail(where + '.index must be an integer');
        if (!isVector(item)) fail(where + ' must have integer x, y, z');
      });
    }
  }

  return problems;
}

/**
 * Reads and validates a room. Throws when the data is not usable.
 *
 * @param {object} room parsed data/roomNNN.json
 * @returns {object} the same room, frozen
 */
export function readRoom(room) {
  const problems = validateRoom(room);
  if (problems.length) {
    throw new Error('invalid room data' + (room && room.id !== undefined ? ' (id ' + room.id + ')' : '')
      + ':\n  ' + problems.join('\n  '));
  }
  return Object.freeze(room);
}

/**
 * All boxes of an object present in the given phase, the object's own box
 * first. Handy for the display list and for collision tests.
 *
 * @param {object} object one entry of room.objects
 * @param {string} [phase] 'day' or 'night'; undefined means "do not filter"
 * @returns {object[]} boxes as {sprite, x, y, z, sx, sy, sz, collision, flags}
 */
export function objectBoxes(object, phase) {
  if (phase && object.phase !== 'always' && object.phase !== phase) return [];
  const own = {
    sprite: object.sprite,
    x: object.x, y: object.y, z: object.z,
    sx: object.sx, sy: object.sy, sz: object.sz,
    collision: object.collision,
    flags: object.flags
  };
  return object.extras && object.extras.length ? [own, ...object.extras] : [own];
}

/**
 * The room as one flat list of boxes, in the order the original's object table
 * holds them: every object of the room, and every extra part of an object right
 * after it, backgrounds before blocks.
 *
 * This is the list the game draws, the list the game worker moves and the list
 * the offline tools work on, and it is one list rather than three because it is
 * one table in the original (`retrieve_screen` fills `graphic_objs_tbl` in
 * exactly this order). Anything that is drawn is in it - the picture-only parts
 * are marked `ignore3D` rather than left out, because a two part object writes
 * its position into the row after its own.
 *
 * The hero is not here. He goes in front of this list, as the first two rows of
 * the table (`heroBoxes()` in `app/hero.js`).
 *
 * @param {object} room a room validated by `readRoom()`
 * @param {string} [phase] 'day' or 'night'; undefined means "do not filter"
 * @returns {object[]} the boxes
 */
export function roomBoxes(room, phase) {
  const list = [];
  for (const object of room.objects) {
    const boxes = objectBoxes(object, phase);
    boxes.forEach((box, part) => {
      const flags = box.flags || {};
      list.push({
        graphic: box.sprite,
        x: box.x, y: box.y, z: box.z,
        sx: box.sx, sy: box.sy, sz: box.sz,
        flipH: !!flags.flipHorizontal,
        flipV: !!flags.flipVertical,
        moveable: !!flags.moveable,
        ignore3D: box.collision === 'decoration',
        part,
        type: object.type,
        source: object.source,
        collision: box.collision,
        motion: object.motion
      });
    });
  }
  return list;
}

function isVector(value) {
  return !!value && Number.isInteger(value.x) && Number.isInteger(value.y) && Number.isInteger(value.z);
}

function validateObject(object, where, room, fail) {
  if (!object || typeof object !== 'object') {
    fail(where + ' is not an object');
    return;
  }
  if (typeof object.type !== 'string' || !object.type) {
    fail(where + '.type must be a non empty string');
  }
  if (!COLLISIONS.includes(object.collision)) {
    fail(where + '.collision is not one of ' + COLLISIONS.join(', '));
  }
  if (!PHASES.includes(object.phase)) {
    fail(where + '.phase is not one of ' + PHASES.join(', '));
  }
  if (!isVector(object)) {
    fail(where + ' must have integer x, y, z');
    return;
  }
  const size = { x: object.sx, y: object.sy, z: object.sz };
  if (!isVector(size) || size.x < 0 || size.y < 0 || size.z < 0) {
    fail(where + ' must have non negative integer sx, sy, sz');
    return;
  }
  if (object.z < 0) {
    fail(where + ' is below the floor (z ' + object.z + ')');
  }
  if (Array.isArray(object.extras)) {
    object.extras.forEach((extra, index) => {
      validateExtra(extra, where + '.extras[' + index + ']', fail);
    });
  } else if (object.extras !== undefined) {
    fail(where + '.extras must be an array');
  }
}

function validateExtra(extra, where, fail) {
  if (!isVector(extra)) {
    fail(where + ' must have integer x, y, z');
  }
  if (!COLLISIONS.includes(extra.collision)) {
    fail(where + '.collision is not one of ' + COLLISIONS.join(', '));
  }
}

#!/usr/bin/env node

/**
 * klmap - holds the converted castle against a period map of the original.
 *
 * The maps in `refs/maps/` are not drawings: `KnightLore_3.png` is a stitch of
 * the real screens of the original, pixel for pixel, all 128 rooms of the
 * castle laid out on one picture. That makes it something the other tools do
 * not have - a picture of what every room is supposed to look like - and this
 * tool is what M9 does with it: it renders every room out of `data/` with the
 * modules the game runs (the same ones `klrender` uses), finds that room in the
 * map, and counts how much of what we draw the original draws too.
 *
 * How a room is found. The stitch is a 1:1 isometric tiling of the 16x16 grid
 * of room ids, so one room east and one room north both move the picture 145
 * pixels right, east 72.5 pixels down and north 72.5 pixels up (`LATTICE`,
 * measured on the map and anchored on the cauldron room). The one thing that
 * cannot be predicted is the floor the room stands on: the castle has storeys,
 * a storey is 48 units, and the map draws a room that much higher up. So the x
 * of a room is known to a pixel and its y is searched over sixteen storeys;
 * what the search finds is then held against the storey the room data itself
 * implies, which is a second, independent check (`levels`).
 *
 * What a mismatch means. The map is one still frame of a running game, so
 * anything that moves in it was caught somewhere on its run: guards, balls,
 * platforms, and anything the player can shove or drop. Those are counted
 * apart from the furniture that cannot move, which is the part a still picture
 * can actually verify. Walls and arches are counted apart again, because the
 * stitch draws the room joins its own way and a wall is often half covered by
 * the neighbouring room.
 *
 * Usage:
 *   node tools/klmap/klmap.js check [<id>|all] [--verbose]
 *   node tools/klmap/klmap.js diff  <id> [-o out.png] [--scale n]
 *   node tools/klmap/klmap.js sheet [-o out.png] [--plain]
 *   node tools/klmap/klmap.js levels
 *
 * Every command takes `--data dir` (default `data`) and `--map file`
 * (default `refs/maps/KnightLore_3.png`).
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readRoom, roomBoxes, roomFileName, DIRECTIONS, oppositeDirection }
  from '../../app/roomData.js';
import { IsoProjection } from '../../app/isoProjection.js';
import { IsoRaster } from '../../app/isoRaster.js';
import { DepthSort } from '../../app/depthSort.js';
import { readSprites, spriteGrid, spritePosition, spriteVisible, boxReference }
  from '../../app/spriteSheet.js';
import { decodeMask, encodeColour } from '../lib/png.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Where the map draws room (column, row), measured on `KnightLore_3.png`.
 * `x = x0 + step*(column + row)`, `y = y0 + half*(column - row) - storey`,
 * where the storey is what the search below finds.
 */
const LATTICE = { x0: 47, step: 145, y0: 940, half: 72.5, floor: -96 };

/** Height of one storey of the castle in world units, which is map pixels. */
const STOREY = 48;

/** Storeys either way the search looks for a room, and the slack around each. */
const STOREYS = 8;
const SLACK = 8;

/** Sideways slack: x is predicted exactly, this only absorbs rounding. */
const SLACK_X = 4;

/** A part of a room counts as found when this much of it is ink in the map. */
const FOUND = 0.7;

/** A whole room counts as found when this much of its picture is ink in the map. */
const FIT_FLOOR = 0.6;

/** What a single room on its own cannot know; see `survey`. */
const ONE_ROOM = 'one room on its own cannot tell it is sitting on a neighbour\'s '
  + 'picture - run check all for that';

/** Colours of the difference pictures. */
const DIFF = [[0, 0, 0], [255, 255, 255], [220, 40, 40], [40, 90, 230]];
const BOTH = 1;
const OURS = 2;
const THEIRS = 3;

// ---------------------------------------------------------------------------
// drawing a room the way the game draws it

/**
 * Renders one room into two buffers: the ink of the picture, and which box of
 * the display list left each pixel behind. The second one is what lets the
 * comparison speak about a single table or guard instead of a whole room.
 *
 * @param {number} id room id
 * @param {object} sprites the sprite sheet
 * @param {string} dataDir where the room files are
 * @returns {object} `{room, boxes, width, height, ink, owner}`
 */
function drawRoom(id, sprites, dataDir) {
  const room = readRoom(JSON.parse(readFileSync(join(dataDir, roomFileName(id)), 'utf8')));
  const boxes = roomBoxes(room);
  const projection = IsoProjection.forRoom(room);
  const width = IsoProjection.screenWidth;
  const height = IsoProjection.screenHeight;
  const ink = new Uint8Array(width*height);
  const owner = new Uint8Array(width*height);
  let drawing = 0;
  const surface = {
    width, height,
    span(x, y, length, colour) {
      for (let step = 0; step < length; step++) {
        ink[y*width + x + step] = colour;
        owner[y*width + x + step] = colour ? drawing : 0;
      }
    },
    pixel(x, y, colour) {
      ink[y*width + x] = colour;
      owner[y*width + x] = colour ? drawing : 0;
    }
  };

  for (const index of DepthSort.order(boxes)) {
    const box = boxes[index];
    const grid = box.graphic === undefined ? false
      : spriteGrid(sprites, box.graphic, { flipHorizontal: box.flipH, flipVertical: box.flipV });
    if (grid === false) continue;
    const reference = boxReference(box);
    const position = spritePosition(grid,
      IsoProjection.point(projection, reference.x, reference.y, reference.z));
    if (!spriteVisible(grid, position)) continue;
    drawing = index + 1;                           // 0 is paper, so boxes count from one
    IsoRaster.drawSprite(surface, grid, position.x, position.y, 1, 0);
  }
  return { room, boxes, width, height, ink, owner };
}

/**
 * What a still picture of a running game can say about a box.
 *
 * `fixed` is furniture nailed to the floor - that is the part the map verifies.
 * `free` is everything the game or the player moves, which the map caught
 * wherever it happened to be. `wall` is the room itself: its walls, arches and
 * fixtures, which the stitch draws its own way where two rooms meet.
 */
function kindOf(box) {
  if (box.source !== 'block') return 'wall';
  if (box.motion !== undefined && box.motion !== 'static') return 'free';
  if (box.collision === 'pushable' || box.collision === 'trigger') return 'free';
  return 'fixed';
}

// ---------------------------------------------------------------------------
// finding a room in the map

/** The ink pixels of a picture, and the rectangle they live in. */
function inkPoints(picture) {
  const points = [];
  let x0 = picture.width, y0 = picture.height, x1 = -1, y1 = -1;
  for (let y = 0; y < picture.height; y++) {
    for (let x = 0; x < picture.width; x++) {
      if (!picture.ink[y*picture.width + x]) continue;
      points.push(x, y);
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return { points, box: { x0, y0, x1, y1 } };
}

/** Summed area table of the map's ink, so "how much ink is in this rectangle" is free. */
function summedArea(map) {
  const width = map.width + 1;
  const table = new Int32Array(width*(map.height + 1));
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      table[(y + 1)*width + x + 1] = map.ink[y*map.width + x]
        + table[y*width + x + 1] + table[(y + 1)*width + x] - table[y*width + x];
    }
  }
  return (x0, y0, x1, y1) => {
    x0 = Math.max(0, Math.min(x0, map.width));
    x1 = Math.max(0, Math.min(x1, map.width));
    y0 = Math.max(0, Math.min(y0, map.height));
    y1 = Math.max(0, Math.min(y1, map.height));
    return table[y1*width + x1] - table[y0*width + x1] - table[y1*width + x0] + table[y0*width + x0];
  };
}

/** How many of a room's ink pixels are ink in the map when it is put at (x, y). */
function overlap(map, points, x, y, stride) {
  let hit = 0;
  for (let at = 0; at < points.length; at += 2*stride) {
    const mx = x + points[at];
    const my = y + points[at + 1];
    if (mx < 0 || my < 0 || mx >= map.width || my >= map.height) continue;
    hit += map.ink[my*map.width + mx];
  }
  return hit;
}

/**
 * Every place in the map a room could be, best first - one for each storey the
 * castle might have put it on.
 *
 * The score is the harmonic mean of how much of the room the map draws and how
 * much of what the map draws there is the room: on its own, "how much of the
 * room is ink" would settle on the solid coloured borders of the picture, and
 * "how much of the picture is room" on the empty black between the wings.
 *
 * All the storeys are kept and not just the best one, because two rooms one
 * above the other in the same column of the picture can be alike enough that a
 * room takes its neighbour's place; `survey` hands out the places so that no
 * two rooms end up in one, and for that it needs the runners up.
 *
 * @param {object} map the ink mask of the map
 * @param {object} area summed area table of the map
 * @param {number} id room id
 * @param {object} picture what `drawRoom` returned
 * @returns {object[]} `{x, y, storey, score, recall}`, best score first
 */
function findPlaces(map, area, id, picture) {
  const { points, box } = inkPoints(picture);
  const total = points.length/2;
  const originX = LATTICE.x0 + LATTICE.step*((id & 0x0f) + (id >> 4));
  const originY = Math.round(LATTICE.y0 + LATTICE.half*((id & 0x0f) - (id >> 4)) + LATTICE.floor);
  const width = box.x1 - box.x0 + 1;
  const height = box.y1 - box.y0 + 1;

  const score = (x, y, stride) => {
    const hit = overlap(map, points, x, y, stride);
    const counted = Math.ceil(total/stride);
    const seen = area(x + box.x0, y + box.y0, x + box.x0 + width, y + box.y0 + height)/stride;
    const recall = hit/counted;
    const precision = hit/Math.max(seen, 1);
    return hit ? 2*recall*precision/(recall + precision) : 0;
  };

  const places = [];
  for (let storey = -STOREYS; storey <= STOREYS; storey++) {
    let best = null;
    for (let slack = -SLACK; slack <= SLACK; slack++) {
      for (let sideways = -SLACK_X; sideways <= SLACK_X; sideways++) {
        const x = originX + sideways;
        const y = originY + storey*STOREY + slack;
        const rough = score(x, y, 2);
        if (best === null || rough > best.score) best = { score: rough, x, y };
      }
    }
    // the rough pass looked at every other pixel; settle it on all of them
    let exact = null;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = best.x + dx;
        const y = best.y + dy;
        const settled = score(x, y, 1);
        if (exact === null || settled > exact.score) exact = { score: settled, x, y };
      }
    }
    best = exact;
    places.push({ x: best.x, y: best.y, storey: -(best.y - originY), score: best.score,
      recall: overlap(map, points, best.x, best.y, 1)/total });
  }
  return places.sort((a, b) => b.score - a.score);
}

/**
 * Holds one room against the map: how much of each kind of thing in it the map
 * draws too, box by box.
 *
 * @param {object} map the ink mask of the map
 * @param {object} picture what `drawRoom` returned
 * @param {object} place where in the map the room was found
 * @returns {object} the place, the tally per kind, and the furniture the map
 *   does not confirm
 */
function compare(map, picture, place) {
  const seen = new Map();
  for (let y = 0; y < picture.height; y++) {
    for (let x = 0; x < picture.width; x++) {
      const owner = picture.owner[y*picture.width + x];
      if (!owner) continue;
      const mx = place.x + x;
      const my = place.y + y;
      const hit = (mx >= 0 && my >= 0 && mx < map.width && my < map.height)
        ? map.ink[my*map.width + mx] : 0;
      const count = seen.get(owner) || [0, 0];
      count[0] += hit;
      count[1]++;
      seen.set(owner, count);
    }
  }

  const kinds = { fixed: { found: 0, total: 0 }, free: { found: 0, total: 0 },
    wall: { found: 0, total: 0 } };
  const missing = [];
  for (const [owner, [hit, total]] of seen) {
    const box = picture.boxes[owner - 1];
    const kind = kindOf(box);
    const share = hit/total;
    kinds[kind].total++;
    if (share >= FOUND) kinds[kind].found++;
    else if (kind === 'fixed') {
      missing.push({ type: box.type, x: box.x, y: box.y, z: box.z, share });
    }
  }
  return { ...place, kinds, missing };
}

// ---------------------------------------------------------------------------
// the storeys of the castle, read out of the room data

/**
 * How much higher the floor of a room is than the floor of its neighbour,
 * taken from the two ends of the doorway between them.
 *
 * A doorway is an arch in the wall, and an arch stands either on the floor or
 * 48 units above it (`high_arch_e/s`, chapter 15 of `NOTES-ORIGINAL.md`). The
 * hero leaves through one arch at its height and arrives at the other one at
 * its height, so the difference of the two is the step between the floors -
 * which is how the castle has storeys at all without a room ever having one.
 */
function archHeight(room, direction) {
  const heights = room.objects
    .filter((object) => object.source === 'background' && archDirection(object.type) === direction)
    .map((object) => object.z);
  return heights.length ? Math.min(...heights) : null;
}

/**
 * The side of the room an arch opens, or false when the piece is not an arch.
 *
 * Gates are left out although they too stand in a doorway: a gate is the
 * portcullis hanging in the opening, not the opening, and it hangs 32 units up
 * where the arch beside it stands on the floor. No side of any room is opened
 * by a gate alone, so nothing is lost by ignoring them.
 */
function archDirection(type) {
  const named = /^(?:tree_|high_)?arch_([nesw])$/.exec(type);
  return named ? { n: 'north', e: 'east', s: 'south', w: 'west' }[named[1]] : false;
}

/** The storey of every room, walking the doorways out from room zero. */
function storeysFromData(rooms) {
  const storey = new Map();
  const disagreements = [];
  const ids = [...rooms.keys()].sort((a, b) => a - b);
  storey.set(ids[0], 0);
  const queue = [ids[0]];
  while (queue.length) {
    const id = queue.shift();
    const room = rooms.get(id);
    for (const direction of DIRECTIONS) {
      const beyond = room.exits[direction];
      if (beyond === false || !rooms.has(beyond)) continue;
      const here = archHeight(room, direction);
      const there = archHeight(rooms.get(beyond), oppositeDirection(direction));
      if (here === null || there === null) continue;
      const value = storey.get(id) + here - there;
      if (!storey.has(beyond)) {
        storey.set(beyond, value);
        queue.push(beyond);
      } else if (storey.get(beyond) !== value
        && !disagreements.some((one) => one.from === beyond && one.to === id)) {
        disagreements.push({ from: id, to: beyond, direction,
          says: value, has: storey.get(beyond) });
      }
    }
  }
  return { storey, disagreements };
}

// ---------------------------------------------------------------------------
// commands

/**
 * Holds every room against the map and says which of them were found there.
 *
 * The places are handed out and not just picked, because two rooms one above
 * the other in the same column of the picture can be alike enough that a room
 * settles on the other one's storey: the best fitting room takes the place it
 * wants first, the next one takes the best place still free, and a room whose
 * every place is taken - or whose best is too poor to believe - is reported as
 * not found rather than quietly drawn on top of its neighbour.
 */
function survey(context, ids) {
  const pictures = new Map();
  const places = new Map();
  const wanted = [];
  for (const id of ids) {
    const picture = drawRoom(id, context.sprites, context.data);
    pictures.set(id, picture);
    const found = findPlaces(context.map, context.area, id, picture);
    places.set(id, found);
    for (const place of found) wanted.push({ id, place });
  }
  wanted.sort((a, b) => b.place.score - a.place.score);

  const taken = new Map();
  const given = new Map();
  for (const { id, place } of wanted) {
    if (given.has(id) || place.recall < FIT_FLOOR) continue;
    const key = place.x + ',' + place.y;
    if (taken.has(key)) continue;
    taken.set(key, id);
    given.set(id, place);
  }

  const empty = { fixed: { found: 0, total: 0 }, free: { found: 0, total: 0 },
    wall: { found: 0, total: 0 } };
  return ids.map((id) => {
    const picture = pictures.get(id);
    const place = given.get(id);
    if (place !== undefined) {
      return { id, found: true, picture, ...compare(context.map, picture, place) };
    }
    const best = places.get(id)[0];
    return { id, found: false, picture, ...best, kinds: empty, missing: [],
      wanted: taken.get(best.x + ',' + best.y) };
  }).sort((a, b) => a.id - b.id);
}

function commandCheck(context, ids, verbose) {
  const rows = survey(context, ids);

  console.log('room   at map        storey  room drawn  furniture  movers  walls');
  for (const row of rows) {
    const share = (kind) => row.kinds[kind].total
      ? (row.kinds[kind].found + '/' + row.kinds[kind].total) : '-';
    console.log(
      hex(row.id).padEnd(6),
      row.found ? (row.x + ',' + row.y).padEnd(12) : 'not found   ',
      (row.found ? String(Math.round(row.storey/STOREY)) : '-').padEnd(7),
      (Math.round(row.recall*100) + '%').padStart(10),
      (row.found ? share('fixed') : '-').padStart(10),
      (row.found ? share('free') : '-').padStart(7),
      (row.found ? share('wall') : '-').padStart(7),
      row.found && row.missing.length && verbose ? '\n       ' + row.missing
        .map((one) => one.type + '(' + one.x + ',' + one.y + ',' + one.z + ') '
          + Math.round(one.share*100) + '%').join('\n       ') : ''
    );
  }

  const found = rows.filter((row) => row.found);
  const lost = rows.filter((row) => !row.found);
  console.log('\n' + rows.length + ' room(s) held against ' + context.mapFile);
  if (rows.length === 1) console.log(ONE_ROOM);
  console.log('  found in the map: ' + found.length
    + (lost.length ? ', not found: ' + lost.length + ' ('
      + lost.map((row) => hex(row.id) + (row.wanted !== undefined
        ? ' wanted the place ' + hex(row.wanted) + ' has' : '')).join('; ') + ')' : ''));
  for (const kind of ['fixed', 'free', 'wall']) {
    const total = found.reduce((sum, row) => sum + row.kinds[kind].total, 0);
    const drawn = found.reduce((sum, row) => sum + row.kinds[kind].found, 0);
    console.log(('  ' + kind + ':').padEnd(10) + drawn + ' of ' + total
      + ' drawn where the map draws them'
      + (total ? '  (' + (100*drawn/total).toFixed(1) + '%)' : ''));
  }
  const bare = found.filter((row) => row.kinds.fixed.total === 0 && row.kinds.free.total === 0);
  if (bare.length) {
    console.log('  rooms with no furniture to tell them apart, placed by their walls alone: '
      + bare.map((row) => hex(row.id)).join(' '));
  }
  const poor = found.filter((row) => row.kinds.fixed.found < row.kinds.fixed.total);
  if (poor.length) {
    console.log('  rooms with furniture the map does not confirm: '
      + poor.map((row) => hex(row.id)).join(' ') + '  (klmap check <id> --verbose)');
  }
}

function commandDiff(context, id, out, scale) {
  const result = survey(context, [id])[0];
  const width = result.picture.width;
  const height = result.picture.height;
  const pixels = new Uint8Array(width*height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const mine = result.picture.ink[y*width + x];
      const mx = result.x + x;
      const my = result.y + y;
      const theirs = (mx >= 0 && my >= 0 && mx < context.map.width && my < context.map.height)
        ? context.map.ink[my*context.map.width + mx] : 0;
      pixels[y*width + x] = mine && theirs ? BOTH : mine ? OURS : theirs ? THEIRS : 0;
    }
  }
  writeFileSync(out, encodeColour({ width, height, pixels }, DIFF, scale));
  console.log('room ' + hex(id) + ' sits at ' + result.x + ',' + result.y
    + ' (storey ' + Math.round(result.storey/STOREY) + '), '
    + Math.round(result.recall*100) + '% of what we draw the map draws too');
  console.log(ONE_ROOM);
  console.log('written ' + out + ' - white both, red only ours, blue only the map');
}

/**
 * The whole castle as one picture: every room drawn where the map draws it.
 * `--plain` writes our castle on its own, otherwise the two are laid over each
 * other, which is the picture to hold against the original map side by side.
 */
function commandSheet(context, ids, out, plain) {
  const width = context.map.width;
  const height = context.map.height;
  const pixels = new Uint8Array(width*height);
  if (!plain) {
    for (let at = 0; at < pixels.length; at++) if (context.map.ink[at]) pixels[at] = THEIRS;
  }
  const rows = survey(context, ids).filter((row) => row.found);
  for (const result of rows) {
    const picture = result.picture;
    for (let y = 0; y < picture.height; y++) {
      for (let x = 0; x < picture.width; x++) {
        if (!picture.ink[y*picture.width + x]) continue;
        const mx = result.x + x;
        const my = result.y + y;
        if (mx < 0 || my < 0 || mx >= width || my >= height) continue;
        pixels[my*width + mx] = plain ? BOTH
          : (context.map.ink[my*width + mx] ? BOTH : OURS);
      }
    }
  }
  writeFileSync(out, encodeColour({ width, height, pixels }, DIFF, 1));
  console.log('written ' + out + ' (' + rows.length + ' rooms, ' + width + 'x' + height + ')'
    + (plain ? '' : ' - white both, red only ours, blue only the map'));
}

/**
 * The storeys of the castle twice over: once from the doorway heights in
 * `data/`, once from how high the map draws each room. The two share no
 * arithmetic - one is a byte in the room data, the other is a row of pixels in
 * a picture drawn by somebody else in 1984 - so where they agree, both are right.
 *
 * The comparison is per doorway rather than per room on purpose. Walking the
 * heights out from one room gives every room a storey, but only if the castle
 * has no seam where a walk around it comes back one storey off, and it has
 * five of those; a doorway at a time asks the question the data can answer.
 */
function commandLevels(context, ids) {
  const rows = new Map(survey(context, ids).map((row) => [row.id, row]));
  const rooms = new Map(ids.map((id) => [id,
    readRoom(JSON.parse(readFileSync(join(context.data, roomFileName(id)), 'utf8')))]));

  /** A room of nothing but walls; see the note in `commandCheck`. */
  const bare = (row) => row.kinds.fixed.total === 0 && row.kinds.free.total === 0;
  let agree = 0;
  let skipped = 0;
  let lost = 0;
  const differ = [];
  const seen = new Set();
  for (const id of ids) {
    for (const direction of DIRECTIONS) {
      const beyond = rooms.get(id).exits[direction];
      if (beyond === false || !rooms.has(beyond)) continue;
      const key = Math.min(id, beyond) + ':' + Math.max(id, beyond);
      if (seen.has(key)) continue;
      seen.add(key);
      const here = archHeight(rooms.get(id), direction);
      const there = archHeight(rooms.get(beyond), oppositeDirection(direction));
      if (here === null || there === null) continue;
      // a room of nothing but walls looks like every other room of nothing but
      // walls, so where the map draws it is not evidence of anything
      if (!rows.get(id).found || !rows.get(beyond).found) {
        lost++;
        continue;
      }
      if (bare(rows.get(id)) || bare(rows.get(beyond))) {
        skipped++;
        continue;
      }
      const fromData = here - there;
      const fromMap = rows.get(beyond).storey - rows.get(id).storey;
      if (Math.abs(fromData - fromMap) <= SLACK) agree++;
      else differ.push({ id, beyond, direction, fromData, fromMap });
    }
  }

  console.log('doorways where the height of the two arches says the floors are '
    + 'a storey apart,\nand the map draws them a storey apart:');
  console.log('  ' + agree + ' of ' + (agree + differ.length) + ' doorways agree'
    + (skipped ? ', ' + skipped + ' left out (a room of nothing but walls at one end, '
      + 'which the map cannot place)' : '')
    + (lost ? ', ' + lost + ' left out (a room not found in the map)' : ''));
  for (const one of differ) {
    console.log('  ' + hex(one.id) + ' ' + one.direction + ' to ' + hex(one.beyond)
      + ': the arches say ' + (one.fromData/STOREY).toFixed(2)
      + ', the map draws ' + (one.fromMap/STOREY).toFixed(2));
  }

  const { storey, disagreements } = storeysFromData(rooms);
  const floors = new Map();
  for (const id of ids) {
    const floor = Math.round((storey.get(id) ?? 0)/STOREY);
    floors.set(floor, (floors.get(floor) || 0) + 1);
  }
  console.log('\nthe castle walked out from room 0x00, one doorway at a time:');
  for (const floor of [...floors.keys()].sort((a, b) => a - b)) {
    console.log('  storey ' + String(floor).padStart(3) + ': ' + floors.get(floor) + ' rooms');
  }
  if (disagreements.length) {
    console.log('  ' + disagreements.length + ' doorway(s) come back to a room that the walk '
      + 'already put on another storey:');
    for (const one of disagreements) {
      console.log('    ' + hex(one.from) + ' ' + one.direction + ' to ' + hex(one.to)
        + ': ' + (one.says/STOREY).toFixed(2) + ' against ' + (one.has/STOREY).toFixed(2));
    }
  }
}

// ---------------------------------------------------------------------------

function hex(value) {
  return '0x' + value.toString(16).toUpperCase().padStart(2, '0');
}

function parseId(text) {
  const id = /^0x/i.test(text) ? parseInt(text, 16) : parseInt(text, 10);
  if (!Number.isInteger(id) || id < 0 || id > 255) throw new Error('bad room id: ' + text);
  return id;
}

/** Every room the data directory holds, in id order. */
function castleRooms(dataDir) {
  const ids = [];
  for (let id = 0; id < 256; id++) {
    if (existsSync(join(dataDir, roomFileName(id)))) ids.push(id);
  }
  if (ids.length === 0) throw new Error('no room data in ' + dataDir + ' - run klconv emit all first');
  return ids;
}

function main(argv) {
  const command = argv[2];
  let target;
  const options = {
    data: join(ROOT, 'data'),
    map: join(ROOT, 'refs/maps/KnightLore_3.png'),
    out: null,
    scale: 2,
    plain: false,
    verbose: false
  };
  for (let at = 3; at < argv.length; at++) {
    if (!argv[at].startsWith('-') && target === undefined) target = argv[at];
    else if (argv[at] === '--data') options.data = argv[++at];
    else if (argv[at] === '--map') options.map = argv[++at];
    else if (argv[at] === '-o') options.out = argv[++at];
    else if (argv[at] === '--scale') options.scale = Number(argv[++at]);
    else if (argv[at] === '--plain') options.plain = true;
    else if (argv[at] === '--verbose') options.verbose = true;
    else throw new Error('unknown option: ' + argv[at]);
  }
  if (!['check', 'diff', 'sheet', 'levels'].includes(command)) {
    console.error('usage: klmap.js check [<id>|all] [--verbose]');
    console.error('       klmap.js diff  <id> [-o out.png] [--scale n]');
    console.error('       klmap.js sheet [-o out.png] [--plain]');
    console.error('       klmap.js levels');
    console.error('       every command takes --data dir and --map file');
    process.exit(1);
  }
  if (!existsSync(options.map)) {
    throw new Error('no map at ' + options.map + ' - refs/ is not in the repository, '
      + 'see refs/README.md');
  }

  const map = decodeMask(options.map);
  const context = {
    map,
    area: summedArea(map),
    mapFile: options.map,
    data: options.data,
    sprites: readSprites(JSON.parse(readFileSync(join(options.data, 'sprites.json'), 'utf8')))
  };
  const all = castleRooms(options.data);

  if (command === 'diff') {
    const id = parseId(target ?? '');
    commandDiff(context, id, options.out || ('diff' + String(id).padStart(3, '0') + '.png'),
      options.scale);
  } else if (command === 'sheet') {
    commandSheet(context, all, options.out || 'castle.png', options.plain);
  } else if (command === 'levels') {
    commandLevels(context, all);
  } else {
    commandCheck(context, (target === undefined || target === 'all') ? all : [parseId(target)],
      options.verbose);
  }
}

try {
  main(process.argv);
} catch (error) {
  console.error('klmap: ' + error.message);
  process.exitCode = 1;
}

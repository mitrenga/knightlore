#!/usr/bin/env node

/**
 * klrender - offline renderer for a Knight Lore room.
 *
 * It runs the same modules the game runs (`app/isoProjection.js`,
 * `app/depthSort.js`, `app/isoRaster.js`, `app/roomData.js`,
 * `app/spriteSheet.js`, `app/hero.js`) against a `data/roomNNN.json` file and
 * writes the result as a PNG, so the scene can be checked, diffed against a
 * screenshot of the original and put into a commit without opening a browser.
 *
 * `check` is the same rendering without the picture: it walks the display list
 * of every room and reports the boxes with no sprite and the sprites that leave
 * the screen, which is what a wrong anchor or a wrong room origin looks like.
 *
 * Usage:
 *   node tools/klrender/klrender.js render <id> [-o out.png] [--scale n] [--outline]
 *                                              [--no-panel] [--border] [--no-hero]
 *                                              [--hero form,dir,frame] [--at x,y,z]
 *                                              [--items [seed]]
 *                                              [--status days,lives,obj,obj,obj]
 *   node tools/klrender/klrender.js order <id>
 *   node tools/klrender/klrender.js check <id|all>
 *
 * Every command takes `--data dir` (default `data`).
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

import { readRoom, readGlobal, roomFileName, roomBoxes, ITEM } from '../../app/roomData.js';
import { IsoProjection } from '../../app/isoProjection.js';
import { IsoRaster } from '../../app/isoRaster.js';
import { DepthSort } from '../../app/depthSort.js';
import { readSprites, spriteGrid, spritePosition, spriteVisible, boxReference, screenPlacements, SCREEN_HEIGHT, FONT_SIZE, SUN_MOON, STATUS } from '../../app/spriteSheet.js';
import { HERO, newHero, heroBoxes } from '../../app/hero.js';
import { loadGame } from '../lib/workerScripts.js';
import { encodeGrey } from '../lib/png.js';

const { SpecialObjects } = loadGame();

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const INK = 255;
const PAPER = 0;

/** Reads and validates one room. */
function loadRoom(id, dataDir) {
  const file = join(dataDir, roomFileName(id));
  return readRoom(JSON.parse(readFileSync(file, 'utf8')));
}

/** Reads and validates the sprites of the game. */
function loadSprites(dataDir) {
  return readSprites(JSON.parse(readFileSync(join(dataDir, 'sprites.json'), 'utf8')));
}

/** The display list the game builds, in the same order. */
function displayList(room, hero, items) {
  const boxes = hero === false ? [] : heroBoxes(hero);
  for (const box of items || []) boxes.push(box);
  for (const box of roomBoxes(room)) boxes.push(box);
  return boxes;
}

/**
 * The collectable objects of a room, as boxes of the display list.
 *
 * They are not in the room data and cannot be: which of the eight kinds lies in
 * which room is dealt out at the start of every game, so a picture of a room can
 * only show *an* object, drawn as the game would have dealt it for the given
 * seed. They go between the hero and the room, which is where the object table
 * keeps them (`find_special_objs_here`).
 *
 * @param {object} room the room being drawn
 * @param {object} options the command line, `items` being false or a seed
 * @param {string} dataDir where `global.json` is
 * @returns {object[]} the boxes, empty when the objects are left out
 */
function roomItems(room, options, dataDir) {
  if (options.items === false) return [];
  const global = readGlobal(JSON.parse(readFileSync(join(dataDir, 'global.json'), 'utf8')));
  const specials = new SpecialObjects(global, ITEM, options.items);
  return specials.here(room.id).map((item) => ({
    graphic: item.graphic,
    x: item.x, y: item.y, z: item.z,
    sx: ITEM.radiusX*2, sy: ITEM.radiusY*2, sz: ITEM.height,
    flipH: false, flipV: false, moveable: true, ignore3D: false, part: 0,
    type: 'object', source: 'special', collision: 'collectible', motion: 'object'
  }));
}

/** The hero of a room, or false when he is left out. */
function roomHero(room, options) {
  if (options.hero === false) return false;
  return { ...newHero(room), ...options.hero };
}

/** Draws one box: its sprite when there is one, its outline otherwise. */
function drawBox(surface, projection, sprites, box, outline) {
  const grid = (sprites === false || box.graphic === undefined)
    ? false
    : spriteGrid(sprites, box.graphic, {flipHorizontal: box.flipH, flipVertical: box.flipV});
  if (outline || grid === false) {
    IsoRaster.drawBox(surface, IsoProjection.boxOutline(projection, box), INK, outline ? false : PAPER);
    return false;
  }
  const reference = boxReference(box);
  const position = spritePosition(grid, IsoProjection.point(projection, reference.x, reference.y, reference.z));
  if (!spriteVisible(grid, position)) {
    return false;                                    // the original does not draw it either
  }
  IsoRaster.drawSprite(surface, grid, position.x, position.y, INK, PAPER);
  return true;
}

/**
 * Draws the furniture of the screen. The panel is what the game loop draws
 * (`display_panel`); the decorated frame belongs to the menu screens
 * (`print_border` is only called from `display_text_list`) and is drawn here
 * only when it is asked for, to check that its pieces were extracted right.
 */
function drawScreenFrame(surface, sprites, groups, status) {
  for (const group of groups) {
    for (const piece of screenPlacements(sprites, group)) {
      for (const position of piece.positions) {
        IsoRaster.drawSprite(surface, piece.grid, position.x, position.y, INK, PAPER);
      }
    }
    // the sun in its window is not one of the panel's placements: the game
    // moves it, so the game draws it (`ScreenFrameEntity`). Here it goes in at
    // the point of its run it starts the game at
    if (group === 'panel') {
      // and only inside the window: the original blits back just that rectangle,
      // so the ends of the sun's run are cut off rather than drawn on the panel
      const window = clipped(surface, SUN_MOON.windowX,
        SCREEN_HEIGHT-SUN_MOON.windowHeight, SUN_MOON.windowWidth, SUN_MOON.windowHeight);
      for (const [graphic, x] of [[SUN_MOON.sun, SUN_MOON.firstX],
        [SUN_MOON.left, SUN_MOON.leftX], [SUN_MOON.right, SUN_MOON.rightX]]) {
        const grid = spriteGrid(sprites, graphic);
        const y = graphic === SUN_MOON.sun ? SUN_MOON.restY : 0;
        IsoRaster.drawSprite(window, grid, x, SCREEN_HEIGHT-y-grid.height, INK, PAPER);
      }
      drawStatus(surface, sprites, status);
    }
  }
}

/**
 * The rest of the panel: the word DAY and the day counter, the lives, and the
 * objects in the hero's hands.
 *
 * The picture has no game behind it, so the numbers are whatever was asked for
 * on the command line; what is being checked here is that the font came out of
 * the binary right and that every piece lands where `STATUS` says.
 */
function drawStatus(surface, sprites, status) {
  drawText(surface, sprites.fonts.day, STATUS.day, STATUS.day.text);
  drawText(surface, sprites.fonts.text, STATUS.days, digitsOf(status.days, STATUS.days.digits));
  drawText(surface, sprites.fonts.text, STATUS.lives, digitsOf(status.lives, STATUS.lives.digits));
  const lives = spriteGrid(sprites, STATUS.livesGraphic.graphic);
  IsoRaster.drawSprite(surface, lives, STATUS.livesGraphic.x,
    SCREEN_HEIGHT-STATUS.livesGraphic.y-lives.height, INK, PAPER);
  for (let slot = 0; slot < status.carried.length && slot < STATUS.carried.slots; slot++) {
    const grid = spriteGrid(sprites, status.carried[slot]);
    if (grid === false) continue;
    IsoRaster.drawSprite(surface, grid, STATUS.carried.x+slot*STATUS.carried.step,
      SCREEN_HEIGHT-STATUS.carried.y-grid.height, INK, PAPER);
  }
}

/** One row of characters of an 8x8 font, printed straight at a pixel position. */
function drawText(surface, font, field, characters) {
  characters.forEach((character, at) => {
    const rows = font[character];
    if (rows === undefined) return;
    for (let row = 0; row < rows.length; row++) {
      for (let column = 0; column < rows[row].length; column++) {
        if (rows[row][column] !== '#') continue;
        surface.pixel(field.x+at*FONT_SIZE+column, field.y+row, INK);
      }
    }
  });
}

/** A number as its digits, right aligned and with the leading zeros the original prints. */
function digitsOf(value, width) {
  return String(Math.max(value, 0) % Math.pow(10, width)).padStart(width, '0')
    .split('').map(Number);
}

/**
 * A view of a surface that only lets through what falls inside a rectangle,
 * which is how the original's window blit behaves.
 */
function clipped(surface, x0, y0, width, height) {
  const inside = (x, y) => (x >= x0 && x < x0+width && y >= y0 && y < y0+height);
  return {
    width: surface.width, height: surface.height,
    span(x, y, len, color) {
      const from = Math.max(x, x0);
      const to = Math.min(x+len, x0+width);
      if (to > from && y >= y0 && y < y0+height) {
        surface.span(from, y, to-from, color);
      }
    },
    pixel(x, y, color) {
      if (inside(x, y)) {
        surface.pixel(x, y, color);
      }
    }
  };
}

/** A grey level bitmap behaving like the surface the rasteriser draws on. */
function newSurface(width, height) {
  const pixels = new Uint8Array(width*height);
  return {
    width, height, pixels,
    span(x, y, w, color) { pixels.fill(color, y*width+x, y*width+x+w); },
    pixel(x, y, color) { pixels[y*width+x] = color; }
  };
}

/** Renders a room and reports what it cost. */
function render(id, options) {
  const room = loadRoom(id, options.data);
  const sprites = options.outline ? false : loadSprites(options.data);
  const boxes = displayList(room, roomHero(room, options),
    roomItems(room, options, options.data));
  const projection = IsoProjection.forRoom(room);

  const sortStart = performance.now();
  const order = DepthSort.order(boxes);
  const sortTime = performance.now()-sortStart;

  const surface = newSurface(IsoProjection.screenWidth, IsoProjection.screenHeight);
  const drawStart = performance.now();
  if (sprites !== false && options.screen.length) {
    drawScreenFrame(surface, sprites, options.screen, options.status);
  }
  let drawn = 0;
  for (const index of order) {
    if (drawBox(surface, projection, sprites, boxes[index], options.outline)) drawn++;
  }
  const drawTime = performance.now()-drawStart;

  writeFileSync(options.out, encodeGrey(surface, options.scale));
  console.log(`room ${id}: ${room.objects.length} objects, ${boxes.length} boxes, `
    + `ink ${room.attribute.ink}, bounds ${room.bounds.x}x${room.bounds.y}x${room.bounds.z}`);
  console.log(`${drawn} of ${boxes.length} boxes drawn as sprites`
    + (options.outline ? ' (outline mode)' : '')
    + (options.screen.length && !options.outline ? ', screen furniture: '+options.screen.join(', ') : ''));
  console.log(`sort ${sortTime.toFixed(2)} ms, draw ${drawTime.toFixed(2)} ms`);
  console.log(`written ${options.out} (${surface.width*options.scale}x${surface.height*options.scale})`);
}

/**
 * Checks the sprites against the geometry of every room.
 *
 * A box without a sprite cannot be drawn at all, and a sprite that reaches
 * outside the screen sideways would run into the next row of the original's
 * video buffer - both mean an anchor or a room origin is wrong. Reaching over
 * the top edge is not a mistake: the original clips a sprite there
 * (`print_sprite` shortens height_lines) and only skips an object once its
 * anchored bottom row is off the screen (the `cp 192` in `calc_pixel_XY`), so
 * those are counted rather than reported.
 *
 * The extent of everything drawn is printed as well, to be held against the
 * layout in NOTES-ORIGINAL.md chapter 9.
 */
function check(ids, options) {
  const sprites = loadSprites(options.data);
  const extent = {left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity};
  const problems = [];
  let boxCount = 0;
  let clipped = 0;
  let skipped = 0;
  for (const id of ids) {
    const room = loadRoom(id, options.data);
    const projection = IsoProjection.forRoom(room);
    for (const box of displayList(room, roomHero(room, options))) {
      boxCount++;
      const grid = box.graphic === undefined ? false
        : spriteGrid(sprites, box.graphic, {flipHorizontal: box.flipH, flipVertical: box.flipV});
      if (grid === false) {
        problems.push(`room ${id}: ${box.source} ${box.type} has no sprite (graphic ${box.graphic})`);
        continue;
      }
      const reference = boxReference(box);
      const position = spritePosition(grid, IsoProjection.point(projection, reference.x, reference.y, reference.z));
      const right = position.x+grid.width-1;
      const bottom = position.y+grid.height-1;
      if (position.x < 0 || right >= IsoProjection.screenWidth) {
        problems.push(`room ${id}: ${box.source} ${box.type} (graphic ${box.graphic}) is drawn at `
          + `x ${position.x} to ${right}, off the side of the screen`);
      }
      if (bottom < 0 || bottom >= IsoProjection.screenHeight) {
        skipped++;                                   // the original would not draw it at all
      } else if (position.y < 0) {
        clipped++;                                   // the original clips it at the top edge
      }
      extent.left = Math.min(extent.left, position.x);
      extent.right = Math.max(extent.right, right);
      extent.top = Math.min(extent.top, position.y);
      extent.bottom = Math.max(extent.bottom, bottom);
    }
  }
  console.log(`${ids.length} room(s), ${boxCount} boxes, every one of them with a sprite`
    + (problems.length ? ' - except the ones listed below' : ''));
  console.log(`drawn extent: x ${extent.left} to ${extent.right}, rows ${extent.top} to ${extent.bottom}`);
  console.log(`${clipped} sprites reach over the top edge and are clipped there, `
    + `${skipped} would be skipped by the original`);
  if (problems.length) {
    console.error(`\n${problems.length} problem(s):\n  ` + problems.join('\n  '));
    process.exitCode = 1;
  } else {
    console.log('check: ok');
  }
}

/** Prints the drawing order, back to front. */
function printOrder(id, options) {
  const room = loadRoom(id, options.data);
  const boxes = displayList(room, roomHero(room, options));
  const order = DepthSort.order(boxes);
  console.log('  #  box  type              source      x   y   z   sx  sy  sz');
  order.forEach((index, position) => {
    const box = boxes[index];
    console.log([
      String(position).padStart(3),
      String(index).padStart(4),
      '  '+box.type.padEnd(18),
      box.source.padEnd(11),
      String(box.x).padStart(3), String(box.y).padStart(3), String(box.z).padStart(3),
      String(box.sx).padStart(4), String(box.sy).padStart(3), String(box.sz).padStart(3)
    ].join(' '));
  });
}

/** `--status days,lives,object,object,object`, e.g. `12,3,96,99,0`. */
function parseStatus(text) {
  const parts = String(text).split(',').map(Number);
  if (parts.length < 2 || parts.some((value) => !Number.isInteger(value) || value < 0)) {
    throw new Error('--status is days,lives[,object,object,object], got: '+text);
  }
  return {days: parts[0], lives: parts[1], carried: parts.slice(2, 2+STATUS.carried.slots)};
}

/** `--hero form,direction,frame`, e.g. `werewolf,2,3`. */
function parseHero(text) {
  const [form, direction, frame] = text.split(',');
  if (form !== 'human' && form !== 'werewolf') {
    throw new Error('--hero starts with human or werewolf, got: '+text);
  }
  const hero = {form};
  if (direction !== undefined) {
    hero.direction = Number(direction);
    if (!(hero.direction >= 0 && hero.direction < HERO.directions.length)) {
      throw new Error('--hero direction is 0 to '+(HERO.directions.length-1)+', got: '+direction);
    }
  }
  if (frame !== undefined) {
    hero.frame = Number(frame);
    if (!(hero.frame >= 0 && hero.frame < HERO.frames)) {
      throw new Error('--hero frame is 0 to '+(HERO.frames-1)+', got: '+frame);
    }
  }
  return hero;
}

/** `--at x,y,z`: where in the room the hero stands, in world units. */
function parsePlace(text) {
  const parts = text.split(',').map(Number);
  if (parts.length !== 3 || parts.some((value) => !Number.isInteger(value))) {
    throw new Error('--at takes three whole numbers x,y,z, got: '+text);
  }
  return {x: parts[0], y: parts[1], z: parts[2]};
}

function main(argv) {
  const command = argv[2];
  const target = argv[3];
  const id = Number(target);
  const all = command === 'check' && target === 'all';
  if (!['render', 'order', 'check'].includes(command) || !(all || Number.isInteger(id))) {
    console.error('usage: klrender.js render <id> [-o out.png] [--scale n] [--outline]');
    console.error('                                [--no-panel] [--border] [--no-hero]');
    console.error('                                [--hero form,dir,frame] [--at x,y,z]');
    console.error('                                [--items [seed]] [--status days,lives,o,o,o]');
    console.error('       klrender.js order <id>');
    console.error('       klrender.js check <id|all>');
    console.error('       every command takes --data dir');
    process.exit(1);
  }
  const options = {
    out: `room${String(id).padStart(3, '0')}.png`,
    outline: false,
    screen: ['panel'],
    hero: {},
    items: false,
    // what the panel says: the picture has no game behind it, so it is told
    status: {days: 0, lives: 5, carried: [0, 0, 0]},
    scale: 1,
    data: join(ROOT, 'data')
  };
  for (let a = 4; a < argv.length; a++) {
    if (argv[a] === '-o') options.out = argv[++a];
    else if (argv[a] === '--outline') options.outline = true;
    else if (argv[a] === '--no-panel') options.screen = options.screen.filter((group) => group !== 'panel');
    else if (argv[a] === '--border') options.screen = options.screen.concat(['border']);
    else if (argv[a] === '--no-hero') options.hero = false;
    else if (argv[a] === '--hero') options.hero = parseHero(argv[++a]);
    else if (argv[a] === '--at') options.hero = {...(options.hero || {}), ...parsePlace(argv[++a])};
    else if (argv[a] === '--items') options.items = Number(argv[a+1]) >= 0 ? Number(argv[++a]) : 0;
    else if (argv[a] === '--status') options.status = parseStatus(argv[++a]);
    else if (argv[a] === '--scale') options.scale = Number(argv[++a]);
    else if (argv[a] === '--data') options.data = argv[++a];
    else {
      console.error('unknown option: '+argv[a]);
      process.exit(1);
    }
  }
  if (command === 'check') {
    check(all ? castleRooms(options.data) : [id], options);
    return;
  }
  if (command === 'order') {
    printOrder(id, options);
    return;
  }
  render(id, options);
}

/** Every room the data directory holds, in id order. */
function castleRooms(dataDir) {
  const ids = [];
  for (let id = 0; id < 256; id++) {
    if (existsSync(join(dataDir, roomFileName(id)))) ids.push(id);
  }
  if (ids.length === 0) throw new Error('no room data in '+dataDir+' - run klconv emit all first');
  return ids;
}

try {
  main(process.argv);
} catch (error) {
  console.error('klrender: '+error.message);
  process.exitCode = 1;
}

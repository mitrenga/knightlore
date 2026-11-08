#!/usr/bin/env node

/**
 * klwalk - offline hero of a Knight Lore room.
 *
 * It runs the very modules the game worker runs (`app/physics.js`,
 * `app/objectTable.js` and the rest, through `tools/lib/workerScripts.js`) over
 * a `data/roomNNN.json` file, so how the hero walks, climbs and falls - and
 * since M5 what the room does around him - can be measured, replayed and put
 * into a commit without opening a browser; the same thing `klrender` does for
 * the picture.
 *
 * `walk` runs a program of held keys and reports where the hero ends up;
 * `check` runs a fixed set of walks in one room or in all 128 and reports the
 * two invariants that must hold in every one of them: nothing ever leaves the
 * room, and the hero is never inside an object. `life` leaves the hero standing
 * and watches the room instead: what moves, how far it gets, what kills him.
 * `worker` runs a walk a third way - through `app/gameWorker.js` itself, its
 * message protocol and its clock - and holds the result against `walk`, which
 * is what says the game and the tools are running one physics and not two.
 * `travel` runs one through the worker across several rooms, this tool standing
 * in for the room model, which is the whole of the game's M7 wiring. `items`
 * picks every one of the 32 collectable objects up and puts it down again, and
 * `win` plays both endings of the game: the fortieth day, and fourteen objects
 * into the cauldron.
 *
 * Usage:
 *   node tools/klwalk/klwalk.js walk <id> [--keys program] [--ticks n]
 *                                         [--at x,y,z] [--facing 0-3]
 *                                         [--method directional|rotational]
 *                                         [--trace] [--png out.png]
 *   node tools/klwalk/klwalk.js check <id|all> [--ticks n]
 *   node tools/klwalk/klwalk.js life <id|all> [--ticks n] [--trace]
 *   node tools/klwalk/klwalk.js doors <id|all> [--ticks n]
 *   node tools/klwalk/klwalk.js worker <id> [--keys program] [--ticks n]
 *   node tools/klwalk/klwalk.js travel <id> [--keys program] [--ticks n]
 *   node tools/klwalk/klwalk.js items <id|all>
 *   node tools/klwalk/klwalk.js win
 *
 * A key program is a comma separated list of `KEYS` or `KEYS*count`, where the
 * keys are `N` `E` `S` `W` (the four isometric directions) and `J` (jump), with
 * `-` for no key at all. `--keys "N*20,NJ,N*8"` walks north for twenty ticks,
 * jumps, and keeps walking. In the rotational method the same five keys are the
 * original's first five bits: `W` and `E` turn, `N` (also spelled `F`) walks
 * forward and `S` (also `P`) is the pick up key. `T` is the sixth bit, the pick
 * up key of the directional method - down is a direction there, so the original
 * gives that method a key of its own (`chk_pickup_drop`).
 *
 * Every command takes `--data dir` (default `data`).
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { readRoom, readGlobal, roomFileName, roomBoxes, DIRECTIONS, ITEM } from '../../app/roomData.js';
import { readSprites, handlerTable } from '../../app/spriteSheet.js';
import { HERO, newHero } from '../../app/hero.js';
import { loadGame, startGameWorker } from '../lib/workerScripts.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { Physics, ObjectMotion, HeroController, DayNight, SpecialObjects, ObjectTable } = loadGame();

/**
 * `seed_1` for every run of every tool: the objects are always dealt out from
 * the same place in the ring and the cauldron always asks in the same order, so
 * a run can be repeated and put into a commit. The game itself picks it at
 * random, which is the only difference.
 */
const SEED = 0;

/**
 * Frames the hero spends materialising before the keys are his
 * (`upd_120_to_126`: eight sparkles, one every other frame), plus a little to
 * let him land.
 */
const APPEAR_TICKS = 20;

/** How long `win` is willing to wait for either end of a game. */
const WIN_TICKS = 40000;

/** A room with nothing in it that can kill the hero, for the clock to run in. */
const WIN_ROOM = 2;

/** Where the hero stands to drop an object in: on top of the cauldron itself. */
const WIN_STAND = {x: 59, y: 59, z: 24};

/** The keys a program letter stands for. */
const KEYS = {
  N: 'forward', S: 'pickup', E: 'right', W: 'left',
  F: 'forward', P: 'pickup', R: 'right', L: 'left', J: 'jump',
  // the sixth bit: the pick up key of the eight-way method, which cannot use
  // `pickup` because down is a direction there (`chk_pickup_drop`)
  T: 'take'
};

/**
 * Frames after an arch has let go of the hero in which he may still be outside
 * the room: enough for a jump taken in a doorway to come back down.
 */
const ARCH_GRACE = 4;

/** The hero's direction number per side of the room (`off_CA32`). */
const DIRECTION_INDEX = {west: 0, east: 1, north: 2, south: 3};

/**
 * The key of the directional method that walks him at each wall. The room is
 * drawn with north running up and to the right, so the key that points up on
 * the keyboard walks him west (`turnTowards()`).
 */
const DIRECTION_KEYS = {west: 'forward', north: 'right', east: 'pickup', south: 'left'};

/** Reads and validates one room. */
function loadRoom(id, dataDir) {
  return readRoom(JSON.parse(readFileSync(join(dataDir, roomFileName(id)), 'utf8')));
}

/** The jump table of the game, read once out of the sprite sheet. */
let handlers = false;
function gameHandlers(dataDir) {
  if (handlers === false) {
    handlers = handlerTable(readSprites(JSON.parse(
      readFileSync(join(dataDir, 'sprites.json'), 'utf8'))));
  }
  return handlers;
}

/** The collectable objects and the cauldron's list, read once (`data/global.json`). */
let globalData = false;
function gameGlobal(dataDir) {
  if (globalData === false) {
    globalData = readGlobal(JSON.parse(readFileSync(join(dataDir, 'global.json'), 'utf8')));
  }
  return globalData;
}

/**
 * The room as the game runs it: an object table with the hero in the first two
 * rows and everything the room is made of behind him. It is the same table the
 * worker builds, filled from the same `roomBoxes()`.
 */
function newTable(room, start, dataDir) {
  const controller = new HeroController(HERO);
  const specials = new SpecialObjects(gameGlobal(dataDir), ITEM, SEED);
  const table = new ObjectTable(controller, new DayNight(), specials);
  table.setHandlers(gameHandlers(dataDir));
  table.setRoom(roomFor(room), {...newHero(room), ...start});
  return table;
}

/** Turns a key program into one set of held keys per tick. */
function parseKeys(program) {
  const ticks = [];
  if (!program) return ticks;
  for (const group of program.split(',')) {
    const [letters, count] = group.split('*');
    const keys = {};
    for (const letter of letters.trim().toUpperCase()) {
      if (letter === '-') continue;
      if (!(letter in KEYS)) throw new Error('unknown key "'+letter+'" in --keys');
      keys[KEYS[letter]] = true;
    }
    const times = count === undefined ? 1 : Number(count);
    if (!(times > 0)) throw new Error('bad repeat count in --keys: '+group);
    for (let t = 0; t < times; t++) ticks.push(keys);
  }
  return ticks;
}

/**
 * A spot on the floor with nothing in it, as near the middle of the room as
 * there is one. The hero of M3 appears in the middle because that is where the
 * original puts him when the game starts (`plyr_spr_init_data`), but two thirds
 * of the rooms have something standing there - a room is entered through an
 * arch, not dropped into. Until the arches work (M7) the checks need somewhere
 * to put him, and this is the nearest honest answer.
 */
function freeStart(room, boxes) {
  const middle = newHero(room);
  const size = {x: HERO.radiusX*2, y: HERO.radiusY*2, z: HERO.height};
  let best = false;
  for (let x = 1; x+size.x < room.bounds.x; x += 2) {
    for (let y = 1; y+size.y < room.bounds.y; y += 2) {
      const box = {x, y, z: 0, sx: size.x, sy: size.y, sz: size.z};
      if (occupied(box, boxes) !== false) continue;
      const distance = Math.abs(x-middle.x)+Math.abs(y-middle.y);
      if (best === false || distance < best.distance) best = {x, y, z: 0, distance};
    }
  }
  return best;
}

/**
 * What the box is inside, if anything. Empty slots of the table and the parts
 * that are picture only are passed over, exactly as the collision passes over
 * them (`is_object_not_ignored`).
 */
function occupied(box, boxes, self) {
  for (let o = 0; o < boxes.length; o++) {
    const other = boxes[o];
    if (other === box || o === self || other.ignore3D || other.graphic === 0) continue;
    if (Physics.overlap(box, 0, other, 'x', 'sx')
      && Physics.overlap(box, 0, other, 'y', 'sy')
      && Physics.overlap(box, 0, other, 'z', 'sz')) {
      return other;
    }
  }
  return false;
}

/**
 * Is the hero's box inside the room and clear of everything in it? Since M5 the
 * same question is asked of everything else in the room as well, because a
 * guard that walks into a wall or a platform that slides into a block would be
 * just as wrong.
 */
function invariants(table, known, start, inDoorway) {
  const problems = [];
  for (const entry of table.entries) {
    if (entry.graphic === 0 || entry.ignore3D) continue;
    // The hero is allowed out of the room while an arch has hold of him: that is
    // what the arches turn the walls off for (`adj_dX_for_out_of_bounds`), and
    // walking out through one is how a room is left. It lasts a few frames
    // longer than the flag does, because a jump taken in a doorway carries him
    // outside and out of the arch's reach - the arch only takes hold of what is
    // within four units of its own floor - and the walls come back the moment he
    // lands. Everything else in a room is in the room, always
    if (entry.index < 2 && inDoorway > 0) continue;
    // the walls, the arches and the gates of a room stand where the data puts
    // them, which is partly outside the room's own bounds - they are the room.
    // Only a box that has left the room it was born in is wrong
    const home = start === undefined ? false : start[entry.index];
    if (home !== false && entry.index > 1
      && entry.x === home.x && entry.y === home.y && entry.z === home.z) {
      continue;
    }
    const what = entry.index === 0 ? 'the hero' : entry.type;
    const out = outside(entry, table.bounds);
    const born = home === false ? '' : outside({...entry, ...home}, table.bounds);
    for (const axis of out) {
      if (born.indexOf(axis) < 0) {
        problems.push(what+' outside the room in '+axis+' at '+place(entry));
      }
    }
    const inside = occupied(entry, table.entries, entry.index);
    if (inside !== false && !(known && known.has(entry.index+':'+inside.index))) {
      problems.push(what+' inside '+inside.type+' at '+place(entry));
    }
  }
  return problems;
}

/**
 * The axes a box sticks out of the room on. The original wants a box wholly
 * inside the room in X and Y and above the floor in Z; there is no ceiling.
 */
function outside(box, bounds) {
  let axes = '';
  if (box.x <= 0 || box.x+box.sx >= bounds.x) axes += 'x';
  if (box.y <= 0 || box.y+box.sy >= bounds.y) axes += 'y';
  if (box.z < 0) axes += 'z';
  return axes;
}

/** Where everything in the table stands, by index. */
function positionsOf(table) {
  return table.entries.map((entry) => ({x: entry.x, y: entry.y, z: entry.z}));
}

/** Which pairs of the table are inside each other, as `index:index` keys. */
function overlapping(table) {
  const pairs = new Set();
  for (const entry of table.entries) {
    if (entry.graphic === 0 || entry.ignore3D) continue;
    const inside = occupied(entry, table.entries, entry.index);
    if (inside !== false) pairs.add(entry.index+':'+inside.index);
  }
  return pairs;
}

/** The hero's position as one short string. */
function place(state) {
  return '('+state.x+','+state.y+','+state.z+')';
}

/**
 * Runs a walk and returns what happened.
 *
 * @param {object} room the room to walk in
 * @param {object} options `{keys, ticks, method, start, data}`
 * @returns {object} `{table, hero, problems, maxZ, trace, startBlocked}`
 */
function simulate(room, options) {
  const table = newTable(room, options.start || {}, options.data);
  let hero = table.hero.state;
  const program = parseKeys(options.keys);
  const ticks = options.ticks || program.length || 40;
  const problems = [];
  const trace = [];

  // a room whose middle is occupied starts the hero inside something; that is
  // the data's business, not the physics', so it is reported apart
  const startBlocked = occupied(hero, table.entries, 0) !== false;
  // a few rooms have two boxes in one place in the data itself; those pairs are
  // not the physics failing and are not reported when they turn up again
  const born = overlapping(table);
  let home = positionsOf(table);

  let maxZ = hero.z;
  let maxStandZ = 0;
  let deaths = 0;
  let lives = table.lives;
  let left = false;
  let inDoorway = 0;
  for (let tick = 0; tick < ticks; tick++) {
    const keys = program.length ? program[Math.min(tick, program.length-1)] : {};
    table.tick({ ...keys, method: options.method || 'directional' });
    if (table.lives !== lives) {
      deaths++;
      lives = table.lives;
      home = positionsOf(table);
      // the room is built again on a death, and the hero with it: his state is
      // a new object, and the old one would freeze where he fell
      hero = table.hero.state;
    }
    maxZ = Math.max(maxZ, hero.z);
    if (hero.standingOn.length && hero.dz === 0) {
      maxStandZ = Math.max(maxStandZ, hero.z);
    }
    trace.push({ tick: tick+1, ...hero });
    if (table.exit !== false) {
      // he has walked out through an arch, and there is no next room here: the
      // walk ends at the doorway rather than carrying on into nothing. Walking
      // from room to room is what `doors` does
      left = table.exit;
      break;
    }
    inDoorway = hero.atArch || hero.entering > 0 ? ARCH_GRACE : Math.max(0, inDoorway-1);
    if (!startBlocked) {
      // only what the room did to itself counts; a room whose data already has
      // two boxes in one place is not the physics failing
      for (const problem of invariants(table, born, home, inDoorway)) {
        problems.push('tick '+(tick+1)+': '+problem);
      }
    }
  }
  return { table, hero, problems, maxZ, maxStandZ, trace, startBlocked, deaths, left };
}

/** `walk`: one program, printed. */
function walk(id, options) {
  const room = loadRoom(id, options.data);
  const start = {};
  var moved = false;
  if (options.at) {
    const [x, y, z] = options.at.split(',').map(Number);
    Object.assign(start, {x, y, z});
  } else {
    const free = freeStart(room, roomBoxes(room));
    const middle = newHero(room);
    if (free !== false && (free.x !== middle.x || free.y !== middle.y)) {
      Object.assign(start, {x: free.x, y: free.y, z: free.z});
      moved = true;
    }
  }
  if (options.facing !== false) start.direction = options.facing;

  const result = simulate(room, {...options, start});
  const state = result.hero;

  if (options.trace) {
    console.log('tick  x    y    z    dz  dir frame  state');
    for (const step of result.trace) {
      console.log(String(step.tick).padStart(4)
        +String(step.x).padStart(5)+String(step.y).padStart(5)+String(step.z).padStart(5)
        +String(step.dz).padStart(4)
        +'  '+HERO.directions[step.direction].slice(0, 1).toUpperCase()
        +String(step.frame).padStart(6)
        +'   '+(step.jumping ? 'jumping' : (step.blockedZ ? 'standing' : 'falling'))
        +(step.blockedX || step.blockedY ? ' blocked' : ''));
    }
    console.log('');
  }

  console.log('room '+id+', '+result.trace.length+' ticks, '+(options.method || 'directional')
    +(options.keys ? ', keys '+options.keys : ', no keys'));
  console.log('  start  '+place(newTable(room, start, options.data).hero.state)
    +(moved ? '  (the middle of the room is occupied, so he starts beside it)' : '')
    +(result.startBlocked ? '  (inside an object: nothing here can move)' : ''));
  console.log('  end    '+place(state)+'  facing '+HERO.directions[state.direction]
    +', frame '+state.frame+', '+(state.jumping ? 'in a jump' : (state.blockedZ ? 'standing' : 'falling')));
  console.log('  highest z reached '+result.maxZ+' ('+(result.maxZ/room.cube.z).toFixed(1)+' cubes)');
  if (state.standingOn.length) {
    console.log('  standing on '+state.standingOn.map((o) => result.table.entries[o].type).join(', '));
  }
  if (result.deaths) {
    console.log('  killed '+result.deaths+' time(s), '+result.table.lives+' lives left');
  }
  if (result.left !== false) {
    console.log('  walked out by the '+result.left.direction+' wall into room '
      +result.left.roomId+' after '+result.trace.length+' ticks');
  }
  console.log('  '+(result.problems.length ? result.problems.length+' PROBLEMS' : 'no problems'));
  for (const problem of result.problems) console.log('    '+problem);

  if (options.png) {
    renderPNG(id, state, options);
  }
  process.exitCode = result.problems.length ? 1 : 0;
}

/** Draws where the hero ended up, by handing the position to klrender. */
function renderPNG(id, state, options) {
  const args = [join(ROOT, 'tools', 'klrender', 'klrender.js'), 'render', String(id),
    '-o', options.png, '--data', options.data,
    '--hero', [state.form, state.direction, state.frame].join(','),
    '--at', [state.x, state.y, state.z].join(',')];
  const run = spawnSync(process.execPath, args, {encoding: 'utf8'});
  process.stdout.write(run.stdout || '');
  if (run.status !== 0) {
    process.stderr.write(run.stderr || '');
    throw new Error('klrender failed');
  }
}

/**
 * `check`: the walks every room has to survive. Nothing here is about a
 * particular room - it is the physics that is being checked, over all 128 sets
 * of geometry the castle has to offer.
 */
function check(ids, options) {
  const ticks = options.ticks || 60;
  const walks = [
    {name: 'stand', keys: '-'},
    {name: 'north', keys: 'N'},
    {name: 'east', keys: 'E'},
    {name: 'south', keys: 'S'},
    {name: 'west', keys: 'W'},
    {name: 'jump north', keys: 'NJ'},
    {name: 'jump east', keys: 'EJ'},
    {name: 'jump south', keys: 'SJ'},
    {name: 'jump west', keys: 'WJ'}
  ];

  let failed = 0;
  let moved = 0;
  let climbed = 0;
  let noRoom = 0;
  let doorways = 0;
  let highest = {z: -1, id: -1};
  for (const id of ids) {
    const room = loadRoom(id, options.data);
    const start = freeStart(room, roomBoxes(room));
    if (start === false) {
      noRoom++;
      console.log('room '+String(id).padStart(3)+'  no free floor to start the hero on');
      continue;
    }
    const middle = newHero(room);
    if (start.x !== middle.x || start.y !== middle.y) moved++;

    const problems = [];
    let maxZ = 0;
    let maxStandZ = 0;
    for (const one of walks) {
      const result = simulate(room, {keys: one.keys, ticks, method: 'directional', start,
        data: options.data});
      maxZ = Math.max(maxZ, result.maxZ);
      maxStandZ = Math.max(maxStandZ, result.maxStandZ);
      if (result.left !== false) doorways++;
      for (const problem of result.problems) problems.push(one.name+': '+problem);
    }
    if (maxStandZ > 0) climbed++;
    if (maxZ > highest.z) highest = {z: maxZ, id};
    if (problems.length) {
      failed++;
      console.log('room '+String(id).padStart(3)+'  '+problems.length+' problems');
      for (const problem of problems.slice(0, 8)) console.log('    '+problem);
      if (problems.length > 8) console.log('    ... and '+(problems.length-8)+' more');
    } else if (ids.length === 1) {
      console.log('room '+id+': all '+walks.length+' walks clean from ('+start.x+','+start.y+',0)'
        +', highest z '+maxZ+', highest he stood on '+maxStandZ);
    }
  }
  if (ids.length > 1) {
    console.log(ids.length+' rooms, '+walks.length+' walks each, '+ticks+' ticks per walk');
    console.log('  '+(ids.length-failed-noRoom)+' clean, '+failed+' with problems'
      +(noRoom ? ', '+noRoom+' with nowhere to stand' : ''));
    console.log('  '+moved+' rooms have something standing in the middle, so the hero started aside');
    console.log('  '+doorways+' walks ended by walking out through a doorway');
    console.log('  '+climbed+' rooms he climbed onto something in');
    console.log('  highest he got: z '+highest.z+' in room '+highest.id);
  }
  process.exitCode = failed ? 1 : 0;
}

/**
 * `life`: the room with nobody playing. The hero is stood in the nearest free
 * spot and left alone, and what the room does around him is reported - which is
 * the whole of M5 in one number per object.
 */
function life(ids, options) {
  const ticks = options.ticks || 200;
  let moving = 0;
  let killers = 0;
  let quiet = 0;
  const behaviours = {};
  const unhandled = {};

  for (const id of ids) {
    const room = loadRoom(id, options.data);
    const free = freeStart(room, roomBoxes(room));
    if (free === false) {
      console.log('room '+String(id).padStart(3)+'  no free floor to stand the hero on');
      continue;
    }
    const table = newTable(room, free, options.data);
    const born = overlapping(table);
    let start = positionsOf(table);
    const home = positionsOf(table);
    const travelled = table.entries.map(() => 0);
    // an empty slot of the table is not a thing that vanished: the two slots a
    // room keeps for collectable objects are usually empty from the start
    const bornGraphic = table.entries.map((entry) => entry.graphic);
    const problems = [];
    let deaths = 0;
    let lives = table.lives;
    let doorway = 0;

    for (let tick = 0; tick < ticks; tick++) {
      table.tick({method: 'directional'});
      if (table.lives !== lives) {
        deaths++;
        lives = table.lives;
        // the room is built again on a death, so where things started is new
        start = positionsOf(table);
      }
      table.entries.forEach((entry, e) => {
        travelled[e] = Math.max(travelled[e], Math.abs(entry.x-start[e].x)
          + Math.abs(entry.y-start[e].y) + Math.abs(entry.z-start[e].z));
      });
      doorway = table.hero.state.atArch || table.hero.state.entering > 0
        ? ARCH_GRACE : Math.max(0, doorway-1);
      for (const problem of invariants(table, born, home, doorway)) {
        problems.push('tick '+(tick+1)+': '+problem);
      }
    }

    const movers = [];
    table.entries.forEach((entry, e) => {
      if (e < 2 || entry.motion === 'static' || entry.ignore3D
        || (entry.graphic === 0 && bornGraphic[e] === 0)) return;
      behaviours[entry.type] = (behaviours[entry.type] || 0)+1;
      var vanished = entry.graphic === 0 && bornGraphic[e] !== 0;
      if (travelled[e] > 0 || vanished) {
        movers.push(entry.type+' '+(vanished ? 'gone' : travelled[e]));
      }
    });
    for (const name of Object.keys(table.unhandled)) unhandled[name] = true;
    if (movers.length) moving++; else quiet++;
    if (deaths) killers++;

    if (ids.length === 1 || problems.length || options.trace) {
      console.log('room '+String(id).padStart(3)+'  '+ticks+' ticks, '
        +(table.dayNight.night() ? 'night' : 'day')+', '
        +(deaths ? deaths+' death(s), ' : 'nobody died, ')
        +(movers.length ? movers.join(', ') : 'nothing moved'));
      for (const problem of problems.slice(0, 8)) console.log('    '+problem);
      if (problems.length > 8) console.log('    ... and '+(problems.length-8)+' more');
    }
    if (problems.length) process.exitCode = 1;
  }

  if (ids.length > 1) {
    console.log(ids.length+' rooms, '+ticks+' ticks each, nobody at the keys');
    console.log('  '+moving+' rooms with something moving in them, '+quiet+' still');
    console.log('  '+killers+' rooms the hero died in without taking a step');
    console.log('  behaviours seen: '+Object.keys(behaviours).sort().join(', '));
    console.log('  '+(Object.keys(unhandled).length
      ? 'NO HANDLER FOR: '+Object.keys(unhandled).sort().join(', ')
      : 'every graphic number in the castle has a handler'));
  }
}

/**
 * `doors`: the arches, both ways.
 *
 * For every doorway of every room it does what a player does: it puts the hero
 * in the doorway as though he had just come in through it - which is
 * `ObjectTable.enterRoom()`, the very routine the game uses - walks him back out
 * of it, and then does the same from the other side. A doorway passes when the
 * hero leaves by the wall he was walking at, arrives in the room the data says
 * is behind it, arrives standing in that room's own arch and not inside
 * anything, and gets out again.
 *
 * Two kinds of doorway cannot be walked straight back through, and neither is a
 * fault: a **drop**, where the arch of the room behind is up on a ledge and the
 * hero falls off the step into the room, so the way back wants climbing rather
 * than one held key; and a **portcullis**, where he is crushed if he dawdles in
 * the gateway. Both are counted and named rather than called failures.
 *
 * This is the whole of M7 in a handful of numbers: the exits, the entry
 * position, the height the arch hands him in at, and the state that has to
 * survive the trip.
 */
function doors(ids, options) {
  // long enough to wait out a portcullis: three doorways of the castle have one
  // hanging in them, and it goes back up on a one-in-thirty-two chance a frame
  const ticks = options.ticks || 200;
  const rooms = new Set(ids);
  let checked = 0;
  let attempted = 0;
  let walked = 0;
  let drops = 0;
  let crushed = 0;
  let raised = 0;
  let outside = 0;
  const problems = [];

  for (const id of ids) {
    const room = loadRoom(id, options.data);
    for (const direction of DIRECTIONS) {
      const behind = room.exits[direction];
      if (behind === false) continue;
      checked++;
      if (!rooms.has(behind)) outside++;
      const trip = walkThrough(room, direction, options, ticks);
      for (const problem of trip.problems) {
        problems.push('room ' + id + ' ' + direction + ': ' + problem);
      }
      for (const leg of trip.legs) {
        attempted++;
        if (leg.out !== false) walked++;
        else if (leg.died) crushed++;
        else if (leg.dropped) drops++;
      }
      if (trip.legs.length > 1 && trip.legs[0].from.z !== trip.legs[1].from.z) raised++;
    }
  }

  console.log(checked + ' doorways in ' + ids.length + ' rooms, walked out of both sides, '
    + ticks + ' ticks each');
  console.log('  ' + walked + ' of ' + attempted + ' walks came out where the data says'
    + (attempted < checked * 2 ? ', ' + (checked * 2 - attempted)
      + ' not tried because the way in failed' : ''));
  console.log('  ' + drops + ' walks are a drop into the room and want climbing to come back');
  console.log('  ' + crushed + ' walks end under a portcullis');
  console.log('  ' + raised + ' doorways whose two sides are at different heights');
  if (outside) console.log('  ' + outside + ' doorways lead out of the rooms given');
  console.log('  ' + (problems.length ? problems.length + ' PROBLEMS' : 'no problems'));
  for (const problem of problems.slice(0, 20)) console.log('    ' + problem);
  if (problems.length > 20) console.log('    ... and ' + (problems.length - 20) + ' more');
  process.exitCode = problems.length ? 1 : 0;
}

/**
 * Walks one doorway from both sides.
 *
 * @param {object} room the room to leave
 * @param {string} direction the wall to leave by
 * @param {object} options the command line
 * @param {number} ticks how long to give him each way
 * @returns {object} `{problems, legs}`
 */
function walkThrough(room, direction, options, ticks) {
  const problems = [];
  const legs = [];
  const table = newTable(room, {}, options.data);

  // he comes in through the very doorway he is about to leave by, turns round
  // and walks back out of it
  let here = room;
  let wall = direction;
  for (let side = 0; side < 2; side++) {
    const from = arrive(table, here, wall, options);
    const hero = table.hero.state;
    const inside = occupied(hero, table.entries, 0);
    if (inside !== false) {
      problems.push('he arrived in room ' + here.id + ' inside ' + inside.type
        + ' at ' + place(hero));
    }
    const arch = ObjectTable.archInWall(roomFor(here), wall);
    if (arch !== false && arch.z !== from.z) {
      problems.push('he arrived in room ' + here.id + ' at z ' + from.z + ', its '
        + wall + ' arch is at z ' + arch.z);
    }
    const leg = leave(table, wall, ticks);
    legs.push({...leg, from});
    if (leg.out === false) {
      if (!leg.died && !leg.dropped) {
        problems.push('he never got out of room ' + here.id + ' by the ' + wall
          + ' wall (he ended at ' + place(hero) + ')');
      }
      break;
    }
    if (leg.out.direction !== wall) {
      problems.push('he left room ' + here.id + ' by the ' + leg.out.direction
        + ' wall, walking at the ' + wall + ' one');
    }
    if (leg.out.roomId !== here.exits[wall]) {
      problems.push('he came out of room ' + here.id + ' in room ' + leg.out.roomId
        + ', the data says ' + here.exits[wall]);
      break;
    }
    here = loadRoom(leg.out.roomId, options.data);
    wall = ObjectTable.opposite[wall];
  }
  return {problems, legs};
}

/**
 * Puts the hero in a doorway of the room as though he had just walked in through
 * it, which is what `exit_screen` leaves behind and what
 * `adjust_plyr_xyz_for_room_size` makes of it: in the middle of the opening,
 * facing into the room, with three frames of walking in still owed.
 */
function arrive(table, room, wall, options) {
  table.exit = {
    roomId: room.id,
    direction: ObjectTable.opposite[wall],
    start: {enter: wall, offset: 0, z: 0, form: 'human',
      direction: DIRECTION_INDEX[ObjectTable.opposite[wall]],
      frame: 2, entering: ObjectTable.enteringFrames}
  };
  table.enterRoom(roomFor(room));
  // a hero in a doorway is walking, not materialising: the sparkles belong to
  // the start of a game and to a death, and `upd_127` has long since brought
  // him out of them
  for (const half of [table.entries[0], table.entries[1]]) {
    half.graphic = half.spare;
  }
  const hero = table.hero.state;
  return {x: hero.x, y: hero.y, z: hero.z};
}

/**
 * Holds the one key that walks the hero at the given wall until he has left the
 * room, or until the ticks run out.
 *
 * @param {ObjectTable} table the room he is in
 * @param {string} wall the wall to walk at
 * @param {number} ticks how long to give him
 * @returns {object} `{out, died, dropped}` - the exit the table reported or
 *   false, whether something killed him on the way, and whether he fell below
 *   the doorway he started in
 */
function leave(table, wall, ticks) {
  const keys = {[DIRECTION_KEYS[wall]]: true, method: 'directional'};
  const hero = table.hero.state;
  const from = hero.z;
  const lives = table.lives;
  let dropped = false;
  for (let tick = 0; tick < ticks; tick++) {
    table.tick(keys);
    if (table.exit !== false) return {out: table.exit, died: false, dropped};
    if (hero.z < from) dropped = true;
    if (table.lives !== lives) return {out: false, died: true, dropped};
  }
  return {out: false, died: hero.destroyed, dropped};
}

/** A room as the object table takes it. */
function roomFor(room) {
  return {id: room.id, bounds: room.bounds, exits: room.exits, boxes: roomBoxes(room)};
}

/**
 * `worker`: the same walk again, but driven through `app/gameWorker.js` - its
 * `init`/`controls` protocol and its own 80 ms clock - and compared tick by tick
 * with the direct run. They have to agree exactly: the worker is not allowed to
 * be a second implementation of anything.
 */
function worker(id, options) {
  const room = loadRoom(id, options.data);
  const free = freeStart(room, roomBoxes(room));
  const middle = newHero(room);
  const start = free === false ? {} : {x: free.x, y: free.y, z: free.z};
  const hero = { ...middle, ...start };
  const program = parseKeys(options.keys);
  const ticks = options.ticks || program.length || 40;

  const wanted = simulate(room, {keys: options.keys, ticks, method: options.method, start,
    data: options.data});
  const got = [];
  let held = {};

  return new Promise((resolve) => {
    const post = startGameWorker((message) => {
      if (message.id === 'exit') {
        // he walked out through an arch. There is no model here to hand him the
        // next room, and the direct walk stopped at the same tick
        post({id: 'reset'});
        resolve(report(id, wanted, got, options));
        return;
      }
      if (message.id !== 'update') return;
      const snapshot = message.snapshot;
      if (snapshot.tick > 0) got.push(snapshot.hero);
      if (snapshot.tick >= ticks) {
        post({id: 'reset'});
        resolve(report(id, wanted, got, options));
        return;
      }
      // the keys of the tick about to be run
      const keys = program.length ? program[Math.min(snapshot.tick, program.length-1)] : {};
      for (const action of ['left', 'right', 'forward', 'jump', 'pickup', 'take']) {
        const value = !!keys[action];
        if (value !== !!held[action]) post({id: 'controls', action, value});
      }
      held = keys;
    });
    post({id: 'init', spec: HERO, item: ITEM, global: gameGlobal(options.data), seed: SEED,
      hero, roomId: room.id, bounds: room.bounds,
      exits: room.exits, boxes: roomBoxes(room), handlers: gameHandlers(options.data),
      method: options.method});
  });
}

/** Prints how the two runs compare. */
function report(id, wanted, got, options) {
  const differences = [];
  for (let tick = 0; tick < Math.min(wanted.trace.length, got.length); tick++) {
    const one = wanted.trace[tick];
    const two = got[tick];
    for (const field of ['x', 'y', 'z', 'direction', 'frame', 'dz', 'jumping']) {
      if (one[field] !== two[field]) {
        differences.push('tick '+(tick+1)+': '+field+' '+one[field]+' in the walk, '+two[field]+' in the worker');
      }
    }
  }
  console.log('room '+id+', '+got.length+' ticks through app/gameWorker.js'
    +(options.keys ? ', keys '+options.keys : ', no keys'));
  const last = got[got.length-1];
  console.log('  end    '+(last === undefined ? '-' : place(last)));
  // the tick he walks out of the room in has no snapshot: the worker posts the
  // exit instead, because the room the snapshot would describe is already gone
  const expected = wanted.trace.length-(wanted.left === false ? 0 : 1);
  if (expected !== got.length) {
    differences.push('the walk ran '+expected+' ticks, the worker '+got.length);
  }
  console.log('  '+(differences.length ? differences.length+' DIFFERENCES from the direct walk'
    : 'the worker and the direct walk agree tick for tick'));
  for (const difference of differences.slice(0, 10)) console.log('    '+difference);
  process.exitCode = differences.length ? 1 : 0;
}

/**
 * `travel`: one key program walked through `app/gameWorker.js` across as many
 * rooms as it reaches, with this tool standing in for the room model - it hands
 * the worker the room it asks for and nothing else.
 *
 * `doors` proves the arches; this proves the wiring. What is being watched here
 * is that the game goes on across a doorway: the lives, the day and the night
 * and the frame counter belong to the worker and must come through unchanged,
 * because nothing about them is ever sent over.
 */
function travel(id, options) {
  const program = parseKeys(options.keys);
  const ticks = options.ticks || program.length || 200;
  const visited = [];
  let held = {};
  let room = loadRoom(id, options.data);
  let last = false;

  return new Promise((resolve) => {
    const post = startGameWorker((message) => {
      if (message.id === 'exit') {
        room = loadRoom(message.roomId, options.data);
        visited.push({id: room.id, direction: message.direction, from: last});
        post({id: 'room', roomId: room.id, bounds: room.bounds, exits: room.exits,
          boxes: roomBoxes(room)});
        return;
      }
      if (message.id !== 'update') return;
      const snapshot = message.snapshot;
      last = snapshot;
      if (snapshot.tick >= ticks) {
        post({id: 'reset'});
        resolve(reportTravel(id, visited, snapshot, options));
        return;
      }
      const keys = program.length ? program[Math.min(snapshot.tick, program.length-1)] : {};
      for (const action of ['left', 'right', 'forward', 'jump', 'pickup', 'take']) {
        const value = !!keys[action];
        if (value !== !!held[action]) post({id: 'controls', action, value});
      }
      held = keys;
    });
    post({id: 'init', spec: HERO, item: ITEM, global: gameGlobal(options.data), seed: SEED,
      hero: newHero(room), roomId: room.id,
      bounds: room.bounds, exits: room.exits, boxes: roomBoxes(room),
      handlers: gameHandlers(options.data), method: options.method});
  });
}


/**
 * `items`: the collectable objects, room by room.
 *
 * The hero is put where the object is rather than walked to it: what is under
 * test here is the pick up rules and not the walking, and an object standing on
 * a ledge four cubes up would otherwise need a key program of its own for every
 * one of the thirty two rooms. Everything after that placement is the game -
 * the same object table, the same key, the same handlers.
 *
 * Each room gets the whole round trip: the object is in the room, one press of
 * the key puts it in the hero's hands and takes it out of the room, and the next
 * press puts it back down at his feet and stands him on top of it.
 */
function items(ids, options) {
  const global = gameGlobal(options.data);
  const rooms = new Set(ids);
  const wanted = global.items.filter((item) => rooms.has(item.room));
  let clean = 0;
  const failures = [];

  // an object that can actually be picked up: a quarter of them are idols
  const deal = new SpecialObjects(global, ITEM, SEED);
  const first = wanted.find((placed) => deal.carriable(deal.items[placed.index].graphic));
  if (first !== undefined) {
    const problems = directionalKey(first, options);
    if (problems.length) {
      failures.push({item: first, problems});
      console.log('the eight-way method, on object '+first.index+':');
      for (const problem of problems) console.log('    '+problem);
    } else {
      console.log('the eight-way method: down aims and does not pick up, the sixth key does');
    }
  }

  for (const placed of wanted) {
    const room = loadRoom(placed.room, options.data);
    const table = newTable(room, {x: placed.x, y: placed.y, z: placed.z}, options.data);
    const specials = table.specials;
    const slot = table.entries[2];
    const problems = [];
    const held = {method: 'rotational', pickup: true};
    const idle = {method: 'rotational'};

    const graphic = slot.graphic;
    const lives = table.lives;
    // he arrives in a puff of sparkles and is not himself until the last of them
    // has gone (`upd_120_to_126`), so the keys are not his for the first frames
    for (let settle = 0; settle < APPEAR_TICKS; settle++) table.tick(idle);
    let told = '';

    if (!specials.carriable(graphic)) {
      // the idol, which is the eighth kind: it is an extra life and it is taken
      // by standing on it, with no key pressed at all
      if (table.lives !== lives+1) {
        problems.push('the idol did not give a life: ' + lives + ' to ' + table.lives);
      }
      if (specials.items[placed.index].graphic !== 0) {
        problems.push('the idol is still in the table of objects');
      }
      told = 'an idol, taken for a life';
    } else {
      table.tick(held);                              // pick it up
      if (specials.carried[0] === false || specials.carried[0].graphic !== graphic) {
        problems.push('the object did not reach the hands');
      }
      if (specials.items[placed.index].graphic !== 0) {
        problems.push('the object is still in the table of objects');
      }

      // Putting it down again takes as many presses as there are slots. The key
      // does not choose an object: it puts down whatever has reached the back of
      // the queue, and every press moves the queue along one - so a single object
      // has to be walked from the front of the panel to the back before it goes.
      // That is `adjust_carried` running whether anything was dropped or not, and
      // with three objects in hand, which is how the game is usually played, it
      // comes out as one press, one object.
      let stood = table.player.z;
      let presses = 0;
      const headroom = !table.blockedAbove(table.player, HeroController.dropLift);
      while (table.entries[2].graphic !== graphic && presses < ITEM.carried) {
        table.tick(idle);                            // the key has to be let go of
        stood = table.player.z;
        table.tick(held);
        presses++;
      }
      const back = table.entries[2].graphic === graphic;
      if (!headroom) {
        // there is no room above him for the cube he would be standing on, so
        // the game refuses the drop (`cant_drop`) - which is the right answer
        if (back) problems.push('the object went down with nowhere for the hero to stand');
        told = 'picked up; no headroom to put it back down';
      } else if (!back) {
        problems.push('the object did not come back into the room in '+presses+' presses');
      } else if (specials.carried.some((carried) => carried !== false)) {
        problems.push('the hands are not empty again');
      } else if (table.player.z !== stood+HeroController.dropLift) {
        problems.push('the hero did not step up onto it: z '+stood+' to '+table.player.z);
      } else {
        told = 'picked up, and put back down on the '+presses+ordinal(presses)+' press';
      }
    }

    if (problems.length) {
      failures.push({item: placed, problems});
      console.log('object '+String(placed.index).padStart(2)+' in room '
        +String(placed.room).padStart(3)+':');
      for (const problem of problems) console.log('    '+problem);
    } else {
      clean++;
      if (ids.length === 1) {
        console.log('object '+placed.index+' in room '+placed.room+' at '+place(placed)
          +': '+told);
      }
    }
  }

  if (ids.length > 1) {
    console.log(wanted.length+' collectable object(s) in '+ids.length+' room(s)');
    console.log('  '+clean+' behaved as the original says, '+failures.length+' with problems');
  }
  if (failures.length) process.exitCode = 1;
}

/**
 * The one thing the two input methods do not share: which key picks an object
 * up. With the keyboard it is the bit an eight-way joystick sets by being
 * pulled down; the eight-way method reads that bit as a direction and has a key
 * of its own for picking up (`chk_pickup_drop`). Pressing down in the eight-way
 * method must therefore aim the hero and nothing else.
 *
 * @param {object} placed one entry of `global.json`
 * @param {object} options the command line
 * @returns {string[]} what went wrong, empty when it did not
 */
function directionalKey(placed, options) {
  const problems = [];
  for (const key of ['pickup', 'take']) {
    const room = loadRoom(placed.room, options.data);
    const table = newTable(room, {x: placed.x, y: placed.y, z: placed.z}, options.data);
    for (let settle = 0; settle < APPEAR_TICKS; settle++) table.tick({method: 'directional'});
    table.tick({method: 'directional', [key]: true});
    const carried = table.specials.carried[0] !== false;
    if (key === 'pickup' && carried) problems.push('down picked the object up');
    if (key === 'take' && !carried) problems.push('the sixth key did not pick the object up');
  }
  return problems;
}

/**
 * `win`: the two ways a game of Knight Lore ends.
 *
 * The first is the clock. Nothing but the sky is asked to run: forty daybreaks
 * and the game is over, however well it was going.
 *
 * The second is the cauldron, and it is the whole of the milestone in one run.
 * The hero is stood on the cauldron in room 136 with the object it is asking for
 * in his hands - the carrying itself is what `items` tests - and the key is
 * pressed. Fourteen times over, the object rises, crosses to the middle, falls
 * in and the sequence moves on; and when the fourteenth goes in the room comes
 * apart into sparkles which come for him, and the game ends won.
 */
function win(options) {
  const problems = [];

  // the clock
  const quiet = loadRoom(WIN_ROOM, options.data);
  const clock = newTable(quiet, {}, options.data);
  let ticks = 0;
  while (!clock.gameOver && ticks < WIN_TICKS) {
    clock.tick({method: 'rotational'});
    ticks++;
  }
  console.log('the clock: day '+clock.dayNight.days+' after '+ticks+' ticks, '
    +(clock.gameOver ? 'game over' : 'still going'));
  if (!clock.gameOver) problems.push('the game did not end on day '+DayNight.lastDay);
  else if (clock.won) problems.push('running out of days counted as a win');

  // the cauldron
  const room = loadRoom(ITEM.cauldronRoom, options.data);
  const table = newTable(room, {x: WIN_STAND.x, y: WIN_STAND.y, z: WIN_STAND.z}, options.data);
  const specials = table.specials;
  const asked = specials.required.slice();
  let put = 0;
  let frames = 0;

  while (!specials.allInCauldron && frames < WIN_TICKS) {
    if (!specials.dropping && specials.last === false) {
      // hand him the object the cauldron is asking for, as picking one up would
      const kind = specials.nextRequired();
      const record = specials.items.find((held) => held.graphic === ITEM.firstGraphic+kind);
      if (record === undefined) {
        problems.push('no object of kind '+kind+' is left in the castle');
        break;
      }
      record.graphic = 0;
      specials.carried[specials.carried.length-1] = {graphic: ITEM.firstGraphic+kind,
        item: record.index};
      put++;
    }
    table.tick({method: 'rotational', pickup: specials.last !== false && !specials.dropping});
    table.tick({method: 'rotational'});
    frames += 2;
  }

  console.log('the cauldron: '+specials.inCauldron+' of '+asked.length+' objects in after '
    +put+' drops and '+frames+' ticks  (asked for '+asked.join(', ')+')');
  if (!specials.allInCauldron) problems.push('the potion was not made');

  let after = 0;
  while (!table.gameOver && after < WIN_TICKS) {
    table.tick({method: 'rotational'});
    after++;
  }
  const sparkles = table.entries.filter((entry) =>
    entry.graphic > ObjectMotion.firstTwinkle && entry.graphic <= ObjectMotion.firstTwinkle+3).length;
  console.log('the ending: '+sparkles+' sparkle(s) still flying, game '
    +(table.gameOver ? (table.won ? 'won' : 'over but not won') : 'still going')
    +' after '+after+' ticks');
  if (!table.gameOver) problems.push('the sparkles never caught him');
  else if (!table.won) problems.push('making the potion did not count as a win');
  console.log('the score: '+JSON.stringify(table.score()));

  for (const problem of problems) console.log('  problem: '+problem);
  if (problems.length) process.exitCode = 1;
}

/** The suffix of a small ordinal, for the reports. */
function ordinal(value) {
  return value === 1 ? 'st' : (value === 2 ? 'nd' : (value === 3 ? 'rd' : 'th'));
}

/** Prints where the journey went. */
function reportTravel(id, visited, snapshot, options) {
  console.log('room '+id+', '+snapshot.tick+' ticks through app/gameWorker.js'
    +(options.keys ? ', keys '+options.keys : ', no keys'));
  for (const step of visited) {
    console.log('  out by the '+step.direction+' wall into room '+step.id
      +'  (lives '+step.from.lives+', '+(step.from.sky.night ? 'night' : 'day')
      +' '+step.from.sky.days+', tick '+step.from.tick+')');
  }
  console.log('  ended in room '+snapshot.roomId+' at '
    +place(snapshot.hero)+' facing '+HERO.directions[snapshot.hero.direction]
    +', lives '+snapshot.lives+', '+(snapshot.sky.night ? 'night' : 'day')
    +' '+snapshot.sky.days);
  console.log('  '+visited.length+' room(s) entered through an arch');
}

function main(argv) {
  const command = argv[2];
  const target = argv[3];
  const id = Number(target);
  const all = ['check', 'life', 'doors', 'items'].includes(command) && target === 'all';
  if (!['walk', 'check', 'life', 'worker', 'doors', 'travel', 'items', 'win'].includes(command)
    || !(command === 'win' || all || Number.isInteger(id))) {
    console.error('usage: klwalk.js walk <id> [--keys program] [--ticks n] [--at x,y,z]');
    console.error('                           [--facing 0-3] [--method directional|rotational]');
    console.error('                           [--trace] [--png out.png]');
    console.error('       klwalk.js check <id|all> [--ticks n]');
    console.error('       klwalk.js life <id|all> [--ticks n] [--trace]');
    console.error('       klwalk.js doors <id|all> [--ticks n]');
    console.error('       klwalk.js worker <id> [--keys program] [--ticks n]');
    console.error('       klwalk.js travel <id> [--keys program] [--ticks n]');
    console.error('       klwalk.js items <id|all>');
    console.error('       klwalk.js win');
    console.error('       every command takes --data dir');
    process.exit(1);
  }
  const options = {
    keys: '', ticks: 0, at: false, facing: false, method: 'directional',
    trace: false, png: false, data: join(ROOT, 'data')
  };
  for (let a = 4; a < argv.length; a++) {
    if (argv[a] === '--keys') options.keys = argv[++a];
    else if (argv[a] === '--ticks') options.ticks = Number(argv[++a]);
    else if (argv[a] === '--at') options.at = argv[++a];
    else if (argv[a] === '--facing') options.facing = Number(argv[++a]);
    else if (argv[a] === '--method') options.method = argv[++a];
    else if (argv[a] === '--trace') options.trace = true;
    else if (argv[a] === '--png') options.png = argv[++a];
    else if (argv[a] === '--data') options.data = argv[++a];
    else {
      console.error('unknown option: '+argv[a]);
      process.exit(1);
    }
  }
  if (!['directional', 'rotational'].includes(options.method)) {
    throw new Error('--method is directional or rotational, got: '+options.method);
  }
  if (command === 'win') {
    win(options);
    return;
  }
  if (command === 'items') {
    items(all ? castleRooms(options.data) : [id], options);
    return;
  }
  if (command === 'check') {
    check(all ? castleRooms(options.data) : [id], options);
    return;
  }
  if (command === 'life') {
    life(all ? castleRooms(options.data) : [id], options);
    return;
  }
  if (command === 'doors') {
    doors(all ? castleRooms(options.data) : [id], options);
    return;
  }
  if (command === 'worker') {
    return worker(id, options);
  }
  if (command === 'travel') {
    return travel(id, options);
  }
  walk(id, options);
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
  const running = main(process.argv);
  if (running) {
    running.catch((error) => {
      console.error('klwalk: '+error.message);
      process.exitCode = 1;
    });
  }
} catch (error) {
  console.error('klwalk: '+error.message);
  process.exitCode = 1;
}

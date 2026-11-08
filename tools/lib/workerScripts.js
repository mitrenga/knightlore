/**
 * Loader for the classic scripts of the game worker.
 *
 * The six scripts of the running game - `app/physics.js`,
 * `app/objectMotion.js`, `app/dayNight.js`, `app/specialObjects.js`,
 * `app/heroController.js` and `app/objectTable.js` - and `app/gameWorker.js`
 * around them are not ES
 * modules: a classic web worker cannot import one, so they are plain scripts
 * loaded with `importScripts()` and they declare their names as globals. The
 * offline tools still have to run *those* files and not a copy of them -
 * a second transcription of the original's collision would rot the moment one
 * of the two is fixed - so they are evaluated here in a scope of their own and
 * the names asked for are handed back.
 *
 * It is the same trick the worker plays, with `new Function` in place of
 * `importScripts`: the scripts see no module system either way.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'app');

/**
 * Runs the given classic scripts of `app/` in one shared scope, in order, and
 * returns the names they declared.
 *
 * @param {string[]} files file names inside `app/`, in load order
 * @param {string[]} names the globals to hand back
 * @returns {object} the named globals
 */
export function loadWorkerScripts(files, names) {
  const source = files.map((file) => readFileSync(join(APP, file), 'utf8')).join('\n;\n');
  return new Function(source + '\nreturn {' + names.join(', ') + '};')();
}

/** The scripts a room is made of: everything but the worker around them. */
export const GAME_SCRIPTS = ['physics.js', 'objectMotion.js', 'dayNight.js',
  'specialObjects.js', 'heroController.js', 'objectTable.js'];

/** The names those scripts declare. */
export const GAME_NAMES = ['Physics', 'ObjectMotion', 'DayNight', 'SpecialObjects',
  'HeroController', 'ObjectTable'];

/** The running game without the worker around it, which is what a tool wants. */
export function loadGame() {
  return loadWorkerScripts(GAME_SCRIPTS, GAME_NAMES);
}

/**
 * Starts `app/gameWorker.js` itself, message protocol, clock and all, in a
 * scope that gives it the handful of worker globals it uses. It is the real
 * worker running on Node's timers rather than the browser's, so a tool can
 * check the thing the game actually loads and not only the physics inside it.
 *
 * @param {function} onMessage called with every message the worker posts
 * @returns {function} send a message to the worker, as `postMessage()` would
 */
export function startGameWorker(onMessage) {
  const files = GAME_SCRIPTS.concat(['gameWorker.js']);
  const source = files.map((file) => readFileSync(join(APP, file), 'utf8')).join('\n;\n');
  const scope = {
    // the worker reads its own URL for the cache busting version
    location: {search: '?ver=offline'},
    // the scripts are already in this scope, there is nothing to fetch
    importScripts: () => {},
    postMessage: onMessage,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    console: console
  };
  const handler = new Function(...Object.keys(scope), source + '\nreturn onmessage;')(...Object.values(scope));
  return (message) => handler({data: message});
}

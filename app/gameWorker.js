// begin code

/**
 * The physics half of the model/worker pair, the same arrangement Manic Miner
 * and Jet Set Willy use: the worker owns the room and the clock, the model owns
 * the screen, and between them go two messages - the room in, a snapshot out
 * per tick.
 *
 * The worker knows nothing about rooms, sprites or JSON. It is handed the size
 * of the room, the flat list of boxes the room is made of and the jump table
 * that says what each graphic number does - which is what the model gets out of
 * `app/roomData.js` and `app/spriteSheet.js` anyway - and it hands back where
 * everything is and what it looks like. What moves is in `app/objectTable.js`,
 * `app/objectMotion.js`, `app/heroController.js` and `app/physics.js`, and what
 * outlives a room - the sky and the collectable objects - is in
 * `app/dayNight.js` and `app/specialObjects.js`; they are all loaded
 * here with `importScripts()` because a classic worker cannot import ES
 * modules; the offline tools in `tools/` run those files rather than a copy.
 */

var version = (location.search.match(/[?&]ver=([^&]*)/) || ['', ''])[1];
importScripts('physics.js?ver='+version, 'objectMotion.js?ver='+version,
  'dayNight.js?ver='+version, 'specialObjects.js?ver='+version,
  'heroController.js?ver='+version, 'objectTable.js?ver='+version);

/**
 * Milliseconds per tick.
 *
 * The original is not locked to the video frame. It draws, and then it burns
 * `6 - rendered_objs_cnt` rounds of a 1280 iteration delay loop (`game_delay`,
 * line 2065), about 9.5 ms each on a 3.5 MHz Z80: the fewer objects had to be
 * redrawn, the longer it waits, so the pace stays the same whatever is on
 * screen. That budget - six objects' worth of drawing plus the fixed cost of
 * walking the object table and the panel - comes out at roughly twelve frames a
 * second, which is also the 80 ms of MM and JSW.
 */
var TICK_MS = 80;

var controls, controller, table, dayNight, specials, method, running, nextTick, paused;

/**
 * Puts the worker back to the state it starts a game in. The held keys survive,
 * so a reset does not drop the key the player is holding.
 *
 * Walking through a doorway does not come through here at all: that is the
 * `room` message, and the whole point of it is that nothing is put back -
 * neither the hero, nor the lives, nor the sky, nor the clock.
 */
function resetData() {
  controller = null;
  table = null;
  specials = null;
  running = false;
  paused = false;
  nextTick = false;
} // resetData

/**
 * Clears the held keys as well. Sent when the game stops listening.
 */
function resetControls() {
  controls = {left: false, right: false, forward: false, jump: false,
    up: false, down: false, pickup: false, take: false};
} // resetControls

/**
 * One tick: schedule the next one, run the room, post the snapshot.
 */
function gameLoop() {
  if (!running) {
    nextTick = false;
    return;
  }
  nextTick = paused ? false : setTimeout(gameLoop, TICK_MS);
  if (paused || table === null) {
    return;
  }
  controls.method = method;
  table.tick(controls);
  if (table.exit !== false) {
    // the hero has walked out through an arch. The original has the whole castle
    // in memory and simply builds the next room; here the room data belongs to
    // the model, so the clock stops until it hands the room over - and no
    // snapshot goes out, because the room it would describe is already gone
    clearTimeout(nextTick);
    running = false;
    nextTick = false;
    postMessage({id: 'exit', roomId: table.exit.roomId,
      direction: table.exit.direction});
    return;
  }
  postMessage({id: 'update', snapshot: snapshot()});
} // gameLoop

/**
 * What the model needs to draw the frame, plus what the debug overlay wants to
 * read. Flat and copied, never the worker's own state object.
 *
 * `objects` is the object table row by row, in the order the model handed the
 * boxes over, so the model can put every one of them back where it belongs
 * without being told which is which.
 *
 * @returns {object} the snapshot
 */
function snapshot() {
  var state = controller.state;
  return {
    tick: table.frame,
    // which room this is a picture of: the model throws away a snapshot of the
    // room it has just left, so that it never puts one room's positions into
    // another room's display list
    roomId: table.roomId,
    hero: {
      form: state.form,
      direction: state.direction,
      frame: state.frame,
      graphic: state.graphic,
      x: state.x, y: state.y, z: state.z,
      dx: state.dx, dy: state.dy, dz: state.dz,
      jumping: state.jumping,
      grounded: state.blockedZ,
      // the two flags of the doorways (M7): standing in one, and walking in
      // through one with the keys not yet his
      atArch: state.atArch,
      entering: state.entering,
      blockedX: state.blockedX,
      blockedY: state.blockedY,
      destroyed: state.destroyed
    },
    standingOn: state.standingOn.slice(),
    objects: table.picture(),
    sky: dayNight.state(),
    lives: table.lives,
    // the panel: the day, the lives and the three objects in his hands
    // (`display_day`, `print_lives`, `display_objects`)
    carried: specials.picture(),
    days: dayNight.days,
    inCauldron: specials.inCauldron,
    gameOver: table.gameOver,
    won: table.won,
    // what the game over screen of M10 has to print, worked out here because it
    // is the game's own arithmetic and not the screen's
    score: table.gameOver ? table.score() : false
  };
} // snapshot

/**
 * Commands from the model.
 *
 * @param {MessageEvent} event the message
 */
onmessage = (event) => {
  var data = event.data;
  switch (data.id) {

    case 'init':
      clearTimeout(nextTick);
      resetData();
      method = data.method || 'directional';
      // `init` is a new game now that a room change is its own message: the sky
      // starts over with it, day nought and the sun where `print_sun_moon`
      // starts it
      dayNight = new DayNight();
      // `seed_1`: where the ring of object kinds starts and how far the asks are
      // rotated, which is the only thing one game has and another has not. The
      // original stirs it with the frame counter of the menu, so it is whatever
      // the player's timing made it
      specials = new SpecialObjects(data.global, data.item,
        data.seed === undefined ? Math.floor(Math.random()*256) : data.seed);
      controller = new HeroController(data.spec);
      table = new ObjectTable(controller, dayNight, specials);
      table.setHandlers(data.handlers);
      table.setRoom({id: data.roomId, bounds: data.bounds, exits: data.exits,
        boxes: data.boxes}, data.hero);
      running = true;
      // the first snapshot is the room as it opens, before anything moves
      postMessage({id: 'update', snapshot: snapshot()});
      gameLoop();
      break;

    case 'room':
      // the room the worker asked for by posting `exit`, or one the development
      // keys of the room model picked. Everything that outlives a room - the
      // lives, the sky, the frame counter - stays where it is, because this is
      // one game going on and not a new one
      if (table !== null) {
        clearTimeout(nextTick);
        table.enterRoom({id: data.roomId, bounds: data.bounds, exits: data.exits,
          boxes: data.boxes}, data.start || false);
        running = true;
        postMessage({id: 'update', snapshot: snapshot()});
        gameLoop();
      }
      break;

    case 'controls':
      if (data.action in controls) {
        controls[data.action] = data.value;
      }
      break;

    case 'method':
      method = data.value;
      break;

    case 'hero':
      // the development keys of the room model: the hero's shape, and while
      // there is no game around him yet, his facing and his walking frame
      if (controller !== null) {
        var change = data.change;
        for (var key in change) {
          if (Object.prototype.hasOwnProperty.call(change, key)) {
            controller.state[key] = change[key];
          }
        }
        postMessage({id: 'update', snapshot: snapshot()});
      }
      break;

    case 'pause':
      paused = true;
      break;

    case 'continue':
      clearTimeout(nextTick);
      paused = false;
      gameLoop();
      break;

    case 'reset':
      clearTimeout(nextTick);
      resetData();
      resetControls();
      break;

  }
}; // onmessage

resetControls();

// begin code

/**
 * The room while it is running: the original's `graphic_objs_tbl` and the loop
 * that walks it (`onscreen_loop`, line 2001).
 *
 * The original has one flat table of forty slots, thirty two bytes each, and
 * everything in a room lives in it - the hero's legs in the first slot, his top
 * half in the second, then the walls and the arches, then the blocks, then the
 * collectable objects. One frame of the game is one pass over that table: each
 * slot's graphic number says which routine updates it, the routine moves it,
 * and moving anything is the same collision routine the hero uses. There is no
 * separate "hero" and no separate "monsters"; there is a table.
 *
 * This is that table. Its entries are the boxes of the room in the order the
 * room data gives them, with the hero in front of them, and they are the very
 * objects handed to `app/physics.js` as obstacles - the hero collides with a
 * guard because they are two rows of one table, not because anybody wrote code
 * to make it happen. What each row does with its frame is in
 * `app/objectMotion.js`; what the hero does with his is in
 * `app/heroController.js`.
 *
 * The table also keeps the handful of numbers the original keeps per room: is a
 * portcullis moving, is a spiked ball already falling, how high do the balls
 * bounce, and may they fall here at all. They are reset when the room is built,
 * which is also what happens when the hero loses a life - dying puts the whole
 * room back, not just him.
 *
 * A classic script, not a module: it is loaded into the game worker with
 * `importScripts()` alongside `app/physics.js`, `app/objectMotion.js`,
 * `app/dayNight.js` and `app/heroController.js`; the offline tools run these
 * very files through `tools/lib/workerScripts.js`.
 */

class ObjectTable {

  /**
   * @param {HeroController} hero the hero, who is the first two entries
   * @param {DayNight} dayNight the sky, which outlives the room
   * @param {SpecialObjects} specials the collectable objects, the inventory and
   *   the cauldron, which outlive the room as well
   */
  constructor(hero, dayNight, specials) {
    this.hero = hero;
    this.dayNight = dayNight;
    this.specials = specials;
    this.roomId = 0;
    this.bounds = false;
    this.exits = ObjectTable.noExits;
    /** The room the hero has walked out of the room into, once he has. */
    this.exit = false;
    /** `upd_sprite_jmp_tbl`: the routine every graphic number points at. */
    this.handlers = [];
    this.input = {};
    this.boxes = [];
    this.entries = [];
    this.start = false;
    this.lives = ObjectTable.lives;
    this.gameOver = false;
    /** True when the game ended with the potion made rather than with a death. */
    this.won = false;
    /** `scrn_visited`: every room the hero has been in, for the final rating. */
    this.visited = {};
    /** `not_1st_screen`: whether there is a room to save the objects out of. */
    this.built = false;
    /** The frame counter, which is the original's `seed_2`. */
    this.frame = 0;
    /** The state behind `random()`, the original's `seed_3`. */
    this.seed = 0x1f2e3d4c;
    this.unhandled = {};
    this.resetRoom();
  } // constructor

  /**
   * The jump table: which routine each of the graphic numbers is updated by.
   * It comes out of `data/sprites.json`, where M3 recorded the name traced from
   * the disassembly for every one of the 188 graphics.
   *
   * @param {string[]} handlers routine name per graphic number
   */
  setHandlers(handlers) {
    this.handlers = handlers;
  } // setHandlers

  /**
   * Puts a room in the table.
   *
   * @param {object} room `{id, bounds, boxes}` - the boxes as the model reads
   *   them out of the room data, in the data's own order
   * @param {object} start where the hero comes in, which is where he comes back
   *   after he has died (`plyr_spr_1_scratchpad`). A hero is built here, in the
   *   sparkles he materialises in; walking in from the room next door does not
   *   come through here but through `enterRoom()`
   */
  setRoom(room, start) {
    this.saveSpecials();
    this.roomId = room.id;
    this.bounds = room.bounds;
    this.exits = room.exits || ObjectTable.noExits;
    this.boxes = room.boxes;
    this.start = start;
    this.exit = false;
    this.build();
  } // setRoom

  /**
   * The other half of `exit_screen`: the room the hero walked into, handed over
   * by whoever owns the room data - the model in the game, the tool offline.
   * The original has the whole castle in memory and simply jumps back into
   * `game_loop` at this point; here the room has to be fetched first, and the
   * clock stands still until it arrives.
   *
   * This is where `adjust_plyr_xyz_for_room_size` happens: the pending exit
   * says which wall he comes in through, and the new room says where that wall
   * is and how high its arch stands.
   *
   * @param {object} room `{id, bounds, exits, boxes}` as `setRoom()` takes it
   * @param {object|false} [start] where to put him, or false for the pending
   *   exit; `ObjectTable.middle` is the centre of the room, which is where the
   *   original starts the game (`plyr_spr_init_data`) and where the development
   *   keys of the room model drop him
   */
  enterRoom(room, start) {
    var pending = this.exit === false ? ObjectTable.middle : this.exit.start;
    var where = start === undefined || start === false ? pending : start;
    var place = where === ObjectTable.middle
      ? this.middleStart(room) : this.archStart(room, where);
    // `build_screen_objects` saves the objects of the room being left before it
    // fills the table with the new one; the two slots of the table are all the
    // memory a collectable object has while it is lying in a room
    this.saveSpecials();
    this.roomId = room.id;
    this.bounds = room.bounds;
    this.exits = room.exits || ObjectTable.noExits;
    this.boxes = room.boxes;
    // the new room's start data, which is only ever used again if he dies in
    // here: `exit_screen` put the sparkles into the copy, not into him
    this.start = place;
    this.exit = false;
    if (this.hero.state === null) {
      this.build();
      return;
    }
    // `retrieve_screen` fills the table from its fourth slot on and clears the
    // rest, so the hero's two slots come through a doorway untouched: **he is
    // not built again, he is moved.** That is why he does not materialise at
    // every door - he walks in with the graphic number, the shape, the facing
    // and the frame of the walk he left the last room with. The sparkles are
    // `lose_life`'s alone.
    this.fill(this.hero.placeAt(place));
  } // enterRoom

  /**
   * `exit_screen`: the hero has walked out through an arch, so the room
   * changes.
   *
   * The original copies his two table entries into `plyr_spr_1_scratchpad`,
   * writes the first of the appearing sparkles over the graphic number **of the
   * copy**, and jumps straight back into the game loop, which rebuilds the room.
   *
   * The copy is the start data of the room he is walking into: what he comes
   * back to when he loses a life in there, and what he comes back *as* - which
   * is why dying in a room returns you to its doorway in a puff of sparkles.
   * **He himself does not sparkle at a doorway.** His own two slots of the table
   * are never touched by the rebuild, so he walks in as he walked out; only his
   * position is adjusted (`enterRoom()`).
   *
   * Two of his three coordinates travel with him. The one along the wall he
   * crossed is thrown away - the arch of the new room decides it - and it is
   * the *centre* of the room the other one is measured from, because the
   * original's coordinates are absolute bytes around 128 and the two rooms need
   * not be the same size. His height travels too, and the arch of the new room
   * overrides it when it finds itself.
   *
   * @param {string} direction the side of the room he left by
   * @returns {boolean} true when the room is changing
   */
  exitRoom(direction) {
    var room = this.exits[direction];
    if (room === false || room === undefined) {
      return false;
    }
    var entry = this.player;
    var across = ObjectTable.axisOf(direction) == 'x' ? 'y' : 'x';
    this.exit = {
      direction: direction,
      roomId: room,
      start: {
        // the wall of the new room he comes in through, which is the original's
        // sentinel value of 0 or 255 in the coordinate it threw away
        enter: ObjectTable.opposite[direction],
        // how far he is from the middle of the doorway, which is the middle of
        // the room
        offset: ObjectMotion.centre(entry, across)-this.bounds[across]/2,
        z: entry.z,
        form: entry.form,
        direction: entry.direction,
        frame: entry.frame,
        // `or 0x30`: the frames he walks in for before the keys are his again
        entering: ObjectTable.enteringFrames
      }
    };
    return true;
  } // exitRoom

  /**
   * `adjust_plyr_xyz_for_room_size` and `adjust_plyr_Z_for_arch`: where the
   * hero stands when he has just come in through an arch.
   *
   * Across the doorway he keeps the offset from the middle of the room he
   * brought with him. Along the way he was walking, the original puts him
   * `room_size - 2` from the centre plus his own radius, which comes out - the
   * radius cancelling - as **the face he leads with two units inside the room**:
   * the rest of him is still in the doorway, which is why the walls are off
   * while he walks in and why his first three frames are not his to steer.
   *
   * His height comes from the arch itself. The original looks through the
   * arches of the new room for the one standing in the wall he is coming in
   * through and takes its Z, which is how a room whose doorway is up on a ledge
   * receives him up there.
   *
   * @param {object} room the room he is coming into
   * @param {object} start the pending exit's start data
   * @returns {object} `{x, y, z, form, direction, frame, entering}`
   */
  archStart(room, start) {
    var spec = this.hero.spec;
    var size = {x: spec.radiusX*2, y: spec.radiusY*2};
    var axis = ObjectTable.axisOf(start.enter);
    var across = axis == 'x' ? 'y' : 'x';
    var where = {x: 0, y: 0, z: start.z, form: start.form,
      direction: start.direction, frame: start.frame, entering: start.entering};
    where[axis] = start.enter == 'east' || start.enter == 'north'
      ? room.bounds[axis]-ObjectTable.archStep
      : ObjectTable.archStep-size[axis];
    where[across] = room.bounds[across]/2+start.offset-size[across]/2;
    var arch = ObjectTable.archInWall(room, start.enter);
    if (arch !== false) {
      where.z = arch.z;
    }
    return where;
  } // archStart

  /**
   * The arch of a room standing in the given wall, or false when the original
   * would not have found one.
   *
   * The original knows which wall an arch is in from one byte:
   * `X + Y` of its near half, which is the screen row the sprite is drawn on
   * (`calc_pixel_XY`), and which therefore says where in the room it stands.
   * The four values it compares against are the four walls
   * (`adjust_plyr_Z_for_arch`), and all 128 rooms of the castle agree with them.
   *
   * The search is the original's and so is its one blind spot: it walks the
   * background objects of the room in order and gives up at the first one that
   * is not an arch. Room 33 lists its high arch, then the block under it, then
   * its west arch - so entering room 33 from the west finds no arch and the hero
   * keeps the height he came in with. Both arches are on the floor there, so
   * nothing shows; it is transcribed rather than fixed because a fix would be
   * a different game.
   *
   * @param {object} room the room to look in
   * @param {string} wall the side of the room
   * @returns {object|false} the box of the arch's near half
   */
  static archInWall(room, wall) {
    var want = ObjectTable.archKeys[wall];
    for (var b = 0; b < room.boxes.length; b++) {
      var box = room.boxes[b];
      if (box.part !== 0) {
        continue;
      }
      if (box.graphic > ObjectTable.lastArchGraphic) {
        return false;
      }
      // the sum, as a byte, exactly as the original compares it
      var key = (ObjectMotion.centre(box, 'x')+ObjectMotion.centre(box, 'y')
        -(room.bounds.x+room.bounds.y)/2) & 0xff;
      if (key === want) {
        return box;
      }
    }
    return false;
  } // archInWall

  /**
   * `plyr_spr_init_data`: the middle of the room, on the floor, which is where
   * the original starts the game. Two thirds of the rooms have something
   * standing there, so it is only ever used for the four rooms the game may
   * begin in and for the development keys of the room model.
   *
   * @param {object} room the room to stand in the middle of
   * @returns {object} `{x, y, z}`
   */
  middleStart(room) {
    var spec = this.hero.spec;
    return {x: room.bounds.x/2-spec.radiusX, y: room.bounds.y/2-spec.radiusY, z: 0};
  } // middleStart

  /** The axis a wall of the room is crossed along. */
  static axisOf(direction) {
    return direction == 'east' || direction == 'west' ? 'x' : 'y';
  } // axisOf

  /**
   * `build_screen_objects`: fills the table from the room data and puts the
   * hero at the front of it. Called again after every death, because the
   * original rebuilds the whole room then - every block that dropped is back
   * where it was.
   */
  build() {
    this.fill(this.hero.entries(this.start, this.dayNight.night()));
  } // build

  /**
   * `update_special_objs`: where the collectable objects of the room being left
   * have got to, written back into the table they really live in. It runs
   * before every rebuild, which includes losing a life - an object put down in
   * a room stays where it was put down, whatever happens to the hero.
   */
  saveSpecials() {
    if (this.built) {
      this.specials.save(this.specialSlots(), this.roomId);
    }
  } // saveSpecials

  /** `special_objs_here`: the two slots of the table the objects of a room use. */
  specialSlots() {
    return this.entries.slice(ObjectTable.heroSlots,
      ObjectTable.heroSlots+SpecialObjects.slots);
  } // specialSlots

  /**
   * The table: the hero's two slots, then the room behind them
   * (`retrieve_screen`, which is the part that starts at the fourth slot).
   *
   * @param {object[]} hero his two entries, whether they are new or the ones
   *   that walked in from the room before
   */
  fill(hero) {
    this.resetRoom();
    this.entries = hero;
    // `find_special_objs_here`: two slots for the collectable objects, always
    // there and usually empty, between the hero and the room. They are where
    // they are because the original puts them there, and it matters - the arches
    // and the collision both walk the head of the table by slot number
    var here = this.specials.here(this.roomId);
    for (var s = 0; s < SpecialObjects.slots; s++) {
      this.entries.push(ObjectTable.specialEntry(this.specials.spec, here[s]));
    }
    for (var b = 0; b < this.boxes.length; b++) {
      this.entries.push(ObjectTable.newEntry(this.boxes[b]));
    }
    for (var e = 0; e < this.entries.length; e++) {
      this.entries[e].index = e;
    }
    this.built = true;
    // `flag_room_visited`: one bit per room, read only by the final rating
    this.visited[this.roomId] = true;
  } // fill

  /**
   * The numbers the original clears when it builds a room.
   */
  resetRoom() {
    this.portcullisMoving = false;
    this.portcullisMoves = 0;
    this.ballBounceHeight = 0;
    this.spikeBallDropping = false;
    // `disable_spike_ball_drop`: no ball ever falls in a room with an odd id
    this.disableSpikeBallDrop = (this.roomId & 1) === 1;
  } // resetRoom

  /**
   * One frame of the room: the sky, then every entry in turn, then the two
   * things the original does after it has drawn - forget the objects that asked
   * to be wiped away, and notice that the hero is one of them.
   *
   * @param {object} input the keys held this frame
   */
  tick(input) {
    if (this.gameOver || this.exit !== false) {
      // the room is over: either the hero is out of lives, or he has walked out
      // of it and the next room has not been handed over yet
      return;
    }
    this.frame = (this.frame+1) & 0xffff;
    // `display_sun_moon_frame` gives up at its first line once the potion is
    // made, so the sun stops where it is and no more days are counted
    if (this.dayNight.step(this.frame, this.specials.allInCauldron)
      && this.dayNight.days >= DayNight.lastDay) {
      // `inc_days`: the fortieth day is the end of the game, whatever else is
      // going on. There is nothing to lose here - it is not a death - the game
      // is simply over
      this.endGame();
      return;
    }
    this.input = input;

    for (var e = 0; e < this.entries.length; e++) {
      var entry = this.entries[e];
      if (entry.graphic === ObjectTable.empty) {
        continue;
      }
      this.stir();
      // two graphic numbers draw nothing and so have no entry in the sprite
      // sheet to read a routine name out of; the original's jump table has one
      // for them all the same (`ObjectTable.handlerNames`)
      var handler = ObjectTable.handlerNames[entry.graphic] || this.handlers[entry.graphic];
      if (!ObjectMotion.update(this, entry, handler)) {
        this.unhandled[handler === undefined ? 'graphic '+entry.graphic : handler] = true;
      }
      if (this.exit !== false || this.gameOver) {
        // `exit_screen` jumps straight back into the game loop, and `game_over`
        // never comes back at all: either way the rest of the table does not
        // get this frame
        return;
      }
    }

    // `init_cauldron_bubbles`, right after the table has been walked: the
    // cauldron's room gets its bubbles back as soon as its slot is free
    this.cauldronBubbles();

    // `calc_pixel_XY_and_render`: an object left on the wiping graphic number is
    // drawn once more as nothing and then its slot is empty
    for (var w = 0; w < this.entries.length; w++) {
      if (this.entries[w].graphic === ObjectMotion.wipeGraphic) {
        this.entries[w].graphic = ObjectTable.empty;
      }
    }

    if (this.entries[0].graphic === ObjectTable.empty
      && this.entries[1].graphic === ObjectTable.empty) {
      this.loseLife();
    }
  } // tick

  /**
   * `lose_life`: one life fewer, the room built again, and the hero back where
   * he came into it - as whichever of his two shapes the sky says.
   */
  loseLife() {
    this.lives--;
    if (this.lives < 0) {
      this.endGame();
      return;
    }
    this.saveSpecials();
    this.build();
  } // loseLife

  /**
   * `game_over`: the game is over, either because the hero has run out of lives
   * or days, or because the potion has been made and one of the sparkles the
   * castle is coming apart in has caught him.
   *
   * The original leaves the game loop here and draws a screen; the screen and
   * the hall of fame behind it are M10, so what happens here is the arithmetic
   * of that screen - how far the player got - and the room stopping.
   */
  endGame() {
    this.gameOver = true;
    this.won = this.specials.allInCauldron;
  } // endGame

  /**
   * `calc_and_display_percent` and the rating it picks: how well the game went.
   *
   * The percentage is the original's fixed point sum to the digit: every room
   * seen counts one and every object in the cauldron counts two, and each of
   * those is worth 0xA41A of a sixteen bit fraction - which is 0.641, so seeing
   * all 128 rooms and making the potion comes to 99.999% and the rounding
   * constant it adds at the end carries it to 100.
   *
   * @returns {object} `{days, lives, rooms, objects, percent, rating, won}`
   */
  score() {
    var rooms = Object.keys(this.visited).length;
    var objects = this.specials.inCauldron;
    var units = objects*2+rooms;
    // `num_scrns_visited`: the room the game started in does not count
    var seen = (rooms-1) & 0xff;
    return {
      days: this.dayNight.days,
      lives: Math.max(this.lives, 0),
      rooms: seen,
      objects: objects,
      percent: Math.floor((units*ObjectTable.percentPerUnit+ObjectTable.percentRound)/0x10000),
      // three bits: the potion, and two bits of the room count
      rating: (this.won ? 4 : 0) | ((seen & 0x40) ? 2 : 0) | ((seen & 0x20) ? 1 : 0),
      won: this.won
    };
  } // score

  /**
   * `prepare_final_animation`: the fourteenth object has gone in, so the room
   * the cauldron stands in stops being a room.
   *
   * The original does it by the slot and not by what is in the slot: eleven
   * entries from the second object slot on are wiped away - which in that room
   * is the object that was just carried in, seven pieces of background and three
   * blocks - and every plain block left behind it turns into a twinkle. Those
   * twinkles are `upd_131_to_133`, and they come for the hero.
   */
  prepareFinalAnimation() {
    var from = ObjectTable.heroSlots+1;
    var e;
    for (e = from; e < from+ObjectTable.finalWipe && e < this.entries.length; e++) {
      this.entries[e].graphic = ObjectMotion.wipeGraphic;
    }
    for (; e < this.entries.length; e++) {
      if (this.entries[e].graphic === ObjectTable.plainBlock) {
        this.entries[e].graphic = ObjectMotion.firstTwinkle+1;
      }
    }
  } // prepareFinalAnimation

  /**
   * `init_cauldron_bubbles`: the bubbles over the cauldron, put into the room's
   * second object slot the moment it is empty.
   *
   * They are not part of the room's data and never were - the original copies
   * eighteen bytes of a template into the table at the end of every frame spent
   * in room 136, so they come back as soon as whatever was in that slot is
   * gone, and they stay away for as long as the potion is made.
   */
  cauldronBubbles() {
    if (this.roomId !== this.specials.spec.cauldronRoom || this.specials.allInCauldron) {
      return;
    }
    var slot = this.entries[ObjectTable.heroSlots+1];
    if (slot === undefined || slot.graphic !== ObjectTable.empty) {
      return;
    }
    var spec = this.specials.spec;
    slot.graphic = ObjectMotion.firstBubble;
    slot.x = this.bounds.x/2-spec.radiusX;
    slot.y = this.bounds.y/2-spec.radiusY;
    slot.z = 0;
    slot.sx = spec.radiusX*2;
    slot.sy = spec.radiusY*2;
    slot.sz = spec.height;
    slot.dx = 0;
    slot.dy = 0;
    slot.dz = 0;
    slot.item = -1;
    slot.dropped = false;
    // the template's flags say "draw", and the handler sets "ignore in 3D" on
    // its very first frame; it is set here instead, because the one frame
    // between the two is a frame in which the bubbles are a solid block sitting
    // inside the cauldron, which nothing can reach and no tool should report
    slot.ignore3D = true;
    // `cauldron_bubbles` byte 13: the bubbles are armed to kill from the moment
    // they are made, and nothing ever disarms them - which is what makes the
    // spell they turn into at night deadly, unlike the wizard's
    slot.deadly = true;
    slot.deadlyOnHit = true;
  } // cauldronBubbles

  /**
   * `dec_dZ_and_update_XYZ`: gravity, the collision, and the step committed.
   *
   * Every moving thing in the game goes through here, the hero included. The
   * fall is one unit a frame and it is applied to whatever the handler left in
   * `dz`, which is why an object that must not fall pre-loads a one.
   *
   * @param {object} entry the entry to move
   * @returns {object} the result of `Physics.resolve()`
   */
  move(entry) {
    entry.dz--;
    return this.commit(entry);
  } // move

  /**
   * `adj_for_out_of_bounds` and `add_dXYZ`: the step an entry is asking for,
   * cut down to what the room allows, and then taken. The hero comes in here
   * rather than through `move()` because his gravity is his own.
   *
   * @param {object} entry the entry to move
   * @returns {object} the result of `Physics.resolve()`
   */
  commit(entry) {
    var result = this.resolveStep(entry);
    this.applyStep(entry, result);
    return result;
  } // commit

  /**
   * The first half of `adj_for_out_of_bounds`: what the room allows of the step,
   * and everything touching something does, but not the step itself. The hero
   * takes the two halves apart because `handle_exit_screen` runs between them -
   * the frame he leaves the room in is a frame whose step is never taken.
   *
   * @param {object} entry the entry to move
   * @returns {object} the result of `Physics.resolve()`
   */
  resolveStep(entry) {
    if (entry.ignore3D) {
      // `adj_for_out_of_bounds` gives up at its very first line for an object
      // that is already flagged "ignore in 3D": no walls, no obstacles, and the
      // flags of the last step left as they were. That is not an optimisation,
      // it is the mechanism - it is how the sparkles drift through the room and
      // how an object dropped over the cauldron falls through the cauldron
      return {dx: entry.dx, dy: entry.dy, dz: entry.dz,
        wantedX: entry.dx, wantedY: entry.dy,
        blockedX: entry.blockedX, blockedY: entry.blockedY, blockedZ: entry.blockedZ,
        standingOn: [], touched: [], pushed: [], carryX: 0, carryY: 0};
    }
    var result = Physics.resolve(entry, entry, this.entries, this.bounds,
      {carried: entry.moveable, self: entry.index,
        // `adj_dX_for_out_of_bounds` returns before it looks at the walls both
        // while the hero stands in an arch and while he is walking in through
        // one; there is nothing else in the game that may be outside the room
        atExit: entry.atArch || entry.entering > 0});
    this.contact(entry, result);
    return result;
  } // resolveStep

  /**
   * `add_dXYZ`: the step, taken.
   *
   * @param {object} entry the entry to move
   * @param {object} result what `resolveStep()` allowed
   */
  applyStep(entry, result) {
    entry.blockedX = result.blockedX;
    entry.blockedY = result.blockedY;
    entry.blockedZ = result.blockedZ;
    entry.dx = result.dx;
    entry.dy = result.dy;
    entry.dz = result.dz;
    entry.x += result.dx;
    entry.y += result.dy;
    entry.z += result.dz;
  } // applyStep

  /**
   * `do_any_objs_intersect` with the box lifted: is there room for the hero one
   * cube higher than he stands? That is the one question the game asks before it
   * lets him put an object down, because putting one down is stepping onto it.
   *
   * @param {object} entry the entry to lift
   * @param {number} lift how far up to try it
   * @returns {boolean} true when something is in the way
   */
  blockedAbove(entry, lift) {
    var raised = {x: entry.x, y: entry.y, z: entry.z+lift,
      sx: entry.sx, sy: entry.sy, sz: entry.sz};
    return Physics.intersectsAny(raised, this.entries, entry.index);
  } // blockedAbove

  /**
   * What touching something does, which the original does inside the collision
   * itself: what is fatal kills, what may be shoved is shoved, and whatever was
   * stood on is told about it - that last one is the whole trigger mechanism of
   * the game, the only way a block ever learns that the hero is on it.
   *
   * @param {object} entry the entry that moved
   * @param {object} result what `Physics.resolve()` reported
   */
  contact(entry, result) {
    var o;
    for (o = 0; o < result.touched.length; o++) {
      var other = this.entries[result.touched[o]];
      if (entry.deadly) {
        other.destroyed = true;
      }
      if (other.deadlyOnHit) {
        entry.destroyed = true;
      }
    }
    for (o = 0; o < result.standingOn.length; o++) {
      this.entries[result.standingOn[o]].triggered = true;
    }
    for (o = 0; o < result.pushed.length; o++) {
      var push = result.pushed[o];
      var shoved = this.entries[push.index];
      if (push.x !== 0) {
        shoved.dx = push.x;
      }
      if (push.y !== 0) {
        shoved.dy = push.y;
      }
    }
  } // contact

  /**
   * `init_death_sparkles`: whatever this was, it is a puff of sparkles now.
   *
   * @param {object} entry the entry that has been killed
   */
  startDeathSparkles(entry) {
    entry.graphic = ObjectTable.firstDeathSparkle;
    entry.ignore3D = true;
  } // startDeathSparkles

  /**
   * The other half of a two part object - a guard's legs under his top half,
   * the hero's chest above his. The original writes to the next slot of the
   * table by adding thirty two to its pointer; the parts of an object are laid
   * out one after the other here too, so it is the next entry as long as it
   * belongs to the same object.
   *
   * @param {object} entry the first part
   * @returns {object|false} the second part, or false when there is none
   */
  follower(entry) {
    var next = this.entries[entry.index+1];
    if (next === undefined || next.part !== entry.part+1) {
      return false;
    }
    return next;
  } // follower

  /** The hero's legs, which are always the first entry (`graphic_objs_tbl`). */
  get player() {
    return this.entries[0];
  } // player

  /**
   * The original's `seed_3`: a byte it stirs with the Z80's refresh register
   * once per object per frame, which makes it genuinely unpredictable - the
   * spiked balls, the ghost and the portcullis all hang off it.
   *
   * A remake has no refresh register, and it wants runs that can be replayed
   * offline, so what stirs the byte here is a plain xorshift. The generator is
   * not the original's and cannot be: what matters is that a handler reading it
   * sees a fresh byte with no pattern in its low bits, which is what the
   * refresh register gave the original for nothing.
   */
  stir() {
    var value = this.seed;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.seed = value|0;
  } // stir

  /**
   * One pseudo random byte, as a handler reads `seed_3`.
   *
   * @returns {number} 0 to 255
   */
  random() {
    return (this.seed >>> 16) & 0xff;
  } // random

  /**
   * The room as the model has to draw it: one row per entry, in table order.
   *
   * @returns {object[]} `{graphic, x, y, z, flipH}` per entry
   */
  picture() {
    var picture = [];
    for (var e = 0; e < this.entries.length; e++) {
      var entry = this.entries[e];
      picture.push({graphic: entry.graphic, x: entry.x, y: entry.y, z: entry.z,
        flipH: entry.flipH});
    }
    return picture;
  } // picture

  /**
   * One entry of the table out of one box of the room data.
   *
   * @param {object} box `{graphic, x, y, z, sx, sy, sz, flags, ...}`
   * @returns {object} the entry
   */
  static newEntry(box) {
    return {
      index: 0,
      // which part of its object this is, so that a two part object can find
      // its other half
      part: box.part|0,
      graphic: box.graphic,
      x: box.x, y: box.y, z: box.z,
      sx: box.sx, sy: box.sy, sz: box.sz,
      // `+9,10,11`: dX and dY live for one frame, dZ is the speed of the fall
      dx: 0, dy: 0, dz: 0,
      // `+7`: the flags of the object. `moveable` is the one that lets a
      // platform carry it and the hero shove it, `ignore3D` marks the parts
      // that are picture only and take no part in the collision at all
      moveable: !!box.moveable,
      ignore3D: !!box.ignore3D,
      flipH: !!box.flipH,
      flipV: !!box.flipV,
      // `+12`: which axes the last step was cut short on
      blockedX: false, blockedY: false, blockedZ: false,
      entering: 0,
      atArch: false,
      // `+7` bit 3: whatever an arch may take by the hand, which is the hero's
      // two halves and nothing else - a collectable object is given flags 0x14
      // when it is put in a room, and bit 3 is not among them
      archAdjust: false,
      // `+14,15`: the unit an arch pulls a thing sideways by, spent by the next
      // step it takes (`calc_plyr_dXY`)
      dxAdjust: 0, dyAdjust: 0,
      // `+13`: the low bits are the direction a guard or a fire is going and
      // the flag a falling ball or a rising ball keeps its way in; the top
      // three are what makes a thing fatal, and what says it has been killed
      dir: 0,
      active: false,
      triggered: false,
      deadly: false,
      deadlyOnHit: false,
      destroyed: false,
      // `+16`: whatever the handler needs to count, and for the two slots a
      // room keeps for collectable objects the record in `SpecialObjects` the
      // slot belongs to - the original's pointer back into `special_objs_tbl`
      spare: 0,
      item: -1,
      // `+13` bit 0 for a collectable object: it has just been put down, so it
      // is drawn again even though it is not moving
      dropped: false,
      // ours: what the room data called it, for the tools and the overlay
      type: box.type,
      source: box.source,
      collision: box.collision,
      motion: box.motion
    };
  } // newEntry

  /**
   * One of the two slots a room keeps for collectable objects.
   *
   * The box is not in the data: `find_special_objs_here` writes the same radii
   * and height into every object it puts in a room, so a collectable object is
   * always the same 10 x 10 x 12 whatever it is a picture of. An empty slot is
   * graphic number zero, which the frame and the collision both pass over.
   *
   * @param {object} spec the `ITEM` constants
   * @param {object} [item] the record from `SpecialObjects.here()`
   * @returns {object} the entry
   */
  static specialEntry(spec, item) {
    var entry = ObjectTable.newEntry({
      part: 0,
      graphic: item === undefined ? ObjectTable.empty : item.graphic,
      x: item === undefined ? 0 : item.x,
      y: item === undefined ? 0 : item.y,
      z: item === undefined ? 0 : item.z,
      sx: spec.radiusX*2, sy: spec.radiusY*2, sz: spec.height,
      // flags 0x14: drawn, and something an arch may hand through a doorway is
      // what `moveable` means for these - a platform carries them too
      moveable: true,
      type: 'object', source: 'special', collision: 'collectible', motion: 'object'
    });
    entry.item = item === undefined ? -1 : item.index;
    return entry;
  } // specialEntry

} // ObjectTable

/** An empty slot of the table: graphic number zero (`retrieve_screen`). */
ObjectTable.empty = 0;

/** The hero's two rows, which every table starts with (`graphic_objs_tbl`). */
ObjectTable.heroSlots = 2;

/**
 * The two graphic numbers that have no entry in `data/sprites.json` because
 * they draw nothing, and so no routine name to look up either. One is the
 * number an object asking to be wiped away is left on, whose routine is the
 * original's `no_update`; the other is the number `upd_103` puts an idol on
 * when it has been taken, which the disassembly marks invalid and whose routine
 * clears the slot on the next frame.
 */
ObjectTable.handlerNames = {1: 'no_update', 111: 'upd_111'};

/**
 * `calc_and_display_percent`: what one room seen, or half an object in the
 * cauldron, is worth of the sixteen bit fraction the percentage is summed in,
 * and the constant added at the end to carry a full game to 100%.
 */
/**
 * How many entries `prepare_final_animation` wipes, counted from the second
 * object slot, and the graphic number of the plain block it turns the rest of
 * the room's blocks from. Both are the original's own numbers and both only
 * make sense in the one room they are ever used in.
 */
ObjectTable.finalWipe = 11;
ObjectTable.plainBlock = 7;

ObjectTable.percentPerUnit = 0xa41a;
ObjectTable.percentRound = 0x28;

/** The first of the sparkles a killed object turns into. */
ObjectTable.firstDeathSparkle = 112;

/** Lives the game starts with (`main`: "5 lives to start"). */
ObjectTable.lives = 5;

/** A room with no arch in any wall, which no room of the castle actually is. */
ObjectTable.noExits = {north: false, east: false, south: false, west: false};

/** The wall of the next room the hero comes in through, per wall he left by. */
ObjectTable.opposite = {north: 'south', east: 'west', south: 'north', west: 'east'};

/** Frames of walking in he owes the arch before the keys are his (`or 0x30`). */
ObjectTable.enteringFrames = 3;

/**
 * How far inside the room the face he leads with is when he comes in
 * (`adjust_plyr_xyz_for_room_size`: `room_size - 2`).
 */
ObjectTable.archStep = 2;

/** Above this graphic number, the original's search for an arch gives up. */
ObjectTable.lastArchGraphic = 5;

/**
 * Which wall an arch stands in, as the original tells: the sum of its near
 * half's centre coordinates, measured from the centre of the room, which is the
 * screen row the sprite lands on (`adjust_plyr_Z_for_arch`, and
 * `NOTES-ORIGINAL.md` chapter 15).
 */
ObjectTable.archKeys = {east: 55, west: 174, north: 81, south: 200};

/** Ask `enterRoom()` for the middle of the room rather than for an arch. */
ObjectTable.middle = 'middle';

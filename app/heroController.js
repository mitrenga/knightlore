// begin code

/**
 * Sabreman under the player's hands: one frame of the original's player update,
 * transcribed from `upd_player_bottom` and the routines it calls
 * (`NOTES-ORIGINAL.md` chapter 13).
 *
 * The order of the frame is the order of that routine and it matters: the
 * transformation is offered, the input is read, the hero turns, the jump
 * starts, the legs animate, and only then does `move_player` build the step,
 * apply gravity, hand the step to the collision and commit it. Turning, walking
 * and jumping are therefore never "the same frame" - a turn costs a frame in
 * which the hero does not walk, and a jump keeps the walk of the frame it
 * started in for its whole flight.
 *
 * Two input methods, both the original's (`user_input_method`):
 * - `rotational` is its keyboard and its two-button joysticks: left and right
 *   turn the hero a quarter turn at a time, a third key walks him forward.
 *   Turning is on a counter, so it takes three frames per quarter turn, and it
 *   is refused while the hero is in the air.
 * - `directional` is its eight-way joystick, and it is what a modern player
 *   expects: each of the four keys names an isometric direction, the hero turns
 *   towards it a quarter turn per frame and walks as soon as he faces it. It
 *   only works with both feet on something.
 *
 * The hero is not a special case of anything: he is the first two entries of
 * `app/objectTable.js`, the legs and the top half, exactly as in the original,
 * and this class is the handler those two entries' graphic numbers point at.
 * That is why a guard can kill him and a platform can carry him without either
 * of them knowing what he is. His state *is* his entry, so the collision moves
 * him the way it moves everything else.
 *
 * His geometry (his 10x10x23 box, his six walking frames, the graphic numbers
 * of his two shapes) is not repeated here: it comes in as `spec`, the `HERO` of
 * `app/hero.js`, so the physics and the drawing cannot disagree about him.
 *
 * A classic script, not a module: it is loaded into the game worker with
 * `importScripts()` alongside `app/physics.js` and `app/objectTable.js`.
 */

class HeroController {

  /**
   * @param {object} spec the `HERO` constants of `app/hero.js`
   */
  constructor(spec) {
    this.spec = spec;
    this.state = null;
    this.top = null;
    /**
     * `pickup_drop_pressed`: the pick up key is one press, one thing. It is a
     * global of the original and it is one here too - it outlives the room and
     * the life, so a key still held down after a death does not empty the hero's
     * hands the moment he comes back.
     */
    this.pickupHeld = false;
  } // constructor

  /**
   * The hero as the first two entries of the object table: his legs, which are
   * the box the game moves, and his top half, which is a picture that follows
   * them (`plyr_spr_init_data`).
   *
   * He does not simply appear. Both halves start on the first of the sparkles
   * he materialises in, which is what the original's start data says and what
   * happens again every time he loses a life; the graphic number he comes back
   * to is kept in `spare`, and the sky decides which of his two shapes it is.
   *
   * The start data is the original's `plyr_spr_1_scratchpad`, and from M7 on it
   * is a copy of him as he was when he walked out of the room before: which way
   * he is facing and which frame of his walk he is in travel with him through
   * the doorway, and so does the handful of frames he owes it. Only his shape is
   * asked of the sky rather than of the copy, exactly as `lose_life` asks.
   *
   * @param {object} start where and how he comes into the room, `{x, y, z}` and
   *   optionally `{direction, frame, entering}`
   * @param {boolean} night true when the moon is up
   * @returns {object[]} the two entries
   */
  entries(start, night) {
    var spec = this.spec;
    var legs = ObjectTable.newEntry({
      part: 0,
      graphic: HeroController.firstAppearSparkle,
      x: start.x, y: start.y, z: start.z,
      sx: spec.radiusX*2, sy: spec.radiusY*2, sz: spec.height,
      moveable: true,
      type: 'hero', source: 'hero', collision: 'solid', motion: 'player'
    });
    // `plyr_spr_init_data`, flags 0x1C and 0x1E: both halves of him are things
    // an arch may line up and hand through a doorway
    legs.archAdjust = true;
    var top = ObjectTable.newEntry({
      part: 1,
      graphic: HeroController.firstAppearSparkle,
      x: start.x, y: start.y, z: start.z+spec.topOffset,
      sx: spec.radiusX*2, sy: spec.radiusY*2, sz: 0,
      moveable: true, ignore3D: true,
      type: 'hero_top', source: 'hero', collision: 'decoration', motion: 'player'
    });
    top.archAdjust = true;

    // his shape is the sky's business, not the start data's: `lose_life` keeps
    // only the low bits of the graphic number it puts back and fills bit 5 in
    // from where the sun is
    legs.form = night ? 'werewolf' : 'human';
    legs.direction = start.direction === undefined ? 0 : start.direction;
    legs.frame = start.frame === undefined ? HeroController.restFrames[0] : start.frame;
    legs.entering = start.entering === undefined ? 0 : start.entering;
    legs.jumping = false;
    // `(ix+13) & 7`, the frames still owed before he may turn again
    legs.turnDelay = 0;
    // indices of the obstacles he last stood on, for the tools and the overlay
    legs.standingOn = [];
    legs.blockedZ = true;
    // `+16`: the graphic number the last of the sparkles brings him back as
    legs.spare = HeroController.legsGraphic(spec, legs);
    top.spare = legs.spare+spec.topHalf;

    this.state = legs;
    this.top = top;
    return [legs, top];
  } // entries

  /**
   * `adjust_plyr_xyz_for_room_size` writing its answer down, and
   * `copy_spr_1_xy_2` right after it: the hero who walked through a doorway,
   * put where the arch of the new room receives him.
   *
   * He is not built again. `retrieve_screen` never touches the two slots of the
   * table he lives in, so what comes through the doorway is *him* - his graphic
   * number, his shape, the way he is facing, the frame of his walk and even the
   * speed he was falling at. The only things written are the three coordinates
   * and the frames of walking in he owes the arch.
   *
   * @param {object} place `{x, y, z, entering}` from `ObjectTable.archStart()`
   * @returns {object[]} his two entries, the same objects as before
   */
  placeAt(place) {
    var legs = this.state;
    var top = this.top;
    legs.x = place.x;
    legs.y = place.y;
    legs.z = place.z;
    legs.entering = place.entering === undefined ? 0 : place.entering;
    // `copy_spr_1_xy_2`: the top half is a picture of where the legs are
    top.x = legs.x;
    top.y = legs.y;
    top.z = legs.z+this.spec.topOffset;
    return [legs, top];
  } // placeAt

  /**
   * `upd_player_bottom`: one frame of the hero.
   *
   * @param {ObjectTable} table the room he is in
   * @param {object} entry his legs, which are his state
   */
  updateBottom(table, entry) {
    if (entry.destroyed) {
      var top = table.follower(entry);
      if (top !== false) {
        top.destroyed = true;
      }
      table.startDeathSparkles(entry);
      return;
    }
    if (this.checkTransform(table, entry)) {
      return;
    }
    var wanted = this.readInput(table.input);
    this.handlePickupDrop(table, entry, this.pickupPressed(wanted, table.input.method));
    this.handleTurning(wanted, table.input.method);
    this.handleJump(wanted);
    this.handleWalkAnimation(wanted);
    this.checkOutOfRoom(table);
    this.movePlayer(table, entry, wanted);
    if (entry.entering > 0) {
      entry.entering--;
    }
    entry.graphic = HeroController.legsGraphic(this.spec, entry);
    entry.flipH = entry.direction > 1;
  } // updateBottom

  /**
   * `upd_player_top`: the half of the hero that is only a picture. It copies
   * the legs' position, sits twelve units above them and takes no part in the
   * collision - and every so often, when it has nothing else to do, it looks
   * over one shoulder or the other for eight frames.
   *
   * @param {ObjectTable} table the room he is in
   * @param {object} entry his top half
   */
  updateTop(table, entry) {
    if (entry.destroyed) {
      table.startDeathSparkles(entry);
      return;
    }
    var legs = table.entries[entry.index-1];
    entry.x = legs.x;
    entry.y = legs.y;
    entry.sx = legs.sx;
    entry.sy = legs.sy;
    entry.sz = 0;
    entry.flipH = legs.flipH;
    entry.ignore3D = true;
    entry.z = legs.z+this.spec.topOffset;
    // the original counts the frames of a glance in the low bits of the byte a
    // walking object keeps its direction in; up here that byte is free
    if (entry.dir > 0) {
      entry.dir--;
      return;
    }
    var look = table.random();
    if (look < HeroController.glanceChance) {
      entry.graphic = (legs.graphic & 0xf8) | HeroController.glanceLeft;
      entry.dir = HeroController.glanceFrames;
    } else if (look >= 256-HeroController.glanceChance) {
      entry.graphic = (legs.graphic & 0xf8) | HeroController.glanceRight;
      entry.dir = HeroController.glanceFrames;
    } else {
      entry.graphic = legs.graphic;
    }
    entry.graphic += this.spec.topHalf;
  } // updateTop

  /**
   * `chk_and_init_transform`: the sky has turned over, so the hero turns into
   * the other one of himself. He may not do it in mid air, and he may not do it
   * while he is walking in through an arch, so the change waits for him to
   * land; once it starts he is eight flickers of `upd_92_to_95` and nothing
   * else, and his top half is wiped away for the duration.
   *
   * @param {ObjectTable} table the room he is in
   * @param {object} entry his legs
   * @returns {boolean} true when the rest of his frame is to be skipped
   */
  checkTransform(table, entry) {
    if (!table.dayNight.transformPending || entry.entering > 0 || entry.jumping) {
      return false;
    }
    table.dayNight.transformPending = false;
    entry.spare = HeroController.transformFlickers;
    var top = table.follower(entry);
    if (top !== false) {
      top.graphic = ObjectMotion.wipeGraphic;
    }
    ObjectMotion.transformSprite(table, entry);
    return true;
  } // checkTransform

  /**
   * The end of `upd_92_to_95`: man and beast change places, and the top half
   * comes back sixteen graphic numbers above the legs.
   *
   * @param {ObjectTable} table the room he is in
   * @param {object} entry his legs
   */
  finishTransform(table, entry) {
    entry.form = entry.form == 'werewolf' ? 'human' : 'werewolf';
    entry.graphic = HeroController.legsGraphic(this.spec, entry);
    entry.flipH = entry.direction > 1;
    entry.spare = entry.graphic;
    var top = table.follower(entry);
    if (top !== false) {
      top.graphic = entry.graphic+this.spec.topHalf;
      top.spare = top.graphic;
      top.destroyed = false;
    }
  } // finishTransform

  /**
   * Is this the werewolf? The one question the rest of the room asks about the
   * hero - the bouncing ball hops towards the beast and away from the man - and
   * the original asks it of his graphic number, not of any flag.
   *
   * @param {object} entry his legs
   * @returns {boolean} true at night
   */
  isWerewolf(entry) {
    return entry.form == 'werewolf';
  } // isWerewolf

  /**
   * The hero's collision box in world units. His state is his box, so this is
   * the state; it stays a method because the tools ask for it.
   *
   * @returns {object} `{x, y, z, sx, sy, sz}`
   */
  box() {
    return this.state;
  } // box

  /**
   * `check_user_input`: the five bits the rest of the frame works with.
   *
   * They are the original's six and no more, and which of them means what
   * depends on the method - which is worth knowing before reading
   * `turnTowards()`. The four bits an eight-way joystick sets by being pushed
   * are `left`, `right`, `forward` (up) and `pickup` (down), and the directional
   * method reads all four as directions; `pickup` is only the pick up key for
   * the keyboard, which has no down. So the original gives the eight-way method
   * a sixth bit for picking up (`chk_pickup_drop` shifts the byte along and
   * reads bit 5), and that is `take`. Only the direction each bit aims at is
   * turned a quarter round in `turnTowards()`, to follow the screen.
   *
   * @param {object} input the keys held this frame
   * @returns {object} `{left, right, forward, jump, pickup, take}`
   */
  readInput(input) {
    return {
      left: !!input.left,
      right: !!input.right,
      forward: !!input.forward,
      jump: !!input.jump,
      pickup: !!input.pickup,
      take: !!input.take
    };
  } // readInput

  /**
   * `chk_pickup_drop`: which of the six bits is the pick up key, which is not
   * the same bit in both methods.
   *
   * With the keyboard it is bit 4, the one an eight-way joystick sets by being
   * pulled down. That is why the eight-way method cannot use it: down is a
   * direction there, so the original shifts the byte along and reads bit 5
   * instead, which is a key of its own on the bottom row of the keyboard.
   *
   * @param {object} wanted the input of this frame
   * @param {string} method 'rotational' or 'directional'
   * @returns {boolean} true when the pick up key is down
   */
  pickupPressed(wanted, method) {
    return method == 'directional' ? wanted.take : wanted.pickup;
  } // pickupPressed

  /**
   * `handle_left_right`, both of its branches.
   *
   * @param {object} wanted the input of this frame, `forward` set in place
   * @param {string} method 'rotational' or 'directional'
   */
  handleTurning(wanted, method) {
    if (method == 'directional') {
      this.turnTowards(wanted);
      return;
    }
    var state = this.state;
    if (state.turnDelay > 0) {
      state.turnDelay--;
      return;
    }
    if (!wanted.left && !wanted.right) {
      return;
    }
    if (state.entering > 0 || state.jumping) {
      return;
    }
    state.turnDelay = HeroController.turnDelay;
    this.turn(wanted.right ? 'right' : 'left');
  } // handleTurning

  /**
   * The eight-way branch of `handle_left_right`: pick the direction the keys
   * name, walk when the hero already faces it and take one quarter turn
   * towards it when he does not. Turning needs the ground: the original tests
   * the Z flag the last collision left behind.
   *
   * @param {object} wanted the input of this frame, `forward` set in place
   */
  turnTowards(wanted) {
    var state = this.state;
    if (state.entering > 0 || !state.blockedZ) {
      return;
    }
    // The keys are read a quarter turn round from the original: the isometric
    // room is drawn with north running up and to the right, so the key that
    // points up on the keyboard is the one that moves the hero up and to the
    // left on the screen (west), and the other three follow it round.
    // The original's order of the tests is kept, the first one still making
    // the second unreachable while the player is asking for that direction.
    var target = -1;
    if (!wanted.left && wanted.forward) {
      target = 0;
    } else if (wanted.right) {
      target = 2;
    } else if (wanted.pickup) {
      target = 1;
    } else if (wanted.left) {
      target = 3;
    }
    if (target < 0) {
      wanted.forward = false;
      return;
    }
    var step = HeroController.towards[target][state.direction];
    if (step == 'forward') {
      wanted.forward = true;
      return;
    }
    // the forward bit is left exactly as the keys set it, so a hero asked for
    // north while he faces east turns and keeps walking east for the frame,
    // while one asked for east while he faces north turns on the spot
    this.turn(step);
  } // turnTowards

  /**
   * A quarter turn. The original does it by toggling bit 3 of the graphic
   * number and the horizontal flip, which comes out as these two cycles.
   *
   * @param {string} side 'left' or 'right'
   */
  turn(side) {
    var cycle = side == 'right' ? HeroController.turnRight : HeroController.turnLeft;
    this.state.direction = cycle[this.state.direction];
  } // turn

  /**
   * `handle_jump`. The jump may also be started in the first frame of a fall,
   * which is what `dZ + 1` not being negative allows.
   *
   * @param {object} wanted the input of this frame
   */
  handleJump(wanted) {
    var state = this.state;
    if (!wanted.jump || state.entering > 0 || state.jumping || state.dz < -1) {
      return;
    }
    state.jumping = true;
    state.dz = HeroController.jumpSpeed;
  } // handleJump

  /**
   * `handle_forward`: the legs run through their six frames while the hero
   * walks, is in the air or is entering the room, and otherwise keep going only
   * until they reach one of the two frames he stands still in.
   *
   * @param {object} wanted the input of this frame
   */
  handleWalkAnimation(wanted) {
    var state = this.state;
    if (state.entering > 0 || state.jumping || wanted.forward) {
      state.frame = (state.frame+1)%this.spec.frames;
      return;
    }
    if (HeroController.restFrames.indexOf(state.frame) >= 0) {
      return;
    }
    state.frame = (state.frame+1)%this.spec.frames;
  } // handleWalkAnimation

  /**
   * `handle_pickup_drop`: the fifth key, which does two things and decides which
   * of them by looking around.
   *
   * The whole of it is one press: the key has to be let go of before it counts
   * again, and it is refused while the hero is in a doorway, in the air, or not
   * standing on anything. Then, in this order:
   *
   * - if a collectable object is within reach - which is his box grown by four
   *   units in every direction, and reaching four units below his feet - he
   *   picks it up. Reach is tested against the two slots the room keeps for
   *   objects and nothing else, so nothing that is not an object can be lifted.
   * - otherwise, if there is a free slot in the room, he puts down the object at
   *   the back of his queue - **at his own feet**, and he steps up onto it. In
   *   the cauldron's room only the first of the two slots counts, which is why
   *   two objects can never be put down in there.
   * - and if he is carrying nothing at all, the queue still shifts along, which
   *   is the original doing the same `LDDR` either way.
   *
   * Where he can put it down is one test taken before anything else: whether
   * there is room for *him* one cube higher than he stands, because dropping an
   * object is standing on it.
   *
   * @param {ObjectTable} table the room he is in
   * @param {object} entry his legs
   * @param {boolean} pressed whether the pick up key is down this frame
   */
  handlePickupDrop(table, entry, pressed) {
    if (this.pickupHeld) {
      this.pickupHeld = pressed;
      return;
    }
    if (!pressed || this.outOfRoom(table) || entry.jumping || !entry.blockedZ) {
      return;
    }
    this.pickupHeld = true;
    var specials = table.specialSlots();
    // `cant_drop`: an object goes where the hero stands and the hero goes one
    // cube up, so he needs the room up there
    var cantDrop = table.blockedAbove(entry, HeroController.dropLift);
    var s;
    for (s = 0; s < specials.length; s++) {
      if (table.specials.carriable(specials[s].graphic)
        && this.nearObject(entry, specials[s], HeroController.reach, HeroController.reach)) {
        table.specials.pickUp(specials[s]);
        table.disableSpikeBallDrop = false;
        return;
      }
    }
    var slots = table.roomId === table.specials.spec.cauldronRoom ? 1 : specials.length;
    for (s = 0; s < slots; s++) {
      if (specials[s].graphic === ObjectTable.empty) {
        this.dropObject(table, entry, specials[s], cantDrop);
        return;
      }
    }
  } // handlePickupDrop

  /**
   * `room_to_drop`: the object at the back of the queue is put down in the given
   * slot.
   *
   * In the cauldron's room, and only if the hero is standing high enough to be
   * on the cauldron's own ledge, the graphic number is given bit 3 - and that
   * one bit is the difference between an object lying on the floor and an object
   * on its way into the cauldron (`upd_96_to_102` against `upd_104_to_110`).
   *
   * @param {ObjectTable} table the room he is in
   * @param {object} entry his legs
   * @param {object} slot the free slot to put it in
   * @param {boolean} cantDrop true when there is no room above him
   */
  dropObject(table, entry, slot, cantDrop) {
    var carried = table.specials.last;
    if (carried === false) {
      table.specials.shift();
      return;
    }
    if (cantDrop) {
      return;
    }
    var graphic = carried.graphic;
    if (table.roomId === table.specials.spec.cauldronRoom
      && entry.z >= HeroController.cauldronLedge) {
      graphic |= 8;
      table.specials.dropping = true;
    }
    slot.graphic = graphic;
    slot.item = carried.item;
    slot.dropped = true;
    // his box and the object's have the same footprint, so his corner is its
    // corner: the original copies the three coordinates across as they stand
    slot.x = entry.x;
    slot.y = entry.y;
    slot.z = entry.z;
    entry.z += HeroController.dropLift;
    var top = table.follower(entry);
    if (top !== false) {
      top.z += HeroController.dropLift;
    }
    table.specials.shift();
  } // dropObject

  /**
   * `is_on_or_near_obj`: is the hero close enough to a thing to take it?
   *
   * The box he is measured with is not the box he walks with. It is grown by
   * `grow` units in each direction on the floor and by as much again in height,
   * and then dropped four units - so he can reach a little below his feet but
   * nothing above his head.
   *
   * @param {object} entry his legs
   * @param {object} other the thing to reach for
   * @param {number} grow units added to each of his radii
   * @param {number} taller units added to his height
   * @returns {boolean} true when the two boxes overlap
   */
  nearObject(entry, other, grow, taller) {
    var low = entry.z-HeroController.reachBelow;
    return entry.x-grow < other.x+other.sx && other.x < entry.x+entry.sx+grow
      && entry.y-grow < other.y+other.sy && other.y < entry.y+entry.sy+grow
      && low < other.z+other.sz && other.z < low+entry.sz+taller;
  } // nearObject

  /**
   * `chk_plyr_OOB`: is any part of the hero outside the room? Which only ever
   * happens in a doorway, and is what stops him picking anything up there.
   *
   * @param {ObjectTable} table the room he is in
   * @returns {boolean} true when he is leaning out
   */
  outOfRoom(table) {
    var state = this.state;
    if (table.bounds === false) {
      return false;
    }
    return state.x <= 0 || state.x+state.sx >= table.bounds.x
      || state.y <= 0 || state.y+state.sy >= table.bounds.y;
  } // outOfRoom

  /**
   * `chk_plyr_OOB`: while the hero sticks out of the room - which only happens
   * in a doorway, and so only once the arches hand him through in M7 - he may
   * fall but he may not rise, so a jump taken in an arch is thrown away.
   *
   * @param {ObjectTable} table the room he is in
   */
  checkOutOfRoom(table) {
    if (this.outOfRoom(table) && this.state.dz >= 0) {
      this.state.dz = 0;
    }
  } // checkOutOfRoom

  /**
   * `handle_exit_screen`: the hero is standing in a doorway, and the step he is
   * about to take would put the whole of him outside the room, so he is not
   * inside it any more - he is in the next one.
   *
   * Three things have to be true, and all three are the original's. He may not
   * already be walking in through an arch, or a room would be left the moment
   * it was entered; he has to be **at** an arch, which is the flag the arch
   * itself set last frame and which this routine spends; and the side of the
   * room he leaves by is the side **he is facing**, not the side he happens to
   * be nearest - a hero shoved sideways out of a doorway by a guard stays where
   * he is.
   *
   * The step is measured against the room the way `screen_west` and its three
   * siblings measure it: the box has to have left the room altogether, which
   * after `chk_plyr_OOB` has let him lean out of the doorway takes another few
   * frames of walking.
   *
   * @param {ObjectTable} table the room he is in
   * @param {object} result the step the collision allowed him
   * @returns {boolean} true when the room is changing and this frame is over
   */
  handleExitScreen(table, result) {
    var state = this.state;
    if (state.entering > 0 || !state.atArch || table.bounds === false) {
      return false;
    }
    state.atArch = false;
    var wall = HeroController.walls[state.direction];
    var axis = wall.axis;
    var size = axis == 'x' ? 'sx' : 'sy';
    var edge = state[axis]+result[axis == 'x' ? 'dx' : 'dy'];
    var gone = wall.beyond ? edge >= table.bounds[axis] : edge+state[size] < 0;
    return gone && table.exitRoom(wall.direction);
  } // handleExitScreen

  /**
   * `move_player`: build the step, let gravity have the vertical, hand the whole
   * thing to the collision and commit what comes back.
   *
   * @param {ObjectTable} table the room he is in
   * @param {object} entry his legs
   * @param {object} wanted the input of this frame
   * @returns {object} the result of `Physics.resolve()`
   */
  movePlayer(table, entry, wanted) {
    var state = this.state;

    if (table.specials.dropping) {
      // `move_player`, its very first line: while an object is on its way into
      // the cauldron the hero is given a rising step of two, which the two units
      // of gravity below take straight back off him. He hangs in the air and
      // watches, which is the only ceremony the game has
      state.dz = HeroController.cauldronHold;
    }

    if (state.jumping || state.entering > 0 || wanted.forward) {
      this.walkStep();
    }

    // gravity: two units a frame, but only one while the hero is still rising
    // and the jump key is still held - holding it is what makes a jump high
    var falling = state.dz < 0;
    state.dz -= (!falling && wanted.jump) ? 1 : 2;
    var wantedDz = state.dz;

    // the collision first, then the doorway, then the step: `move_player` calls
    // `adj_for_out_of_bounds`, `handle_exit_screen` and `add_dXYZ` in that order,
    // and the frame he leaves the room in is a frame whose step is never taken
    var result = table.resolveStep(entry);
    state.standingOn = result.standingOn;
    if (this.handleExitScreen(table, result)) {
      return result;
    }
    table.applyStep(entry, result);

    // landing: the vertical was cut short while the hero was on his way down
    if (result.blockedZ && wantedDz < 0) {
      state.jumping = false;
    }

    // dX and dY are a per frame thing; only the falling speed survives
    state.dx = 0;
    state.dy = 0;
    return result;
  } // movePlayer

  /**
   * `calc_plyr_dXY`: three units in the direction the hero faces, plus whatever
   * was pushed into him since the last frame.
   */
  walkStep() {
    var state = this.state;
    var step = HeroController.walk[state.direction];
    // whatever an arch pulled him by since the last frame goes in first and is
    // then forgotten - it is a nudge, not a speed
    state.dx += state.dxAdjust;
    state.dy += state.dyAdjust;
    state.dxAdjust = 0;
    state.dyAdjust = 0;
    state.dx += step.x;
    state.dy += step.y;
  } // walkStep

  /**
   * The graphic number of the hero's legs, which is his whole appearance:
   * bit 5 is man or beast, bit 3 with the horizontal flip is the direction he
   * faces, and the low three bits are the frame of his walk (`get_sprite_dir`).
   *
   * `heroLegs()` in `app/hero.js` is the same encoding on the drawing side,
   * for the offline renderer, which has no worker to ask.
   *
   * @param {object} spec the `HERO` constants
   * @param {object} state the hero's legs entry
   * @returns {number} the graphic number
   */
  static legsGraphic(spec, state) {
    var base = state.form == 'werewolf' ? spec.werewolf : spec.human;
    return base+((state.direction & 1) ? 8 : 0)+(state.frame%spec.frames);
  } // legsGraphic

} // HeroController

/**
 * How far the hero reaches for an object (`handle_pickup_drop` grows each of his
 * radii and his height by four) and how far below his feet that reach goes
 * (`is_on_or_near_obj` drops his Z by four for the height test).
 */
HeroController.reach = 4;
HeroController.reachBelow = 4;

/**
 * How far he rises when he puts an object down: one cube, because the object
 * goes where he is standing and he ends up standing on it.
 */
HeroController.dropLift = 12;

/**
 * How high he has to be standing in the cauldron's room for an object he puts
 * down to go into the cauldron rather than onto the floor (`cp 152`, which is
 * two cubes above the floor).
 */
HeroController.cauldronLedge = 24;

/** The step `move_player` gives him while an object goes in (`ld (ix+11), 2`). */
HeroController.cauldronHold = 2;

/** Units the hero walks per frame (`move_plyr_W` and its three siblings). */
HeroController.walkSpeed = 3;

/** The vertical speed a jump starts with (`handle_jump`). */
HeroController.jumpSpeed = 8;

/** Frames owed after a quarter turn in the rotational method (`(ix+13) or 2`). */
HeroController.turnDelay = 2;

/** The two walking frames the hero may be left standing in (`loc_C994`). */
HeroController.restFrames = [2, 4];

/** The first of the sparkles he materialises in (`plyr_spr_init_data`). */
HeroController.firstAppearSparkle = 120;

/** Flickers one transformation takes (`chk_and_init_transform`). */
HeroController.transformFlickers = 8;

/** The two frames of his walk in which he is looking over a shoulder. */
HeroController.glanceLeft = 6;
HeroController.glanceRight = 7;

/** How long a glance lasts, and how likely it is out of 256 (`upd_player_top`). */
HeroController.glanceFrames = 8;
HeroController.glanceChance = 2;

/**
 * The step of one frame of walking, per direction. West and east are the x
 * axis, north and south the y axis; the signs are the original's, read off
 * `off_CA32`.
 */
HeroController.walk = [
  {x: -HeroController.walkSpeed, y: 0},
  {x: HeroController.walkSpeed, y: 0},
  {x: 0, y: HeroController.walkSpeed},
  {x: 0, y: -HeroController.walkSpeed}
];

/**
 * The wall each of the four directions leads out through, in the order the
 * original's `screen_move_tbl` holds them: west, east, north, south. `beyond`
 * is the wall the box has to be past, rather than short of.
 */
HeroController.walls = [
  {direction: 'west',  axis: 'x', beyond: false},
  {direction: 'east',  axis: 'x', beyond: true},
  {direction: 'north', axis: 'y', beyond: true},
  {direction: 'south', axis: 'y', beyond: false}
];

/** Where a quarter turn to the left leads: W to S to E to N and round again. */
HeroController.turnLeft = [3, 2, 0, 1];

/** Where a quarter turn to the right leads: W to N to E to S and round again. */
HeroController.turnRight = [2, 3, 1, 0];

/**
 * What to do to face the direction the player asked for, indexed by the wanted
 * direction and then by the one the hero faces (`chk_facing_N` and its three
 * siblings). Where the two turns are equally long the original has a
 * preference, and this table keeps it.
 */
HeroController.towards = [
  ['forward', 'right', 'left', 'right'],
  ['right', 'forward', 'right', 'left'],
  ['right', 'left', 'forward', 'left'],
  ['left', 'right', 'left', 'forward']
];

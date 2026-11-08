// begin code

/**
 * What every kind of object in a room does with its frame: the original's
 * `upd_sprite_jmp_tbl` (line 2131), routine by routine.
 *
 * The most important thing about this table is what it is indexed by. The
 * original does not ask what *type* a block is - the room data has long been
 * forgotten by the time an object moves - it asks what its **graphic number**
 * is, and jumps. A guard walking west and a guard walking east are two graphic
 * numbers with one handler; a block that has been triggered into falling is a
 * different graphic number from the block it was a moment ago, and so has a
 * different handler; and the hero is nothing but the entry whose graphic number
 * happens to be one of his. `data/sprites.json` carries the name of the routine
 * every one of the 188 graphic numbers points at, traced from the disassembly
 * in M3, so this file is keyed by those names and the room data does not have
 * to say a word about behaviour.
 *
 * Handlers take the table and their own entry, and reach the room through the
 * table: it owns the clock, the pseudo random bytes and the handful of globals
 * the original keeps per room (whether a portcullis is moving, whether a spiked
 * ball is already falling, how high the bouncing balls bounce).
 *
 * Most of the 40-odd handlers of the original are one instruction long - they
 * set the pixel offset the sprite is drawn at and return - because the objects
 * they belong to are the walls, the arches and the plain blocks, which never
 * move. Those offsets are data here (`app/spriteSheet.js` has them from M3), so
 * every one of them comes out as `ObjectMotion.still`. What is left is this
 * file: two dozen behaviours, none of them longer than a screen.
 *
 * A classic script, not a module: it is loaded into the game worker with
 * `importScripts()` alongside `app/physics.js`, and the offline tools run this
 * very file through `tools/lib/workerScripts.js`.
 */

var ObjectMotion = {

  /**
   * The handler of one entry, by the name of the original's routine.
   *
   * @param {ObjectTable} table the room's object table
   * @param {object} entry the entry to update
   * @param {string} handler name of the routine, from `sheet.graphics`
   * @returns {boolean} false when there is no such routine here
   */
  update: function(table, entry, handler) {
    var routine = ObjectMotion.handlers[handler];
    if (routine === undefined) {
      return false;
    }
    routine(table, entry);
    return true;
  }, // update

  /**
   * A picture and nothing else: the walls, the arches, the plain blocks, the
   * sun and the moon of the panel. The original's handler for these is the one
   * instruction that sets the sprite's pixel offset, which is data here.
   */
  still: function() {
  }, // still

  /**
   * `get_sprite_dir`: which way a thing that walks the four isometric
   * directions is facing, read out of its graphic number and its flip exactly
   * as the original reads it - bit 3 of the number tells west from east and the
   * horizontal flip turns both of them into north and south. The hero keeps a
   * `direction` of his own as well, and it is the same number; an arch asks the
   * graphic, because an arch has no idea what it is talking to.
   *
   * @param {object} entry the entry to read
   * @returns {number} 0 west, 1 east, 2 north, 3 south
   */
  spriteDir: function(entry) {
    return ((entry.graphic & 8) ? 1 : 0)+(entry.flipH ? 2 : 0);
  }, // spriteDir

  /**
   * `upd_2_4` in full: the near half of an arch, which is the only piece of a
   * room that knows anything about leaving it.
   *
   * The arch does not test the doorway. It works out one point - thirteen units
   * towards the room from its own centre, which is the middle of the opening -
   * and then looks through the head of the object table for anything that may
   * be taken by the hand (`archAdjust`), twice:
   *
   * - close to that point, within six units across the doorway and fifteen
   *   along it, and within four of the arch's own height: that thing is **at an
   *   arch**, which is what turns the room's walls off for it and what lets
   *   `handle_exit_screen` hand it to the next room.
   * - loosely near it, fifteen units either way: that thing is pulled one unit
   *   towards the middle of the opening per frame, so that a hero who walks at
   *   a doorway slightly off centre is lined up with it by the time he gets
   *   there. It is the friendliest thing in the game and it is entirely
   *   invisible.
   *
   * Which way the point lies is the arch's horizontal flip: an arch in the
   * north or the south wall is drawn mirrored and probes along x, one in the
   * east or the west wall probes along y. That holds for every arch in all 128
   * rooms.
   *
   * @param {ObjectTable} table the room the arch is in
   * @param {object} entry the arch's near half
   */
  arch: function(table, entry) {
    var probe = ObjectMotion.archProbe(entry);
    // the original walks the first four slots of the table only - the hero's two
    // halves and the two slots a room keeps for collectable objects - and of
    // those only the ones flagged `archAdjust`, which is the hero. An object is
    // given flags 0x14 when it is put in a room and bit 3 is not among them, so
    // an arch neither lines an object up nor hands it through a doorway
    var count = Math.min(ObjectMotion.archReach, table.entries.length);
    var e, other;
    for (e = 0; e < count; e++) {
      other = table.entries[e];
      if (other.graphic === ObjectTable.empty || !other.archAdjust) {
        continue;
      }
      if (ObjectMotion.nearArch(probe, other, probe.tolX, probe.tolY)) {
        other.atArch = true;
      }
    }
    for (e = 0; e < count; e++) {
      other = table.entries[e];
      if (other.graphic === ObjectTable.empty || !other.archAdjust) {
        continue;
      }
      if (ObjectMotion.nearArch(probe, other, ObjectMotion.archPull, ObjectMotion.archPull)) {
        ObjectMotion.archAlign(probe, other);
      }
    }
  }, // arch

  /**
   * The middle of an arch's opening, and how near a thing has to be to it to
   * count as standing in the doorway (`upd_2_4`, `adj_2_4_hflip`).
   *
   * @param {object} entry the arch's near half
   * @returns {object} `{x, y, z, tolX, tolY}`
   */
  archProbe: function(entry) {
    var x = ObjectMotion.centre(entry, 'x');
    var y = ObjectMotion.centre(entry, 'y');
    return entry.flipH
      ? {x: x-ObjectMotion.archDoorway, y: y, z: entry.z,
        tolX: ObjectMotion.archAcross, tolY: ObjectMotion.archAlong}
      : {x: x, y: y+ObjectMotion.archDoorway, z: entry.z,
        tolX: ObjectMotion.archAlong, tolY: ObjectMotion.archAcross};
  }, // archProbe

  /**
   * `is_near_to`: is the thing's centre inside the box of tolerances around the
   * point, and standing within four units of the arch's own floor? The height
   * is what keeps a hero in mid air from being handed through a doorway.
   *
   * @param {object} probe the point from `archProbe()`
   * @param {object} entry the thing to measure
   * @param {number} tolX how far it may be along x
   * @param {number} tolY how far it may be along y
   * @returns {boolean} true when it is near
   */
  nearArch: function(probe, entry, tolX, tolY) {
    return Math.abs(probe.x-ObjectMotion.centre(entry, 'x')) < tolX
      && Math.abs(probe.y-ObjectMotion.centre(entry, 'y')) < tolY
      && Math.abs(probe.z-entry.z) < ObjectMotion.archHeight;
  }, // nearArch

  /**
   * `adj_ew` and `adj_ns`: one unit towards the middle of the opening, across
   * the way the thing is facing. It is stored rather than applied, and the
   * step it takes next frame spends it.
   *
   * @param {object} probe the point from `archProbe()`
   * @param {object} entry the thing to pull straight
   */
  archAlign: function(probe, entry) {
    var axis = ObjectMotion.spriteDir(entry) < 2 ? 'y' : 'x';
    var centre = ObjectMotion.centre(entry, axis);
    if (probe[axis] === centre) {
      return;
    }
    entry[axis == 'x' ? 'dxAdjust' : 'dyAdjust'] = probe[axis] > centre ? 1 : -1;
  }, // archAlign

  /**
   * `set_both_deadly_flags`: fatal if you hit it, fatal if it hits you. The
   * hazards set both flags on themselves every single frame, because the
   * collision clears nothing and the flags of an object that has just been
   * rebuilt with the room have to come back.
   *
   * @param {ObjectTable} table the room's object table
   * @param {object} entry the entry to arm
   */
  deadly: function(table, entry) {
    entry.deadly = true;
    entry.deadlyOnHit = true;
  }, // deadly

  /**
   * The centre of an entry along one axis. The original stores centres and
   * radii, so wherever it compares two objects' positions it is comparing
   * centres; our boxes are corners and sizes, so the centre is worked out here
   * rather than the comparison quietly moving by half a box.
   *
   * @param {object} entry the entry
   * @param {string} axis 'x' or 'y'
   * @returns {number} the centre along that axis
   */
  centre: function(entry, axis) {
    return entry[axis]+entry[axis == 'x' ? 'sx' : 'sy']/2;
  }, // centre

  /**
   * `move_towards_plyr`: a step of the given length along both axes, each
   * signed so that it points at the hero.
   *
   * @param {ObjectTable} table the room's object table
   * @param {object} entry the entry to steer
   * @param {number} speed units per frame along each axis
   */
  /**
   * The last line of `upd_131_to_133`: is the sparkle on top of the hero? Both
   * axes measured between centres, and the height is not asked about at all.
   *
   * @param {ObjectTable} table the room
   * @param {object} entry the sparkle
   * @param {number} reach how near counts
   * @returns {boolean} true when it has caught him
   */
  reachedPlayer: function(table, entry, reach) {
    var player = table.player;
    return Math.abs(ObjectMotion.centre(player, 'x')-ObjectMotion.centre(entry, 'x')) < reach
      && Math.abs(ObjectMotion.centre(player, 'y')-ObjectMotion.centre(entry, 'y')) < reach;
  }, // reachedPlayer

  /**
   * `add_obj_to_cauldron`: an object has reached the middle of the cauldron.
   *
   * The cauldron takes whatever it is given and keeps none of it: the object is
   * gone either way, and only the one it was asking for moves the sequence
   * along. The fourteenth right one is the end of the game, and the room it is
   * standing in comes apart on the spot.
   *
   * @param {ObjectTable} table the room
   * @param {object} entry the object going in
   */
  intoCauldron: function(table, entry) {
    entry.z = ObjectMotion.cauldronMouth;
    table.specials.putInCauldron(entry.graphic & 7);
    if (table.specials.allInCauldron) {
      table.prepareFinalAnimation();
    }
    table.specials.take(entry);
    ObjectMotion.handlers.upd_111(table, entry);
  }, // intoCauldron

  towardsPlayer: function(table, entry, speed) {
    var player = table.player;
    entry.dx = ObjectMotion.centre(entry, 'x') < ObjectMotion.centre(player, 'x') ? speed : -speed;
    entry.dy = ObjectMotion.centre(entry, 'y') < ObjectMotion.centre(player, 'y') ? speed : -speed;
  }, // towardsPlayer

  /**
   * `toggle_next_prev_sprite`: the two frame animation of the fires, the balls
   * and the ghost is bit 0 of the graphic number.
   *
   * @param {object} entry the entry to animate
   */
  toggleSprite: function(entry) {
    entry.graphic ^= 1;
  }, // toggleSprite

  /**
   * `next_graphic_no_mod_4`: the four frame animation of the sparkles and the
   * spells is the low two bits of the graphic number.
   *
   * @param {object} entry the entry to animate
   */
  nextSpriteOfFour: function(entry) {
    entry.graphic = (entry.graphic & 0xfc) | ((entry.graphic+1) & 3);
  }, // nextSpriteOfFour

  /**
   * `animate_human_legs`: the six frame walk of the hero, the guards and the
   * wizard is the low three bits of the graphic number, wrapping at six - the
   * two remaining values are the two frames a figure may stand still in.
   *
   * @param {object} entry the entry to animate
   */
  animateLegs: function(entry) {
    var frame = (entry.graphic+1) & 7;
    entry.graphic = (entry.graphic & 0xf8) | (frame == 6 ? 0 : frame);
  }, // animateLegs

  /**
   * Which way a walking figure faces, from the step it is taking: bit 3 of the
   * graphic number together with the horizontal flip, the same four way
   * encoding the hero uses (`set_guard_wizard_sprite` for the guards' top
   * halves does it with bit 0 instead, and `facingBit()` takes the bit).
   *
   * The original compares dX with dY as unsigned bytes, which for the only
   * values that ever get here - zero and plus or minus two - means "is the
   * object moving along Y at all", because a negative delta is a large byte.
   * That comparison is kept rather than tidied, because it is the reason a
   * figure moving diagonally faces along Y.
   *
   * @param {object} entry the entry to point
   * @param {number} bit which bit of the graphic number carries the facing
   */
  facingBit: function(entry, bit) {
    if (entry.dx === 0 && entry.dy === 0) {
      return;
    }
    if ((entry.dx & 0xff) < (entry.dy & 0xff)) {
      // along Y: north clears the bit, south sets it, both mirrored
      ObjectMotion.setFacing(entry, bit, entry.dy < 0, true);
      return;
    }
    // along X: west clears the bit, east sets it, neither mirrored
    ObjectMotion.setFacing(entry, bit, entry.dx >= 0, false);
  }, // facingBit

  /**
   * Writes one facing into a graphic number and a flip.
   *
   * @param {object} entry the entry to point
   * @param {number} bit which bit of the graphic number carries the facing
   * @param {boolean} set whether that bit is set
   * @param {boolean} flip whether the sprite is mirrored
   */
  setFacing: function(entry, bit, set, flip) {
    var mask = 1 << bit;
    entry.graphic = set ? (entry.graphic | mask) : (entry.graphic & ~mask);
    entry.flipH = flip;
  } // setFacing

}; // ObjectMotion

/**
 * The routines of `upd_sprite_jmp_tbl`, by the name the disassembly gives them.
 * The comments are the original's own.
 */
ObjectMotion.handlers = {

  // ---------------------------------------------------------------- pictures

  /** unused graphic numbers, and the two halves of the cauldron (M8). */
  no_update: ObjectMotion.still,
  /**
   * The near half of every arch, which is where a room's doorways live
   * (`ObjectMotion.arch`), and the far half, which is only a picture.
   */
  upd_2_4: function(table, entry) {
    ObjectMotion.arch(table, entry);
  },
  upd_3_5: ObjectMotion.still,
  /** rock, block, spiked ball at rest, and everything else block shaped. */
  upd_6_7: ObjectMotion.still,
  /** the brickwork of the walls, in its four sizes. */
  upd_10: ObjectMotion.still,
  upd_11: ObjectMotion.still,
  upd_12_to_15: ObjectMotion.still,
  /** the trees of the outdoor rooms. */
  upd_128_to_130: ObjectMotion.still,
  /** the sun, the moon and the frame of the panel, drawn by the model. */
  upd_88_to_90: ObjectMotion.still,
  /**
   * The cauldron, bottom and rim. It does nothing at all: what happens over it
   * is done by the objects that fly into it (`upd_104_to_110`) and by the
   * bubbles that rise out of it (`upd_160_to_163`), neither of which asks the
   * cauldron anything - the original knows it is in the cauldron's room from the
   * room's number, not by finding a cauldron in it.
   */
  upd_141: ObjectMotion.still,
  upd_142: ObjectMotion.still,

  // -------------------------------------------------------------------- hero

  /**
   * The hero's legs, man and beast: `upd_player_bottom`, which is the whole of
   * `app/heroController.js`.
   */
  upd_16_to_21_24_to_29: function(table, entry) {
    table.hero.updateBottom(table, entry);
  },
  upd_48_to_53_56_to_61: function(table, entry) {
    table.hero.updateBottom(table, entry);
  },

  /** The hero's top half: `upd_player_top`, a copy of the legs and a glance. */
  upd_32_to_47: function(table, entry) {
    table.hero.updateTop(table, entry);
  },
  upd_64_to_79: function(table, entry) {
    table.hero.updateTop(table, entry);
  },

  // ------------------------------------------------------- standing hazards

  /** gargoyle: it only sits there, but touching it is fatal. */
  upd_22: ObjectMotion.deadly,

  /** spikes, on the floor and on a pillar. */
  upd_23: ObjectMotion.deadly,

  // -------------------------------------------------- guards and the wizard

  /**
   * `upd_30_31_158_159`: the top half of a guard walking a square circuit, and
   * of the wizard, who walks one too.
   *
   * The circuit is not a path in the data: the guard walks west until something
   * stops him, then north, then east, then south, and round again
   * (`guard_NSEW_tbl`). The room's own furniture is what makes the circuit, so
   * a guard in an empty room walks the four walls.
   *
   * This half is the one with the box: it moves, and then hands its position
   * and its step to the entry after it, which is the pair of legs.
   */
  upd_30_31_158_159: function(table, entry) {
    table.move(entry);
    ObjectMotion.guardStep(entry);
    var legs = table.follower(entry);
    if (legs !== false) {
      legs.dx = entry.dx;
      legs.dy = entry.dy;
      legs.x = entry.x;
      legs.y = entry.y;
    }
    ObjectMotion.facingBit(entry, 0);
    ObjectMotion.deadly(table, entry);
  },

  /**
   * `upd_150_151`: the top half of a guard marching east and west. He turns
   * round when something stops him, and never turns a corner.
   */
  upd_150_151: function(table, entry) {
    entry.dx = (entry.dir & 1) ? ObjectMotion.guardSpeed : -ObjectMotion.guardSpeed;
    var legs = table.follower(entry);
    if (legs !== false) {
      legs.dx = entry.dx;
    }
    ObjectMotion.facingBit(entry, 0);
    table.move(entry);
    if (entry.blockedX) {
      entry.dir ^= 1;
    }
    if (legs !== false) {
      legs.x = entry.x;
    }
    ObjectMotion.deadly(table, entry);
  },

  /**
   * `upd_144_to_149_152_to_157`: the legs of a guard or of the wizard. They do
   * not move - the half above them does, and writes its position in here - they
   * only face the way the step points and take the next frame of the walk.
   */
  upd_144_to_149_152_to_157: function(table, entry) {
    if (entry.dx === 0 && entry.dy === 0) {
      return;
    }
    ObjectMotion.facingBit(entry, 3);
    ObjectMotion.animateLegs(entry);
  },

  // ------------------------------------------------------------------ ghost

  /**
   * `upd_80_to_83`: the ghost drifts. It picks a step of three or four units
   * along each axis at random and keeps it until something stops it, which is
   * why it crosses a room diagonally and then rattles along a wall.
   *
   * It drifts along the floor rather than through the air: the same fall of one
   * unit a frame is applied to it as to everything else, and every ghost in the
   * castle is placed on the floor to begin with.
   */
  upd_80_to_83: function(table, entry) {
    table.move(entry);
    if ((entry.dx === 0 && entry.dy === 0) || entry.blockedX || entry.blockedY) {
      entry.dx = ObjectMotion.drift(table.random());
      entry.dy = ObjectMotion.drift(table.frame & 0xff);
      ObjectMotion.ghostFacing(entry);
    }
    ObjectMotion.toggleSprite(entry);
    ObjectMotion.deadly(table, entry);
  },

  // ------------------------------------------------------- moving platforms

  /**
   * `upd_54`: a block sliding east and west, the platform of the game.
   *
   * There is no path and no turning point in the data. The block chases a
   * triangle wave that the frame counter itself describes - count up through
   * sixteen, count back down - and every other object in the table is half a
   * period out of step with it, which the original gets for free out of bit 5
   * of the object's own address. So a platform slides one cube back and forth
   * in thirty two frames, or about two and a half seconds, and two platforms in
   * one room move in opposite directions.
   */
  upd_54: function(table, entry) {
    ObjectMotion.slide(table, entry, 'x');
  },

  /** `upd_55`: the same block, sliding north and south. */
  upd_55: function(table, entry) {
    ObjectMotion.slide(table, entry, 'y');
  },

  // ------------------------------------------------- blocks you can shift

  /**
   * `upd_62`: the block that looks as if it could be pushed. It clears its own
   * step before it moves, so whatever shoved it this frame is thrown away and
   * the only thing it ever does is fall.
   */
  upd_62: function(table, entry) {
    entry.dx = 0;
    entry.dy = 0;
    table.move(entry);
  },

  /**
   * `upd_84`: the table. It takes the step the hero pushed into it, moves it,
   * and drops it again, so it travels exactly as far as it is pushed.
   */
  upd_84: function(table, entry) {
    table.move(entry);
    entry.dx = 0;
    entry.dy = 0;
  },

  /**
   * `upd_85`: the chest. The same as the table but for the one line that clears
   * the step, which is missing - so a chest that has been pushed keeps sliding
   * until something stops it.
   */
  upd_85: function(table, entry) {
    table.move(entry);
  },

  // ------------------------------------------------------------ spiked ball

  /**
   * `upd_63`: a spiked ball hanging in the air, waiting for its moment.
   *
   * One ball in a room falls at a time (`is_spike_ball_dropping`), a ball takes
   * a one in sixteen chance every frame to be the one, and in a room with an
   * odd id no ball ever falls at all (`disable_spike_ball_drop`, set from the
   * room's own number in `build_screen_objects`). The balls that wait above the
   * top of the screen are drawn as soon as their bottom row comes into view,
   * which is why `spriteVisible()` tests only that row.
   */
  upd_63: function(table, entry) {
    ObjectMotion.deadly(table, entry);
    if (table.disableSpikeBallDrop) {
      return;
    }
    if (entry.active) {
      table.move(entry);
      if (entry.blockedZ) {
        entry.active = false;
        table.spikeBallDropping = false;
      }
      return;
    }
    if (table.spikeBallDropping || table.random() >= ObjectMotion.spikeBallChance) {
      return;
    }
    entry.active = true;
    table.spikeBallDropping = true;
  },

  // ------------------------------------------------------------------ fires

  /** `upd_86_87`: fire crossing the room east and west. */
  upd_86_87: function(table, entry) {
    ObjectMotion.patrol(table, entry, 'x');
  },

  /** `upd_180_181`: fire crossing the room north and south. */
  upd_180_181: function(table, entry) {
    ObjectMotion.patrol(table, entry, 'y');
  },

  /**
   * `upd_176_177`: a fire that stays where it is and flickers, mirrored at
   * random. No room in the castle contains one - it is in the block table but
   * never placed - and it is here because the table is transcribed whole.
   */
  upd_176_177: function(table, entry) {
    // `fire_seed` is the frame counter at the top of the frame, then bumped
    // once per object as the table is walked, so it is this
    if (((table.frame+entry.index) & 1) === 0) {
      return;
    }
    if (table.random() & 0x40) {
      entry.flipH = !entry.flipH;
    }
    ObjectMotion.toggleSprite(entry);
    // the routine falls into `set_deadly_wipe_and_draw_flags`, so it is only
    // fatal from the first frame it flickers on
    ObjectMotion.deadly(table, entry);
  },

  // ------------------------------------------------------------------ balls

  /**
   * `upd_178_179`: a ball bouncing straight up and down. It rises at two units
   * a frame to thirty two units above where it started and then falls, and the
   * height is a room wide number, so a second ball in the same room bounces to
   * the height of the first.
   */
  upd_178_179: function(table, entry) {
    if (table.ballBounceHeight === 0) {
      table.ballBounceHeight = entry.z+ObjectMotion.bounceHeight;
    }
    ObjectMotion.toggleSprite(entry);
    if (entry.active) {
      entry.dz = ObjectMotion.ballRise;
      table.move(entry);
      if (entry.z > table.ballBounceHeight) {
        entry.active = false;
      }
    } else {
      table.move(entry);
      if (entry.blockedZ) {
        entry.active = true;
      }
    }
    ObjectMotion.deadly(table, entry);
  },

  /**
   * `upd_182_183`: the ball that bounces around the room - and the one place in
   * the game where being a werewolf changes more than the picture. On every
   * bounce it picks one axis at random and hops two units along it: away from
   * Sabreman, towards the wolf. The original does it by patching the condition
   * of a jump instruction; here it is the same test with its sense flipped.
   *
   * How high it bounces is the room's own number again: four units in a room
   * with an even id, four plus a random three in an odd one.
   */
  upd_182_183: function(table, entry) {
    // the collision writes the resolved step back, and this handler wants the
    // step it asked for, so it puts it back afterwards
    var dx = entry.dx;
    var dy = entry.dy;
    table.move(entry);
    entry.dx = dx;
    entry.dy = dy;
    if (entry.blockedZ) {
      entry.dz = ObjectMotion.bounceRise
        + ((table.roomId & 1) ? (table.random() & 3) : 0);
      var towards = table.hero.isWerewolf(table.player);
      if (table.random() & 1) {
        entry.dy = ObjectMotion.hop(entry, table.player, 'y', towards);
        entry.dx = 0;
      } else {
        entry.dx = ObjectMotion.hop(entry, table.player, 'x', towards);
        entry.dy = 0;
      }
    }
    ObjectMotion.toggleSprite(entry);
    ObjectMotion.deadly(table, entry);
  },

  // ------------------------------------------------------------ portcullis

  /**
   * `upd_8`: a portcullis at rest. One in a room moves at a time; a low one
   * rises, a high one drops. The first four moves of a room happen at once and
   * after that a move takes a one in thirty two chance per frame, so a gate
   * that has just come down waits a second or two before it goes up again.
   */
  upd_8: function(table, entry) {
    if (table.portcullisMoving) {
      return;
    }
    if (entry.z <= ObjectMotion.portcullisLow) {
      if (table.random() & 0x1f) {
        return;
      }
      entry.graphic |= 1;
      entry.dz = 1;
      table.portcullisMoving = true;
      return;
    }
    if (table.portcullisMoves >= ObjectMotion.portcullisFreeMoves) {
      if (table.random() & 0x1f) {
        return;
      }
      // the original stops counting by setting the top bit of the counter
      table.portcullisMoves = 0x80;
    }
    table.portcullisMoves++;
    entry.graphic |= 1;
    entry.dz = -1;
    table.portcullisMoving = true;
  },

  /**
   * `upd_9`: a portcullis on the move. On the way down it accelerates and it is
   * fatal; on the way up it crawls at one unit a frame.
   */
  upd_9: function(table, entry) {
    entry.deadly = true;
    if (table.player.entering > 0) {
      return;
    }
    if (entry.dz < 0) {
      entry.dz--;
      table.move(entry);
      if (!entry.blockedZ) {
        return;
      }
    } else {
      entry.dz = 2;
      table.move(entry);
      if (entry.z <= ObjectMotion.portcullisLow) {
        return;
      }
    }
    table.portcullisMoving = false;
    entry.graphic &= ~1;
  },

  // ------------------------------------------------------- blocks that give

  /**
   * `upd_91`: the block that drops away under the hero. It falls one unit for
   * every frame something is standing on it and stops the moment nothing is, so
   * it is a lift down rather than a trap.
   */
  upd_91: function(table, entry) {
    if (!entry.triggered) {
      return;
    }
    entry.triggered = false;
    entry.dz = 0;
    table.move(entry);
  },

  /**
   * `upd_143`: the block that collapses under the hero. It turns into the last
   * of the sparkles and is gone the next frame.
   */
  upd_143: function(table, entry) {
    if (!entry.triggered) {
      return;
    }
    entry.graphic = ObjectMotion.lastSparkle;
    ObjectMotion.handlers.upd_112_to_118_184(table, entry);
  },

  // --------------------------------------------------------------- sparkles

  /**
   * `upd_112_to_118_184`: the sparkles the hero dies in, and the puff a
   * collapsing block leaves. One frame per graphic number, seven of them.
   */
  upd_112_to_118_184: function(table, entry) {
    entry.graphic++;
  },

  /** `upd_119`: the last of the death sparkles. It asks to be wiped away. */
  upd_119: function(table, entry) {
    entry.graphic = ObjectMotion.wipeGraphic;
  },

  /**
   * `upd_185_187`: the sparkle an object dropped into the cauldron ends on
   * (M8), and - because a collapsing block ends on graphic 184, which this same
   * table increments into 185 - the sparkle a collapsing block ends on too.
   * That second way in is a bug in the original: it zeroes the graphic number
   * of a collectable object it does not have, which on a Spectrum means a write
   * to address zero and so to ROM, and does nothing at all.
   */
  upd_185_187: function(table, entry) {
    entry.graphic = ObjectMotion.wipeGraphic;
  },

  /**
   * `upd_120_to_126`: the sparkles the hero appears in, at the start of a room
   * and after he has lost a life. Every other frame, seven of them.
   */
  upd_120_to_126: function(table, entry) {
    if ((table.frame & 1) === 0) {
      return;
    }
    entry.graphic++;
  },

  /**
   * `upd_127`: the last of them. The hero comes back as whatever `spare` says
   * he is, which `lose_life` filled in from the day and the night.
   */
  upd_127: function(table, entry) {
    entry.destroyed = false;
    entry.graphic = entry.spare;
  },

  /**
   * `upd_92_to_95`: the hero flickering between man and beast. Eight flickers,
   * one every fourth frame, and then he is the other one - and if something
   * kills him while he is flickering he dies in the middle of it.
   */
  upd_92_to_95: function(table, entry) {
    if (entry.destroyed) {
      table.startDeathSparkles(entry);
      return;
    }
    if ((table.frame & 3) !== 0) {
      return;
    }
    entry.spare--;
    if (entry.spare <= 0) {
      table.hero.finishTransform(table, entry);
      return;
    }
    ObjectMotion.transformSprite(table, entry);
  },

  // ----------------------------------------------------- collectable objects

  /**
   * `upd_96_to_102`: one of the seven objects the cauldron wants, lying on the
   * floor or falling to it.
   *
   * It is the plainest thing in the game: it falls, and once it has stopped
   * falling it does nothing whatever. The one flag it keeps is "just put down",
   * which the original needs so that an object dropped onto the very spot it
   * was standing on is drawn again even though it never moved.
   */
  upd_96_to_102: function(table, entry) {
    table.move(entry);
    if (!entry.dropped && entry.dx === 0 && entry.dy === 0 && entry.dz === 0) {
      return;
    }
    entry.dropped = false;
    entry.dx = 0;
    entry.dy = 0;
  },

  /**
   * `upd_103`: the idol, which is the eighth of the objects and is not an object
   * at all - it is an extra life, and it is taken by walking into it rather than
   * by pressing the pick up key.
   *
   * Its reach is the hero's box grown by one unit either way, which is a good
   * deal tighter than the reach of the pick up key; and taking it clears the
   * room's "no spiked ball falls here" flag, exactly as picking anything up
   * does.
   */
  upd_103: function(table, entry) {
    if (table.hero.nearObject(table.player, entry, ObjectMotion.idolReach, 0)) {
      // the graphic number with bit 3 set is the invalid one, which draws
      // nothing and gives the slot up on the next frame
      entry.graphic |= 8;
      table.specials.take(entry);
      table.lives++;
      table.disableSpikeBallDrop = false;
    }
    table.move(entry);
  },

  /**
   * `upd_104_to_110`: an object the hero has dropped over the cauldron, on its
   * way in. It is the same seven graphic numbers with bit 3 set, and that bit is
   * the only thing that tells it from an object lying on the floor.
   *
   * The path is neither animated nor scripted: one unit a frame towards the
   * middle of the room along each axis, rising while it is below the rim and
   * level once it is above it, and when it is over the middle it drops in - and
   * it drops *through* the cauldron, because an object that flags itself
   * "ignore in 3D" is not collided at all (`adj_for_out_of_bounds` gives up at
   * its first line). The hero hangs in the air while it goes, which is what
   * makes it look like a ceremony rather than an accident.
   */
  upd_104_to_110: function(table, entry) {
    var middleX = table.bounds.x/2;
    var middleY = table.bounds.y/2;
    var x = ObjectMotion.centre(entry, 'x');
    var y = ObjectMotion.centre(entry, 'y');
    entry.dx = x === middleX ? 0 : (x < middleX ? 1 : -1);
    entry.dy = y === middleY ? 0 : (y < middleY ? 1 : -1);
    if (x === middleX && y === middleY) {
      if (entry.z <= ObjectMotion.cauldronMouth) {
        ObjectMotion.intoCauldron(table, entry);
        return;
      }
      entry.ignore3D = true;
      table.move(entry);
      return;
    }
    entry.dz = entry.z < ObjectMotion.cauldronRim ? 2 : 1;
    table.move(entry);
  },

  /**
   * `upd_111`: the graphic number the disassembly marks invalid. Nothing is ever
   * drawn with it - it is one frame of nothing, and then the slot is free.
   */
  upd_111: function(table, entry) {
    entry.graphic = ObjectMotion.wipeGraphic;
  },

  /**
   * `upd_160_to_163`: the bubbles over the cauldron, which are the only thing in
   * the whole game that tells the player anything.
   *
   * They rise out of the cauldron to the height of its rim and hang there,
   * turning over four frames of sparkle - and every fourth of those frames,
   * while the hero is a man, is a picture of **the object the cauldron is asking
   * for next**. That is the user interface of Knight Lore.
   *
   * At night it is not so friendly. The werewolf gets no hint: the bubbles set
   * bit 2 of their own graphic number instead, which turns them into the four
   * numbers of a spell, and a spell chases him. It is the wizard's spell
   * handler and it looks the same, but this one was armed to kill when the
   * cauldron made it and nothing ever disarmed it.
   *
   * They also give the room's first object slot up the moment something real
   * arrives in it, which is how the cauldron's room has room for the object
   * being carried in.
   */
  upd_160_to_163: function(table, entry) {
    if (table.entries[ObjectTable.heroSlots].graphic !== ObjectTable.empty) {
      ObjectMotion.handlers.upd_111(table, entry);
      return;
    }
    entry.ignore3D = true;
    table.move(entry);
    ObjectMotion.nextSpriteOfFour(entry);
    if (entry.z < ObjectMotion.cauldronRim) {
      entry.dz = 2;
      return;
    }
    entry.dz = 1;
    if (table.hero.isWerewolf(table.player)) {
      entry.graphic |= 4;
      entry.ignore3D = false;
      return;
    }
    if ((entry.graphic & 3) === 0) {
      entry.graphic = ObjectMotion.firstRequired+table.specials.nextRequired();
    }
  },

  /**
   * `upd_168_to_175`: the one frame in which the bubbles are showing what the
   * cauldron wants. It lasts exactly that frame and then they are bubbles again.
   */
  upd_168_to_175: function(table, entry) {
    entry.graphic = ObjectMotion.firstBubble;
  },

  // ---------------------------------------------------- the end of the game

  /**
   * `upd_131_to_133`: what the castle turns into once the potion is made.
   *
   * `prepare_final_animation` wipes the cauldron's room and turns every plain
   * block left in it into one of these. They fly up out of the floor to a little
   * above the rim of the cauldron, and from there they come for the hero at four
   * units a frame - and when one of them is within six units of him in both
   * axes, that is the end of the game and the screen that says the potion is
   * made.
   */
  upd_131_to_133: function(table, entry) {
    if (entry.z >= ObjectMotion.sparkleHeight) {
      if (ObjectMotion.reachedPlayer(table, entry, ObjectMotion.sparkleReach)) {
        table.endGame();
        return;
      }
      entry.deadly = true;
      entry.ignore3D = true;
      entry.dz = 1;
      ObjectMotion.towardsPlayer(table, entry, ObjectMotion.sparkleSpeed);
      table.move(entry);
      return;
    }
    entry.dz = 3;
    // `dX_dY_tbl`: which quarter of the room the sparkle is in decides its step,
    // and it decides it crosswise - the side it is on along x picks its step
    // along y and the other way round - so what comes out of the floor is a
    // swirl rather than four sprays
    var half = ObjectMotion.sparkleSpeed;
    entry.dx = ObjectMotion.centre(entry, 'y') >= table.bounds.y/2 ? half : -half;
    entry.dy = ObjectMotion.centre(entry, 'x') >= table.bounds.x/2 ? -half : half;
    // one of the three twinkles at random; the first of the four is never used
    entry.graphic = ObjectMotion.firstTwinkle+Math.max(table.random() & 3, 1);
    table.move(entry);
  },

  // ---------------------------------------------------------- wizard's spell

  /**
   * `upd_164_to_167`: the spell the wizard sends after the hero. It follows him
   * at four units a frame - one when he is standing in an arch, so that it
   * cannot chase him out of the room - and, unlike everything else that moves,
   * it is not fatal: it is a shove, not a death.
   */
  upd_164_to_167: function(table, entry) {
    var cauldron = table.roomId === table.specials.spec.cauldronRoom;
    ObjectMotion.towardsPlayer(table, entry,
      table.player.atArch && !cauldron ? ObjectMotion.spellSlow : ObjectMotion.spellSpeed);
    table.move(entry);
    ObjectMotion.nextSpriteOfFour(entry);
    // in the cauldron's room the spell is the cauldron's, not the wizard's, and
    // it gives up the moment the hero stops being himself: the original tests
    // his graphic number against the one number that separates a hero from the
    // sparkles and flickers he is sometimes made of
    if (cauldron && table.player.graphic >= ObjectMotion.spellGivesUp) {
      ObjectMotion.handlers.upd_111(table, entry);
    }
  }

}; // ObjectMotion.handlers

/**
 * `upd_54` and `upd_55`: one frame of a sliding platform.
 *
 * @param {ObjectTable} table the room's object table
 * @param {object} entry the platform
 * @param {string} axis 'x' or 'y'
 */
ObjectMotion.slide = function(table, entry, axis) {
  var delta = axis == 'x' ? 'dx' : 'dy';
  // bit 5 of the object's own address in the original's table, which is the low
  // bit of its index: every other object is half a period out of step
  var offset = (entry.index & 1) ? 0x10 : 0;
  var wave = (table.frame+offset) & 0xff;
  if (wave & 0x10) {
    wave = ~wave;
  }
  var target = wave & 0x0f;
  // the original's position is the centre of the box, and this is the low four
  // bits of it: where the block stands inside the cube it slides across
  var position = (ObjectMotion.centre(entry, axis)+8) & 0x0f;
  if (position == target) {
    return;
  }
  entry[delta] = position < target ? 1 : -1;
  // pre-loaded so that the fall of one unit a frame comes out as none
  entry.dz = 1;
  table.move(entry);
}; // ObjectMotion.slide

/**
 * `upd_86_87` and `upd_180_181`: one frame of a fire crossing the room. It
 * turns round when something stops it, and it is fatal both ways.
 *
 * @param {ObjectTable} table the room's object table
 * @param {object} entry the fire
 * @param {string} axis 'x' or 'y'
 */
ObjectMotion.patrol = function(table, entry, axis) {
  var delta = axis == 'x' ? 'dx' : 'dy';
  var bit = axis == 'x' ? 1 : 2;
  var blocked = axis == 'x' ? 'blockedX' : 'blockedY';
  entry.dz = 1;
  entry[delta] = (entry.dir & bit) ? ObjectMotion.fireSpeed : -ObjectMotion.fireSpeed;
  table.move(entry);
  if (entry[blocked]) {
    entry.dir ^= bit;
  }
  ObjectMotion.toggleSprite(entry);
  ObjectMotion.deadly(table, entry);
}; // ObjectMotion.patrol

/**
 * `move_guard_wizard_NSEW`: the step of a guard walking his circuit. He keeps
 * going the way he is going; the frame he is stopped he turns a quarter and
 * takes the first step of the new side in the same frame.
 *
 * @param {object} entry the guard's top half
 */
ObjectMotion.guardStep = function(entry) {
  var speed = ObjectMotion.guardSpeed;
  var side = ObjectMotion.guardSides[entry.dir & 3];
  var blocked = side.axis == 'x' ? entry.blockedX : entry.blockedY;
  if (!blocked) {
    entry.dx = side.dx*speed;
    entry.dy = side.dy*speed;
    return;
  }
  var next = ObjectMotion.guardSides[(entry.dir+1) & 3];
  entry.dx = next.dx*speed;
  entry.dy = next.dy*speed;
  entry.dir = (entry.dir+1) & 3;
}; // ObjectMotion.guardStep

/**
 * `calc_ghost_sprite`: which way the ghost looks, from the longer half of its
 * drift. Bit 1 of the graphic number and the flip, and the two are the other
 * way round from the guards': along X the ghost is mirrored, along Y it is not.
 *
 * @param {object} entry the ghost
 */
ObjectMotion.ghostFacing = function(entry) {
  if (Math.abs(entry.dy) >= Math.abs(entry.dx)) {
    ObjectMotion.setFacing(entry, 1, entry.dy >= 0, false);
    return;
  }
  ObjectMotion.setFacing(entry, 1, entry.dx < 0, true);
}; // ObjectMotion.ghostFacing

/**
 * `get_delta_from_tbl` as the ghost uses it: three or four units, either way.
 *
 * @param {number} random a pseudo random byte
 * @returns {number} the step
 */
ObjectMotion.drift = function(random) {
  var index = 4+(random & 3);
  var size = 1+(index >> 1);
  return (index & 1) ? size : -size;
}; // ObjectMotion.drift

/**
 * One hop of the bouncing ball along one axis, two units towards the hero or
 * away from him.
 *
 * @param {object} entry the ball
 * @param {object} player the hero's entry
 * @param {string} axis 'x' or 'y'
 * @param {boolean} towards true to hop at him, false to hop away
 * @returns {number} the step
 */
ObjectMotion.hop = function(entry, player, axis, towards) {
  var below = ObjectMotion.centre(player, axis) < ObjectMotion.centre(entry, axis);
  var away = below ? ObjectMotion.hopSpeed : -ObjectMotion.hopSpeed;
  return towards ? -away : away;
}; // ObjectMotion.hop

/**
 * `rand_legs_sprite`: one flicker of the transformation - one of the four
 * transform graphics, never the one already showing, mirrored at random.
 *
 * @param {ObjectTable} table the room's object table
 * @param {object} entry the hero's legs
 */
ObjectMotion.transformSprite = function(table, entry) {
  var graphic = ObjectMotion.transformFirst | (table.random() & 3);
  if (graphic == entry.graphic) {
    graphic ^= 1;
  }
  entry.graphic = graphic;
  entry.flipH = !entry.flipH;
}; // ObjectMotion.transformSprite

/** Units a guard walks per frame (`guard_W` and its three siblings). */
ObjectMotion.guardSpeed = 2;

/** Units a fire moves per frame (`upd_86_87`). */
ObjectMotion.fireSpeed = 2;

/** Units the bouncing ball hops sideways when it lands (`upd_182_183`). */
ObjectMotion.hopSpeed = 2;

/** Vertical speed the bouncing ball leaves the floor with. */
ObjectMotion.bounceRise = 4;

/** Vertical speed of a ball on its way up (`ball_up`). */
ObjectMotion.ballRise = 3;

/** How far above its resting place a ball bounces (`upd_178_179`). */
ObjectMotion.bounceHeight = 32;

/**
 * The heights of the cauldron, in room units: the rim an object rises to before
 * it crosses to the middle (`cp 152`), and the mouth it has to be down to before
 * it counts as in (`cp 128`). The original's Z is an absolute byte with the
 * floor at 128, so both are that many units above the floor of the room.
 */
ObjectMotion.cauldronRim = 24;
ObjectMotion.cauldronMouth = 0;

/** The first of the four sparkles the cauldron bubbles with (`cauldron_bubbles`). */
ObjectMotion.firstBubble = 160;

/** The graphic numbers that show the object the cauldron wants (`or 168`). */
ObjectMotion.firstRequired = 168;

/** How near the hero has to be to take an idol (`upd_103`: radii plus one). */
ObjectMotion.idolReach = 1;

/** The four twinkles the castle comes apart in; the first is never used. */
ObjectMotion.firstTwinkle = 130;

/** How high the final sparkles rise before they come for the hero (`cp 164`). */
ObjectMotion.sparkleHeight = 36;

/** How fast they travel, and how near one has to be to end the game. */
ObjectMotion.sparkleSpeed = 4;
ObjectMotion.sparkleReach = 6;

/**
 * The graphic number above which the hero is not a hero but a puff of
 * something: the flicker of a transformation, the sparkles of a death or of an
 * arrival (`upd_164_to_167`: `sub 0x10, cp 0x40`).
 */
ObjectMotion.spellGivesUp = 80;

/** Units the wizard's spell covers per frame, and in an arch (`upd_164_to_167`). */
ObjectMotion.spellSpeed = 4;
ObjectMotion.spellSlow = 1;

/** One in how many frames a waiting spiked ball starts to fall (`upd_63`). */
ObjectMotion.spikeBallChance = 16;

/** A portcullis at or below this height rises rather than drops (`upd_8`). */
ObjectMotion.portcullisLow = 31;

/** How many moves a room's portcullis makes without waiting first. */
ObjectMotion.portcullisFreeMoves = 4;

/** The graphic number a collapsing block turns into (`upd_143`). */
ObjectMotion.lastSparkle = 184;

/** The first of the four transformation graphics (`rand_legs_sprite`). */
ObjectMotion.transformFirst = 92;

/**
 * The graphic number that means "draw me away and forget me"
 * (`calc_pixel_XY_and_render`): the object is drawn once more as nothing, and
 * its graphic number becomes zero, which is the empty slot.
 */
ObjectMotion.wipeGraphic = 1;

/**
 * The four sides of a guard's circuit, in the order he walks them
 * (`guard_NSEW_tbl`): west, north, east, south. `axis` is the one his step
 * lies on, and so the one whose blocked flag turns him.
 */
ObjectMotion.guardSides = [
  {axis: 'x', dx: -1, dy: 0},
  {axis: 'y', dx: 0, dy: 1},
  {axis: 'x', dx: 1, dy: 0},
  {axis: 'y', dx: 0, dy: -1}
];

/** Table slots an arch may take by the hand (`upd_2_4`: `ld b, 4`). */
ObjectMotion.archReach = 4;

/** How far into the room from an arch's centre the middle of its opening is. */
ObjectMotion.archDoorway = 13;

/** How near the middle of the opening one has to be, across it and along it. */
ObjectMotion.archAcross = 6;
ObjectMotion.archAlong = 15;

/** How near the arch's own floor, in either direction (`is_near_to`: `cp 4`). */
ObjectMotion.archHeight = 4;

/** How far from an arch it starts lining one up with the doorway (`loc_C785`). */
ObjectMotion.archPull = 15;

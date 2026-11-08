/**
 * Sabreman, and the werewolf he turns into at night.
 *
 * Everything here is about which sprites he is made of and where they sit; what
 * he does is in `app/heroController.js`, which runs in the game worker and
 * drives this same state object. The two share the box below rather than each
 * having their own: the worker is handed `HERO` when the room starts, so the
 * physics and the drawing cannot disagree about how big he is.
 *
 * The original keeps the hero as two objects in `graphic_objs_tbl`, the legs
 * and the top half (`plyr_spr_init_data`, `upd_player_top`): the top half
 * copies the position of the legs, sits 12 units above them, has no height of
 * its own and is flagged "ignore in 3D", so it is picture only. Its graphic
 * number is always the legs' plus 16.
 *
 * The graphic number of the legs encodes both the animation and the direction
 * (`get_sprite_dir`): bits 0-2 are the walking frame, bit 3 together with the
 * horizontal flip flag makes the four directions, and bit 5 is what the
 * transformation toggles between man and beast.
 *
 * Deliberately dependency free, so the offline renderer builds the same hero as
 * the game.
 */

// begin code

/** The hero as the original starts him: the man, standing, facing west. */
export const HERO = Object.freeze({
  /** Graphic number the legs of the human start at (`upd_16_to_21_24_to_29`). */
  human: 16,
  /** The werewolf's legs, which is the human's with bit 5 set. */
  werewolf: 48,
  /** The top half is always the legs plus 16 (`set_top_sprite`). */
  topHalf: 16,
  /** Walking frames per direction. */
  frames: 6,
  /** Radii and height of the legs box (`plyr_spr_init_data`). */
  radiusX: 5,
  radiusY: 5,
  height: 23,
  /** How far above the legs the top half is drawn (`upd_player_top`). */
  topOffset: 12,
  /** The four directions, in the order the original numbers them. */
  directions: Object.freeze(['west', 'east', 'north', 'south'])
});

/** The hero's state as this milestone needs it: where he stands and how he looks. */
export function newHero(room) {
  return {
    form: 'human',
    direction: 0,
    // facing west, in the second frame of his walk: `init_start_location` puts
    // graphic 18 in the start data, which is the human's legs plus frame 2, and
    // it is one of the two frames he may be left standing in
    frame: 2,
    // the original spawns him in the middle of the room, on the floor
    // (plyr_spr_init_data: X = Y = 128, Z = the floor level)
    x: room.bounds.x / 2 - HERO.radiusX,
    y: room.bounds.y / 2 - HERO.radiusY,
    z: 0
  };
} // newHero

/**
 * The graphic number and the flip of the hero's legs. Directions 0 and 1 (west
 * and east) are the drawn sprites, 2 and 3 (north and south) are the same two
 * mirrored.
 *
 * This is the drawing side of `HeroController.legsGraphic()`, which is the same
 * encoding inside the game worker; it is here for the offline renderer, which
 * draws a hero without a worker to ask.
 *
 * @param {object} hero state from `newHero()`
 * @returns {object} `{graphic, flipHorizontal}`
 */
export function heroLegs(hero) {
  const base = hero.form === 'werewolf' ? HERO.werewolf : HERO.human;
  const group = (hero.direction & 1) ? 8 : 0;
  return {
    graphic: base + group + (hero.frame % HERO.frames),
    flipHorizontal: hero.direction > 1
  };
} // heroLegs

/**
 * The hero as boxes of the display list: the legs, then the top half. Both are
 * shaped like the objects of a room, so the depth sorting and the renderer do
 * not need to know a hero exists - and they are the first two boxes of the
 * list, because they are the first two entries of the object table the game
 * worker runs (`app/objectTable.js`), and the two lists are read off each other
 * row by row.
 *
 * While the game is running the worker owns his graphic number: he is not
 * always himself, and the sparkles he dies in and the flicker he changes shape
 * in are graphic numbers like any other. `hero.graphic` is that number when
 * there is one, and `heroLegs()` works it out for the hero of a picture that
 * has no worker behind it.
 *
 * @param {object} hero state from `newHero()`, or the hero of a snapshot
 * @returns {object[]} boxes as the display list uses them
 */
export function heroBoxes(hero) {
  const legs = hero.graphic === undefined ? heroLegs(hero)
    : { graphic: hero.graphic, flipHorizontal: !!hero.flipH };
  const shared = {
    sx: HERO.radiusX * 2, sy: HERO.radiusY * 2,
    flipH: legs.flipHorizontal, flipV: false,
    // the original's "moveable" flag: a platform under him carries him, and
    // anything that runs into him shoves him (`plyr_spr_init_data`, flags 0x1C)
    moveable: true,
    source: 'hero', motion: 'player'
  };
  return [
    {
      ...shared,
      graphic: legs.graphic,
      x: hero.x, y: hero.y, z: hero.z, sz: HERO.height,
      ignore3D: false, part: 0,
      collision: 'solid',
      type: hero.form
    },
    {
      ...shared,
      graphic: legs.graphic + HERO.topHalf,
      x: hero.x, y: hero.y, z: hero.z + HERO.topOffset, sz: 0,
      ignore3D: true, part: 1,
      collision: 'decoration',
      type: hero.form + '_top'
    }
  ];
} // heroBoxes

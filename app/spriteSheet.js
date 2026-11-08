/**
 * Reader of the original's masked sprites (`data/sprites.json`, written by
 * `tools/klsprite`).
 *
 * Knight Lore draws every object as a sprite that carries its own mask: the
 * mask is the silhouette and clears whatever is already on the screen, the
 * image is the ink drawn into the hole. That is what makes the scene occlude
 * correctly with nothing but a painter's algorithm, and it is why the mask
 * reaches one pixel further than the ink on every edge - the sprite wipes a
 * clean outline for itself (NOTES-ORIGINAL.md chapter 12).
 *
 * The stored bytes are the original's, untouched: a row is a run of byte pairs
 * (mask byte, image byte) and the first row is the bottom one, because the
 * original counts screen rows upwards. This module turns that into a grid of
 * pixels counted downwards, which is what a canvas wants, and hands out the
 * anchor the sprite is positioned by.
 *
 * Deliberately dependency free, so the game, the room editor and the offline
 * tools in tools/ all read the sprites through the same code.
 */

// begin code

/** Sprite data format version understood by this module. */
export const SPRITE_FORMAT = 1;

/** The three states a pixel of a masked sprite can be in. */
export const TRANSPARENT = 0;
export const MASK = 1;
export const INK = 2;

/** Characters the states are printed with by `gridRow()`. */
export const PIXEL_CHARS = ['.', ':', '#'];

/**
 * Height of the ZX Spectrum screen. The original counts its pixel rows upwards
 * from the bottom of the screen, so turning one of its positions into a canvas
 * row needs it; it is the same 192 as `IsoProjection.screenHeight`.
 */
export const SCREEN_HEIGHT = 192;

/** Width and height of one character of either font (`print_8x8`). */
export const FONT_SIZE = 8;

/** The flip flags, in the order the anchor keys of a graphic use them. */
const FLIP_KEYS = ['flipH', 'flipV', 'flipHV'];

/**
 * Validates parsed sprite data.
 *
 * @param {object} sheet parsed data/sprites.json
 * @returns {string[]} list of problems, empty when the data is valid
 */
export function validateSprites(sheet) {
  const problems = [];
  const fail = (message) => problems.push(message);

  if (!sheet || typeof sheet !== 'object') {
    return ['sprite data is not an object'];
  }
  if (sheet.format !== SPRITE_FORMAT) {
    fail('unsupported format: ' + sheet.format);
    return problems;
  }
  if (!Array.isArray(sheet.sprites) || sheet.sprites.length === 0) {
    fail('sprites must be a non empty array');
    return problems;
  }
  sheet.sprites.forEach((sprite, index) => {
    const where = 'sprites[' + index + ']';
    if (!isPositive(sprite.width) || sprite.width % 8 !== 0) {
      fail(where + '.width must be a positive multiple of 8, got ' + sprite.width);
      return;
    }
    if (!isPositive(sprite.height)) {
      fail(where + '.height must be a positive integer, got ' + sprite.height);
      return;
    }
    if (typeof sprite.bytes !== 'string' || !/^[0-9A-F]*$/.test(sprite.bytes)) {
      fail(where + '.bytes must be an upper case hexadecimal string');
      return;
    }
    // a mask byte and an image byte for every byte of every row
    const expected = sprite.width / 8 * sprite.height * 2 * 2;
    if (sprite.bytes.length !== expected) {
      fail(where + ' (' + sprite.label + ') holds ' + sprite.bytes.length / 2 + ' bytes, '
        + sprite.width + 'x' + sprite.height + ' masked needs ' + expected / 2);
    }
  });

  if (!Array.isArray(sheet.graphics) || sheet.graphics.length === 0) {
    fail('graphics must be a non empty array');
    return problems;
  }
  sheet.graphics.forEach((graphic, index) => {
    if (graphic === null) {
      return;                                      // the null sprite: nothing is drawn
    }
    const where = 'graphics[' + index + ']';
    if (!Number.isInteger(graphic.sprite) || !sheet.sprites[graphic.sprite]) {
      fail(where + '.sprite is not an index into sprites: ' + graphic.sprite);
    }
    if (!isAnchor(graphic.anchor)) {
      fail(where + '.anchor must have integer x and y');
    }
    FLIP_KEYS.forEach((key) => {
      if (graphic[key] !== undefined && !isAnchor(graphic[key])) {
        fail(where + '.' + key + ' must have integer x and y');
      }
    });
  });

  if (!sheet.fonts || typeof sheet.fonts !== 'object') {
    fail('fonts must be an object');
  } else {
    Object.keys(sheet.fonts).forEach((name) => {
      validateFont(sheet.fonts[name], 'fonts.' + name, fail);
    });
  }

  return problems;
} // validateSprites

/**
 * One 8x8 font: an array of characters, each eight rows of eight `#` or `.`.
 *
 * @param {object} font one entry of `sheet.fonts`
 * @param {string} where its name, for the message
 * @param {function} fail collects a problem
 */
function validateFont(font, where, fail) {
  if (!Array.isArray(font) || font.length === 0) {
    fail(where + ' must be a non empty array of characters');
    return;
  }
  font.forEach((character, index) => {
    if (!Array.isArray(character) || character.length !== FONT_SIZE) {
      fail(where + '[' + index + '] must be ' + FONT_SIZE + ' rows');
      return;
    }
    character.forEach((row, line) => {
      if (typeof row !== 'string' || !new RegExp('^[#.]{' + FONT_SIZE + '}$').test(row)) {
        fail(where + '[' + index + '][' + line + '] must be ' + FONT_SIZE + ' of # and .');
      }
    });
  });
} // validateFont

/**
 * Reads and validates the sprite data. Throws when it is not usable, because a
 * half readable sprite sheet can only produce a wrong looking screen.
 *
 * @param {object} data parsed data/sprites.json
 * @returns {object} the sheet, with the cache the decoded grids are kept in
 */
export function readSprites(data) {
  const problems = validateSprites(data);
  if (problems.length) {
    throw new Error('invalid sprite data:\n  ' + problems.join('\n  '));
  }
  return {
    format: data.format,
    origin: data.origin,
    sprites: data.sprites,
    graphics: data.graphics,
    screen: data.screen,
    fonts: data.fonts,
    grids: {}
  };
} // readSprites

/**
 * The grid of one graphic, decoded on first use and kept in the sheet's cache.
 *
 * @param {object} sheet a sheet from `readSprites()`
 * @param {number} graphic graphic number, an index into `sheet.graphics`
 * @param {object} [flips] `{flipHorizontal, flipVertical}`
 * @returns {object|false} `{width, height, anchor, pixels}`, or false when the
 *   graphic number draws nothing
 */
export function spriteGrid(sheet, graphic, flips) {
  const entry = sheet.graphics[graphic];
  if (entry === undefined || entry === null) {
    return false;
  }
  const flipHorizontal = !!(flips && flips.flipHorizontal);
  const flipVertical = !!(flips && flips.flipVertical);
  const key = graphic + (flipHorizontal ? 'h' : '') + (flipVertical ? 'v' : '');
  if (sheet.grids === undefined) {
    sheet.grids = {};
  }
  if (!(key in sheet.grids)) {
    sheet.grids[key] = buildGrid(sheet, entry, flipHorizontal, flipVertical);
  }
  return sheet.grids[key];
} // spriteGrid

/**
 * The anchor of a graphic for the given flips. The original's arch pieces are
 * drawn from a different corner when they are mirrored, so the flipped anchors
 * are stored separately and fall back to the plain one.
 *
 * @param {object} entry one entry of `sheet.graphics`
 * @param {boolean} flipHorizontal
 * @param {boolean} flipVertical
 * @returns {object} `{x, y}`
 */
export function spriteAnchor(entry, flipHorizontal, flipVertical) {
  const key = flipHorizontal ? (flipVertical ? 'flipHV' : 'flipH') : (flipVertical ? 'flipV' : false);
  if (key !== false && entry[key] !== undefined) {
    return entry[key];
  }
  return entry.anchor;
} // spriteAnchor

/**
 * One row of a grid as text, for the offline tools and the console: `#` is ink,
 * `:` a pixel the mask clears without drawing ink, `.` is transparent.
 *
 * @param {object} grid a grid from `spriteGrid()`
 * @param {number} row row index, counted from the top
 * @returns {string} the row
 */
export function gridRow(grid, row) {
  let text = '';
  for (let x = 0; x < grid.width; x++) {
    text += PIXEL_CHARS[grid.pixels[row * grid.width + x]];
  }
  return text;
} // gridRow

/**
 * Where a sprite lands on the screen. The original computes the pixel position
 * of the object's reference point - the centre of its footprint, at the bottom
 * of the box - and the anchor moves the sprite from there to its own bottom
 * left corner; the sprite is then drawn upwards, so its top row is that row
 * minus its height.
 *
 * @param {object} grid a grid from `spriteGrid()`
 * @param {object} point projected reference point `{x, y}`, y counted downwards
 * @returns {object} `{x, y}` of the top left pixel of the sprite
 */
export function spritePosition(grid, point) {
  return {
    x: point.x + grid.anchor.x,
    y: point.y - grid.anchor.y - grid.height + 1
  };
} // spritePosition

/**
 * Whether the original would draw the sprite at all.
 *
 * `calc_pixel_XY` compares the anchored row against 192 and gives up on the
 * object when it does not fit, which - because its rows are counted upwards
 * from the bottom of the screen - is the test for the *bottom* row of the
 * sprite having left the screen. A sprite that only reaches over the top edge
 * is drawn and clipped there, so this is deliberately not a test of the whole
 * rectangle: the spiked balls that fall into a room wait above the screen until
 * their bottom row comes into view, and drawing them early would show a ball
 * hanging under the top edge that the original does not show.
 *
 * @param {object} grid a grid from `spriteGrid()`
 * @param {object} position a position from `spritePosition()`
 * @returns {boolean} true when the sprite is to be drawn
 */
export function spriteVisible(grid, position) {
  const bottom = position.y + grid.height - 1;
  return bottom >= 0 && bottom < SCREEN_HEIGHT;
} // spriteVisible

/**
 * The reference point of a box: the centre of its footprint at its bottom, in
 * world units. It is the position the original keeps for an object, and the
 * point the sprite anchor is measured from.
 *
 * @param {object} box `{x, y, z, sx, sy, sz}` in world units
 * @returns {object} `{x, y, z}`
 */
export function boxReference(box) {
  return { x: box.x + box.sx / 2, y: box.y + box.sy / 2, z: box.z };
} // boxReference

/**
 * The little window at the right hand end of the panel, in the original's own
 * numbers (`init_sun`, `display_sun_moon_frame`): the graphic of the sun and of
 * the moon, the two pieces of scenery in front of them and where those stand,
 * where the sun starts its run and how high it rides when it is resting there.
 *
 * It is not among the panel's placements because the original does not draw it
 * with the panel: it clears the window and draws it again every eighth frame,
 * which is when the sun has moved along.
 *
 * `windowX`, `windowWidth` and `windowHeight` are that window, and they are the
 * clipping rectangle of the sun: `display_frame` clears six bytes by thirty one
 * lines from screen pixel 184 upwards from the bottom, draws the sun and the two
 * pieces of scenery into the buffer, and blits *only that rectangle* back
 * (`vidbuf_fill_window`, `blit_to_screen` with `bc = 0x1F06`). The sun's run
 * starts eight pixels to the left of the window and its sixteen pixel wide
 * sprite ends nine pixels to the right of it, so on the original both ends of
 * the run are cut off by the blit and never reach the panel.
 */
export const SUN_MOON = Object.freeze({
  sun: 88, moon: 89,
  left: 90, leftX: 184,
  right: 186, rightX: 208,
  firstX: 176, restY: 9,
  windowX: 184, windowWidth: 48, windowHeight: 31
});

/**
 * What the panel of a running game shows besides the sun: the day, the lives
 * left and the objects the hero is carrying.
 *
 * The original prints all of it straight at a pixel position, without the
 * projection and without an anchor, exactly as it prints the panel itself
 * (`display_day`, `print_days`, `print_lives_gfx`, `print_lives`,
 * `display_objects`). Its positions are video buffer addresses, which are
 * `Y * 32 + X / 8` with Y counted upwards from the bottom of the screen, and
 * for the text they name the **top** row of the eight the character is printed
 * over (`print_8x8` walks downwards through memory, which is upwards on the
 * screen). They are turned round into rows counted from the top here, the same
 * way `screenPlacements()` turns the panel round.
 *
 * The colours are the original's attribute bytes with the bright bit set:
 * yellow for the day and the lives, and one per kind of object carried
 * (`object_attributes`).
 */
export const STATUS = Object.freeze({
  /** The word DAY, four characters of the little font (`display_day`, 0x0F70). */
  day: Object.freeze({x: 112, y: SCREEN_HEIGHT-1-15, text: [0, 1, 2, 3]}),
  /** The two digits of the day counter under it (`print_days`, vidbuf+0xEF). */
  days: Object.freeze({x: 120, y: SCREEN_HEIGHT-1-7, digits: 2}),
  /** The little hero beside the lives (`print_lives_gfx`: graphic 140 at 16,32). */
  livesGraphic: Object.freeze({graphic: 140, x: 16, y: 32}),
  /** The two digits of the lives (`print_lives`, vidbuf+0x4E4). */
  lives: Object.freeze({x: 32, y: SCREEN_HEIGHT-1-39, digits: 2}),
  /**
   * The three objects the hero carries, each in a 24 by 24 pixel window
   * (`display_objects`: pixel X `(3-b)*24+16`, pixel Y 0).
   */
  carried: Object.freeze({x: 16, y: 0, step: 24, size: 24, slots: 3}),
  /** Ink colour per kind of object carried (`object_attributes`, low three bits). */
  carriedInk: Object.freeze([2, 3, 4, 5, 6, 7, 2, 7]),
  /** Ink the day and the lives are printed in (`print_days`: attribute 0x47). */
  ink: 7
});

/**
 * `upd_sprite_jmp_tbl`: the name of the routine that updates an object, for
 * every graphic number of the game.
 *
 * The original does not decide what a thing does from what the room data calls
 * it - it jumps on the graphic number the thing is drawn with, which is why a
 * block that has started to fall behaves differently from the block it was a
 * moment ago. M3 traced the routine of all 188 graphics out of the disassembly
 * and put it in the sheet; this hands it to the game worker as the table it is.
 *
 * @param {object} sheet a sheet from `readSprites()`
 * @returns {Array<string|undefined>} routine name per graphic number
 */
export function handlerTable(sheet) {
  return sheet.graphics.map((entry) => (entry === undefined || entry === null)
    ? undefined : entry.handler);
}

/**
 * Where the pieces of the screen furniture go, in screen coordinates.
 *
 * The original prints the frame and the panel straight at a pixel position
 * (`print_border`, `display_panel`), without the projection and without an
 * anchor, and repeats a piece a given number of times with a given step. Both
 * the position and the step are in its own pixel space, where Y is the bottom
 * row of the sprite counted upwards from the bottom of the screen, so both are
 * turned around here.
 *
 * @param {object} sheet a sheet from `readSprites()`
 * @param {string} group `'border'` or `'panel'`
 * @returns {object[]} `{graphic, grid, positions: [{x, y}]}` per piece, the
 *   positions being the top left pixel of every repetition
 */
export function screenPlacements(sheet, group) {
  const placements = (sheet.screen && sheet.screen[group]) || [];
  return placements.map((placement) => {
    const grid = spriteGrid(sheet, placement.graphic, placement);
    if (grid === false) {
      throw new Error('the ' + group + ' uses graphic ' + placement.graphic + ', which draws nothing');
    }
    const positions = [];
    for (let repeat = 0; repeat < placement.repeat; repeat++) {
      positions.push({
        x: placement.x + repeat * placement.stepX,
        y: SCREEN_HEIGHT - (placement.y + repeat * placement.stepY) - grid.height
      });
    }
    return { graphic: placement.graphic, grid: grid, positions: positions };
  });
} // screenPlacements

/**
 * Decodes one sprite into a grid of pixel states, applying the flips the way
 * the original does: a vertical flip swaps whole rows, a horizontal one mirrors
 * every row across the full width of the sprite data.
 */
function buildGrid(sheet, entry, flipHorizontal, flipVertical) {
  const sprite = sheet.sprites[entry.sprite];
  const width = sprite.width;
  const height = sprite.height;
  const bytesPerRow = width / 8;
  const pixels = new Uint8Array(width * height);
  for (let row = 0; row < height; row++) {
    // the first row of the stored data is the bottom one
    const target = flipVertical ? row : height - 1 - row;
    let at = row * bytesPerRow * 4;
    for (let byte = 0; byte < bytesPerRow; byte++) {
      const mask = parseInt(sprite.bytes.substring(at, at + 2), 16);
      const ink = parseInt(sprite.bytes.substring(at + 2, at + 4), 16);
      at += 4;
      for (let bit = 0; bit < 8; bit++) {
        const state = (ink & (0x80 >> bit)) ? INK : ((mask & (0x80 >> bit)) ? MASK : TRANSPARENT);
        if (state !== TRANSPARENT) {
          const column = byte * 8 + bit;
          pixels[target * width + (flipHorizontal ? width - 1 - column : column)] = state;
        }
      }
    }
  }
  return {
    width: width,
    height: height,
    anchor: spriteAnchor(entry, flipHorizontal, flipVertical),
    pixels: pixels
  };
} // buildGrid

function isPositive(value) {
  return Number.isInteger(value) && value > 0;
}

function isAnchor(value) {
  return !!value && Number.isInteger(value.x) && Number.isInteger(value.y);
}

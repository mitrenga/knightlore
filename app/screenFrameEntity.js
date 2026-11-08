const { AbstractEntity } = await import('./svision/js/abstractEntity.js?ver='+window.srcVersion);
const { SpriteEntity } = await import('./svision/js/platform/canvas2D/spriteEntity.js?ver='+window.srcVersion);
const { ZXColor } = await import('./svision/js/platform/canvas2D/zx/zxColor.js?ver='+window.srcVersion);
const { screenPlacements, gridRow, spriteGrid, SCREEN_HEIGHT, FONT_SIZE, SUN_MOON, STATUS } = await import('./spriteSheet.js?ver='+window.srcVersion);
// begin code

/**
 * The furniture of the screen: the panel around the room, and - for the menu
 * screens of M10 - the decorated frame.
 *
 * Both are sprites in the original, which is why the screen looked empty until
 * now: `NOTES-ORIGINAL.md` chapter 9 had their coordinates but not their
 * pictures. They are masked sprites like everything else, so they are drawn by
 * svision's `SpriteEntity` with a mask colour - this is the one place in the
 * game where the library's sprites are used directly rather than through the
 * scene's rasteriser.
 *
 * The two are not on screen at the same time. `display_panel` runs in the game
 * loop, so the panel is part of the playing screen; `print_border` is only ever
 * called from `display_text_list`, so the frame belongs to the menu, the text
 * screens and the game over screen. During play there is nothing around the
 * room but the panel, which is why the far wall of a shallow room may reach the
 * top edge of the screen.
 *
 * What the panel *shows* is state, and from M8 it shows all of it. The sun and
 * the moon are the day and the night: the sun crosses the little window at the
 * right hand end of the panel, and when it reaches the end of its run the moon
 * takes over and Sabreman turns into the werewolf. Beside them are the day the
 * game has got to - forty of them is the whole game - the lives left, and the
 * three objects in the hero's hands, each in its own colour.
 *
 * None of that is drawn through the projection or through the scene: the
 * original prints it straight at a pixel position out of an 8x8 font and a
 * handful of sprites (`display_day`, `print_days`, `print_lives`,
 * `display_objects`), so it is a fixed set of sprite entities here whose frame
 * or visibility changes, and the positions are in `STATUS`.
 *
 * It is one attribute colour per room, like the rest of the screen, and it is
 * drawn before the scene, so an object that reaches the edge of the room covers
 * it rather than the other way round - which is the order the original draws
 * them in as well.
 */
export class ScreenFrameEntity extends AbstractEntity {

  /**
   * @param {AbstractEntity} parentEntity the entity the frame is attached to
   * @param {number} x x position inside the parent
   * @param {number} y y position inside the parent
   * @param {number} width frame width, the whole 256 pixel screen
   * @param {number} height frame height
   * @param {string[]} groups which groups of `sheet.screen` to draw, `'panel'`
   *   for the playing screen and `'border'` for the menu screens
   */
  constructor(parentEntity, x, y, width, height, groups) {
    super(parentEntity, x, y, width, height, ZXColor.brightWhite, false);
    this.id = 'ScreenFrameEntity';

    this.groups = groups;
    this.sprites = false;
    this.pieces = [];
    this.sunEntity = false;
    this.windowEntity = false;
    this.sunHeight = 0;
    this.paperColor = ZXColor.black;
    this.roomInk = 0;
    /** The two digits of the day counter and the two of the lives. */
    this.daysDigits = [];
    this.livesDigits = [];
    /** The four glyphs of the word DAY, which take the room's own colour. */
    this.dayPieces = [];
    /** One entity per slot and per kind of object: only the right one is shown. */
    this.carriedPieces = [];
  } // constructor

  /**
   * Builds the sprite entities of the pieces this entity draws.
   *
   * @param {object} sprites a sheet from `readSprites()`
   */
  setSprites(sprites) {
    this.sprites = sprites;
    this.shutdown();                                 // a second room reuses the entity
    this.pieces = [];
    this.sunEntity = false;
    this.windowEntity = false;
    this.daysDigits = [];
    this.livesDigits = [];
    this.dayPieces = [];
    this.carriedPieces = [];
    for (var g = 0; g < this.groups.length; g++) {
      var placements = screenPlacements(sprites, this.groups[g]);
      for (var p = 0; p < placements.length; p++) {
        this.addPlacement(placements[p]);
      }
      if (this.groups[g] == 'panel') {
        this.addSunAndMoon();
        this.addStatus();
      }
    }
  } // setSprites

  /**
   * The rest of the panel: the word DAY and the day counter under it, the little
   * hero and the lives beside him, and the three objects being carried.
   *
   * Everything here is built once and then only shown, hidden or given another
   * frame - the original redraws the same handful of pixel windows for the whole
   * game and never moves any of them.
   */
  addStatus() {
    this.dayPieces = this.addText(STATUS.day, this.sprites.fonts.day, STATUS.day.text);
    this.daysDigits = this.addText(STATUS.days, this.sprites.fonts.text,
      new Array(STATUS.days.digits).fill(0));
    this.livesDigits = this.addText(STATUS.lives, this.sprites.fonts.text,
      new Array(STATUS.lives.digits).fill(0));
    this.addStatusSprite(STATUS.livesGraphic.graphic,
      STATUS.livesGraphic.x, STATUS.livesGraphic.y, ZXColor.color(STATUS.ink+8));
    this.addCarried();
  } // addStatus

  /**
   * A row of characters of one of the two fonts, one entity per character. Every
   * one of them carries the whole font as its frames, so showing a number is
   * setting a frame and nothing else.
   *
   * @param {object} field a field of `STATUS`, `{x, y}` being its top left pixel
   * @param {string[][]} font one of `sheet.fonts`
   * @param {number[]} initial the character to start each position on
   * @returns {SpriteEntity[]} one entity per character, left to right
   */
  addText(field, font, initial) {
    var entities = [];
    for (var c = 0; c < initial.length; c++) {
      var piece = new SpriteEntity(this, field.x+c*FONT_SIZE, field.y,
        ZXColor.color(STATUS.ink+8), false, 0, 0);
      piece.setGraphicsData({penChar: '#', maskChar: ':', frames: font.length, sprite: font});
      piece.setFixSize(FONT_SIZE, FONT_SIZE);
      piece.frame = initial[c];
      this.addEntity(piece);
      entities.push(piece);
    }
    return entities;
  } // addText

  /**
   * One sprite printed straight onto the panel. The original's pixel Y is the
   * bottom row of the sprite counted up from the bottom of the screen, the same
   * as everywhere else on this screen.
   *
   * @param {number} graphic graphic number to draw
   * @param {number} x its left edge in screen pixels
   * @param {number} y its bottom row, counted the original's way
   * @param {string} color the ink to draw it in
   * @returns {SpriteEntity|false} the entity, or false when it draws nothing
   */
  addStatusSprite(graphic, x, y, color) {
    var grid = spriteGrid(this.sprites, graphic);
    if (grid === false) {
      return false;
    }
    var piece = new SpriteEntity(this, x, SCREEN_HEIGHT-y-grid.height, color, false, 0, 0);
    piece.setGraphicsData({penChar: '#', maskChar: ':', sprite: ScreenFrameEntity.rowsOf(grid)});
    piece.setFixSize(grid.width, grid.height);
    this.addEntity(piece);
    return piece;
  } // addStatusSprite

  /**
   * The three windows the objects being carried are drawn in.
   *
   * Each kind of object is its own colour in the original (`object_attributes`),
   * and an attribute is a whole 8x8 cell there, so an object in the panel is
   * simply drawn in its own ink. There is one entity per window and per kind
   * rather than one with frames, because the seven sprites are not the same
   * height; all of them are hidden and `setStatus()` shows the right one.
   */
  addCarried() {
    var spec = STATUS.carried;
    for (var slot = 0; slot < spec.slots; slot++) {
      var pieces = {};
      for (var kind = 0; kind < STATUS.carriedInk.length; kind++) {
        var graphic = ScreenFrameEntity.firstObject+kind;
        var piece = this.addStatusSprite(graphic, spec.x+slot*spec.step, spec.y,
          ZXColor.color(STATUS.carriedInk[kind]+8));
        if (piece !== false) {
          piece.hide = true;
          pieces[graphic] = piece;
        }
      }
      this.carriedPieces.push(pieces);
    }
  } // addCarried

  /**
   * What the panel says about the game: which day it is, how many lives are
   * left and what the hero is carrying.
   *
   * @param {object} snapshot the frame from the game worker
   */
  setStatus(snapshot) {
    ScreenFrameEntity.setNumber(this.daysDigits, snapshot.days);
    ScreenFrameEntity.setNumber(this.livesDigits, Math.max(snapshot.lives, 0));
    for (var slot = 0; slot < this.carriedPieces.length; slot++) {
      var wanted = snapshot.carried[slot];
      var pieces = this.carriedPieces[slot];
      for (var graphic in pieces) {
        if (Object.prototype.hasOwnProperty.call(pieces, graphic)) {
          pieces[graphic].hide = Number(graphic) !== wanted;
        }
      }
    }
  } // setStatus

  /**
   * Writes a number right aligned into a row of digits, leading zeros and all -
   * the original prints two BCD digits and never suppresses the first.
   *
   * @param {SpriteEntity[]} digits the entities to write into
   * @param {number} value the number to show
   */
  static setNumber(digits, value) {
    var left = Math.max(value, 0);
    for (var d = digits.length-1; d >= 0; d--) {
      digits[d].frame = left % 10;
      left = Math.floor(left/10);
    }
  } // setNumber

  /**
   * The window the sun and the moon cross, at the right hand end of the panel
   * (`display_sun_moon_frame`).
   *
   * It is not in the placements of the panel, because the original does not
   * draw it with the panel: it clears the window and draws it again every
   * eighth frame, which is when the sun has moved. What goes in it is one
   * sprite with two frames - the sun and the moon are graphic numbers one
   * apart, and the original swaps between them by toggling a bit - and over it
   * go two pieces of scenery the sun passes behind.
   *
   * The window is an entity of its own, of exactly the rectangle the original
   * blits back to the screen (`SUN_MOON.windowX` and the two sizes), and the
   * sun is cropped to it. That is what keeps the sun and the moon inside the
   * little window: their run begins eight pixels before its left edge and their
   * sprite ends nine pixels past its right edge, and without the crop those
   * ends are drawn over the panel instead of being cut off by the blit.
   */
  addSunAndMoon() {
    var window = SUN_MOON;
    var sun = spriteGrid(this.sprites, window.sun);
    var moon = spriteGrid(this.sprites, window.moon);
    if (sun === false || moon === false) {
      return;
    }
    this.sunHeight = sun.height;
    this.windowEntity = new AbstractEntity(this, window.windowX,
      SCREEN_HEIGHT-window.windowHeight, window.windowWidth, window.windowHeight,
      this.penColor, false);
    this.windowEntity.id = 'SunMoonWindow';
    this.addEntity(this.windowEntity);
    this.sunEntity = new SpriteEntity(this.windowEntity,
      window.firstX-window.windowX,
      window.windowHeight-SUN_MOON.restY-sun.height, this.penColor, false, 0, 0);
    this.sunEntity.setMaskColor(this.paperColor);
    this.sunEntity.setGraphicsData({penChar: '#', maskChar: ':', frames: 2,
      sprite: [ScreenFrameEntity.rowsOf(sun), ScreenFrameEntity.rowsOf(moon)]});
    this.windowEntity.addEntity(this.sunEntity);
    this.sunEntity.enablePaintWithVisibility();      // cut off at the window's edges
    this.pieces.push(this.sunEntity);
    // the scenery goes in afterwards, so that the sun passes behind it
    this.addFramePiece(window.left, window.leftX);
    this.addFramePiece(window.right, window.rightX);
  } // addSunAndMoon

  /**
   * One of the two pieces of scenery in front of the sun's window.
   *
   * It goes inside the window entity, so its position is given relative to the
   * window's left edge and its bottom is the bottom of the window.
   *
   * @param {number} graphic graphic number of the piece
   * @param {number} x its left edge, in screen pixels
   */
  addFramePiece(graphic, x) {
    var grid = spriteGrid(this.sprites, graphic);
    if (grid === false) {
      return;
    }
    this.addPiece(ScreenFrameEntity.rowsOf(grid), grid,
      {x: x-SUN_MOON.windowX, y: SUN_MOON.windowHeight-grid.height}, 1, 1,
      this.windowEntity);
  } // addFramePiece

  /**
   * Where the sun or the moon has got to.
   *
   * @param {object} sky `{graphic, x, y, night, days}` from the game worker
   */
  setSky(sky) {
    if (this.sunEntity === false) {
      return;
    }
    this.sunEntity.frame = sky.night ? 1 : 0;
    this.sunEntity.x = sky.x-SUN_MOON.windowX;
    this.sunEntity.y = SUN_MOON.windowHeight-sky.y-this.sunHeight;
  } // setSky

  /**
   * A sprite grid as the rows of text `SpriteEntity` reads.
   *
   * @param {object} grid a grid from `spriteGrid()`
   * @returns {string[]} one string per row
   */
  static rowsOf(grid) {
    var rows = [];
    for (var r = 0; r < grid.height; r++) {
      rows.push(gridRow(grid, r));
    }
    return rows;
  } // rowsOf

  /**
   * Adds one piece of the furniture. A piece that repeats along a whole row or
   * column of the screen is a single sprite entity with a repeat count - which
   * is what the two bars of the frame and the two pillars of the panel are -
   * and anything else, like the diagonal edge of the panel, becomes one entity
   * per repetition.
   *
   * @param {object} placement one entry of `screenPlacements()`
   */
  addPlacement(placement) {
    var grid = placement.grid;
    var positions = placement.positions;
    var rows = ScreenFrameEntity.rowsOf(grid);
    var repeatX = 1;
    var repeatY = 1;
    var origin = positions[0];
    if (positions.length > 1) {
      if (ScreenFrameEntity.isRun(positions, grid.width, 0)) {
        repeatX = positions.length;
      } else if (ScreenFrameEntity.isRun(positions, 0, -grid.height)) {
        repeatY = positions.length;
        origin = positions[positions.length-1];
      } else {
        for (var q = 0; q < positions.length; q++) {
          this.addPiece(rows, grid, positions[q], 1, 1);
        }
        return;
      }
    }
    this.addPiece(rows, grid, origin, repeatX, repeatY);
  } // addPlacement

  /**
   * Creates one sprite entity of the furniture.
   *
   * @param {string[]} rows the sprite as rows of `#`, `:` and `.`
   * @param {object} grid the grid the rows come from
   * @param {object} position top left pixel of the piece
   * @param {number} repeatX how many times the sprite repeats to the right
   * @param {number} repeatY how many times it repeats downwards
   * @param {AbstractEntity} [parent] the entity to put the piece in, this one
   *   by default; the pieces of the sun's window go inside the window
   */
  addPiece(rows, grid, position, repeatX, repeatY, parent) {
    var into = parent || this;
    var piece = new SpriteEntity(into, position.x, position.y, this.penColor, false, 0, 0);
    piece.setMaskColor(this.paperColor);
    piece.setGraphicsData({penChar: '#', maskChar: ':', sprite: rows});
    piece.setFixSize(grid.width, grid.height);
    if (repeatX > 1) {
      piece.setRepeatX(repeatX);
    }
    if (repeatY > 1) {
      piece.setRepeatY(repeatY);
    }
    into.addEntity(piece);
    this.pieces.push(piece);
  } // addPiece

  /**
   * Sets the colours of the room the frame is drawn in: the whole screen of the
   * original is one attribute, so the frame changes colour with the room.
   *
   * @param {string} inkColor the room's ink colour
   * @param {string} paperColor the room's paper colour
   */
  setColors(inkColor, paperColor, ink) {
    this.penColor = inkColor;
    this.paperColor = paperColor;
    this.roomInk = ink|0;
    for (var p = 0; p < this.pieces.length; p++) {
      this.pieces[p].setPenColor(inkColor);
      this.pieces[p].setMaskColor(paperColor);
    }
    // `display_day` picks the colour of the word DAY from the room's own: the
    // attribute byte complemented, plus two, and the low three bits of that
    var dayColor = ZXColor.color(((9-this.roomInk) & 7)+8);
    for (var d = 0; d < this.dayPieces.length; d++) {
      this.dayPieces[d].setPenColor(dayColor);
    }
  } // setColors

  /**
   * Draws the pieces.
   */
  drawEntity() {
    if (this.hide == true) {
      return;
    }
    this.drawSubEntities();
  } // drawEntity

  /**
   * Whether the positions are a contiguous run with the given step, which is
   * what a repeat count can draw in one go.
   *
   * @param {object[]} positions the positions to test
   * @param {number} stepX expected step to the right
   * @param {number} stepY expected step downwards
   * @returns {boolean} true when every position follows the previous one
   */
  static isRun(positions, stepX, stepY) {
    for (var p = 1; p < positions.length; p++) {
      if (positions[p].x != positions[p-1].x+stepX || positions[p].y != positions[p-1].y+stepY) {
        return false;
      }
    }
    return true;
  } // isRun

} // ScreenFrameEntity

/** Graphic number of the first of the objects that may be carried. */
ScreenFrameEntity.firstObject = 96;

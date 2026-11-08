const { AbstractEntity } = await import('./svision/js/abstractEntity.js?ver='+window.srcVersion);
const { TextEntity } = await import('./svision/js/platform/canvas2D/textEntity.js?ver='+window.srcVersion);
const { ZXColor } = await import('./svision/js/platform/canvas2D/zx/zxColor.js?ver='+window.srcVersion);
// begin code

/**
 * Development overlay for the scene: how much there is to draw, how much of it
 * came out of the sprite sheet, how long the ordering and the drawing took,
 * where the hero is and what the physics thinks he is doing, and where the
 * original's frame, panel and counters sit on the screen.
 *
 * It is deliberately not a ZX Spectrum looking thing — it is drawn in a colour
 * the game never uses, so a screenshot with the overlay on can never be
 * mistaken for a screenshot of the game.
 */
export class DebugOverlayEntity extends AbstractEntity {

  /**
   * @param {AbstractEntity} parentEntity the entity the overlay is attached to
   * @param {number} x x position inside the parent
   * @param {number} y y position inside the parent
   * @param {number} width overlay width
   * @param {number} height overlay height
   * @param {SceneEntity} sceneEntity the scene the numbers are read from
   * @param {RoomModel} model the model the hero and the keys are read from
   */
  constructor(parentEntity, x, y, width, height, sceneEntity, model) {
    super(parentEntity, x, y, width, height, ZXColor.brightYellow, false);
    this.id = 'DebugOverlayEntity';

    this.sceneEntity = sceneEntity;
    this.model = model;
    this.showGuides = false;
    this.lines = [];
    this.frameTime = 0;
    this.frameTimestamp = 0;
  } // constructor

  /**
   * Creates the text rows of the overlay.
   */
  init() {
    for (var l = 0; l < DebugOverlayEntity.rows; l++) {
      var line = new TextEntity(this, this.app.fonts.fonts5x5, 2, 2+l*7, this.width-4, 5, '', this.penColor, false, {});
      this.addEntity(line);
      this.lines.push(line);
    }
  } // init

  /**
   * Records how long the last frame took, so the overlay can show the frame
   * rate next to the times spent inside the scene.
   *
   * @param {number} timestamp the current frame timestamp
   */
  loopEntity(timestamp) {
    if (this.frameTimestamp != 0) {
      this.frameTime = timestamp-this.frameTimestamp;
    }
    this.frameTimestamp = timestamp;
  } // loopEntity

  /**
   * Turns the guide rectangles on or off.
   *
   * @param {boolean} value true to draw the guides
   */
  setShowGuides(value) {
    this.showGuides = value;
  } // setShowGuides

  /**
   * Refreshes the texts and draws them, plus the guides when enabled.
   */
  drawEntity() {
    if (this.hide == true) {
      return;
    }
    this.refreshTexts();
    if (this.showGuides) {
      this.drawGuides();
    }
    this.drawSubEntities();
  } // drawEntity

  /**
   * Fills the rows from the scene's statistics.
   */
  refreshTexts() {
    var scene = this.sceneEntity;
    var stats = scene.stats;
    var room = scene.room;
    var hero = scene.hero;

    this.lines[0].setText(room === false
      ? 'NO ROOM DATA'
      : 'ROOM '+DebugOverlayEntity.pad(room.id, 3)
        +'  INK '+room.attribute.ink
        +'  SIZE '+room.bounds.x+'X'+room.bounds.y
        +'  EXITS '+DebugOverlayEntity.exits(room));
    this.lines[1].setText('OBJECTS '+stats.objects+'  BOXES '+stats.boxes
      +'  SPRITES '+stats.sprites
      +(stats.missing ? '  NO SPRITE '+stats.missing : '')
      +(stats.offScreen ? '  OFF SCREEN '+stats.offScreen : ''));
    this.lines[2].setText('SORT '+DebugOverlayEntity.ms(stats.sortTime)
      +'  DRAW '+DebugOverlayEntity.ms(stats.drawTime)
      +'  FRAME '+DebugOverlayEntity.ms(this.frameTime));
    this.lines[3].setText('DRAW '+(scene.useSprites && scene.sprites !== false ? 'SPRITES' : 'BOXES')
      +'  FILL '+(scene.fillBoxes ? 'ON' : 'OFF')
      +'  GUIDES '+(this.showGuides ? 'ON' : 'OFF')
      +'  KEYS '+this.app.inputMethod.slice(0, 3).toUpperCase());
    this.lines[4].setText(hero === false
      ? 'NO HERO'
      : 'HERO '+hero.form.toUpperCase()+' '+DebugOverlayEntity.heroDirection(hero)
        +' FRAME '+hero.frame
        +'  AT '+hero.x+','+hero.y+','+hero.z);
    this.lines[5].setText(hero === false
      ? ''
      : 'DZ '+DebugOverlayEntity.signed(hero.dz)+'  '+DebugOverlayEntity.heroState(hero)
        +'  TICK '+(this.model.snapshot === false ? 0 : this.model.snapshot.tick));
    this.lines[6].setText(DebugOverlayEntity.roomState(this.model.snapshot));
    this.lines[7].setText('D OVERLAY S SPRITES F FILL G GUIDES O ORDER R REDRAW');
    this.lines[8].setText('C KEYS N WEREWOLF [ ] ROOM  ARROWS AND SPACE PLAY');
  } // refreshTexts

  /**
   * The walls of the room with an arch in them, by initial. The id of the room
   * behind each of them is not shown: it is this room's id plus or minus one or
   * sixteen, and there is no room on the line for four of them.
   *
   * @param {object} room the room being shown
   * @returns {string} some of NESW, or a dash
   */
  static exits(room) {
    var text = '';
    var sides = ['north', 'east', 'south', 'west'];
    for (var s = 0; s < sides.length; s++) {
      if (room.exits[sides[s]] !== false) {
        text += sides[s].charAt(0).toUpperCase();
      }
    }
    return text === '' ? '-' : text;
  } // exits

  /**
   * The state of the room the game worker is running: the sky, which is the day
   * and the night, how many lives are left, and how much of the object table is
   * still there.
   *
   * @param {object|false} snapshot the last snapshot from the worker
   * @returns {string} the row
   */
  static roomState(snapshot) {
    if (snapshot === false) {
      return 'NO SNAPSHOT';
    }
    var alive = 0;
    for (var o = 0; o < snapshot.objects.length; o++) {
      if (snapshot.objects[o].graphic !== 0) {
        alive++;
      }
    }
    var carried = snapshot.carried.filter(function(graphic) {
      return graphic !== 0;
    }).length;
    var over = '';
    if (snapshot.gameOver) {
      over = '  '+(snapshot.won ? 'POTION MADE' : 'GAME OVER')
        +' '+snapshot.score.percent+'% - ANY KEY';
    }
    return (snapshot.sky.night ? 'NIGHT' : 'DAY')
      +' '+snapshot.days+'  SUN '+snapshot.sky.x
      +'  LIVES '+snapshot.lives
      +'  CARRY '+carried+'  POT '+snapshot.inCauldron
      +'  IN ROOM '+alive+'/'+snapshot.objects.length
      +over;
  } // roomState

  /**
   * The direction the hero faces, as its initial.
   *
   * @param {object} hero the hero state of the scene
   * @returns {string} one of W, E, N, S
   */
  static heroDirection(hero) {
    return DebugOverlayEntity.directions[hero.direction] || '?';
  } // heroDirection

  /**
   * What the hero is doing, in the terms the physics thinks in: the jump flag,
   * and the "Z out of bounds" flag the collision leaves behind, which is the
   * original's way of saying he is standing on something.
   *
   * @param {object} hero the hero state of the scene
   * @returns {string} JUMPING, FALLING or STANDING
   */
  static heroState(hero) {
    var where = (hero.entering ? ' ENTER' : '')+(hero.atArch ? ' ARCH' : '');
    if (hero.jumping) {
      return 'JUMPING'+where;
    }
    return (hero.grounded ? 'STANDING' : 'FALLING')+where;
  } // heroState

  /**
   * A number with its sign, so a falling speed reads as a falling speed.
   *
   * @param {number} value the number
   * @returns {string} the number, plus signed
   */
  static signed(value) {
    var number = value || 0;
    return (number > 0 ? '+' : '')+number;
  } // signed

  /**
   * Draws the screen furniture of the original as empty rectangles, so the
   * scene can be checked against a screenshot before the sprites exist. The
   * coordinates come from `NOTES-ORIGINAL.md` chapter 9.
   */
  drawGuides() {
    var guides = DebugOverlayEntity.guides;
    for (var g = 0; g < guides.length; g++) {
      var guide = guides[g];
      this.app.layout.paint(this, guide[0], guide[1], guide[2], 1, this.penColor);
      this.app.layout.paint(this, guide[0], guide[1]+guide[3]-1, guide[2], 1, this.penColor);
      this.app.layout.paint(this, guide[0], guide[1], 1, guide[3], this.penColor);
      this.app.layout.paint(this, guide[0]+guide[2]-1, guide[1], 1, guide[3], this.penColor);
    }
  } // drawGuides

  /**
   * Formats a duration for the overlay.
   *
   * @param {number} value duration in milliseconds
   * @returns {string} the duration with one decimal place
   */
  static ms(value) {
    return (Math.round(value*10)/10)+'MS';
  } // ms

  /**
   * Pads a number with leading zeros.
   *
   * @param {number} value the number
   * @param {number} length required length
   * @returns {string} the padded number
   */
  static pad(value, length) {
    var text = ''+value;
    while (text.length < length) {
      text = '0'+text;
    }
    return text;
  } // pad

} // DebugOverlayEntity

/** Text rows the overlay is made of. */
DebugOverlayEntity.rows = 9;

/** Initials of the four directions, in the order the original numbers them. */
DebugOverlayEntity.directions = ['W', 'E', 'N', 'S'];

/**
 * Rectangles of the original's screen furniture as `[x, y, width, height]`,
 * in screen pixels with y counted downwards: the window inside the decorated
 * frame, the sun/moon panel, the day counter and the lives indicator.
 */
DebugOverlayEntity.guides = [
  [8, 31, 240, 129],
  [184, 160, 48, 32],
  [120, 184, 16, 8],
  [16, 144, 32, 16]
];

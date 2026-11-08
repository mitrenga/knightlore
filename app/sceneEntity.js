const { AbstractEntity } = await import('./svision/js/abstractEntity.js?ver='+window.srcVersion);
const { ZXColor } = await import('./svision/js/platform/canvas2D/zx/zxColor.js?ver='+window.srcVersion);
const { IsoProjection } = await import('./isoProjection.js?ver='+window.srcVersion);
const { IsoRaster } = await import('./isoRaster.js?ver='+window.srcVersion);
const { DepthSort } = await import('./depthSort.js?ver='+window.srcVersion);
const { roomBoxes, ITEM } = await import('./roomData.js?ver='+window.srcVersion);
const { spriteGrid, spritePosition, spriteVisible, boxReference } = await import('./spriteSheet.js?ver='+window.srcVersion);
const { newHero, heroBoxes } = await import('./hero.js?ver='+window.srcVersion);
// begin code

/**
 * Draws one room: it turns the room data into a display list of boxes, orders
 * that list back to front and paints it with the painter's algorithm.
 *
 * Every box is a masked sprite of the original, positioned by the anchor its
 * graphic number carries (`app/spriteSheet.js`): the mask clears the paper and
 * the image draws the ink, so an object in front simply wipes what is behind
 * it. Nothing else does the occlusion - there is no depth buffer and no
 * clipping, exactly as in 1984.
 *
 * The whole scene is rebuilt from the ordered display list whenever it is
 * marked dirty, as `GAME-DESIGN.md` chapter 4 prescribes; the result is kept
 * in a drawing cache, so a static room costs one blit per frame. Splitting the
 * scene into a static and a dynamic layer is deliberately not done until the
 * measurements shown by the debug overlay say it is necessary.
 *
 * The box outlines the scene was built with in M2 are still there behind the
 * `S` key: they draw the geometry instead of the picture, which is what to look
 * at when the ordering rather than the artwork looks wrong.
 */
export class SceneEntity extends AbstractEntity {

  /**
   * @param {AbstractEntity} parentEntity the entity the scene is attached to
   * @param {number} x x position inside the parent
   * @param {number} y y position inside the parent
   * @param {number} width scene width, normally the whole 256 pixel screen
   * @param {number} height scene height
   */
  constructor(parentEntity, x, y, width, height) {
    super(parentEntity, x, y, width, height, ZXColor.brightWhite, false);
    this.id = 'SceneEntity';

    this.room = false;
    this.sprites = false;
    this.hero = false;
    this.projection = false;
    this.paperColor = ZXColor.black;
    this.ink = 0;
    this.boxes = [];
    this.order = [];
    this.useSprites = true;
    this.fillBoxes = true;
    this.stats = {objects: 0, boxes: 0, sprites: 0, missing: 0, offScreen: 0, sortTime: 0, drawTime: 0};
  } // constructor

  /**
   * Creates the drawing cache the scene is painted into.
   */
  init() {
    this.app.layout.newDrawingCache(this, 0);
  } // init

  /**
   * Shows a room: stores it, derives the projection and the attribute colours
   * from it, puts the hero in the middle of it and marks the scene for
   * redrawing.
   *
   * @param {object} room a room validated by `readRoom()`
   */
  setRoom(room) {
    this.room = room;
    this.projection = IsoProjection.forRoom(room);
    this.ink = room.attribute.ink;
    this.penColor = ZXColor.color(room.attribute.ink+(room.attribute.bright ? 8 : 0));
    this.paperColor = ZXColor.color(room.attribute.paper);
    this.hero = newHero(room);
    this.buildDisplayList();
    this.cleanCache();
  } // setRoom

  /**
   * Hands the scene the sprites of the original.
   *
   * @param {object} sprites a sheet from `readSprites()`
   */
  setSprites(sprites) {
    this.sprites = sprites;
    this.cleanCache();
  } // setSprites

  /**
   * Records what the worker says the hero is doing. The picture of him is not
   * built here - he is the first two boxes of the display list and comes back
   * with the rest of the room in `setObjects()` - this is the state the debug
   * overlay reads and the state a room built without a worker starts from.
   *
   * @param {object} change fields of the hero state to replace
   */
  setHero(change) {
    if (this.hero === false) {
      return;
    }
    for (var key in change) {
      if (Object.prototype.hasOwnProperty.call(change, key)) {
        this.hero[key] = change[key];
      }
    }
  } // setHero

  /**
   * Puts the room where the worker says it is: one row of the snapshot per box
   * of the display list, in the same order, because the display list is the
   * worker's object table. A box whose graphic number has gone to zero has been
   * taken out of the room - a collapsed block, the hero in the moment between
   * dying and coming back - and is not drawn at all.
   *
   * The scene is repainted only when one of those rows actually changed. A room
   * with nothing moving in it therefore still costs one blit a frame, as it did
   * before anything moved.
   *
   * @param {object[]} objects `{graphic, x, y, z, flipH}` per box
   */
  setObjects(objects) {
    var redraw = false;
    for (var o = 0; o < objects.length && o < this.boxes.length; o++) {
      var row = objects[o];
      var box = this.boxes[o];
      if (box.graphic !== row.graphic || box.x !== row.x || box.y !== row.y
        || box.z !== row.z || box.flipH !== row.flipH) {
        redraw = true;
      }
      box.graphic = row.graphic;
      box.x = row.x;
      box.y = row.y;
      box.z = row.z;
      box.flipH = row.flipH;
    }
    if (redraw) {
      this.cleanCache();
    }
  } // setObjects

  /**
   * Turns the room's objects into the flat list of boxes the renderer works
   * with. Background and blocks go into one list, because the original builds
   * one display list out of both, and an object's extra parts are boxes of
   * their own - the arch halves and the wall planes are ordered against
   * everything else individually. The hero is appended as two more boxes, which
   * is how the original carries him as well.
   */
  buildDisplayList() {
    this.boxes = [];
    if (this.room === false) {
      return;
    }
    // the hero goes in front of the room, because that is where he is in the
    // original's object table, and this list is that table
    if (this.hero !== false) {
      var hero = heroBoxes(this.hero);
      for (var h = 0; h < hero.length; h++) {
        this.boxes.push(hero[h]);
      }
    }
    // and behind him the two slots the room keeps for collectable objects,
    // empty until the worker says otherwise. They are here rather than in
    // `roomBoxes()` because they are not part of the room's data: which object
    // is in which room is a thing of the game and it changes as it is played.
    // This list and the worker's object table are read off each other row by
    // row, so a slot that is empty is still a row (`SpecialObjects.slots`)
    for (var s = 0; s < SceneEntity.specialSlots; s++) {
      this.boxes.push({
        graphic: 0,
        x: 0, y: 0, z: 0,
        sx: ITEM.radiusX*2, sy: ITEM.radiusY*2, sz: ITEM.height,
        flipH: false, flipV: false, moveable: true, ignore3D: false, part: 0,
        type: 'object', source: 'special', collision: 'collectible', motion: 'object'
      });
    }
    var boxes = roomBoxes(this.room);
    for (var b = 0; b < boxes.length; b++) {
      this.boxes.push(boxes[b]);
    }
    this.stats.objects = this.room.objects.length+(this.hero === false ? 0 : 1);
    this.stats.boxes = this.boxes.length;
  } // buildDisplayList

  /**
   * Switches between the sprites of the original and the box outlines of M2.
   *
   * @param {boolean} value true to draw sprites
   */
  setUseSprites(value) {
    if (this.useSprites != value) {
      this.useSprites = value;
      this.cleanCache();
    }
  } // setUseSprites

  /**
   * In the outline mode, draws the boxes only as outlines or filled with the
   * paper colour. Without the fill nothing occludes anything, which is the
   * quickest way to see what the depth sorting actually did.
   *
   * @param {boolean} value true to fill the silhouettes
   */
  setFillBoxes(value) {
    if (this.fillBoxes != value) {
      this.fillBoxes = value;
      this.cleanCache();
    }
  } // setFillBoxes

  /**
   * Marks the cached scene as out of date.
   */
  cleanCache() {
    if (this.drawingCache[0]) {
      this.drawingCache[0].cleanCache();
    }
  } // cleanCache

  /**
   * Draws the cached scene, repainting it first when the cache is dirty.
   */
  drawEntity() {
    if (this.hide == true || this.room === false) {
      return;
    }
    var cache = this.drawingCache[0];
    if (cache.preparePaint(this.width, this.height)) {
      cache.ctx.clearRect(0, 0, this.width, this.height);
      this.paintScene(cache);
    }
    this.app.layout.paintCache(this, 0);
    this.drawSubEntities();
  } // drawEntity

  /**
   * Orders the display list and paints it back to front, recording how long
   * both steps took for the debug overlay.
   *
   * @param {DrawingCache} cache the cache to paint into
   */
  paintScene(cache) {
    var started = SceneEntity.now();
    this.order = DepthSort.order(this.boxes);
    var ordered = SceneEntity.now();

    var surface = this.newSurface(cache);
    var drawSprites = this.useSprites && this.sprites !== false;
    var paper = this.fillBoxes ? this.paperColor : false;
    this.stats.sprites = 0;
    this.stats.missing = 0;
    this.stats.offScreen = 0;
    for (var o = 0; o < this.order.length; o++) {
      var box = this.boxes[this.order[o]];
      if (box.graphic === 0) {
        // an empty slot of the object table: it is not in the room any more
        continue;
      }
      var grid = drawSprites ? this.boxGrid(box) : false;
      if (grid !== false) {
        var reference = boxReference(box);
        var point = IsoProjection.point(this.projection, reference.x, reference.y, reference.z);
        var position = spritePosition(grid, point);
        if (spriteVisible(grid, position)) {
          IsoRaster.drawSprite(surface, grid, position.x, position.y, this.penColor, this.paperColor);
          this.stats.sprites++;
        } else {
          this.stats.offScreen++;
        }
      } else {
        if (drawSprites) {
          this.stats.missing++;
        }
        IsoRaster.drawBox(surface, IsoProjection.boxOutline(this.projection, box), this.penColor, paper);
      }
    }

    this.stats.sortTime = ordered-started;
    this.stats.drawTime = SceneEntity.now()-ordered;
  } // paintScene

  /**
   * The sprite of one box of the display list, mirrored the way the object's
   * flags ask for.
   *
   * @param {object} box one entry of the display list
   * @returns {object|false} a grid from `spriteGrid()`, or false when the box
   *   has no sprite to draw
   */
  boxGrid(box) {
    if (box.graphic === undefined) {
      return false;
    }
    return spriteGrid(this.sprites, box.graphic,
      {flipHorizontal: box.flipH, flipVertical: box.flipV});
  } // boxGrid

  /**
   * Wraps a drawing cache into the surface interface the rasteriser expects.
   * The fill colour is only handed to the context when it actually changes:
   * a room is one attribute colour, so this is one assignment per scene.
   *
   * @param {DrawingCache} cache the cache to draw into
   * @returns {object} the surface
   */
  newSurface(cache) {
    var ctx = cache.ctx;
    var current = false;
    var setColor = function(color) {
      if (color !== current) {
        current = color;
        ctx.fillStyle = color;
      }
    };
    return {
      width: this.width,
      height: this.height,
      span: function(x, y, width, color) {
        setColor(color);
        ctx.fillRect(x, y, width, 1);
      },
      pixel: function(x, y, color) {
        setColor(color);
        ctx.fillRect(x, y, 1, 1);
      }
    };
  } // newSurface

  /**
   * Writes the drawing order to the console, back to front. The list is far
   * too long to put on a 256 by 192 screen, and it is the one thing about the
   * scene that has to be readable object by object when the occlusion looks
   * wrong. `tools/klrender/klrender.js order <id>` prints the same thing
   * without a browser.
   */
  logOrder() {
    if (!window.console) {
      return;
    }
    console.log('drawing order of room '+(this.room === false ? '?' : this.room.id)+', back to front:');
    for (var o = 0; o < this.order.length; o++) {
      var box = this.boxes[this.order[o]];
      console.log(o+'\tbox '+this.order[o]+'\t'+box.source+'\t'+box.type
        +'\tsprite '+box.graphic
        +'\t('+box.x+','+box.y+','+box.z+') '+box.sx+'x'+box.sy+'x'+box.sz);
    }
  } // logOrder

  /**
   * Monotonic time in milliseconds, falling back to `Date` on engines without
   * `performance` (old TV browsers).
   *
   * @returns {number} the current time in milliseconds
   */
  static now() {
    if (typeof performance !== 'undefined' && performance.now) {
      return performance.now();
    }
    return Date.now();
  } // now

} // SceneEntity

/**
 * Rows this list keeps between the hero and the room for the collectable
 * objects, which is `SpecialObjects.slots` in the game worker. The two lists
 * are read off each other row by row, so both have to leave the same gap.
 */
SceneEntity.specialSlots = 2;

// begin code

/**
 * Isometric projection of the Knight Lore world onto the ZX Spectrum screen.
 *
 * The formulas are taken from `calc_pixel_XY` in the disassembly
 * (`NOTES-ORIGINAL.md` chapter 7), not from a general isometric derivation:
 * Filmation replaced the mathematically correct sqrt(3)/2 factor by 1, so the
 * two ground axes run along lines of slope 1/2 and land on whole pixels.
 *
 * The original works in its own byte space (the room is centred on 128,128,
 * the floor is Z=128) and counts screen rows upwards from the bottom of the
 * screen; the screen address routine flips them (`screen_calc_addr_de` uses
 * `cpl`, so row = 191 - pixelY). Everything below is that same map rewritten
 * for our room coordinates (origin in the south-west floor corner, z upwards)
 * and for screen rows counted downwards, which is what a canvas wants.
 *
 * Exact integer arithmetic is used where the original wraps around a byte.
 * The two differ only for coordinates outside the room (the wall planes sit at
 * x = -1), where the original's wrap is a glitch, not a feature.
 */
export class IsoProjection {

  /**
   * Projection constants for one room. They depend only on the room size,
   * because the original centres every room on the same point of its byte
   * space and the screen origin is therefore a constant.
   *
   * @param {object} room room data (only `bounds` is used)
   * @returns {{spanX: number, skew: number}} constants for `point()`
   */
  static forRoom(room) {
    var radiusX = room.bounds.x/2;
    var radiusY = room.bounds.y/2;
    return {
      // pixelX = X + Y - 128 with X = x + 128 - radiusX, Y = y + 128 - radiusY
      spanX: 128-radiusX-radiusY,
      // pixelY = (Y - X + 128 >> 1) + Z - 104 with Z = z + 128
      skew: radiusX-radiusY+128
    };
  } // forRoom

  /**
   * Projects a point of the world onto the screen.
   *
   * @param {object} projection constants from `forRoom()`
   * @param {number} x world x (south-west corner of the room is 0)
   * @param {number} y world y
   * @param {number} z world z, upwards from the floor
   * @returns {{x: number, y: number}} screen position, y counted downwards
   */
  static point(projection, x, y, z) {
    return {
      x: x+y+projection.spanX,
      y: IsoProjection.floorRow-z-Math.floor((y-x+projection.skew)/2)
    };
  } // point

  /**
   * Screen silhouette of an axis aligned box.
   *
   * The viewer stands towards larger x, smaller y and larger z, so the three
   * visible faces are the top (z + sz), the front (x + sx) and the left
   * (y). Their common corner is the near top one, and the three edges meeting
   * there are the only ones inside the silhouette.
   *
   * @param {object} projection constants from `forRoom()`
   * @param {object} box `{x, y, z, sx, sy, sz}` in world units
   * @returns {{outline: object[], inner: object[][]}} the six point hexagon
   *   (clockwise from its left top corner) and the three inner edges
   */
  static boxOutline(projection, box) {
    var x0 = box.x;
    var x1 = box.x+box.sx;
    var y0 = box.y;
    var y1 = box.y+box.sy;
    var z0 = box.z;
    var z1 = box.z+box.sz;

    var leftTop  = IsoProjection.point(projection, x0, y0, z1);
    var backTop  = IsoProjection.point(projection, x0, y1, z1);
    var rightTop = IsoProjection.point(projection, x1, y1, z1);
    var right    = IsoProjection.point(projection, x1, y1, z0);
    var front    = IsoProjection.point(projection, x1, y0, z0);
    var left     = IsoProjection.point(projection, x0, y0, z0);
    var near     = IsoProjection.point(projection, x1, y0, z1);

    return {
      outline: [leftTop, backTop, rightTop, right, front, left],
      inner: [[near, leftTop], [near, rightTop], [near, front]]
    };
  } // boxOutline

  /**
   * Screen bounding rectangle of a box, useful for clipping and for a quick
   * "do these two overlap on screen at all" test.
   *
   * @param {object} projection constants from `forRoom()`
   * @param {object} box `{x, y, z, sx, sy, sz}` in world units
   * @returns {{x: number, y: number, width: number, height: number}} the rectangle
   */
  static boxBounds(projection, box) {
    var left = IsoProjection.point(projection, box.x, box.y, box.z);
    var right = IsoProjection.point(projection, box.x+box.sx, box.y+box.sy, box.z);
    var top = IsoProjection.point(projection, box.x, box.y+box.sy, box.z+box.sz);
    var bottom = IsoProjection.point(projection, box.x+box.sx, box.y, box.z);
    return {
      x: left.x,
      y: top.y,
      width: right.x-left.x+1,
      height: bottom.y-top.y+1
    };
  } // boxBounds

} // IsoProjection

/** ZX Spectrum screen the projection targets. */
IsoProjection.screenWidth = 256;
IsoProjection.screenHeight = 192;

/**
 * Screen row of the world point (0, 0, 0) before the depth skew is applied.
 * 191 - (128 - 104) in the original's terms: the floor of every room lands on
 * the same rows whatever its size.
 */
IsoProjection.floorRow = 167;

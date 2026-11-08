// begin code

/**
 * Pixel rasteriser for the isometric scene.
 *
 * It draws through a minimal surface interface — `{width, height, span(x, y,
 * width, color), pixel(x, y, color)}` — so the same code fills the canvas in
 * the game and a plain bitmap in the offline tools. Clipping to the surface
 * happens here, so a surface only ever sees coordinates inside it.
 *
 * Everything is drawn a whole pixel at a time. The canvas path API would be
 * simpler but antialiases its edges, and a Knight Lore screen has exactly two
 * colours per character cell.
 *
 * A masked sprite is drawn the way the original does it (`print_sprite`): the
 * mask clears the background and the image is drawn into the hole, which on a
 * two colour screen means painting the mask in the paper colour and the image
 * in the ink colour. That single step is what makes the painter's algorithm
 * occlude correctly.
 */
export class IsoRaster {

  /**
   * Fills a simple polygon using the even-odd rule.
   *
   * @param {object} surface the target surface
   * @param {object[]} points polygon corners as `{x, y}`, in order
   * @param {string} color fill colour
   */
  static fillPolygon(surface, points, color) {
    var count = points.length;
    var top = points[0].y;
    var bottom = points[0].y;
    for (var p = 1; p < count; p++) {
      if (points[p].y < top) {
        top = points[p].y;
      }
      if (points[p].y > bottom) {
        bottom = points[p].y;
      }
    }
    if (top < 0) {
      top = 0;
    }
    if (bottom > surface.height) {
      bottom = surface.height;
    }

    var crossings = [];
    for (var row = top; row < bottom; row++) {
      var centre = row+0.5;
      crossings.length = 0;
      for (var e = 0; e < count; e++) {
        var from = points[e];
        var to = points[(e+1)%count];
        if (from.y == to.y) {
          continue;
        }
        if ((centre >= from.y && centre < to.y) || (centre >= to.y && centre < from.y)) {
          crossings.push(from.x+(centre-from.y)*(to.x-from.x)/(to.y-from.y));
        }
      }
      if (crossings.length < 2) {
        continue;
      }
      crossings.sort((a, b) => a-b);
      for (var c = 0; c+1 < crossings.length; c += 2) {
        var start = Math.ceil(crossings[c]-0.5);
        var end = Math.ceil(crossings[c+1]-0.5);
        if (start < 0) {
          start = 0;
        }
        if (end > surface.width) {
          end = surface.width;
        }
        if (end > start) {
          surface.span(start, row, end-start, color);
        }
      }
    }
  } // fillPolygon

  /**
   * Draws a line with Bresenham's algorithm.
   *
   * @param {object} surface the target surface
   * @param {object} from start point `{x, y}`
   * @param {object} to end point `{x, y}`
   * @param {string} color line colour
   */
  static drawLine(surface, from, to, color) {
    var x = from.x;
    var y = from.y;
    var stepX = to.x > x ? 1 : -1;
    var stepY = to.y > y ? 1 : -1;
    var deltaX = Math.abs(to.x-x);
    var deltaY = -Math.abs(to.y-y);
    var error = deltaX+deltaY;

    for (;;) {
      if (x >= 0 && y >= 0 && x < surface.width && y < surface.height) {
        surface.pixel(x, y, color);
      }
      if (x == to.x && y == to.y) {
        return;
      }
      var doubled = 2*error;
      if (doubled >= deltaY) {
        error += deltaY;
        x += stepX;
      }
      if (doubled <= deltaX) {
        error += deltaX;
        y += stepY;
      }
    }
  } // drawLine

  /**
   * Draws one box of the display list: the silhouette is filled with the paper
   * colour so that whatever is already there is covered (this is the painter's
   * algorithm doing the occlusion), then the visible edges are drawn in ink.
   *
   * This is the stand-in the scene was built with before the sprites were
   * extracted: it draws the geometry of a box rather than its picture, which is
   * still the quickest way to see what the depth sorting did (the `S` key of
   * the scene switches between the two).
   *
   * @param {object} surface the target surface
   * @param {object} shape result of `IsoProjection.boxOutline()`
   * @param {string} inkColor colour of the edges
   * @param {string|false} paperColor fill colour, or false to draw edges only
   */
  static drawBox(surface, shape, inkColor, paperColor) {
    if (paperColor !== false) {
      IsoRaster.fillPolygon(surface, shape.outline, paperColor);
    }
    var outline = shape.outline;
    for (var e = 0; e < outline.length; e++) {
      IsoRaster.drawLine(surface, outline[e], outline[(e+1)%outline.length], inkColor);
    }
    for (var i = 0; i < shape.inner.length; i++) {
      IsoRaster.drawLine(surface, shape.inner[i][0], shape.inner[i][1], inkColor);
    }
  } // drawBox

  /**
   * Draws a masked sprite with its top left pixel at `x, y`.
   *
   * The grid holds one of three states per pixel: transparent (nothing is
   * touched), mask only (the paper colour) and ink. Runs of the same state are
   * drawn as one span, which is what keeps a full screen of sprites cheap.
   *
   * @param {object} surface the target surface
   * @param {object} grid a grid from `spriteGrid()` of `app/spriteSheet.js`
   * @param {number} x screen x of the left edge of the sprite
   * @param {number} y screen y of the top row of the sprite
   * @param {string} inkColor colour of the image pixels
   * @param {string|false} paperColor colour of the mask, or false to draw the
   *   ink only and leave the background showing through
   */
  static drawSprite(surface, grid, x, y, inkColor, paperColor) {
    var pixels = grid.pixels;
    var colors = [false, paperColor, inkColor];
    var top = y < 0 ? -y : 0;
    var bottom = grid.height;
    if (y+bottom > surface.height) {
      bottom = surface.height-y;
    }
    var left = x < 0 ? -x : 0;
    var right = grid.width;
    if (x+right > surface.width) {
      right = surface.width-x;
    }
    for (var row = top; row < bottom; row++) {
      var at = row*grid.width;
      var column = left;
      while (column < right) {
        var state = pixels[at+column];
        var run = column+1;
        while (run < right && pixels[at+run] == state) {
          run++;
        }
        var color = colors[state];
        if (color !== false) {
          surface.span(x+column, y+row, run-column, color);
        }
        column = run;
      }
    }
  } // drawSprite

} // IsoRaster

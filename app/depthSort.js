// begin code

/**
 * Depth sorting of a room's display list.
 *
 * The order is not a sort by a key. Objects are convex boxes whose screen
 * projections are hexagons; two of them overlap only when three interval
 * conditions hold at once, and the resulting "is behind" relation is not
 * transitive, so three objects can form a cycle. Ultimate did not split
 * objects to resolve that and accepted the occasional artefact, and so do we
 * (`GAME-DESIGN.md` chapter 4).
 *
 * Both the relation and the walk over it are taken from
 * `calc_display_order_and_render` in the disassembly. The original compares
 * the two boxes on each axis into a three valued code (obj1 clear of obj2 /
 * they overlap / obj2 clear of obj1), combines the three codes into an index
 * `9*x + 3*y + z` and looks the answer up in a 27 entry jump table. That table
 * is `DepthSort.behindTable` below, entry by entry.
 */
export class DepthSort {

  /**
   * Three valued comparison of one axis, as the original computes it: 0 when
   * the first interval is entirely on the far side of the second, 2 when the
   * second is entirely on the far side of the first, 1 when they overlap.
   * Touching intervals count as separated, which is what makes the result
   * stable for stacked cubes.
   *
   * @param {number} min1 low end of the first interval
   * @param {number} max1 high end of the first interval
   * @param {number} min2 low end of the second interval
   * @param {number} max2 high end of the second interval
   * @returns {number} 0, 1 or 2
   */
  static axisCode(min1, max1, min2, max2) {
    if (min1 >= max2) {
      return 0;
    }
    if (min2 < max1) {
      return 1;
    }
    return 2;
  } // axisCode

  /**
   * Decides whether `box2` has to be drawn before `box1`, i.e. whether it is
   * behind it. The viewer stands towards larger x, smaller y and larger z.
   *
   * @param {object} box1 `{x, y, z, sx, sy, sz}` in world units
   * @param {object} box2 the box that may be behind `box1`
   * @returns {boolean} true when `box2` must be drawn first
   */
  static isBehind(box1, box2) {
    var codeX = DepthSort.axisCode(box1.x, box1.x+box1.sx, box2.x, box2.x+box2.sx);
    var codeY = DepthSort.axisCode(box1.y, box1.y+box1.sy, box2.y, box2.y+box2.sy);
    var codeZ = DepthSort.axisCode(box1.z, box1.z+box1.sz, box2.z, box2.z+box2.sz);
    return DepthSort.behindTable[9*codeX+3*codeY+codeZ] == 1;
  } // isBehind

  /**
   * Orders a display list back to front.
   *
   * This follows the original's walk: take the first object that has not been
   * drawn yet, descend to the first object that must be drawn before it, and
   * repeat; when nothing is left behind the current object, draw it and start
   * over. Objects visited on the way down are remembered (the original's
   * `render_list`), and meeting one of them again means the relation has a
   * cycle — it is then drawn straight away, which breaks the cycle at a
   * deterministic place and accepts the artefact the original has as well.
   *
   * @param {object[]} boxes the display list, in a stable order
   * @returns {number[]} indices into `boxes`, back to front
   */
  static order(boxes) {
    var count = boxes.length;
    var drawn = [];
    var onPath = [];
    var behind = [];
    var index;

    // The relation is computed once, so the walk below only follows lists.
    for (index = 0; index < count; index++) {
      drawn[index] = false;
      onPath[index] = false;
      behind[index] = [];
    }
    for (index = 0; index < count; index++) {
      for (var other = 0; other < count; other++) {
        if (other != index && DepthSort.isBehind(boxes[index], boxes[other])) {
          behind[index].push(other);
        }
      }
    }

    var order = [];
    var next = 0;
    while (order.length < count) {
      while (drawn[next]) {
        next++;
      }
      var current = next;
      var path = [current];
      onPath[current] = true;
      for (;;) {
        var previous = -1;
        var list = behind[current];
        for (var l = 0; l < list.length; l++) {
          if (!drawn[list[l]]) {
            previous = list[l];
            break;
          }
        }
        if (previous < 0) {
          break;                       // nothing behind it, draw it
        }
        if (onPath[previous]) {
          current = previous;          // cycle, draw the object we met again
          break;
        }
        current = previous;
        path.push(current);
        onPath[current] = true;
      }
      order.push(current);
      drawn[current] = true;
      for (var p = 0; p < path.length; p++) {
        onPath[path[p]] = false;
      }
    }
    return order;
  } // order

} // DepthSort

/**
 * The original's 27 entry jump table (`off_CF69`), indexed by
 * `9*codeX + 3*codeY + codeZ`. 1 marks the entries that send the second object
 * to the renderer first (`d_3467121516` — the label lists exactly those
 * indices); every other entry leaves the pair unordered. Index 13, where the
 * two boxes overlap on all three axes, is the original's `objs_coincide`: it
 * turns a collected special object into the twinkle sprite and orders nothing.
 */
DepthSort.behindTable = [
  0, 0, 0, 1, 1, 0, 1, 1, 0,
  0, 0, 0, 1, 0, 0, 1, 1, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0
];

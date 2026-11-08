// begin code

/**
 * The 3D collision of the original, transcribed routine by routine from
 * `adj_for_out_of_bounds` (`NOTES-ORIGINAL.md` chapter 13).
 *
 * Everything here works on axis aligned boxes in world units, `{x, y, z}` being
 * the south-west bottom corner and `{sx, sy, sz}` the size - the same shape the
 * room data and the display list use. The original keeps centres and radii
 * instead and tests `abs(centre1-centre2) - (radius1+radius2) < 0`; that is the
 * same predicate as the interval overlap below, touching included: two boxes
 * that only touch count as separated, which is what lets the hero stand on a
 * block at all.
 *
 * The one thing that must not be "improved" is the resolution itself. The
 * original does not sweep and does not push out of an overlap: it takes the
 * whole step, and while the step would end inside something it shortens it by
 * one unit and tries again (`adj_d_for_out_of_bounds`). Axes are done one after
 * another - Z first, then X, then Y - and the tests of a later axis already use
 * the shortened delta of the earlier one, while the axes not done yet count as
 * zero. That order is why the hero climbs onto a block by walking into it after
 * a jump, and why he slides along a wall instead of stopping dead.
 *
 * A classic script, not a module: it is loaded into the game worker with
 * `importScripts()`, which cannot import ES modules. The offline tools run this
 * very file through `tools/lib/workerScripts.js` rather than a copy of it.
 */

var Physics = {

  /**
   * Do the two boxes overlap on one axis, once the first has been moved by
   * `delta` along it? Touching is not overlapping.
   *
   * @param {object} box the moving box
   * @param {number} delta how far it moves along this axis
   * @param {object} other the box to test against
   * @param {string} axis 'x', 'y' or 'z'
   * @param {string} size 'sx', 'sy' or 'sz'
   * @returns {boolean} true when the two intervals overlap
   */
  overlap: function(box, delta, other, axis, size) {
    var low = box[axis]+delta;
    return low < other[axis]+other[size] && other[axis] < low+box[size];
  }, // overlap

  /**
   * One step of `adj_d_for_out_of_bounds`: the delta, one unit shorter, keeping
   * its sign. Zero stays zero.
   *
   * @param {number} delta the delta to shorten
   * @returns {number} the shortened delta
   */
  shorten: function(delta) {
    if (delta > 0) {
      return delta-1;
    }
    if (delta < 0) {
      return delta+1;
    }
    return 0;
  }, // shorten

  /**
   * `do_any_objs_intersect`: is anything in the way of this box, standing still?
   *
   * The original uses it in one place - to ask whether there is room above the
   * hero for him to step up onto the object he is about to put down - and it is
   * the same three overlap tests as a step of zero, over the same table, with
   * the same rows passed over.
   *
   * @param {object} box the box to test `{x, y, z, sx, sy, sz}`
   * @param {object[]} obstacles the boxes to test against
   * @param {number} self the index in `obstacles` that is the box itself
   * @returns {boolean} true when something overlaps it
   */
  intersectsAny: function(box, obstacles, self) {
    for (var o = 0; o < obstacles.length; o++) {
      var other = obstacles[o];
      if (o === self || other.ignore3D || other.graphic === 0) {
        continue;
      }
      if (Physics.overlap(box, 0, other, 'x', 'sx')
        && Physics.overlap(box, 0, other, 'y', 'sy')
        && Physics.overlap(box, 0, other, 'z', 'sz')) {
        return true;
      }
    }
    return false;
  }, // intersectsAny

  /**
   * Moves a box by `motion` against the obstacles and the walls of the room,
   * and reports what it ran into.
   *
   * `obstacles` are the boxes of the room the physics knows about: everything
   * the original keeps in `graphic_objs_tbl` without the "ignore in 3D" flag,
   * which is every object of a room but the decorative halves. An obstacle may
   * carry `dx`/`dy` (a moving platform) and `moveable` (the original's flag for
   * a box something else may shove along), both of which the original handles
   * inside this same routine.
   *
   * The original does not skip the moving object when it walks the table - it
   * sets the object's own "ignore in 3D" flag on the way in and clears it on
   * the way out, which comes to the same thing. Here the mover is a box of its
   * own, so `options.self` is the one index in `obstacles` that is the mover
   * itself and is passed over.
   *
   * @param {object} box the moving box `{x, y, z, sx, sy, sz}`
   * @param {object} motion the wanted step `{dx, dy, dz}`
   * @param {object[]} obstacles the boxes to collide with
   * @param {object|false} bounds room size `{x, y, z}`, or false for no walls
   * @param {object} [options] `{carried: bool, atExit: bool, self: number}` -
   *   `carried` is the original's "moveable" flag, which makes a platform under
   *   the box carry it; `atExit` is its "near an arch" flag, which turns the
   *   room walls off; `self` is the mover's own index in `obstacles`
   * @returns {object} `{dx, dy, dz, blockedX, blockedY, blockedZ, standingOn,
   *   touched, pushed, carryX, carryY}` - the step that may actually be taken,
   *   which axes were cut short, the obstacles hit from above or below, every
   *   obstacle hit on any axis, the moveable ones shoved and the motion a
   *   platform underneath handed over
   */
  resolve: function(box, motion, obstacles, bounds, options) {
    var settings = options || {};
    var result = {
      dx: 0, dy: 0, dz: 0,
      wantedX: 0, wantedY: 0,
      blockedX: false, blockedY: false, blockedZ: false,
      standingOn: [], touched: [], pushed: [], carryX: 0, carryY: 0
    };

    // The original resolves Z with dX and dY still zero, X with the resolved dZ
    // but dY still zero, and Y with both of the others resolved; `result` is
    // that same running state, so the order below is the order in the code.
    result.dz = motion.dz|0;
    if (result.dz !== 0 && bounds !== false) {
      Physics.resolveFloor(box, result, bounds);
    }
    if (result.dz !== 0) {
      Physics.resolveAxis(box, result, obstacles, 'z', settings);
    }

    // the platform found by the Z pass has already written its own motion into
    // the mover's dX/dY at this point in the original, before they are read
    result.dx = (motion.dx|0) || result.carryX;
    result.wantedX = result.dx;
    if (result.dx !== 0 && bounds !== false && !settings.atExit) {
      Physics.resolveWall(box, result, bounds, 'x');
    }
    if (result.dx !== 0) {
      Physics.resolveAxis(box, result, obstacles, 'x', settings);
    }

    result.dy = (motion.dy|0) || result.carryY;
    result.wantedY = result.dy;
    if (result.dy !== 0 && bounds !== false && !settings.atExit) {
      Physics.resolveWall(box, result, bounds, 'y');
    }
    if (result.dy !== 0) {
      Physics.resolveAxis(box, result, obstacles, 'y', settings);
    }

    return result;
  }, // resolve

  /**
   * `adj_dZ_for_out_of_bounds`: the floor of the room. There is no ceiling -
   * the original only checks that the box does not end below the floor level,
   * which is why the falling spike balls may wait above the screen.
   *
   * @param {object} box the moving box
   * @param {object} result the running state, `dz` shortened in place
   * @param {object} bounds room size `{x, y, z}`
   */
  resolveFloor: function(box, result, bounds) {
    while (result.dz !== 0 && box.z+result.dz < 0) {
      result.blockedZ = true;
      result.dz = Physics.shorten(result.dz);
    }
  }, // resolveFloor

  /**
   * `adj_dX_for_out_of_bounds` and its Y twin: the box has to end strictly
   * inside the room. The original writes this as `abs(centre-128)+radius <
   * room_size`, which with the origin in the room's corner is simply "not
   * touching either wall".
   *
   * @param {object} box the moving box
   * @param {object} result the running state, the delta shortened in place
   * @param {object} bounds room size `{x, y, z}`
   * @param {string} axis 'x' or 'y'
   */
  resolveWall: function(box, result, bounds, axis) {
    var delta = axis == 'x' ? 'dx' : 'dy';
    var size = axis == 'x' ? 'sx' : 'sy';
    var blocked = axis == 'x' ? 'blockedX' : 'blockedY';
    while (result[delta] !== 0) {
      var low = box[axis]+result[delta];
      if (low > 0 && low+box[size] < bounds[axis]) {
        return;
      }
      result[blocked] = true;
      result[delta] = Physics.shorten(result[delta]);
    }
  }, // resolveWall

  /**
   * `adj_dX_for_obj_intersect` and its Y and Z twins: shorten the delta until
   * the box no longer ends inside an obstacle. Testing restarts from the same
   * obstacle after every shortening, exactly as the original loops back.
   *
   * @param {object} box the moving box
   * @param {object} result the running state, the delta shortened in place
   * @param {object[]} obstacles the boxes to collide with
   * @param {string} axis 'x', 'y' or 'z'
   * @param {object} settings the options of `resolve()`
   */
  resolveAxis: function(box, result, obstacles, axis, settings) {
    var delta = Physics.deltaOf[axis];
    var size = Physics.sizeOf[axis];
    var blocked = Physics.blockedOf[axis];
    var others = Physics.otherAxes[axis];

    // what the mover asked for on this axis, before the room walls and the
    // obstacles shortened it: that is what the original hands to a box it
    // shoves, because it reads the delta out of the object's own record and
    // only writes the shortened one back at the very end of
    // `adj_for_out_of_bounds`
    var wanted = axis == 'x' ? result.wantedX : result.wantedY;

    for (var o = 0; o < obstacles.length; o++) {
      var other = obstacles[o];
      // `is_object_not_ignored`: an empty slot of the table and a part that is
      // picture only are both invisible to the collision, and so is the mover
      // itself - the original marks itself ignored on the way in, which comes
      // to the same thing as passing over its own row
      if (o === settings.self || other.ignore3D || other.graphic === 0) {
        continue;
      }
      if (!Physics.overlap(box, result[Physics.deltaOf[others[0]]], other, others[0], Physics.sizeOf[others[0]])) {
        continue;
      }
      if (!Physics.overlap(box, result[Physics.deltaOf[others[1]]], other, others[1], Physics.sizeOf[others[1]])) {
        continue;
      }
      while (Physics.overlap(box, result[delta], other, axis, size)) {
        result[blocked] = true;
        if (result.touched.indexOf(o) < 0) {
          result.touched.push(o);
        }
        if (axis == 'z') {
          // the original flags the object as touched from above or below here:
          // that is what triggers a dropping or a collapsing block
          if (result.standingOn.indexOf(o) < 0) {
            result.standingOn.push(o);
          }
          // a platform under a box that may be carried hands it its own motion
          if (settings.carried) {
            result.carryX = result.carryX || (other.dx|0);
            result.carryY = result.carryY || (other.dy|0);
          }
        } else if (other.moveable) {
          Physics.remember(result.pushed, o, axis, wanted);
        }
        result[delta] = Physics.shorten(result[delta]);
        if (result[delta] === 0) {
          // `ret Z`: with nothing left to move, the remaining obstacles cannot
          // change the answer and the original stops looking
          return;
        }
      }
    }
  }, // resolveAxis

  /**
   * Records that an obstacle was shoved along one axis. The original copies the
   * mover's delta into the obstacle's own dX/dY, so the block moves on its next
   * update; here the object table gets the list and does the same.
   *
   * @param {object[]} pushed the list to add to
   * @param {number} index index of the obstacle in the obstacle list
   * @param {string} axis 'x' or 'y'
   * @param {number} delta how hard it was shoved
   */
  remember: function(pushed, index, axis, delta) {
    for (var p = 0; p < pushed.length; p++) {
      if (pushed[p].index == index) {
        pushed[p][axis] = delta;
        return;
      }
    }
    var entry = {index: index, x: 0, y: 0};
    entry[axis] = delta;
    pushed.push(entry);
  } // remember

}; // Physics

/** Name of the delta of each axis in the result of `resolve()`. */
Physics.deltaOf = {x: 'dx', y: 'dy', z: 'dz'};

/** Name of the size of each axis in a box. */
Physics.sizeOf = {x: 'sx', y: 'sy', z: 'sz'};

/** Name of the blocked flag of each axis in the result of `resolve()`. */
Physics.blockedOf = {x: 'blockedX', y: 'blockedY', z: 'blockedZ'};

/** The two axes an axis is tested against before it is resolved. */
Physics.otherAxes = {x: ['y', 'z'], y: ['x', 'z'], z: ['x', 'y']};

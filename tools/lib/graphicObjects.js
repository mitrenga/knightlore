/**
 * The two tables of the original that say what an object is made of:
 * `block_type_tbl` (the cubes placed on the room grid) and
 * `background_type_tbl` (the walls, arches and fixtures). Both are tables of
 * pointers to a list of parts terminated by a zero byte; a block part is 6
 * bytes and is positioned relative to a grid cell, a background part is 8 bytes
 * and carries absolute coordinates (NOTES-ORIGINAL.md chapter 2).
 *
 * Shared by tools/klconv (which converts the rooms) and tools/klsprite (which
 * needs the radii to check a sprite against the box it is drawn on).
 */

/** One block definition: parts of 6 bytes terminated by a zero byte. */
export function readBlockParts(snapshot, address) {
  const parts = [];
  while (snapshot.byte(address) !== 0) {
    parts.push({
      sprite: snapshot.byte(address),
      radiusX: snapshot.byte(address + 1),
      radiusY: snapshot.byte(address + 2),
      height: snapshot.byte(address + 3),
      flags: snapshot.byte(address + 4),
      offsets: snapshot.byte(address + 5)
    });
    address += 6;
  }
  return parts;
}

/** One background definition: parts of 8 bytes terminated by a zero byte. */
export function readBackgroundParts(snapshot, address) {
  const parts = [];
  while (snapshot.byte(address) !== 0) {
    parts.push({
      sprite: snapshot.byte(address),
      x: snapshot.byte(address + 1),
      y: snapshot.byte(address + 2),
      z: snapshot.byte(address + 3),
      radiusX: snapshot.byte(address + 4),
      radiusY: snapshot.byte(address + 5),
      height: snapshot.byte(address + 6),
      flags: snapshot.byte(address + 7)
    });
    address += 8;
  }
  return parts;
}

/** Every block definition, indexed as in block_type_tbl. */
export function readBlockDefs(snapshot) {
  return snapshot.pointerTable('block_type_tbl').map((address) => readBlockParts(snapshot, address));
}

/** Every background definition, indexed as in background_type_tbl. */
export function readBackgroundDefs(snapshot) {
  return snapshot.pointerTable('background_type_tbl').map((address) => readBackgroundParts(snapshot, address));
}

/**
 * The sizes every graphic number is drawn at, collected from both tables. It is
 * usually one size per graphic number - the original picks an object's
 * behaviour by its graphic number, so the two cannot come apart - but a few
 * pieces are reused at another size (the portcullis stands across either axis),
 * so all of them are kept.
 *
 * @param {Snapshot} snapshot the snapshot to read
 * @returns {Map<number, object[]>} graphic number -> `[{radiusX, radiusY, height, from}]`
 */
export function readGraphicSizes(snapshot) {
  const sizes = new Map();
  const add = (part, from) => {
    const size = { radiusX: part.radiusX, radiusY: part.radiusY, height: part.height, from };
    const known = sizes.get(part.sprite);
    if (known === undefined) {
      sizes.set(part.sprite, [size]);
      return;
    }
    if (!known.some((entry) => entry.radiusX === size.radiusX && entry.radiusY === size.radiusY
      && entry.height === size.height)) {
      known.push(size);
    }
  };
  readBlockDefs(snapshot).forEach((parts, index) => {
    parts.forEach((part) => add(part, 'block type ' + index));
  });
  readBackgroundDefs(snapshot).forEach((parts, index) => {
    parts.forEach((part) => add(part, 'background type ' + index));
  });
  return sizes;
}

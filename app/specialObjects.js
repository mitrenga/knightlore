// begin code

/**
 * The thirty two collectable objects of the castle, the three the hero may
 * carry and the cauldron that wants fourteen of them: the original's
 * `special_objs_tbl`, `objects_carried` and `objects_required`
 * (`NOTES-ORIGINAL.md` chapter 16).
 *
 * The objects are not part of any room. The original keeps one table of them
 * outside the rooms and a room looks through it for the ones whose current room
 * is this one (`find_special_objs_here`), because an object carried out through
 * a doorway stops belonging to the room it was found in. That is why this is a
 * thing of its own that outlives rooms, like `app/dayNight.js`: the room's
 * object table borrows two slots to it and hands the positions back when the
 * room is left (`update_special_objs`).
 *
 * Three of its numbers are the whole of the game's arithmetic:
 *
 * - **which object is which** is not in the data. The original leaves the
 *   graphic number of every record zero and deals the eight of them out in a
 *   ring from a random start when a game begins (`init_special_objects`), so
 *   the diamond is in a different room every game and the same room always
 *   holds *an* object. Seven of the eight may be picked up; the eighth, the
 *   idol, is an extra life and is taken by walking into it.
 * - **what the cauldron asks for** is fixed: fourteen asks over the seven
 *   kinds, and the only thing a new game changes is where in that ring it
 *   starts (`shuffle_objects_required` rotates it by four to seven places).
 * - **the inventory is three slots and a shove**. Picking up a fourth object
 *   does not refuse it: the object at the back of the queue is put down where
 *   the new one lay and the queue moves along (`adjust_carried`), which is one
 *   `LDDR` in the original and is why the game never has to say "hands full".
 *
 * A classic script, not a module: it is loaded into the game worker with
 * `importScripts()` alongside `app/objectTable.js`, and the offline tools run
 * this very file through `tools/lib/workerScripts.js`.
 */

class SpecialObjects {

  /**
   * @param {object} data `data/global.json` as `readGlobal()` returns it
   * @param {object} spec the `ITEM` constants of `app/roomData.js`
   * @param {number} seed the original's `seed_1`, which is the only thing that
   *   makes one game's castle different from another's
   */
  constructor(data, spec, seed) {
    this.spec = spec;
    /** Where every object starts, which a new game copies into `items`. */
    this.start = data.items;
    /** The order the cauldron asks in, before it is rotated. */
    this.order = data.required;
    /** `special_objs_tbl`: where each object is now, and what it is. */
    this.items = [];
    /** `objects_required`, rotated for this game. */
    this.required = [];
    /** `objects_carried`: three slots, the last of which is the one that goes. */
    this.carried = [];
    /** `inventory`: where a new object waits for one shift of the queue. */
    this.staging = false;
    /** `objects_put_in_cauldron`. */
    this.inCauldron = 0;
    /** `all_objs_in_cauldron`: the game is won and the castle is coming apart. */
    this.allInCauldron = false;
    /** `obj_dropping_into_cauldron`: the hero hangs still while it goes in. */
    this.dropping = false;
    this.startGame(seed|0);
  } // constructor

  /**
   * `init_special_objects` and `shuffle_objects_required`: a new game.
   *
   * The objects are dealt out in a ring - object 0 gets whatever the seed says,
   * object 1 the next kind, and so on round the eight - so every game has four
   * of each kind and they are always in the same thirty two places. The asks are
   * the one fixed sequence rotated by four to seven, which the original does by
   * shifting the whole array along that many times.
   *
   * @param {number} seed one byte, the original's `seed_1`
   */
  startGame(seed) {
    var spec = this.spec;
    var kind = seed & 0xff;
    this.items = this.start.map(function(item) {
      var graphic = spec.firstGraphic+(kind++ & (spec.graphics-1));
      return {index: item.index, graphic: graphic,
        x: item.x, y: item.y, z: item.z, room: item.room};
    });
    var rotate = 4+(seed & 3);
    this.required = this.order.slice(rotate % this.order.length)
      .concat(this.order.slice(0, rotate % this.order.length));
    this.carried = [];
    for (var c = 0; c < spec.carried; c++) {
      this.carried.push(false);
    }
    this.staging = false;
    this.inCauldron = 0;
    this.allInCauldron = false;
    this.dropping = false;
  } // startGame

  /**
   * `find_special_objs_here`: the objects that are in this room now.
   *
   * The original walks the whole table every time a room is built and copies
   * what it finds into the two slots the room keeps for them; an object that
   * has been picked up has had its graphic number zeroed and is passed over.
   *
   * @param {number} roomId the room being built
   * @returns {object[]} the records, at most as many as there are slots
   */
  here(roomId) {
    var found = [];
    for (var i = 0; i < this.items.length && found.length < SpecialObjects.slots; i++) {
      if (this.items[i].graphic !== 0 && this.items[i].room === roomId) {
        found.push(this.items[i]);
      }
    }
    return found;
  } // here

  /**
   * `update_special_objs`: the room is about to be left or rebuilt, so where its
   * objects have got to goes back into the table.
   *
   * An object the hero has just picked up is not written back: its slot has
   * been left on the wiping graphic number and the original skips a slot whose
   * graphic number is zero by the time it gets here. Neither are the cauldron's
   * bubbles, which have no record behind them at all - in the original they
   * have a null pointer and the write goes to ROM, which is the documented bug
   * the disassembly marks; here there is simply nothing to write to.
   *
   * @param {object[]} entries the room's two special slots
   * @param {number} roomId the room they are in
   */
  save(entries, roomId) {
    for (var e = 0; e < entries.length; e++) {
      var entry = entries[e];
      if (entry.graphic === 0 || entry.item < 0) {
        continue;
      }
      var item = this.items[entry.item];
      item.graphic = entry.graphic;
      item.x = entry.x;
      item.y = entry.y;
      item.z = entry.z;
      item.room = roomId;
    }
  } // save

  /**
   * `pickup_object`: the object in the given slot goes into the hero's hands.
   *
   * Its record is emptied at once, so nothing puts it back in the room. If the
   * hero was already carrying three, the one at the back of the queue takes its
   * place on the floor - **where the new one was lying**, not where the hero
   * stands, which is the original's own doing and the reason a swap looks like
   * the two objects changing places.
   *
   * @param {object} entry the slot the object is in
   * @returns {object|false} the object put down in its place, or false
   */
  pickUp(entry) {
    this.staging = {graphic: entry.graphic, item: entry.item};
    if (entry.item >= 0) {
      this.items[entry.item].graphic = 0;
    }
    var swapped = this.carried[this.carried.length-1];
    if (swapped === false) {
      entry.graphic = ObjectMotion.wipeGraphic;
      entry.item = -1;
    } else {
      entry.graphic = swapped.graphic;
      entry.item = swapped.item;
      entry.dropped = true;
    }
    this.shift();
    return swapped;
  } // pickUp

  /**
   * The object in a slot has left the game for good: it has gone into the
   * cauldron, or it was an idol and has been taken. The original zeroes the
   * graphic number of the record through the pointer the slot keeps, which is
   * what stops the room putting it back next time it is built.
   *
   * @param {object} entry the slot
   */
  take(entry) {
    if (entry.item >= 0) {
      this.items[entry.item].graphic = 0;
      entry.item = -1;
    }
  } // take

  /**
   * `adjust_carried`: the queue moves along by one slot and whatever was waiting
   * in `inventory` comes in at the front. It runs whether anything was picked up
   * or put down, which is why putting an object down leaves the front slot empty
   * rather than closing the gap.
   */
  shift() {
    for (var c = this.carried.length-1; c > 0; c--) {
      this.carried[c] = this.carried[c-1];
    }
    this.carried[0] = this.staging;
    this.staging = false;
  } // shift

  /** `object_carried_2`: the slot at the back, which is the one that is put down. */
  get last() {
    return this.carried[this.carried.length-1];
  } // last

  /**
   * `add_obj_to_cauldron`: an object has reached the middle of the cauldron.
   *
   * The cauldron does not keep what it is given. It compares the object with
   * the one it is asking for and the object is gone either way; only the right
   * one moves the sequence along. Fourteen of them and the game is won.
   *
   * @param {number} kind the object's kind, 0 to 6
   * @returns {boolean} true when it was the one being asked for
   */
  putInCauldron(kind) {
    this.dropping = false;
    if (kind !== this.nextRequired()) {
      return false;
    }
    this.inCauldron++;
    if (this.inCauldron >= this.required.length) {
      this.allInCauldron = true;
    }
    return true;
  } // putInCauldron

  /**
   * `ret_next_obj_required`: the kind of object the cauldron is asking for,
   * which its bubbles show every fourth frame while the hero is a man.
   *
   * @returns {number} the kind, 0 to 6
   */
  nextRequired() {
    return this.required[this.inCauldron % this.required.length];
  } // nextRequired

  /**
   * Can this graphic number be picked up? The first seven of the eight kinds
   * can; the eighth is the idol, which is an extra life and takes itself
   * (`can_pickup_spec_obj`: "special objects base no.", less than seven).
   *
   * @param {number} graphic the graphic number of a slot
   * @returns {boolean} true when it is a carriable object
   */
  carriable(graphic) {
    var kind = graphic-this.spec.firstGraphic;
    return kind >= 0 && kind < this.spec.carriable;
  } // carriable

  /**
   * What the panel draws: the graphic number in each of the three slots, or
   * zero for an empty one (`display_objects`).
   *
   * @returns {number[]} one per slot, front of the queue first
   */
  picture() {
    return this.carried.map(function(slot) {
      return slot === false ? 0 : slot.graphic;
    });
  } // picture

} // SpecialObjects

/**
 * Slots a room keeps for collectable objects: the third and fourth rows of the
 * object table, right behind the hero's two (`special_objs_here` and
 * `special_objs_here_1`). Two is enough for every room of the castle, and it is
 * also the reason the hero cannot put an object down in a room that already has
 * two lying in it.
 */
SpecialObjects.slots = 2;

const { AbstractModel } = await import('./svision/js/abstractModel.js?ver='+window.srcVersion);
const { ZXColor } = await import('./svision/js/platform/canvas2D/zx/zxColor.js?ver='+window.srcVersion);
const { SceneEntity } = await import('./sceneEntity.js?ver='+window.srcVersion);
const { ScreenFrameEntity } = await import('./screenFrameEntity.js?ver='+window.srcVersion);
const { DebugOverlayEntity } = await import('./debugOverlayEntity.js?ver='+window.srcVersion);
const { readRoom, readGlobal, roomFileName, roomBoxes, castleRooms, ITEM } = await import('./roomData.js?ver='+window.srcVersion);
const { readSprites, handlerTable } = await import('./spriteSheet.js?ver='+window.srcVersion);
const { HERO } = await import('./hero.js?ver='+window.srcVersion);
// begin code

/**
 * The castle, one room at a time: it loads the sprites and the room data, shows
 * the scene and hands the room to the game worker, which from then on owns
 * everything in it. The objects the hero carries belong to M8.
 *
 * The model never moves anything itself. It sends the worker the room as a list
 * of boxes, it forwards the keys, and it draws the snapshots that come back -
 * the same division of labour as in MM and JSW.
 *
 * Walking from room to room (M7) is that same division of labour and nothing
 * more. The worker notices that the hero has left through an arch, works out
 * which room is next - the room data says so, and the original computes the
 * same id from the room's own - and asks for it; the model fetches it, shows it
 * and hands it back. Nothing about the game travels through the model on the
 * way: the hero, the lives, the day and the night all stay in the worker, which
 * is why one model serves the whole castle instead of being rebuilt at every
 * doorway.
 */
export class RoomModel extends AbstractModel {

  /**
   * @param {AbstractApp} app the owning application
   * @param {number} roomId id of the room to show, 0-255
   */
  constructor(app, roomId) {
    super(app);
    this.id = 'RoomModel';

    this.roomId = roomId;
    // held keys are read as they are pressed and released, not repeated
    this.autorepeatKeys = false;
    // true between asking for a room and the worker's first snapshot of it: the
    // screen keeps the room he has just left until there is a frame to put in
    // its place, exactly as the original holds the picture while it rebuilds
    this.awaitingRoom = false;
    // false until the worker has been given the first room of the game
    this.started = false;
    // what to tell the worker about where the hero comes into the next room
    this.pendingStart = undefined;
    this.snapshot = false;
    this.sceneEntity = null;
    this.screenFrameEntity = null;
    this.debugOverlayEntity = null;
  } // constructor

  /**
   * Builds the entity tree and asks the server for the data. The sprites are
   * fetched first and kept on the application: they are the same for the whole
   * castle, so from M7 on a room change costs one request, not two.
   */
  init() {
    super.init();

    // Knight Lore paints the whole screen black and colours it with one
    // attribute per room; the border is black as well (`xor a` before OUT).
    this.borderEntity.bkColor = ZXColor.black;
    this.desktopEntity.bkColor = ZXColor.black;

    // the panel goes in first: the original draws the objects of the room over
    // it, not the other way round. The decorated frame is not part of the
    // playing screen at all - it belongs to the menu (M10).
    this.screenFrameEntity = new ScreenFrameEntity(this.desktopEntity, 0, 0,
      this.desktopWidth, this.desktopHeight, ['panel']);
    this.desktopEntity.addEntity(this.screenFrameEntity);

    this.sceneEntity = new SceneEntity(this.desktopEntity, 0, 0, this.desktopWidth, this.desktopHeight);
    this.desktopEntity.addEntity(this.sceneEntity);

    this.debugOverlayEntity = new DebugOverlayEntity(this.desktopEntity, 0, 0, this.desktopWidth, this.desktopHeight, this.sceneEntity, this);
    this.desktopEntity.addEntity(this.debugOverlayEntity);

    this.fetchNext();
  } // init

  /**
   * The two files that are the whole game rather than one room - the sprites and
   * the collectable objects - and then the room itself.
   *
   * They are kept on the application, so they are fetched once per game and not
   * once per room; `fetchData()` will not have two requests in flight, so they
   * go one after the other and the room comes last.
   */
  fetchNext() {
    if (this.app.spriteSheet === false) {
      this.fetchData(RoomModel.spritesURL, false, {});
      return;
    }
    if (this.app.global === false) {
      this.fetchData(RoomModel.globalURL, false, {});
      return;
    }
    this.applySprites();
    this.requestRoom(this.roomId);
  } // fetchNext

  /**
   * Receives the sprites or the room data, validates them through the shared
   * readers and hands them to the entities. Invalid data is reported rather
   * than half drawn: the converter writes the files, so a problem here is a bug
   * in the data, not something the game should paper over.
   *
   * @param {object} data the fetched payload
   */
  setData(data) {
    try {
      if (data.url == RoomModel.spritesURL) {
        this.app.spriteSheet = readSprites(data.data);
        this.fetchNext();
        return;
      }
      if (data.url == RoomModel.globalURL) {
        this.app.global = readGlobal(data.data);
        this.fetchNext();
        return;
      }
      var room = readRoom(data.data);
      this.app.rooms[room.id] = room;
      this.showRoom(room);
    } catch (error) {
      this.app.showErrorMessage(error.message, 'restart');
    }
  } // setData

  /**
   * Hands the room to the worker and lets it start ticking.
   *
   * What goes across is the room as a flat list of boxes - `roomBoxes()`, the
   * very list the scene draws behind the two boxes of the hero, whom the worker
   * builds itself - together with the jump table that says what each graphic
   * number does. Nothing about rooms, sprites or JSON crosses: the worker fills
   * its object table with these boxes, and every tick it hands back one row per
   * box, which the scene puts straight back into the same list.
   *
   * Every box goes over, the picture-only ones included. They are flagged
   * `ignore3D` rather than left out, because the original keeps them in the
   * table too - a guard's legs are drawn from the row after his body, and that
   * row has to be there for his body to write into.
   */
  startWorker(room, start) {
    this.sendWorkerMessage({
      id: 'init',
      spec: HERO,
      item: ITEM,
      global: this.app.global,
      hero: start,
      roomId: room.id,
      bounds: room.bounds,
      exits: room.exits,
      boxes: roomBoxes(room),
      handlers: handlerTable(this.app.spriteSheet),
      method: this.app.inputMethod
    });
  } // startWorker

  /**
   * Opens a room: from the application's cache when it has been in it before,
   * from the server when it has not.
   *
   * The cache is what makes walking back and forth free. A room is ten
   * kilobytes of JSON and there are 128 of them, so the whole castle is worth
   * keeping once it has been seen; it lives on the application rather than on
   * the model because the model is the one thing here that does not outlive a
   * game.
   *
   * While the room is on its way the screen is left alone (`awaitingRoom`).
   * There is no prefetching of the rooms next door: it would want a second
   * request in flight, which `fetchData()` does not do per model, and the
   * measurements have not asked for it.
   *
   * @param {number} roomId id of the room to open, 0-255
   * @param {object|string} [start] `'middle'` to drop the hero in the middle of
   *   it, which is what the development keys do; by default he comes in through
   *   the arch he left the last room by
   */
  requestRoom(roomId, start) {
    this.roomId = roomId;
    this.app.roomId = roomId;
    this.awaitingRoom = true;
    this.pendingStart = start;
    var room = this.app.rooms[roomId];
    if (room !== undefined) {
      this.showRoom(room);
      return;
    }
    this.fetchData(RoomModel.dataURL(roomId), false, {});
  } // requestRoom

  /**
   * Puts a room on the screen and hands it to the worker.
   *
   * The first room of a game starts the worker; every one after it is handed
   * over on its own, because the worker is in the middle of a game and the hero,
   * the lives and the sky are its own business.
   *
   * @param {object} room a room validated by `readRoom()`
   */
  showRoom(room) {
    this.sceneEntity.setRoom(room);
    this.screenFrameEntity.setColors(this.sceneEntity.penColor, this.sceneEntity.paperColor,
      this.sceneEntity.ink);
    if (this.started) {
      this.sendWorkerMessage({id: 'room', roomId: room.id, bounds: room.bounds,
        exits: room.exits, boxes: roomBoxes(room), start: this.pendingStart});
    } else {
      this.started = true;
      // the game begins in the middle of the room, which is where the original
      // begins it (`plyr_spr_init_data`); every room after this one is entered
      // through an arch
      this.startWorker(room, this.sceneEntity.hero);
    }
  } // showRoom

  /**
   * Sends a message to the game worker.
   *
   * @param {object} message the message to send
   */
  sendWorkerMessage(message) {
    if (this.app.worker) {
      this.app.worker.postMessage(message);
    }
  } // sendWorkerMessage

  /**
   * Receives a snapshot from the worker and puts the hero where it says.
   *
   * @param {MessageEvent} event the message from the worker
   */
  handleWorkerMessage(event) {
    if (event.data.id == 'exit') {
      this.requestRoom(event.data.roomId);
      return;
    }
    if (event.data.id != 'update' || event.data.snapshot.roomId !== this.roomId) {
      return;
    }
    this.awaitingRoom = false;
    this.snapshot = event.data.snapshot;
    this.sceneEntity.setHero(this.snapshot.hero);
    this.sceneEntity.setObjects(this.snapshot.objects);
    this.screenFrameEntity.setSky(this.snapshot.sky);
    this.screenFrameEntity.setStatus(this.snapshot);
  } // handleWorkerMessage

  /**
   * Stops the worker when the model goes away.
   */
  shutdown() {
    this.sendWorkerMessage({id: 'reset'});
    super.shutdown();
  } // shutdown

  /**
   * Hands the loaded sprites to the scene and to the screen frame.
   */
  applySprites() {
    this.sceneEntity.setSprites(this.app.spriteSheet);
    this.screenFrameEntity.setSprites(this.app.spriteSheet);
  } // applySprites

  /**
   * The keys. Five of them are the game (`app.controls.keyboard`, one per input
   * bit of the original) and go straight to the worker; the rest are the
   * development keys the scene has carried since M2, plus `C` for the input
   * method and `N` for the werewolf, which stays a key until the day and night
   * cycle turns him in M5.
   *
   * @param {object} event the event to handle
   * @returns {boolean} true when the event was handled
   */
  handleEvent(event) {
    if (event.id == 'keyPress' && this.snapshot !== false && this.snapshot.gameOver) {
      // out of lives. The game over screen and the hall of fame are M10; until
      // then any key starts the game again, in one of the four rooms the
      // original may begin in
      this.app.roomId = RoomModel.startRoom();
      this.app.setModel('RoomModel');
      return true;
    }
    if (event.id == 'keyPress' || event.id == 'keyRelease') {
      var action = this.controlAction(event.key);
      if (action !== false) {
        this.sendWorkerMessage({id: 'controls', action: action, value: event.id == 'keyPress'});
        return true;
      }
    }
    if (event.id == 'keyPress') {
      var hero = this.sceneEntity.hero;
      switch (event.key.toUpperCase()) {
        case 'D':
          this.debugOverlayEntity.hide = !this.debugOverlayEntity.hide;
          return true;
        case 'S':
          this.sceneEntity.setUseSprites(!this.sceneEntity.useSprites);
          return true;
        case 'F':
          this.sceneEntity.setFillBoxes(!this.sceneEntity.fillBoxes);
          return true;
        case 'G':
          this.debugOverlayEntity.setShowGuides(!this.debugOverlayEntity.showGuides);
          return true;
        case 'O':
          this.sceneEntity.logOrder();
          return true;
        case 'R':
          this.sceneEntity.cleanCache();
          return true;
        case 'C':
          this.app.inputMethod = this.app.inputMethod == 'directional' ? 'rotational' : 'directional';
          this.sendWorkerMessage({id: 'method', value: this.app.inputMethod});
          return true;
        case 'N':
          if (hero !== false) {
            this.sendWorkerMessage({id: 'hero',
              change: {form: hero.form == 'human' ? 'werewolf' : 'human'}});
          }
          return true;
        case '[':
          this.openRoom(-1);
          return true;
        case ']':
          this.openRoom(1);
          return true;
      }
    }
    return super.handleEvent(event);
  } // handleEvent

  /**
   * The development keys `[` and `]`: the next or the previous room of the
   * castle, in id order, with the hero dropped in the middle of it.
   *
   * They are not how the game moves between rooms - that is the arches - they
   * are how one looks at the castle. The middle of a room is where the original
   * starts a game, and two thirds of the rooms have something standing there, so
   * these keys will occasionally drop the hero inside a block; the four rooms a
   * game may actually begin in are clear.
   *
   * @param {number} step +1 for the next room, -1 for the previous one
   */
  openRoom(step) {
    var rooms = castleRooms();
    var at = rooms.indexOf(this.roomId);
    this.requestRoom(rooms[(at+step+rooms.length)%rooms.length], 'middle');
  } // openRoom

  /**
   * The input bit a key stands for, if it stands for one.
   *
   * @param {string} key the key of the event
   * @returns {string|false} the name of the control, or false
   */
  controlAction(key) {
    var keyboard = this.app.controls.keyboard;
    for (var action in keyboard) {
      if (Object.prototype.hasOwnProperty.call(keyboard, action) && keyboard[action] == key) {
        return action;
      }
    }
    return false;
  } // controlAction

  /**
   * Advances the frame. The scene itself is cached, so drawing every frame
   * costs one blit and gives the overlay an honest frame time.
   *
   * @param {number} timestamp the current frame timestamp
   */
  loopModel(timestamp) {
    super.loopModel(timestamp);
    this.debugOverlayEntity.loopEntity(timestamp);
    if (this.awaitingRoom) {
      // a room has been asked for and the worker has not said where anything in
      // it is yet: the last frame of the room he left stays on the screen rather
      // than a frame of the new room with everything in the wrong place
      return;
    }
    this.drawModel();
  } // loopModel

  /**
   * URL the room data is fetched from. The `.data` suffix is what the svision
   * front controller routes to `dataPage.php`, which serves `data/<name>.json`.
   *
   * @param {number} roomId id of the room, 0-255
   * @returns {string} the request URL
   */
  static dataURL(roomId) {
    return roomFileName(roomId).replace(/\.json$/, '.data');
  } // dataURL

} // RoomModel

/** URL the sprites of the whole game are fetched from. */
RoomModel.spritesURL = 'sprites.data';

/**
 * URL of everything that is the game rather than a room: the 32 collectable
 * objects, the order the cauldron asks for them in and the rooms a game may
 * begin in (`data/global.json`).
 */
RoomModel.globalURL = 'global.data';

/**
 * The four rooms a game may begin in, one picked at random
 * (`init_start_location`, `start_locations`). They are the only rooms the hero
 * is ever put into rather than walking into, and the only four whose middle is
 * guaranteed to be clear.
 */
RoomModel.startRooms = [0x2f, 0x44, 0xb3, 0x8f];

/** One of them, as the original picks it: `seed_1 & 3`. */
RoomModel.startRoom = function() {
  return RoomModel.startRooms[Math.floor(Math.random()*RoomModel.startRooms.length)];
}; // startRoom

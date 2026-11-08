const { Version } = await import('./version.js?ver='+window.srcVersion);
const { AbstractApp } = await import('./svision/js/abstractApp.js?ver='+window.srcVersion);
const { Fonts5x5 } = await import('./svision/js/platform/canvas2D/fonts5x5.js?ver='+window.srcVersion);
const { RoomModel } = await import('./roomModel.js?ver='+window.srcVersion);
const { Tool } = await import('./svision/js/tool.js?ver='+window.srcVersion);
// begin code

/**
 * The Knight Lore application.
 *
 * At this milestone it loads the sprites of the original, opens a room, draws
 * it and lets the player walk about in it. The menu, the tape loading screen,
 * the hall of fame and the rest of the shell are taken over from Jet Set Willy
 * in M10.
 *
 * The game worker is created here and lives as long as the application, exactly
 * as in MM and JSW: the models come and go, the physics does not.
 */
export class GameApp extends AbstractApp {

  /**
   * @param {AbstractPlatform} platform the platform to render on
   * @param {string} importPath directory the application modules are loaded from
   * @param {string} wsURL websocket URL of the server
   * @param {string|false} devModeName banner shown in development mode
   */
  constructor(platform, importPath, wsURL, devModeName) {
    super(platform, 'bodyApp', importPath, wsURL);
    this.id = 'GameApp';

    // the physics runs in the worker and posts a snapshot per tick; whichever
    // model is on screen at the time is the one that gets it
    this.worker = new Worker(this.importPath+'/gameWorker.js?ver='+window.srcVersion);
    this.worker.onmessage = (event) => {
      if (this.model) {
        this.model.handleWorkerMessage(event);
      }
    };

    this.version = Version;
    this.devModeName = devModeName;

    this.fonts = {
      fonts5x5: new Fonts5x5(this)
    };

    // One key per input bit of the original (`check_user_input`): the same five
    // bits serve both input methods, they are only read differently. Remapping,
    // the touch controls and the gamepads arrive with M10.
    this.controls = {
      keyboard: {
        forward: 'ArrowUp',
        pickup: 'ArrowDown',
        take: 'z',
        left: 'ArrowLeft',
        right: 'ArrowRight',
        jump: ' '
      },
      mouse: {enable: false},
      touchscreen: {supported: false},
      gamepads: {supported: false, devices: {}}
    };

    /**
     * How the four direction keys are read. `directional` is the eight-way
     * joystick of the original and the friendlier of the two: a key names an
     * isometric direction and the hero turns towards it. `rotational` is its
     * keyboard: left and right turn, forward walks.
     */
    this.inputMethod = 'directional';

    /**
     * The room the next model opens. The game begins in one of the four rooms
     * the original may begin in, picked at random (`init_start_location`);
     * `?devRoom=` overrides it, which is how one looks at a particular room while
     * working on it.
     */
    this.roomId = GameApp.wantedRoom();
    /** Rooms already loaded, by id: the castle costs one request per room. */
    this.rooms = {};
    // the sprites of the whole castle, loaded once by the first room
    this.spriteSheet = false;
    // the collectable objects and the cauldron's list, likewise: they belong to
    // the game and not to any room (`data/global.json`)
    this.global = false;
    this.setModel('RoomModel');
  } // constructor

  /**
   * Replaces the active model.
   *
   * @param {string} model name of the model to switch to
   */
  setModel(model) {
    var needResizeApp = false;
    if (this.model) {
      this.model.shutdown();
      needResizeApp = true;
    }
    switch (model) {
      case 'RoomModel':
        this.model = new RoomModel(this, this.roomId);
        break;
    }
    this.model.init();
    if (needResizeApp) {
      this.resizeApp();
    }
  } // setModel

} // GameApp

/**
 * The room a developer build asks for (`?devRoom=45` and `?devRoom=0x2d` both
 * work; `Tool.devParam`, R-058 — nothing outside dev mode), or one of the four
 * the game may begin in.
 *
 * @returns {number} a room id, 0-255
 */
GameApp.wantedRoom = function() {
  var asked = Tool.devParam('devRoom', undefined);
  var id = asked === undefined ? NaN : Number(asked);
  return Number.isInteger(id) && id >= 0 && id <= 255 ? id : RoomModel.startRoom();
}; // wantedRoom

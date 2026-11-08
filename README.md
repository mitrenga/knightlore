KNIGHT LORE
=====================
The 1984 isometric classic, reborn for modern web browsers.

## About
Originally written by Tim and Chris Stamper and published by Ultimate Play The Game in 1984. Its Filmation engine drew the castle as a three dimensional world on a machine with 48K of memory, and it is still the game that showed what an 8-bit computer could do.

This is a faithful remake based on the original ZX Spectrum version — not an emulator and not a binary copy. The room data, the sprites and the rules are re-derived from the published disassembly and written into an open JSON format of our own; the code is new and runs on the [svision](https://github.com/mitrenga/svision) library.

**Work in progress.** The project is being built milestone by milestone (`ROADMAP.md`); the game is not playable yet. What runs today is a live room: the isometric renderer draws it with the original's sprites, its projection and its depth sorting, and Sabreman walks about in it — he turns, jumps, falls, climbs onto blocks and slides along walls, all of it with the original's own constants. The room is alive around him too: guards walk their circuits, ghosts drift, fires cross the floor, platforms slide, spiked balls drop, blocks fall away under him and portcullises come and go, and every one of them can kill him — he dies in a puff of sparkles and comes back where he came in. The sun crosses the panel, and when the moon replaces it he turns into the werewolf. Since M7 the castle is whole: all 128 rooms are in `data/`, and its 286 doorways work - walk at an arch and it lines you up with the opening and hands you through it into the doorway of the room behind, at whatever height that room's own arch stands - walking, not materialising, because the hero himself goes through the door and only his position is put right. There is still nothing to pick up and nothing to win: the objects and the cauldron are M8.


## Requirements
- PHP 8.1+
- nginx
- MySQL / MariaDB
- Node.js — for the offline tools in `tools/`, and terser for building the bundle (`npm i -g terser`)
- es-check, for the ES2018 compatibility gate in `svtool verify` (`npm i -g es-check`)


## Install
(`~/` below refers to the project root, not your home directory.)
- clone this repository
- clone library repository https://github.com/mitrenga/svision
- check symlink ~/app/svision
- configure nginx (example: ~/config/nginx.conf)
- create path ~/js with permissions 0777
- create database (script: ~/config/createDB.sql)
- create configuration file ~/config/config.php (example: ~/config/config.php.sample)
- build the production bundle: ~/app/svision/tools/svtool build bundle


## Developer mode
Developer mode is switched in `~/config/config.php` (both settings are optional; without them the app runs in production mode):

```php
$devMode = true;
$devModeName = '.{\"penColor\":\"#000000\",\"bkColor\":\"#fefe00\",\"width\":185}◢◤ ◢◤ ◢◤ ◢◤  DEVELOPER MODE ◢◤ ◢◤ ◢◤ ◢◤';
```

`$devMode` values:
- `true` — development: JS sources are served directly instead of the bundle and the service worker is unregistered/bypassed
- `['serviceWorker' => true]` — development, but the service worker stays enabled
- `false` or not set — production: minified bundle + service worker

### Developer parameters

In dev mode only (R-058, `Tool.devParam`): `?devRoom=<id>` opens a
particular room (`?devRoom=45`, `?devRoom=0x2d`) instead of one of the four
the game starts in. The same knob goes into the configuration as
`$devMode = ['room' => 45]`; the address wins. On a production server the
parameter does not exist.


## Keys
Playing:

| key | what it does |
|---|---|
| arrows | the four isometric directions. The room is drawn with north running up and to the right, so the key that points up on the keyboard walks the hero up and to the left on the screen, which is west; the other three follow it round |
| `SPACE` | jump — hold it and the jump goes higher, as in the original |
| `C` | switch the input method: the original's eight-way joystick (arrow = direction) or its keyboard (left and right turn, up walks) |
| `Z` | pick up the collectable object within reach, or put down the one at the back of the queue and step up onto it. In the keyboard method the down arrow does it as well: that is the original's own arrangement, because the eight-way method reads down as a direction and is given a key of its own for picking up |

The development keys of the milestones so far:

| key | what it does |
|---|---|
| `D` | show or hide the development overlay |
| `S` | draw the original's sprites, or the plain boxes of the geometry |
| `F` | in the box mode, fill the boxes or draw them as outlines only (outlines show what the depth sorting did) |
| `G` | show the rectangles of the original's frame, panel and counters |
| `O` | write the drawing order, back to front, to the browser console |
| `R` | redraw the scene, re-running the sort |
| `N` | turn the hero into the werewolf and back, beside the day and night cycle that does it on its own |
| `?devRoom=<id>` | in the URL, dev mode only: open a particular room instead of one of the four the game starts in (`?devRoom=45`, `?devRoom=0x2d`) |
| `[` `]` | open the previous or the next room of the castle, with the hero dropped in the middle of it (which is not how the game moves between rooms - that is the arches) |


## Build & tooling
The `svtool` CLI (`~/app/svision/tools/svtool`) builds and checks the deploy. Run it from the project root:
- `svtool build bundle` — minified production bundle `js/bundle.<version>.min.js` (requires terser)
- `svtool build debug-bundle` — the same concatenation left unminified, `js/bundle.<version>.js`, for debugging on a device whose console cannot be opened
- `svtool verify` — check the `js/` deploy is complete, matches the current sources, and stays within ES2018
- `svtool info` — show the app version, deploy state and the most recent database records
- `svtool clean` — remove everything generated from `js/`

The game's own tools live in `tools/` and need nothing but Node:
- `node tools/klconv/klconv.js list | dump <id> | emit <id|all> [--out dir] | global [--out dir] | verify [--out dir] | info` — reads the original's room data out of a snapshot and writes our `data/roomNNN.json`; `global` writes `data/global.json`, the 32 collectable objects and the order the cauldron asks for them in; `verify` converts every room afresh and holds it against what is in `data/`, so a file edited by hand or left behind is caught
- `node tools/klsprite/klsprite.js list [--used] | sprites | show <graphic> [--flip h|v|hv] | anchors | verify | emit [--out dir]` — reads the original's masked sprites and writes `data/sprites.json`; `show` prints one as text, `verify` compares every sprite against the disassembly source, `anchors` holds each anchor against the box it is drawn on
- `node tools/klrender/klrender.js render <id> [-o out.png] [--scale n] [--outline] [--no-panel] [--border] [--no-hero] [--hero form,dir,frame] [--at x,y,z] [--items [seed]] [--status days,lives,o,o,o]` — renders a room to a PNG with the same modules the game uses, so a scene can be checked without a browser; `--items` deals the collectable objects out as a game would and draws the one that lands in this room, `--status` fills the panel in
- `node tools/klrender/klrender.js order <id>` — prints the drawing order the depth sorting produced
- `node tools/klrender/klrender.js check <id|all>` — walks every box of every room and reports the ones without a sprite or drawn off the screen
- `node tools/klwalk/klwalk.js walk <id> [--keys program] [--ticks n] [--at x,y,z] [--facing 0-3] [--method directional|rotational] [--trace] [--png out.png]` — walks the hero through a room with the same physics the game runs and reports where he ends up; a key program is a list like `N*20,NJ,N*8` (`N` `E` `S` `W` `J`, with `*n` to hold)
- `node tools/klwalk/klwalk.js check <id|all>` — the two invariants in every room: nothing ever leaves it (the hero excepted while an arch has hold of him) and the hero is never inside an object
- `node tools/klwalk/klwalk.js life <id|all> [--ticks n] [--trace]` — leaves the hero standing and watches the room instead: what moves and how far, what kills him, and whether every graphic number in it has a handler
- `node tools/klwalk/klwalk.js doors <id|all> [--ticks n]` — every doorway of every room, walked out of from both sides: whether the hero leaves by the wall he walks at, lands in the room the data says and at the height its arch stands at, and gets back
- `node tools/klwalk/klwalk.js worker <id> [--keys program]` — the same walk through `app/gameWorker.js` itself, its message protocol and its clock, compared tick by tick with the direct run
- `node tools/klwalk/klwalk.js travel <id> [--keys program] [--ticks n]` — one key program walked through the real worker across as many rooms as it reaches, this tool standing in for the room model
- `node tools/klwalk/klwalk.js items <id|all>` — every collectable object of the castle picked up and put down again with the game's own key and rules, including the idols that are extra lives and the places with no headroom to put one back
- `node tools/klwalk/klwalk.js win` — both endings played out: the fortieth day running the game out, and fourteen objects into the cauldron, the room coming apart and the score that comes of it
- `node tools/klmap/klmap.js check [<id>|all] [--verbose]` — finds every room in the period map of the original (`refs/maps/KnightLore_3.png`, a 1:1 stitch of the real screens) and counts how much of what we draw the original draws too, furniture, movers and walls apart; `--verbose` names the pieces the map does not confirm
- `node tools/klmap/klmap.js diff <id> [-o out.png] [--scale n]` — the same for one room as a picture: white both, red only ours, blue only the map
- `node tools/klmap/klmap.js sheet [-o out.png] [--plain]` — the whole castle out of `data/` drawn over the original map, which is the picture to check by eye
- `node tools/klmap/klmap.js levels` — the storeys of the castle twice over, from the doorway heights in the data and from how high the map draws each room
- `python3 tools/recon/dump-location-table.py` — reproduces the castle map out of the disassembly

`tools/lib/` holds what more than one of them needs: the snapshot and symbol reader, the reader of the disassembly source, the two object tables of the original, the PNG reader and writer, and the loader that lets a tool run the game worker's classic scripts instead of copying them.


## Documentation
- `GAME-DESIGN.md` — what is being built and why (Czech)
- `ROADMAP.md` — the milestones (Czech)
- `NOTES-ORIGINAL.md` — what the disassembly says: data formats, projection, drawing order (Czech)
- `RESOURCES.md` — the sources everything is derived from (Czech)


## License
See the [LICENSE](LICENSE) file.

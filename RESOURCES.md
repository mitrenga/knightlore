# Knight Lore — zdroje

Podklady pro remake. U každého zdroje je poznamenáno, **k čemu přesně slouží**.
Vše, co se z těchto zdrojů skutečně použije (grafika, data, fonty), se musí
zapsat do `CREDITS.md` / `SOURCES.md` podle konvence svision (`SOURCES.md`
v repozitáři svision je vzor formátu: *Used in / Origin / Author / Source /
Licence*).

## 1. Reverzní inženýrství originálu — nejdůležitější vrstva

Knight Lore má **kompletní komentovanou disassembly** — to je obrovská výhoda
oproti JSW/MM, kde se hodně odvozovalo z chování. Ta se stane primárním
zdrojem pravdy pro pravidla, konstanty a data místností.

- **jonsole/knightlore** — https://github.com/jonsole/knightlore
  (`knightlore.asm`) — reverzně inženýrovaný, relokovatelný Z80 zdroják,
  prakticky každý řádek okomentovaný, pojmenované proměnné a datové struktury;
  portováno i na TRS-80. **Hlavní zdroj pro engine i data.**
- **Retro Ports — „Knight Lore disassembly released"** —
  http://retroports.blogspot.com/2016/01/knight-lore-disassembly-released.html
  — kontext k disassembly, včetně zmínky o portu do C (užitečné jako druhý
  pohled na tytéž algoritmy).
- **level7.org.uk disassembly** —
  https://level7.org.uk/miscellany/knightlore-disassembly.txt — nezávislá
  disassembly, dobrá na křížovou kontrolu.
- **Z80 Source Code Software / Knight Lore (GitLab)** —
  https://gitlab.com/z80-source-code-software/other-systems/knight-lore---zx-spectrum
- **mrcook/zx-spectrum-games** — https://github.com/mrcook/zx-spectrum-games
  — anotované disassembly ve formátu SkoolKit (`.skool`); stejná rodina
  nástrojů, jakou používají JSW/MM disassembly.

**Co z disassembly vytěžit (a v jakém pořadí):**
1. formát a obsah dat místností → generátor našeho `data/roomNNN.json`,
2. tabulky sprajtů a masek → export do `SpriteTool` formátu,
3. konstanty fyziky (výška a délka skoku, rychlost chůze, gravitace, výška
   schodu, rychlosti plošin a strážců),
4. pravidla hry: cyklus den/noc, výběr žádaných předmětů, kapacita inventáře,
   podmínky smrti, skóre,
5. **zda a jak se propojení místností mění mezi hrami** (viz `GAME-DESIGN.md`
   kap. 2 — otevřená otázka s velkým dopadem na formát dat).

## 2. Technika Filmation (izometrie)

- **Bannalia — „Filmation math"** —
  http://bannalia.blogspot.com/2008/02/filmation-math.html — nejlepší stručný
  rozbor: zjednodušená projekce `(x,y,z) → (x0 + x − y, y0 − x/2 − y/2 + z)`,
  reprezentace objektů konvexními kvádry, šestiúhelníkové průměty, šest
  podmínek relace „je za", a poznámka, že relace **není tranzitivní**
  (Ultimate cykly neřešilo). **Povinná četba před psaním `depthSort.js`.**
- **Wikipedia — Knight Lore** — https://en.wikipedia.org/wiki/Knight_Lore —
  historie, popis maskovací techniky, kontext série Sabreman.

## 3. Herní obsah — mapy, pravidla, průchody

- **Original instructions (nvg.ntnu.no)** —
  http://rk.nvg.ntnu.no/sinclair/instructions/kghtlore.html — dobový návod
  k hře; **primární zdroj pro texty, terminologii a pravidla**.
- **StrategyWiki — Knight Lore** — https://strategywiki.org/wiki/Knight_Lore
  — 28 předmětů po hradu, kotel jich vyžádá 14, chování kotle vůči
  vlkodlakovi, 40 dní a nocí.
- **Spectrum Computing** —
  https://spectrumcomputing.co.uk/entry/9366/ZX-Spectrum/Knight_Lore —
  archivní záznam hry (TAP/TZX, skeny, dobové recenze).
- **World of Spectrum (classic)** — https://worldofspectrum.net/item/0009366/
- **Games Database — mapy** —
  https://www.gamesdatabase.org/media/sinclair-zx-spectrum/artwork-map/knight-lore
- **zx-spectrum.cz — dobové recenze** —
  https://www.zx-spectrum.cz/zxsr/zxsr.php?id=9366 (česky, dobrý zdroj citací
  na `about` stránku)
- **Longplay videa** (referenční hratelnost, timing, chování strážců):
  https://www.youtube.com/watch?v=7n7qtErhF-A a
  https://www.youtube.com/watch?v=esQ_QlCK0Us
- **Speed Demos Archive** — https://speeddemosarchive.com/KnightLore.html —
  speedrun komentář = hutný popis mechanik a triků.

## 4. Emulátor jako měřicí přístroj

Nenahraditelné pro ladění věrnosti: nechat originál běžet vedle remaku.
- TAP/TZX ze Spectrum Computing, emulátor s debuggerem a krokováním
  (Fuse, ZEsarUX) — breakpointy podle labelů z disassembly, čtení paměti
  s daty místností, snímky obrazovky pro pixel-porovnání.
- Postup ověřování: screenshot originálu vs. screenshot remaku ve stejné
  místnosti, porovnání po pixelech.

## 5. Vlastní kód a projekty (zdroj *formy*)

- **svision** — `/home/libmit/sw/svision`,
  https://github.com/mitrenga/svision. Dokumentace: `docs/` (jsdoc),
  `tutorials/`, `README.md`, `SOURCES.md`.
  Přímo použitelné: `ZXPlatform` + `zxColor`, `zxFonts8x8`,
  `SpriteTool` / `SpriteEntity`, `drawingCache`, `MenuEntity`, `TextEntity`,
  `InputEventsManager`, `zxRemapKeysEntity`, `zxSettingsEntity`,
  `zxVolumeEntity`, `zxSelectingGamepadEntity`, `zxResetModel`,
  `slidingTextEntity`, audio stack, service worker, `php/main.php`.
  Nástroje: `tools/svtool` (build/verify/info/clean), `make-app-icons`,
  `make-favicon`, `make-data-fonts`, `mid2score`/`xml2score` (hudba).
- **Jet Set Willy** — `/home/libmit/sw/jetsetwilly`. **Předloha struktury
  projektu**: `index.php` (SEO, JSON-LD, noscript), `config/compile.json`,
  `config/createDB.sql` (`rg_jsw_hallOfFame`), `config/nginx.conf`,
  `aboutPage.php`, `testFlightPage.php`, `data/global.json` + `roomNN.json`,
  model/worker rozdělení, tape loading, hall of fame, menu.
- **Manic Miner** — `/home/libmit/sw/manicminer`. Tentýž vzor o generaci
  starší; dobré na porovnání, co se mezi projekty ustálilo.
- **Endless Universe** — `/home/libmit/sw/endlessuniverse`. Vzor pro
  **objektový entity systém ve workeru**, **editor uvnitř aplikace**
  (`/spriteEditor`, `/sceneEditor`, role v DB, oddělený bundle) a pro styl
  vedení `GAME-DESIGN.md`.
- **testflights** — `/home/libmit/sw/testflights/*` — vzor testovací stránky
  pro rozesílání beta verzí.

## 6. Série Sabreman (kontext a budoucnost)

- **Sabre Wulf** (1984) — první díl, 2D.
- **Underwurlde** (1984) — 2D flick-screen, tentýž hrdina a svět; jiný engine,
  ale sdílí grafický jazyk a lore. Kandidát na další remake.
- **Alien 8** (1985) — **Filmation I, prakticky tentýž engine jako Knight
  Lore**. Pokud izo vrstva ve svision vznikne pořádně, je Alien 8 řádově
  levnější druhý titul.
- **Nightshade / Gunfright** (1985) — Filmation II (rolující izo scéna) —
  přirozené pokračování izo vrstvy o krok dál.

## 7. Právní rámec

- Remake, ne emulátor ani kopie binárky — kód nový, data přepsaná do vlastního
  formátu; stejná formulace jako v README u JSW a MM.
- Knight Lore, Sabreman a Ultimate Play The Game jsou ochranné známky /
  majetek příslušných držitelů (dnes Rare / Microsoft) — v `about` uvést
  autorství originálu (Tim a Chris Stamperovi, Ultimate Play The Game, 1984)
  a jasně, že jde o nekomerční fanouškovský remake.
- Disassembly použít jako **referenci pro pochopení pravidel**, ne jako zdroj
  kopírovaného kódu; z ní odvozená data (mapy, sprajty) zapsat do
  `SOURCES.md` s uvedením původu.
- Licence projektu: sjednotit s JSW/MM (`LICENSE` v jejich repozitářích).

# Knight Lore — Game Design Document (zadání)

Stav k 2026-09-01 (vzniklo 2026-08-31, průběžně doplňováno o ověřená
zjištění). Vstupní zadání remaku pro prohlížeč nad knihovnou
[svision](https://github.com/mitrenga/svision), ve stejném duchu jako
`manicminer` a `jetsetwilly`. Body označené **(ověřit)** je nutné potvrdit
proti originálu nebo disassembly (viz `RESOURCES.md`) dřív, než se podle nich
bude psát kód.

## 1. Co stavíme

- **Věrný remake** ZX Spectrum hry *Knight Lore* (Ultimate Play The Game /
  Ashby Computers & Graphics, bratři Tim a Chris Stamperovi, 1984), engine
  **Filmation** — izometrická 3D scéna v monochromatické grafice.
- **Ne emulátor, ne kopie binárky.** Herní data (mapa, sprajty, chování) se
  přepisují do vlastního JSON formátu, kód je nový. Stejná formulace jako
  v README u JSW.
- Cíl: hratelnost k nerozeznání od originálu na desktopu i mobilu,
  klávesnice / myš / gamepad / dotyk, PWA, offline.
- Vedlejší cíl, který má cenu sám o sobě: **izometrická vrstva ve svision**
  použitelná i pro další Filmation hry (Alien 8, Pentagram, Nightshade)
  a pro původní tvorbu.

## 2. Herní pravidla (zadání hry)

- Sabreman je prokletý — v **noci** se mění ve **vlkodlaka**, ve **dne** je
  zpět člověkem. Přeměna je automatická, řízená cyklem den/noc, hráč ji
  neovlivní.
- Úkol: donést do **kotle** v komnatě čaroděje Melkhiora předměty, které si
  kotel postupně žádá. Aktuálně žádaný předmět je zobrazen v panelu.
  Po vhození se žádost změní. Kotel si během hry vyžádá **14 předmětů**
  ze 7 typů; sekvence je pevná a na začátku hry se jen pootočí o 4–7 pozic
  (*ověřeno v M1*, `NOTES-ORIGINAL.md` kap. 4). Tabulka rozmístěných předmětů
  má **32 záznamů** — proti dobově uváděným 28 předmětům je to o čtyři víc,
  rozdíl dořešit v M8.
- **Časový limit: 40 dní a nocí.** Cyklus běží nezávisle na hráči a je
  zobrazen v info panelu (den/noc + počítadlo).
- Hrad má **128 místností** a přechody **čtyřmi směry**; svisle se mezi
  místnostmi nechodí (*ověřeno v M7*, `NOTES-ORIGINAL.md` kap. 15) — patra hradu
  propojuje výška oblouku, kterým se odchází. Dobové popisy tvrdí, že se plán hradu mezi hrami liší — **neplatí**
  (*ověřeno v M1*): hrad je pevná mřížka 16×16, ID místnosti = `řádek<<4 |
  sloupec` a soused se z ID počítá, netabulkuje. Náhodná je jen startovní
  místnost, jedna ze čtyř. Viz `NOTES-ORIGINAL.md` kap. 1.
- Hráč nese **nejvýš 3 předměty současně** (*ověřeno v M2*, `display_objects`,
  `NOTES-ORIGINAL.md` kap. 10), zbytek odkládá v místnostech.
- **Předmět lze vhodit do kotle jen jako člověk.** Vlkodlaka jiskra u kotle
  zabije — časování vůči cyklu den/noc je jádro obtížnosti.
- Životy, ztráta života při doteku strážce / pasti / propadnutí, návrat na
  vstupní pozici místnosti.
- Skóre a **Hall of Fame** v DB, stejně jako v MM/JSW.

### Mechaniky, které engine musí umět

Minimální sada, bez které hra nedává smysl (finální seznam vzejde z mapování
místností v M1):

- chůze po čtyřech izo směrech, skok (krátký/dlouhý), pád s poškozením/bez,
- **stoupání na kvádry** (schod o výšku ≤ N), stání na pohyblivé plošině,
- **tlačení kvádrů** a jejich použití jako schodu,
- pohyblivé plošiny a výtahy (dráha, rychlost, nesou hráče i objekty),
- statické pasti (bodce, ohnivé sochy) a **létající/pohybující se strážci**,
- ~~objekty existující **jen ve dne / jen v noci**~~ — *ověřeno v M1: v
  originálu neexistují*, geometrie místnosti je statická a cyklus mění jen
  podobu, rozměry a fyziku hráče (`NOTES-ORIGINAL.md` kap. 3),
- sbíratelné předměty, jejich odložení a vhození do kotle,
- rozdílná fyzika/rozměr **člověk vs. vlkodlak** (jiná výška sprajtu, jiná
  rychlost a výška skoku — ověřit, jak moc se liší).

## 3. Souřadný systém a projekce

- Svět je **3D mřížka jednotkových krychlí**. Souřadnice `(x, y, z)`:
  `x` a `y` = půdorys, `z` = výška. Herní logika i data pracují **výhradně
  v jednotkách světa**, nikdy v pixelech obrazovky.
- Projekce do 2D (jediné místo, kde se pixely počítají):

  ```
  sx = originX + (x - y)
  sy = originY - (x + y) / 2 + z
  ```

  To je **přesně ta zjednodušená projekce, kterou používal Filmation** (místo
  matematicky správného faktoru √3/2 se použije 1) — osy `x` a `y` se promítají
  na přímky se sklonem 1/2, které jdou beze zbytku vykreslit v pixelech.
  Držet se jí, ne „správnější" izometrie: jinak grafika originálu nesedne.
  *Ověřeno v M2:* originál má osy přiřazené zrcadlově (vodorovná je `x+y`,
  hloubková `y−x`) a počítá řádky odspodu obrazovky; přesné znění i s odvozením
  je v `NOTES-ORIGINAL.md` kap. 7 a implementované v `app/isoProjection.js`.
  Měřítko jednotky světa vůči pixelu je 1 : 1 a je konstantou platformy,
  ne dat.
- **Rozlišení a paleta:** ZX Spectrum 256×192, atributová barva per místnost
  (monochromatická scéna obarvená atributy) → `ZXPlatform`
  ze svision, stejně jako MM/JSW.
- Herní plocha vs. info panel: rozvržení odpovídá originálu. *Ověřeno v M2*
  z disassembly (ne z fotky): zdobený rámeček kolem celé obrazovky, panel se
  sluncem/měsícem a žádaným předmětem vpravo dole, počítadlo dní dole
  uprostřed, životy vlevo — souřadnice v `NOTES-ORIGINAL.md` kap. 9.

## 4. Render — jádro problému

Izometrie stojí a padá se **zákrytem** (occlusion). Toto je nejrizikovější
část projektu a dostane vlastní milník.

- **Malířův algoritmus** nad display listem místnosti: nakreslit objekty
  odzadu dopředu.
- **Řazení není prostý sort podle klíče.** Objekty jsou konvexní kvádry dané
  dvěma vrcholy `(x, y, z)` a `(x', y', z')`; do 2D se promítají jako
  šestiúhelníky. Dva se překrývají jen při splnění tří intervalových podmínek
  najednou, a pořadí pak určuje relace „je za". Řadí se tedy **topologicky nad
  touto relací**, ne sortem podle klíče `x + y + z`.
  *Ověřeno v M2:* originál relaci nepočítá vzorcem, ale složí z každé osy
  trojhodnotový kód do indexu a odpověď vyčte z **27položkové tabulky**;
  pozorovatel stojí ve směru většího `x`, **menšího** `y` a většího `z` — na
  ose `y` je tedy směr opačný, než tenhle dokument původně předpokládal.
  Tabulka i průchod jsou v `NOTES-ORIGINAL.md` kap. 8 a v `app/depthSort.js`.
- **Relace „je za" není tranzitivní** — tři objekty mohou tvořit cyklus
  (A za B, B za C, C za A). Ultimate to neřešilo dělením objektů a přijalo
  občasný artefakt. **Uděláme totéž.** *Ověřeno v M2:* originál cyklus pozná
  tak, že při hloubkovém sestupu narazí na objekt, který už na cestě je,
  a rozsekne ho tím, že ho hned nakreslí; děláme to stejně, takže artefakty
  vycházejí na stejných místech jako v originálu.
- **Masky:** sprajty se kreslí monochromaticky s maskou (nejdřív vymaskovat
  pozadí, pak vykreslit tvar), aby měl objekt čistý obrys proti objektu za
  ním. Pokud `SpriteTool`/`SpriteEntity` masku neumí, je to úkol do svision,
  ne hack v Knight Lore.
- **Strategie překreslování:** místnost má řádově desítky až nižší stovky
  objektů → **přestavět celou scénu každý snímek** ze setříděného display
  listu. Cache (`drawingCache`) použít na jednotlivé sprajty, ne na půlky
  scény; statická/dynamická vrstva se dělit až tehdy, pokud to měření
  ukáže jako nutné (a pak korektně: statické objekty *před* dynamickým se
  musí překreslit). *Doplněno v M2:* hotová scéna se drží v jedné cache
  a překresluje se celá, jakmile se cokoli změní — není to dělení scény na
  vrstvy, jen se nerasterizuje snímek, ve kterém se nic nestalo.
- Cíl: **stabilní snímková frekvence na desktopu i telefonu**; měřicí overlay
  (počet objektů, čas řazení, čas kreslení) od M2 dál.

## 5. Fyzika a kolize

- Každý objekt = **3D AABB** v jednotkách světa (`x, y, z, sx, sy, sz`).
- Pohyb po ose: posun → test průniku → korekce, osy zvlášť (řeší klouzání
  podél stěn). *Ověřeno v M4:* originál to dělá přesně takhle, korekce je
  zkracování kroku po jedné jednotce a pořadí os je Z, X, Y — a z toho pořadí
  vychází i stoupání na kvádry. Implementované v `app/physics.js`.
- Gravitace, balistický skok; ovládání ve vzduchu podle originálu.
  *Ověřeno v M4:* skok **je** předurčený — ve vzduchu se nedá otočit ani
  zastavit, hráč letí směrem, kterým se odrazil. Jeho výška je ale proměnná:
  držení klávesy zpomalí gravitaci, dokud stoupá (16 jednotek klepnutím,
  28 držením). Konstanty a odvození jsou v `NOTES-ORIGINAL.md` kap. 13.
- „Stání na" = kontakt shora; plošina, na které hráč stojí, ho **unáší**.
  *Ověřeno v M4:* originál nemá „stání na" jako stav, jen příznak „svislý posun
  se musel zkrátit", a unášení je jeden `ld` uvnitř téže kolizní rutiny.
- Kolizní typy jako atribut objektu: `solid / platform / hazard / pushable /
  collectible / trigger / decoration`.
- Pozor na klasickou past izo her: **stín / indikátor výšky**. Bez vodítka
  hráč nepozná, kam dopadne. Originál to neměl — pokud se ukáže jako
  nehratelné na moderní obrazovce, řeší se to jako volitelná asistence
  v nastavení, nikdy jako změna základní hry.

## 6. Formát dat

Ve stylu JSW (`data/roomNN.json` + `data/global.json`), ale ve 3D:

- `data/global.json` — počet místností, startovní místnost, mřížka mapy,
  seznam sbíratelných předmětů a jejich sprajtů, sprajty Sabremana
  a vlkodlaka, parametry cyklu den/noc, délka hry (40 cyklů).
- `data/roomNNN.json` — jedna místnost. **Skutečný tvar vzešlý z M1 je
  popsaný v `NOTES-ORIGINAL.md` kap. 6**, včetně odůvodnění odchylek od
  původní představy níže:
  - `attribute` (barva), `bounds` (rozměry v jednotkách), `cube` (16×16×12),
  - `exits` — čtyři směry, jen dopočítané ID sousední místnosti; originál
    exity v datech nemá a vstupní pozici neurčuje — tu dá až oblouk v místnosti,
    do které se vchází (*M7*),
  - `objects[]` — `{ type, source, sprite, x, y, z, sx, sy, sz, collision,
    motion, phase }`; pozadí (stěny, oblouky) i kvádry jsou v jednom poli,
    protože engine z nich skládá jeden display list,
  - pohyblivé objekty nemají vlastní pole — pohyb je vlastnost typu
    (`motion`), stejně jako v originálu,
  - `items[]` — odkazy do globální tabulky 32 předmětů.
- **Jeden sdílený modul pro čtení/validaci** formátu, používaný hrou
  i editorem (poučení z EU).
- Sprajty v formátu `SpriteTool` (mono + maska), sdílená knihovna sprajtů
  napříč místnostmi — v Knight Lore se tytéž kvádry opakují ve všech
  místnostech, data místnosti odkazují na typ, nenesou bitmapu.

## 7. Editor místností `/roomEditor`

**Bez editoru se 128 izometrických místností ručně nenapíše.** Zkušenost z EU
(kap. 15 tamního GDD) platí i tady:

- Stránka `/roomEditor` uvnitř aplikace, přístup podle role / jen devel režim,
  práva vynucuje PHP, ne UI.
- Kód editoru si natahuje editor stránka vlastním `<script>`; z `app/main.js`
  na něj nevede import, takže se do produkčního bundlu **nemá jak dostat**
  (`svtool` bere jen to, co je z `main.js` dosažitelné — R-019).
- Funkce: umístění kvádrů v 3D mřížce (klik do izo scény + volba výšky),
  paleta typů objektů, dráhy pohyblivých objektů, fáze den/noc, exity,
  spawny; uložení do `/data` přes autorizovaný endpoint.
- Předpočty (bounds, anchor, margins, případné předtřídění statiky) dělá
  editor při uložení — engine data jen čte.

## 8. Architektura kódu

Vzor MM/JSW (jejich `app/` a hlavičky; `compile.json` už seznam souborů
nenese — odvozuje se z importů, R-019):

- `gameApp.js`, `main.js`, `appPlatform.js` — kostra aplikace nad svision.
- `menuModel.js`, `mainModel.js`, `tapeLoadingModel.js`, `gameOverModel.js`,
  `hallOfFameEntity.js`, `aboutEntity.js`, `pauseGameEntity.js` — převzít
  jedna k jedné z JSW, liší se jen obsahem.
- **Nové jádro:**
  - `isoProjection.js` — projekce, konstanty krychle, převody svět↔obrazovka,
  - `depthSort.js` — topologické řazení display listu,
  - `sceneEntity.js` — vykreslení místnosti (display list + kreslení),
  - `roomModel.js` — stav místnosti, přechody, cyklus den/noc,
  - `gameWorker.js` — fyzika a AI ve workeru, snapshot ping-pong do modelu
    (stejný vzor jako MM/JSW/EU),
  - `heroController.js` — vstupy a stavový automat animací.
  *Doplněno v M4:* přibyl `physics.js` (kolize samotné, bez hráče) a všechny tři
  jsou **klasické skripty** — worker `import` neumí. Model workeru posílá jen
  rozměr místnosti a plochý seznam krabic, takže o datech ani sprajtech neví.
  Člověk a vlkodlak nemají dvě sady parametrů: liší se jen grafikou (M3).
- Vše, co je obecné (izo projekce, depth sort, masky ve sprajtech), patří
  **do svision**, ne do repozitáře hry.

## 9. Platformy a ovládání

- **Desktop primární** (klávesnice, gamepad), mobil plnohodnotně hratelný
  (dotykové ovládání jako v JSW).
- Mapování směrů: čtyři izo směry na kříž/klávesy, skok, sebrat/položit.
  Remapování kláves přes hotovou `zxRemapKeysEntity` ze svision.
- PWA, service worker, offline (hotové ve svision).

## 10. Infrastruktura projektu

Kopie osvědčené sestavy z JSW — vzniká hned v M0, ať se od začátku pracuje
v ostrém prostředí:

- `index.php` + `app/svision` symlink, `config/nginx.conf`, `config/config.php`,
  `config/createDB.sql` (tabulka `rg_kl_hallOfFame`), `config/compile.json`.
- `svtool build bundle` / `verify` / `info` / `clean`, gate na ES2018.
- `aboutPage.php`, `testFlightPage.php`, `images/poster.png`, ikony, favicon.
- `README.md` v angličtině ve stylu JSW; `GAME-DESIGN.md` (tento dokument)
  a `ROADMAP.md` česky; třetí strany a původ dat do `CREDITS.md` /
  `SOURCES.md` podle konvence svision.

## 11. Inspirace a hranice

- **Jet Set Willy / Manic Miner (tvoje remaky):** struktura projektu, menu,
  tape loading, hall of fame, formát místností, worker/model rozdělení,
  testflight stránka. Odsud se bere *forma*.
- **Underwurlde (Sabreman série):** stejný hrdina a svět; pokud se remake
  Knight Lore povede, sdílená izo/sprajt vrstva otevírá i **Alien 8**
  (Filmation, prakticky stejný engine) a Underwurlde (2D, jiný engine, ale
  tentýž vesmír) — brát jako budoucí pokračování, ne jako scope teď.
- **Endless Universe:** vzor pro entity systém ve workeru, editor uvnitř
  aplikace a pro tenhle způsob vedení dokumentace.
- **Hranice scope:** žádné vylepšování hry (nové místnosti, nová grafika,
  QoL mechaniky) dokud neběží věrná verze. Rozšíření se sbírají do sekce
  „nápady" v `ROADMAP.md`.

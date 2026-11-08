# Knight Lore — milníky

Postup po malých ověřitelných krocích, každý s viditelným výsledkem — stejná
filozofie jako u Endless Universe. Milníky **M0–M6 tvoří „pahýl"**: jedna
místnost, kterou lze projít a která vypadá jako originál. Teprve po revizi
pahýlu se sahá na obsah, editor a zbylých 127 místností.

Zbylých 127 místností přišlo dřív, než tenhle plán čekal: revize pahýlu (kap. 10
`REVIEW-M6.md`, rozhodnutí A) je do `data/` nasypala hned, protože M7 nemá kam
vyjít ze dveří. Ověření každé místnosti proti originálu — ta podstatná část M9 —
zůstalo, kde bylo, a doběhlo se až v M9 (`REVIEW-M9.md`).

Před M0: rozhodnout otevřené otázky označené **(ověřit)** v `GAME-DESIGN.md`
tak, jak na ně přijde řada — ne všechny předem.

**Stav k 2026-09-01: hotovo M0–M5 a M7–M9; M6 zrevidováno, čeká na odsouhlasení
zbytku.** Hrad se dá projít i dohrát: 128 místností, 286 dveří, 32 předmětů,
kotel, čtyřicet dní — hru lze prohrát vypršením času a vyhrát doplněním
lektvaru. Hrad je navíc ověřený proti dobové mapě originálu: 127 ze 128
místností se v ní našlo a 99,3 % nepohyblivého nábytku kreslíme tam, kde ho
kreslí originál (`REVIEW-M9.md`). Revize pahýlu je v `REVIEW-M6.md` — z pěti
rozhodnutí
(A–E) je **A provedeno**, protože bez všech 128 místností nemá M7 kam vyjít ze
dveří; B potvrzeno tím, že se M7 dělalo první; C, D a E čekají na odsouhlasení.
Čtyři věci z kap. 9 revize se offline změřit nedají a čekají na tvoje oči.

---

## ⚠ Vysoká priorita — `sceneEntity.js` kreslí mimo svision

**Založeno 2026-09-06 při převodu rasterové vrstvy do knihovny (R-014).**
Je to jediné místo napříč všemi hrami, které po sjednocení zbylo.

`app/sceneEntity.js:309` podává rasterizéru plochu, která kreslí **jeden
`fillRect` na pixel**:

```js
newSurface(cache) {
  var ctx = cache.ctx;
  …
  span:  function(x, y, width, color) { setColor(color); ctx.fillRect(x, y, width, 1); },
  pixel: function(x, y, color)        { setColor(color); ctx.fillRect(x, y, 1, 1); }
}
```

Dvě věci jsou na tom špatně:

1. **Sahá do `cache.ctx` za zády entity.** Všechny ostatní hry (14 souborů
   v 8 projektech) od 2026-09-06 kreslí přes `RasterEntity.paintRaster(data)`
   do `ImageData` — jedna pixelová cesta v celé knihovně. Tahle je druhá.
2. **`setColor` je opsaná knihovna.** `DrawingCache.paint()` má `lastColor`,
   který dělá přesně totéž: `fillStyle` se přiřazuje, jen když se barva mění.

**Co s tím.** `RasterEntity` (`svision/js/platform/canvas2D/rasterEntity.js`)
na to má hotové obojí: `this.pixels` je `Uint32Array` pohled na snímek
a `RasterEntity.rgbaValue('#rrggbb')` zabalí barvu ve správném pořadí bajtů.
`span()` se z toho stane `fill()` na řezu pole, `pixel()` jedno přiřazení.

**Vazby:** globální registr `../DECISIONS.md` — **R-014** (rasterová vrstva,
třída hotová) a **R-023** (`SpriteEntity` na `RasterEntity`; tohle je tatáž
vrstva a stejná práce, dá se udělat spolu). Pozor na **R-018**: nejdřív změřit,
teprve pak optimalizovat — tady je ale hlavní důvod *jedna cesta k pixelům*,
ne rychlost.

**Neměřeno.** Entity potřebují DOM, takže na `sceneEntity.js` nedosáhne žádné
`match*`. Po převodu se musí proklikat — hlavně překrývání objektů, na kterém
stojí celý isometrický pohled.

---

## Fáze A — pahýl (jedna místnost)

### M0 — Kostra projektu + odečtená grafika
Vytvořit projekt podle vzoru JSW: `index.php`, symlink `app/svision`,
`config/{compile.json,config.php.sample,nginx.conf,createDB.sql}`
(tabulka `rg_kl_hallOfFame`), `js/`, ikony, `README.md`. Rozchodit devel režim
a `svtool build bundle` + `verify` na prázdné aplikaci s jedním prázdným
modelem. Z originálu (emulátor, screenshoty) odečíst rozměry krychle,
rozvržení obrazovky a atributové barvy.
*Hotovo, když: aplikace se otevře v prohlížeči, ukáže prázdnou ZX obrazovku
se správným rámečkem a panelem, a `svtool verify` projde.*
*Uzavřeno 2026-09-01:* kostra, `svtool build`/`verify` i datový endpoint běží.
Rámeček a panel jsou v originálu sprajty, takže se dokreslily až v M3 — a
přitom se ukázalo, že **rámeček do hry vůbec nepatří**, kreslí ho jen menu a
textové obrazovky (`NOTES-ORIGINAL.md` kap. 9). Ve hře je kolem místnosti
panel, a ten se kreslí. Chybí ikony a poster (M10).

### M1 — Čtení originálních dat
Prostudovat disassembly (`RESOURCES.md` kap. 1), popsat formát dat místností
originálu a napsat **offline konvertor** (PHP nebo Node, do `tools/`), který
z binárky vytáhne jednu místnost a vypíše ji. Zároveň navrhnout náš
`data/roomNNN.json` (formát z `GAME-DESIGN.md` kap. 6) a sdílený modul pro
čtení/validaci.
*Hotovo, když: konvertor vypíše obsah zvolené místnosti a vznikne první
validní `room000.json`; víme, jestli je propojení místností fixní.*

### M2 — Izo render statické scény
`isoProjection.js` + `depthSort.js` + `sceneEntity.js`: načíst `room000.json`
a vykreslit ji. Malířův algoritmus nad topologicky setříděným display listem,
deterministické rozseknutí cyklů. Debug overlay: pořadí kreslení, počet
objektů, čas řazení a kreslení.
*Hotovo, když: statická místnost je vedle screenshotu originálu k nerozeznání
(pixel-porovnání) a overlay ukazuje rozumné časy.*
*Uzavřeno 2026-09-01:* projekce, řazení i zákryt jsou hotové a odečtené přímo
z disassembly (`NOTES-ORIGINAL.md` kap. 7–9). Kvádry se v M2 kreslily
procedurálně jako obrysy; od M3 se kreslí sprajty a obrysový režim zůstal jako
vývojářský (klávesa `S`), protože ukazuje geometrii, když se pokazí řazení.
Kromě overlaye vznikl offline renderer `tools/klrender`, který místnost vykreslí
do PNG bez prohlížeče; všech 128 místností jím projde, největší display list má
36 kvádrů, řazení 0,5 ms a kreslení 3,5 ms (Node, jedna místnost).

### M3 — Sprajty s maskami
Export sprajtů z originálu do `SpriteTool` formátu; doplnit do svision
podporu **masky** (sprajt + maska, korektní obrys proti pozadí). Sabreman
a vlkodlak jako animované sprajty, zatím statické, umístěné do scény.
*Hotovo, když: postava stojí v místnosti, správně zakrývá a je zakrývána
kvádry, obrys je čistý; změny jsou ve svision, ne v hře.*
*Uzavřeno 2026-09-01:* hotovo — celá místnost, panel i postava se kreslí
sprajty originálu (`NOTES-ORIGINAL.md` kap. 12) a scéna tím poprvé vypadá jako
originál; na skutečný pixel-diff ale chybí snímek z emulátoru (viz níže).

Jak to nakonec vyšlo:
- **Sprajty se neukládají do `SpriteTool` formátu, ale jako bajty originálu**
  (`data/sprites.json`, hex, dvojice maska/obrázek). Je to přesnější
  provenience (dá se srovnat bajt po bajtu se zdrojákem disassembly, což
  `klsprite verify` u všech 103 sprajtů dělá) a menší než překódovaná mřížka.
  Formát rozbaluje `app/spriteSheet.js` — bez závislostí, takže z něj čte hra
  i offline nástroje.
- **Do svision přibyla maska u `SpriteEntity`** (`maskChar`, `maskColor`) a nic
  víc; kreslení scény si hra rasterizuje sama do jedné cache, protože malířův
  algoritmus potřebuje pořadí, ne entity. Panel je naopak z `SpriteEntity`
  poskládaný, takže se maska ve knihovně skutečně používá.
- **Kotva každého sprajtu je kód, ne data** — trasuje se ze zdrojáku
  disassembly (`tools/lib/asm.js`), vyjde pro 177 ze 188 čísel grafiky a
  u kvádrů a stěn přesně odpovídá siluetě krabice.
- Ověřeno offline: `klsprite verify` (sprajty proti zdrojáku),
  `klrender check all` (3806 krabic ve 128 místnostech má sprajt, nic
  nevyjede z boků obrazovky) a PNG jednotlivých místností.
- **Co zbývá:** obsah panelu (slunce/měsíc, životy, dny, inventář — M5, M8,
  M10) a kotvy grafik, které žádná tabulka objektů nepoužívá; ty se ověří, až
  se na ně narazí.
  Pixel-diff proti originálu, který tu chyběl, nakonec udělal M9 — nad dobovou
  mapou, která je slepenec skutečných obrazovek (`REVIEW-M9.md`).

### M4 — Pohyb a fyzika
`gameWorker.js` + `heroController.js`: chůze čtyřmi izo směry, skok, pád,
gravitace, 3D AABB kolize, stoupání na kvádry, stání na plošině. Konstanty
z disassembly (M1). Snapshot ping-pong worker→model jako v MM/JSW.
*Hotovo, když: postavou lze projít celou místnost, vylézt na kvádry,
seskočit; pocit z ovládání sedí na video originálu.*
*Uzavřeno 2026-09-01:* hotovo — hráč chodí, otáčí se, skáče, padá, leze na
kvádry a klouže podél stěn; všechno odečtené z disassembly
(`NOTES-ORIGINAL.md` kap. 13), žádná konstanta není odhadnutá.

Jak to nakonec vyšlo:
- **Fyzika se nedala vymyslet, jen opsat.** `adj_for_out_of_bounds` nedělá
  sweep ani vytlačování z průniku: vezme celý krok a dokud by skončil uvnitř
  něčeho, zkracuje ho po jednotce. Osy se řeší v pořadí Z, X, Y a testy pozdější
  osy už počítají se zkráceným posunem té dřívější. **Stoupání na kvádry,
  klouzání podél stěn, unášení plošinou i tlačení kvádrů z toho vypadnou samy** —
  není to pět mechanik, je to jedna rutina.
- **Skok je proměnně vysoký.** Držení klávesy zpomalí gravitaci ze −2 na −1,
  dokud hráč stoupá: klepnutí dá 16 jednotek, držení 28. Přeskočit jednu krychli
  jde vždy, dvě jen s drženou klávesou, na tři nedosáhne. Ve vzduchu se nedá
  otočit ani zastavit — domněnka `GAME-DESIGN.md` kap. 5 o „předurčeném skoku"
  platí.
- **Ovládání jsou dvě metody nad týmiž pěti bity**, jako v originálu: rotační
  (klávesnice originálu — otáčení a „vpřed") a směrová (osmisměrný joystick —
  klávesa = světová strana). Směrová je výchozí, `C` je přepíná.
- **Tick je 80 ms**, odvozený ze zpožďovací smyčky originálu (`game_delay`),
  což je i tempo MM a JSW. Originál není svázaný s obrazovým snímkem.
- **Worker je klasický skript, ne modul** — `importScripts` moduly neumí. Aby
  fyzika nebyla opsaná dvakrát, spouštějí offline nástroje přes
  `tools/lib/workerScripts.js` přesně ty soubory, které načítá hra; `klwalk
  worker` navíc rozjede celý `app/gameWorker.js` i s protokolem a hodinami
  a porovná ho snímek po snímku s přímým během.
- Ověřeno offline: `klwalk check all` — 9 procházek po 60 snímcích ve všech 128
  místnostech, **nikde hráč nevyjede z místnosti ani neskončí uvnitř objektu**,
  v 73 místnostech si vyleze na něco nad podlahou.
- **Co zbývá:** hráč se zatím jen pohybuje — nezabíjí ho nic, nic se nehýbe
  a z místnosti se nedá odejít (příznak „je u oblouku" je připravený, plní ho
  M7). V 67 místnostech stojí uprostřed nějaký objekt, takže startovní pozice
  originálu tam není volná; pořádnou vstupní pozici dá až M7.

### M5 — Živá místnost
Pohyblivé plošiny a strážci (dráhy, rychlosti), pasti, tlačitelné kvádry,
cyklus den/noc včetně přeměny postavy a **objektů existujících jen ve dne /
jen v noci**. Smrt a návrat na vstupní pozici.
*Hotovo, když: v jedné místnosti běží den/noc, mění se geometrie i postava,
strážci zabíjejí a hra to korektně přežije.*
*Uzavřeno 2026-09-01:* hotovo, s jednou opravou zadání — **geometrie se
den/noc nemění**, to už vyvrátila kapitola 3 `NOTES-ORIGINAL.md` při M1
(objekty „jen ve dne / jen v noci" v originálu nejsou). Mění se podoba hráče,
a to je celý rozdíl mezi dnem a nocí. Vše ostatní běží: dvacet chování
odečtených z disassembly (`NOTES-ORIGINAL.md` kap. 14).

Jak to nakonec vyšlo:
- **Nešlo přidat „strážce" k hráči — musela vzniknout tabulka.** Originál nemá
  hráče a nepřátele, má `graphic_objs_tbl`: čtyřicet řádků, hráč v prvních dvou,
  a jeden snímek hry je jeden průchod. Až z toho vypadne, že strážce zabije
  hráče, protože jsou to dva řádky jedné tabulky, a že plošina ho unáší, aniž by
  o něm věděla. `app/objectTable.js` je ta tabulka, hráč v ní je řádek 0.
- **Chování se nevybírá podle typu objektu, ale podle čísla grafiky** — a jména
  rutin pro všech 188 grafik jsme si vytrasovali už v M3, takže dispečink je
  datová tabulka (`upd_sprite_jmp_tbl`) a ne `switch`. Klasifikace `collision`
  a `motion` v konvertoru tím pro engine přestala platit; zůstává jako
  dokumentace a slovník editoru. Dvě položky se přitom opravily: kouzlo
  čaroděje **není smrtelné** a `moveable_block` navzdory příznaku strčit nejde.
- **Dráhy nejsou v datech.** Strážce jde na západ, dokud ho něco nezastaví, pak
  na sever, pak na východ; obvod tvoří nábytek místnosti. Plošina honí
  trojúhelníkovou vlnu, kterou popisuje sám čítač snímků, a druhá plošina je
  proti ní v protifázi, protože má lichý index v tabulce. Ani jedno se nedalo
  vymyslet, jen opsat.
- **Spouštěče, smrtelnost i strkání se rozdávají uvnitř kolize** — v téže
  rutině z M4, jen se z ní teď vytahuje seznam toho, do čeho se posun trefil.
  Padající kvádr klesá, dokud na něm někdo stojí, a to je celý jeho kód.
- **Smrt trvá,** není to teleport: hráč se rozpadne na osm jisker, teprve pak
  hra pozná, že je po něm, postaví celou místnost znovu (spadlé kvádry jsou
  zpátky) a on se objeví dalšími osmi jiskrami na vstupní pozici. Hra jimi
  i začíná.
- Ověřeno offline: `klwalk check all` beze změny výsledku (nic nevyjede
  z místnosti, hráč neskončí v objektu) a nový `klwalk life all` — 200 snímků
  bez hráče u kláves ve všech 128 místnostech: **v 59 z nich se něco hýbe,
  v 20 hráč umře, aniž by udělal krok, a každé číslo grafiky, které se v hradu
  vyskytne, má handler.**
- V `data/` je teď dvanáct místností místo jedné — jedna od každého chování,
  ať je co prohlížet (klávesy `[` a `]`). Zbylých 116 zůstává na M9.
- **Co zbývá:** handlery předmětů a kotle jsou prázdné (M8), zvuky nejsou
  (M10), panel ukazuje slunce a měsíc, ale ne dny, životy a inventář (M8, M10).

### M6 — Revize pahýlu
Společná kontrola: věrnost vzhledu, pocit z ovládání, výkon (desktop, telefon,
TV), čitelnost kódu, případný reformát dat, co patří do svision a co do hry.
Rozhodnout pořadí fáze B.
*Hotovo, když: odsouhlasíme závěry a další krok.*
*Podklad hotový 2026-09-01:* `REVIEW-M6.md`. Měřeno offline nad všemi 128
místnostmi vygenerovanými konvertorem, týmiž soubory z `app/`, jaké běží ve
hře. Věrnost, živost i kolize projdou beze změny proti M5; výkon má rezervu
a optimalizace se odkládá s napsaným receptem; kód obstál, formát dat nese
jedno mrtvé pole (`phase`). Dvě čísla, která rozhodují o pořadí fáze B: v repu
je dvanáct místností, takže se čísla M5 nedají zreprodukovat, a hrdina se staví
doprostřed místnosti, což je v 67 ze 128 uvnitř něčeho — z toho 35× smrt a 27×
uvíznutí. Milník zůstává otevřený, dokud nebudou odsouhlasena rozhodnutí A–E.

---

## Fáze B — hra

### M7 — Přechody mezi místnostmi
Exity čtyřmi směry + vertikálně, spawn pozice, přenos stavu (inventář,
cyklus, životy), model mapy hradu (fixní, nebo generovaný — podle výsledku
M1). Několik ručně/konvertorem připravených místností vedle sebe.
*Hotovo, když: lze projít mezi místnostmi tam a zpět a stav se neztrácí.*
*Uzavřeno 2026-09-01:* hotovo — celý hrad je v `data/`, hráč prochází všemi
286 dveřmi tam i zpět, životy a obloha se přes dveře nemění. Vše odečtené
z disassembly (`NOTES-ORIGINAL.md` kap. 15), žádná konstanta není odhadnutá.

Jak to nakonec vyšlo:
- **Jedna oprava zadání: svisle se nechodí.** `screen_move_tbl` má čtyři
  položky a místnost nemá strop. Patra hradu propojuje **výška oblouku**:
  `high_arch_e/s` stojí 48 jednotek nad podlahou, odchází se z nich ve výšce
  a v sousední místnosti tě postaví její vlastní oblouk. Ze 286 dveří má
  **46 na každé straně jinou výšku.**
- **Odcházení není vlastnost hráče, ale oblouku.** `upd_2_4` byl do M6 obrázek;
  je to handler, který si spočítá střed otvoru a řekne hráči „jsi u oblouku".
  Ten příznak vypne stěny místnosti a povolí odchod — a druhým, volnějším testem
  oblouk hráče **narovnává do dveří po jedné jednotce za snímek**. Nejpřívětivější
  věc ve hře a je úplně neviditelná.
- **Odchází se tam, kam je hráč otočený**, ne tam, kde je: strážce, který ho
  vystrčí ze dveří bokem, ho z místnosti nedostane. A odejde se teprve, když je
  za stěnou **celá** krabice; krok, ve kterém se to stane, se nikdy neprovede.
- **Přes dveře jde hráč sám za sebe, nezjevuje se.** Tabulku plní
  `retrieve_screen` od čtvrtého slotu, takže hráčovy dva řádky přechodem projdou
  nedotčené — grafika, tvar, otočení i fáze chůze. Jiskra 120, kterou
  `exit_screen` zapisuje, jde jen do odložené kopie (`plyr_spr_1_scratchpad`),
  a ta je to, **na co a jako co se vrací po smrti**: proto se po smrti objevíš
  jiskrami ve dveřích, kterými jsi přišel, a ne uprostřed místnosti; hra jimi
  i začíná. Tím padá i to, co M6 měřilo jako nehratelnost 62 místností:
  uprostřed místnosti hra začíná jen ve **čtyřech** startovních místnostech
  originálu, a ty čtyři mají volný střed.
- **Přes dveře se nepřenáší nic**, protože se nic nepřenášet nemusí: worker si
  drží hráče, životy, oblohu i čítač snímků a mění se mu jen místnost. Model
  jen dodá JSON, na který si worker řekne; jedna nová zpráva každým směrem.
  Místnosti si aplikace cachuje, takže chození tam a zpět je zdarma.
- Ověřeno offline: `klwalk doors all` — **286 dveří z obou stran, 558 z 568
  průchodů skončilo v místnosti, kterou předepisují data, a nula chyb**;
  7 průchodů je pád do místnosti (zpátky se leze, ne chodí) a 3 končí pod
  padající mříží. `klwalk travel` totéž přes skutečný `app/gameWorker.js`
  a jeho protokol. `klwalk check all` a `life all` dávají na 128 místnostech
  přesně čísla, kterými se uzavíral M5.
- **Co zbývá:** nic; inventář, který se přes dveře nepřenášel, protože ještě
  nebyl, přinesl M8 a přenáší se (je to globální stav, ne stav místnosti).

### M8 — Předměty, kotel, vítězství a prohra
Sbírání a odkládání předmětů, limit inventáře, panel s žádaným předmětem,
Melkhiorova komnata, kotel (a jeho smrtící chování vůči vlkodlakovi),
sekvence žádostí, limit 40 dní a nocí, konec hry, skóre.
*Hotovo, když: hru lze prohrát vypršením času a vyhrát doplněním všech
předmětů.*

*Hotovo 2026-09-01.* Podrobně `NOTES-ORIGINAL.md` kap. 16. Z hradu se stala hra:
32 předmětů leží v hradu (`data/global.json`, nová tabulka mimo místnosti —
který druh kde leží, rozdává až začátek hry), hráč tři z nich unese, položí je
a stoupá na ně, kotel v místnosti 136 si o ně říká v pevné sekvenci 14 žádostí
a bubliny nad ním ukazují, co chce — ve dne. V noci místo nápovědy vyšle
smrtelné kouzlo. Čtyřicátý den hru ukončí; čtrnáctý správný předmět ji vyhraje
a místnost se rozpadne na jiskry, které si pro hrdinu přijdou. Panel ukazuje
den, životy a nesené předměty; skóre a procenta se počítají originálovou
aritmetikou a čekají v snapshotu na obrazovku konce hry (M10).

- **Nové v pravidlech, co plán nečekal:** inventář se **nevybírá** — pokládá se
  vždycky předmět na konci fronty a každý stisk frontu posune, takže jeden
  nesený předmět je nutné třemi stisky prohnat panelem. A položení není
  položení, ale **vystoupení**: předmět jde tam, kde hrdina stojí, a hrdina se
  zvedne o krychli, takže tam, kde nad hlavou není místo, položit nejde.
- **„Limit 40 dní" je potvrzený**, ne odhad: `inc_days` porovnává BCD čítač
  s bajtem 64, což je 0x40, a to je čtyřicet. Jedna hra je 31 360 snímků,
  u nás asi 42 minut.
- **Co zbývá jinde:** obrazovka konce hry a hodnocení jsou M10 (čísla už jsou
  spočítaná), zvuky taky. `klwalk doors all` má nově jednu chybu ze 568 — hráč
  se v místnosti 10 zdrží o předmět a v sousední místnosti narazí na spuštěnou
  mříž; není to fyzika, je to pevný program kláves toho testu.
- **Ověřeno offline:** `klwalk items all` (32 předmětů zvednuto a položeno),
  `klwalk win` (obojí ukončení hry, včetně skóre), `check all`, `life all`,
  `travel`, `klrender check all` beze změny.

### M9 — Konverze všech 128 místností
Dotáhnout konvertor z M1 na celou hru, vygenerovat kompletní `data/`,
projít a ověřit každou místnost proti originálu. Doplnit chybějící typy
objektů, na které se narazí.
*Hotovo, když: celý hrad je v datech a průchod hrou se shoduje s longplay
videem originálu.*
*Uzavřeno 2026-09-01:* hotovo — a **ověření očima se nakonec dalo udělat
strojově**. Podrobně `REVIEW-M9.md`.

Jak to nakonec vyšlo:
- **Snímky originálu po místnostech v repu jsou, jen se o nich nevědělo.**
  `refs/maps/KnightLore_3.png` není kresba, ale slepenec skutečných obrazovek
  originálu v měřítku 1:1 — celý hrad na jednom obrázku. Nový nástroj
  `tools/klmap` proto místnost nakreslí týmiž moduly, jaké běží ve hře,
  najde ji v mapě a spočítá, kolik z toho, co kreslíme my, kreslí i originál.
- **Poloha místnosti v mapě je počitatelná, patro ne.** Jedna místnost na
  východ i na sever posune obrázek o 145 px vpravo a o 72,5 px dolů/nahoru;
  svisle ji ale hrad zvedá po podlažích 48 jednotek, a to se hledá. Místa se
  rozdávají tak, aby v jednom nestály dvě místnosti — jinak si místnost, kterou
  mapa nekreslí, spokojeně sedne na sousedku nad sebou.
- **Výsledek: 127 ze 128 místností nalezeno a 826 z 832 kusů nepohyblivého
  nábytku kreslíme tam, kde ho kreslí originál (99,3 %).** Šest zbylých stojí
  u stěny vysoko nebo uvnitř hromady, kde je v mapě zakrývá sousední místnost.
  Nenašla se jediná místnost, 0x27; na jejím místě kreslí mapa něco jiného
  a nikde jinde se lépe neuchytí.
- **Pohyblivé objekty statická mapa ověřit nemůže** (231 z 314) a ani nemá —
  snímek je zastihl uprostřed dráhy. Zdi a oblouky (1968 z 2341) rozhoduje
  slepenec po svém v místech, kde se místnosti stýkají.
- **Data se ukázala jako přesně to, co dává binárka**: nový `klconv verify`
  převede všech 128 místností i `global.json` znovu a porovná bajt po bajtu —
  nic doupraveného rukou, nic navíc, nic chybějícího.
- **Nové typy objektů si M9 nevyžádal**, jak předpovídal M8: všech 29 typů
  kvádrů a 24 typů pozadí je hotových a každé číslo grafiky v hradu má handler.
- **Vedlejší nález o originálu:** hrad má devět podlaží, výška oblouku ve
  dveřích je jediné, co je nese — a **do jednoho výškopisu se poskládat nedá**,
  protože mřížka se zacykluje a pět dveří se vrátí o patro jinam. Escherovo
  schodiště, hráči neviditelné (`NOTES-ORIGINAL.md` kap. 17).
- **Co zbývá na oči:** místnost 0x27, šest kusů nábytku (vypadají na zákryt,
  ne na chybu) a všechno, co statická mapa neukáže — dráhy, den/noc, panel,
  barvy. Seznam a příkazy jsou v `REVIEW-M9.md` kap. 4.

### M10 — Obal hry
Menu, tape loading obrazovka, hall of fame nad DB, pauza, nastavení
(hlasitost, remapování kláves, gamepad), `about` stránka, dotykové ovládání,
poster/ikony, PWA a service worker, `testFlightPage.php`.
Vše převzaté z JSW — práce je hlavně v obsahu, ne v kódu.
*Hotovo, když: hra vypadá a chová se jako hotový titul z tvé řady.*

### M11 — Editor `/roomEditor`
Editor místností uvnitř aplikace (role v DB, server-side vynucení, oddělený
bundle, který se do produkce nekompiluje). Od té chvíle se opravy dat dělají
v editoru, ne ručně v JSON.
*Hotovo, když: v editoru lze otevřít, upravit a uložit místnost a hra změnu
vidí.*

### M12 — Ladění a vydání
Pixel-porovnání proti originálu po místnostech, výkonový profil na slabých
zařízeních, testflight kolo, `SOURCES.md`/`CREDITS.md`, README, SEO texty,
nasazení.

---

## Rizika (a co s nimi)

- **Depth sorting** — největší riziko, řeší se hned v M2, ne až s obsahem.
  Pojistka: převzít přesně model z Bannalia/disassembly, cykly nechat být.
- ~~**Masky ve sprajtech**~~ — vyřízeno v M3: do svision stačilo přidat
  masku u `SpriteEntity`, zbytek je v datech a v rasterizéru hry.
- **Výkon při plném překreslování scény** — měřit od M2; teprve když čísla
  ukážou problém, dělit statickou a dynamickou vrstvu.
- ~~**Formát dat originálu**~~ — vyřízeno v M1 a M7: mapa je pevná mřížka
  16×16, soused se počítá z ID a exity jsou oblouky ve stěnách.
- **Čitelnost izo skoku na moderní obrazovce** — vyhodnotit na pahýlu (M6),
  případné asistence jen jako volba v nastavení.

## Nápady mimo scope (sbírat, nedělat)

Nové místnosti, vylepšená grafika, barevná verze, QoL asistence, remake
**Alien 8** nad stejnou izo vrstvou, **Underwurlde**. Nic z toho dřív, než
běží věrný Knight Lore.

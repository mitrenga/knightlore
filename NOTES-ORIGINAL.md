# Poznámky z originálu

Zjištění z disassembly (`refs/disasm/jonsole-knightlore/knightlore.asm`,
autor tcdev v1.00rc7). Průběžně doplňovat. Řádky odkazují na tento soubor.

Stav k 2026-09-01 — po M9 (ověření hradu proti dobové mapě).

## 1. Mapa hradu je pevná mřížka 16×16 — otevřená otázka vyřešena

`GAME-DESIGN.md` kap. 2 uvádí jako **(ověřit)**, že se plán hradu mezi hrami
liší. **Neplatí.** Podle disassembly:

- Místnost je identifikována jedním bajtem: `ID = řádek<<4 | sloupec`.
- Přechody (`screen_west` / `screen_east` / `screen_north` / `screen_south`,
  ř. 5605–5700) sousedy **nedohledávají v tabulce, ale počítají z ID**:
  východ `ID+1`, západ `ID−1` (obojí jen v rámci dolního nibblu, tj. řádek
  se nemění a wrapuje se), sever `ID+16`, jih `ID−16`.
- Tabulka `location_tbl` (ř. 354) obsahuje přesně **128 záznamů**, ID bez
  duplicit, rozprostřených po mřížce 16×16.

**Důsledek pro formát dat:** žádný seznam exitů v `roomNNN.json` — soused se
odvodí z ID. Souborů bude 128, pojmenovaných podle ID v hex nebo dec.
Rozložení místností v mřížce (`#` = existuje):

```
#####...########
#.#.#...#....#.#
###.#..##....###
#...#..##......#
#########......#
....#..##.....##
....#..##.######
....#######.....
...#############
...#...##..#...#
...#...##.##...#
...##..#..##...#
...#...#.......#
####..####...###
#.##..####...#.#
####..####...###
```

Reprodukce: `python3 tools/recon/dump-location-table.py`.

## 2. Formát záznamu místnosti (`location_tbl`)

Proměnně dlouhý záznam, prohledávaný lineárně (`find_screen`, ř. 7028),
dekódovaný v `retrieve_screen` (ř. 7023–7245):

```
[0]    ID místnosti
[1]    délka záznamu (počítaná od tohoto bajtu; celý záznam = 1 + délka)
[2]    atributy: bity 0-2 = INK (hodnoty 3-6, BRIGHT vždy zapnutý),
                 bity 3-7 = index do room_size_tbl
[3..]  seznam typů pozadí (indexy do background_type_tbl), zakončený 0xFF
[..]   seznam kvádrů do konce záznamu
```

`room_size_tbl` (ř. 349) má tři varianty: `64×64×128`, `32×64×128`,
`64×32×128`. První dvě čísla jsou **poloměry** místnosti kolem středu 128, tedy
místnost je 128×128 nebo 64×128 nebo 128×64 jednotek. Třetí číslo (vždy 128)
není výška, ale **hladina podlahy** v bajtové ose Z.

Délky záznamů 5–29 bajtů, celá tabulka 2432 bajtů. Parser to projde beze
zbytku, takže formát sedí přesně.

### 2.1 Seznam kvádrů (popředí)

Dvojice bajtů, `next_fg_obj` (ř. 7130):

```
[blok]  bity 3-7 = index do block_type_tbl, bity 0-2 = počet−1 (1 až 8)
[pozice] × počet, každý: bity 0-2 = buňka X, bity 3-5 = buňka Y, bity 6-7 = Z
```

Jeden bajt bloku tedy umístí až osm stejných kvádrů, každý svým bajtem pozice.
Seznam končí vyčerpáním délky záznamu, nemá terminátor.

### 2.2 Definice typu kvádru (`block_type_tbl`, 29 položek)

Tabulka ukazatelů na definici; definice je seznam **částí po 6 bajtech**
zakončený nulou (většina typů má jednu část, strážci dvě):

```
+0 sprajt   +1 poloměr X   +2 poloměr Y   +3 výška
+4 příznaky +5 posuny
```

`posuny`: bit 0 = půlbuňka v X (+8), bit 1 = půlbuňka v Y (+8),
bity 2-7 = posun v Z (jednotky po 4).

Výsledná pozice části (`next_fg_obj_sprite`, ř. 7149):

```
X = buňkaX*16 + půlX*8 + 72
Y = buňkaY*16 + půlY*8 + 72
Z = buňkaZ*12 + (posuny & 0xFC) + room_size_Z
```

X/Y je **střed** objektu, Z jeho **spodek**, poloměry jsou poloviční rozměry.
Krychle je tedy 16×16×12 jednotek a mřížka buněk vychází přesně.

### 2.3 Definice typu pozadí (`background_type_tbl`, 24 položek)

Stejný princip, ale části mají 8 bajtů a **absolutní** souřadnice (pozadí není
vázané na mřížku buněk):

```
+0 sprajt  +1 X  +2 Y  +3 Z  +4 poloměr X  +5 poloměr Y  +6 výška  +7 příznaky
```

Zdi (`wall_size_1..3`) mají v jedné ose poloměr 0 — jsou to roviny, ne kvádry.

### 2.4 Příznaky objektu (bajt +7 v `graphic_objs_tbl`)

```
7 = vertikální překlopení   6 = horizontální překlopení   5 = wipe
4 = kreslit                 3 = auto-posun u oblouku (jen hráč)
2 = pohyblivý (tlačitelný)  1 = ignorovat ve 3D výpočtech
0 = je u oblouku (jen hráč)
```

Bit 1 (`ignorovat ve 3D`) označuje **čistě dekorační** části — horní půlka
strážce, jiskra nad kotlem, hlava čaroděje.

### 2.5 Exity nejsou v datech

Originál žádný seznam exitů nemá. Otvor ve stěně **je** položka seznamu pozadí
(`arch_n/e/s/w`, `tree_arch_*`, `gate_*`, `high_arch_e/s`) a soused se dopočítá
z ID (kap. 1). Kontrola dekódování: pokud se z 128 místností vygenerují exity
podle typů pozadí, vyjde **souvislý graf bez slepých odkazů a všechny přechody
jsou obousměrné** — což sedí přesně a je nejsilnější důkaz, že je formát
přečtený správně.

### 2.6 Sbíratelné předměty (`special_objs_tbl`)

Samostatná tabulka mimo místnosti: **32 záznamů po 9 bajtech**
(`sprajt, X, Y, Z, místnost` + 4 bajty aktuálního stavu za běhu). Předmět tedy
nepatří do dat místnosti, ale do globální tabulky — místnost si své předměty
najde podle ID (`find_special_objs_here`, ř. 1439).

## 3. Den a noc nemění geometrii místnosti — otevřená otázka vyřešena

`GAME-DESIGN.md` kap. 2 a 6 počítaly s objekty, které existují **jen ve dne /
jen v noci** (`phase` v datech). **V originálu nic takového není.**
`sun_moon_scratchpad` má v celé hře jen šest použití (ř. 2097, 4357, 4411,
4442, 6753, 6877) a všechna se týkají panelu se sluncem/měsícem a **podoby
hráče** — `retrieve_screen` ani aktualizace objektů se na cyklus nikdy neptají.

Geometrie místnosti je tedy statická; hru mění pouze to, že vlkodlak má jiný
sprajt a jinou fyziku, a že do kotle smí jen člověk. (Jiné *rozměry* nemá —
krabice hráče je v obou podobách stejná, viz kap. 12.4.) Pole `phase`
ve formátu ponecháváme (vždy `always`) — nic nestojí a nechává dveře otevřené
pro editor.

## 4. Předměty a kotel

- `objects_required` (ř. 4244): `0,1,2,3,4,5,6,3,5,0,6,1,2,4` — **14 položek
  ze 7 typů předmětů**, sada je **pevná**.
- `shuffle_objects_required` (ř. 2712): sekvence se jen **rotuje o 4–7 pozic**
  podle `seed_1`, neprohazuje se. Odpověď na otázku „je výběr náhodný" z
  `GAME-DESIGN.md`: náhodný je pouze začátek pevného cyklu.
- `objects_carried` (ř. 101): 7 bajtů — ověřit, kolik z toho je skutečný
  limit inventáře a kolik režie.
- Startovní místnost je náhodná ze čtyř (`start_locations`, ř. 1593):
  `0x2F, 0x44, 0xB3, 0x8F`. Hráč začíná uprostřed místnosti na podlaze
  (`plyr_spr_init_data`, ř. 6785: X=128, Y=128, Z=128).

## 5. Paměťová mapa originálu (hlavička asm)

```
$4000-$57FF  video RAM        $5800-$5AFF  atributy      $5B9F  zásobník
$5BA0-$6107  proměnné         $6108-$D8F2  kód a data
$D8F3-$F0F2  video buffer     $F100-$FFFF  lookup tabulky (za běhu)
```

Vykreslování: sprajt + maska přes AND/OR, posun o libovolný počet pixelů
rotací bitů, horizontální překlopení přes lookup tabulku, kreslení do
off-screen bufferu po osmipixelových sloupcích a blit jen změněných sloupců
(`blit_to_screen`, ř. 7613). Pro M3 (masky ve svision) a pro úvahu o
výkonu v M2 to je přímá předloha.

Chování objektu se **nevybírá podle typu kvádru, ale podle čísla sprajtu** —
`upd_sprite_jmp_tbl` (ř. 2131) je indexovaná `graphic_no`. Naše klasifikace
(`collision`, `motion` v konvertoru) je odvozená z názvů v `block_type_tbl`
a je potřeba ji ověřit proti chování originálu v M4/M5.

## 6. Náš formát a konvertor

Konvertor: `node tools/klconv/klconv.js list | dump <id> | emit <id|all> | info`.
Čte snapshot `refs/original/knightlore-jonsole-build.sna` a symboly
`refs/disasm/jonsole-knightlore/knightlore.sld` — adresy tabulek se tedy
neopisují ručně, berou se z buildu disassembly. Délky tabulek ukazatelů se
dopočítají z toho, kde začíná první cíl (a proti očekávaným počtům se kontrolují),
takže případná záměna verze binárky spadne hned na chybu, ne na tichý nesmysl.

`app/roomData.js` je sdílený modul pro čtení a validaci — bez závislostí, běží
v prohlížeči i v Node. Konvertor jím **povinně** validuje každou místnost před
zápisem, takže hra i editor čtou přesně to, co modul umí přijmout.

### Souřadnice

Jednotky originálu zůstávají: **1 krychle = 16×16×12 jednotek**. Počátek se ale
přesouvá do **jihozápadního rohu podlahy** místnosti (odečte se
`128−room_size_X`, `128−room_size_Y`, `room_size_Z`), a objekt se ukládá jako
`x,y,z` = roh kvádru + `sx,sy,sz` = rozměry (místo střed + poloměry). Kvádry
tak leží přesně na násobcích 16 a 12 a formát je čitelný i ručně.

### `data/roomNNN.json`

```
format, id, grid{column,row}
attribute{ink,paper,bright}
cube{x,y,z}          rozměr krychle v jednotkách (16,16,12)
bounds{x,y,z}        rozměr místnosti v jednotkách
exits{north,east,south,west}   ID sousední místnosti nebo false
objects[]  {type, typeIndex, source: "background"|"block", sprite,
            collision, motion, phase, x,y,z, sx,sy,sz,
            flags?, cell?, extras?[]}
items[]    {index, x,y,z}      odkaz do globální tabulky předmětů
origin{}   provenience: index velikosti, názvy pozadí
```

Odchylky od `GAME-DESIGN.md` kap. 6 (a proč):

- **žádné `exits` se spawn pozicemi** — soused se počítá z ID; v `exits` je
  jen dopočítané ID, aby data byla čitelná a validátor mohla zkontrolovat.
  Vstupní pozice originál nemá, hráč vstupuje protilehlou stěnou.
- **žádné samostatné `movers[]`** — pohyb je vlastnost typu objektu
  (`motion`), stejně jako v originálu; jedno pole `objects[]` odpovídá tomu,
  jak engine scénu skládá (pozadí i kvádry jdou do jednoho display listu).
- **`items[]` jen odkazuje** do globální tabulky 32 předmětů, protože tak je
  to v originálu; seznam předmětů patří do `data/global.json` (M8).
- `phase` je zatím vždy `always`, viz kap. 3.

### Stav dat

V repu je zatím jen `data/room000.json` (M1). Konvertor už `emit all` zvládá
a všech 128 místností projde validací i kontrolou grafu exitů — ale
místnost po místnosti se proti originálu ověřuje až v M9.

## 7. Projekce (odečteno v M2)

`calc_pixel_XY` (ř. 7700) je celá projekce Filmationu, tři sčítání a jeden posun:

```
pixelX = X + Y - 128 + pixel_x_adj
pixelY = ((Y - X + 128) >> 1) + Z - 104 + pixel_y_adj
```

Vodorovná osa obrazovky je **součet** obou půdorysných os, hloubková je jejich
**rozdíl** — je to tedy zrcadlově otočená varianta vzorce v `GAME-DESIGN.md`
kap. 3, ne jiná projekce. `pixel_?_adj` je kotva sprajtu, ne vlastnost scény.

**`pixelY` se počítá odspodu obrazovky.** Není to překlep v disassembly:
`screen_calc_addr_de` (ř. 8008) dělá na Y `cpl`, takže adresa vzniká pro
`255-pixelY`, a při základu `0x38` místo `0x40` z toho vychází
`řádek = 191 - pixelY`. Proto se `Z` v `pixelY` **přičítá** (výš ve světě =
níž v `pixelY` = výš na obrazovce) a proto `pixelY` označuje **spodek**
sprajtu, který se kreslí nahoru — kontrola „nevyšlo to ze spodku obrazovky"
je ve skutečnosti kontrola horního okraje.

Po převodu do našich souřadnic (počátek v jihozápadním rohu podlahy, `z`
nahoru, řádky shora) zbude z celé projekce:

```
screenX = x + y + (128 - poloměrX - poloměrY)
screenY = 167 - z - ((y - x + poloměrX - poloměrY + 128) >> 1)
```

Konstanta 167 je `191 - (128 - 104)` a **nezávisí na velikosti místnosti** —
podlaha každé místnosti leží na týchž řádcích. U místnosti 128×128 je levý roh
podlahy na `(0, 103)`, přední (spodní) roh na `(128, 167)`, zadní na
`(128, 39)`. Pozorovatel stojí ve směru **většího x, menšího y a většího z**.

Originál počítá v bajtech a u stěn (`x = -1`) mu součet přeteče; my počítáme
přesně, protože v tom místě je přetečení chyba, ne vlastnost.

## 8. Pořadí kreslení (odečteno v M2)

`calc_display_order_and_render` (ř. 6300) nesortuje. Pro dvojici objektů
spočítá na každé ose trojhodnotový kód (0 = objekt 1 je celý na jedné straně,
1 = intervaly se překrývají, 2 = objekt 2 je celý na jedné straně; dotek se
počítá jako oddělení), složí je do indexu `9*x + 3*y + z` a v **27položkové
skokové tabulce** (`off_CF69`) najde odpověď. Sedm indexů —
3, 4, 6, 7, 12, 15, 16 — znamená „objekt 2 se musí nakreslit dřív"; index 13
(překryv ve všech třech osách) je `objs_coincide` a pořadí neurčuje, jen mění
sebraný předmět na jiskřičku.

Průchod je hloubkové sestupování: vezmi první nenakreslený objekt, sestup na
první objekt, který musí být dřív, a opakuj; když už nic nezbývá, nakresli ho
a začni od začátku. Navštívené objekty drží `render_list` — potkat je znovu
znamená **cyklus**, a ten se rozsekne tím, že se objekt nakreslí hned.
`render_list` je tedy zásobník hloubkového průchodu a Ultimate cykly opravdu
neřešilo dělením objektů, jak předpokládá `GAME-DESIGN.md` kap. 4.

Naše `app/depthSort.js` má tabulku i průchod položku po položce stejné.

## 9. Rozvržení obrazovky (odečteno v M2, doplněno v M3)

Rámeček i panel jsou sprajty; v M3 se obojí odečetlo z dat (`border_data`,
`panel_data`) a kreslí se — a přitom se ukázalo, že **rámeček do hry vůbec
nepatří**. `print_border` volá jenom `display_text_list` (ř. 1717) a obrazovka
game over (ř. 1284), tedy menu a textové obrazovky; ve smyčce hry se volá pouze
`display_panel` (ř. 2096). Ve hře je kolem místnosti jen panel, nic víc, a
proto smí zadní stěna nízké místnosti klidně dosáhnout horního okraje obrazovky
(kap. 12.5).

Souřadnice (řádky shora, 0-191):

| co | kde | zdroj |
|---|---|---|
| rohy rámečku | 4× 32×32 v rozích obrazovky | `border_data` (ř. 339) |
| vodorovné lišty | x 32-224, řádky 0-23 a 168-191 | `print_border` (ř. 1653) |
| svislé lišty | x 0 a 248, řádky 31-159 | `print_border` |
| panel slunce/měsíce | znakové řádky 20-23, sloupce 22-29 | `colour_panel` (ř. 6858) |
| počítadlo dní | znakový řádek 23, sloupce 15-16 | `print_days` (ř. 3513) |
| životy | znakové řádky 18-19, sloupce 2-5 | `print_lives_gfx` (ř. 3527) |

Okno místnosti je tedy zhruba `x 8-247`, řádky `24-167`, a spodní roh podlahy
(řádek 167) sedí přesně na horní hraně spodní lišty rámečku — ta ale při hře
není vidět, viz výše.

Panel se skládá ze šesti kusů (`panel_data`): dva svislé pilíře 16×64 na
`x 0` a `x 240` od řádku 128 dolů, dvě pětice sprajtů 16×8 stoupající po
diagonále (krok +16 v x, ∓8 v y) a dva kusy 16×16 na `x 96` a `x 144`. Co panel
*ukazuje* — slunce/měsíc, životy, počítadlo dní, nesené předměty — je stav a
patří do M5, M8 a M10.

Změřeno na všech 128 místnostech (`klrender check all`): nic nevyjede z boků
obrazovky, kreslí se v rozsahu `x 0-255`, řádky `-29` až `159`.

## 10. Drobnosti potvrzené při M2

- **Limit inventáře jsou 3 předměty** (`display_objects`, ř. 3784: `ld b, 3`
  „3 objects max"). Otázka z `GAME-DESIGN.md` kap. 2 je tím zodpovězená;
  `objects_carried` má 7 bajtů, zbytek je režie.
- Největší místnost má **36 kvádrů** v display listu (128 místností, měřeno
  konvertorem), takže obavy o výkon řazení jsou zatím bezpředmětné.

## 11. Kam se dívat dál (mapa disassembly)

| Téma | Symbol / řádek |
|---|---|
| dekodér místnosti | `retrieve_screen` / `find_screen` (7023) |
| typy pozadí (oblouky, stěny) | `background_type_tbl` (946) |
| typy kvádrů | `block_type_tbl` (878) |
| speciální objekty | `special_objs_tbl` (1126), `find_special_objs_here` (1439) |
| tabulka sprajtů | `sprite_tbl` (8303) |
| chování objektu podle sprajtu | `upd_sprite_jmp_tbl` (2131) |
| strážci | `guard_NSEW_tbl` (3458), `set_guard_wizard_sprite` (3063) |
| kotel | `add_obj_to_cauldron` (4211), `centre_of_room` (4203) |
| sbírání/odkládání | `pickup_object` (4048), `drop_object` (4020) |
| počítadlo dní | `inc_days` (4415), `print_days` (3513) |
| přechody místností | `handle_exit_screen` (5567) |
| náhodná startovní místnost | `start_locations` (1593) |
| projekce | `calc_pixel_XY` (7700) |
| pořadí kreslení | `calc_display_order_and_render` (6300) |
| rámeček a panel | `print_border` (1653), `display_panel` (6826) |
| sprajty a maska | `sprite_tbl` (8303), `print_sprite` (7757) |
| kotva sprajtu | `set_pixel_adj` (4962), `upd_*` handlery |
| překlopení sprajtu | `flip_sprite_data` (8067) |
| podoba hráče | `get_sprite_dir`, `upd_player_top` (6183) |
| snímek hráče | `upd_player_bottom` (5140) |
| vstup | `check_user_input` (6539), `keyboard` (6663) |
| otáčení a chůze | `handle_left_right` (5217), `handle_forward` (5366) |
| skok a gravitace | `handle_jump` (5343), `move_player` (5412) |
| kolize a meze místnosti | `adj_for_out_of_bounds` (5706) |
| tempo hry | `game_delay` (2076) |

## 12. Sprajty a maska (odečteno v M3)

`sprite_tbl` (ř. 8303) má **188 položek** — index je „číslo grafiky"
(`graphic_no`), tedy totéž číslo, kterým se indexuje `upd_sprite_jmp_tbl`.
Ukazují na **103 různých sprajtů** (+ `spr_nul`) o celkem **15 574 bajtech**.
Jedno číslo grafiky = jeden obrázek *a* jedno chování; proto v datech místnosti
stačí u objektu `sprite`.

### 12.1 Formát

Hlavičku popisuje sama disassembly (ř. 8323) a parser jí věří:

```
+0  šířka: bity 0-3 = bajtů na řádek, bity 6-7 = aktuální stav překlopení
+1  výška v řádcích
+2  [řádek 0..výška] [bajt 0..šířka] { +0 maska, +1 obrázek }
```

- **První řádek dat je spodní.** Kreslí se do lineárního bufferu (`vidbuf`,
  32 bajtů na řádek) a po řádku se adresa **zvětšuje**, přičemž `vidbuf` je
  indexovaný `pixelY` odspodu obrazovky (kap. 7). Kontrola: sprajt kvádru
  (`spr_020`, 32×28) má nejširší řádek osm řádků nad spodkem, což je přesně
  místo, kde má silueta krychle 16×16×12 levý a pravý vrchol.
- **Maska maže, obrázek kreslí**: `print_sprite` (ř. 7757) skládá
  `(obrazovka & ~maska) | obrázek`. Maska přesahuje obrázek o jeden pixel na
  každé straně — sprajt si sám vymaže čistý obrys proti pozadí. Tohle jediné
  dělá zákryt; žádný z-buffer ani clipping ve hře není.
- Šířka je nejvýš 5 bajtů (40 px), výška nejvýš 64 řádků.

### 12.2 Překlopení

`flip_sprite_data` (ř. 8067) překlápí data **na místě** a stav si pamatuje
v bitech 6-7 bajtu šířky (bit 6 = vodorovně, bit 7 = svisle, tedy stejné bity
jako v příznacích objektu). Svislé překlopení vyměňuje celé řádky, vodorovné
obrací pořadí bajtů v řádku i bity v nich, a dvojici (maska, obrázek) přitom
nechává pohromadě — zrcadlí se tedy celá šířka sprajtu včetně prázdné výplně.

Důsledek pro extrakci: snapshot je běžící stroj, takže sprajt, který se
naposledy kreslil překlopený, má překlopená data. Konvertor to podle bitů
šířky vrátí zpět. Kontrola: `klsprite verify` srovná všech 103 sprajtů
**bajt po bajtu proti `DB` blokům zdrojáku disassembly** — dva nezávislé
opisy téhož. Jeden sprajt (`spr_014`, roh rámečku) je překlopený v každém
z nich, a v každém jinak; po znormalizování se shodují do posledního bajtu.

### 12.3 Kotva sprajtu

`calc_pixel_XY` počítá pozici **referenčního bodu** objektu (střed podstavy
dole, kap. 7) a k ní přičítá `pixel_x_adj`/`pixel_y_adj` — kotvu, která ukáže
na **levý spodní pixel sprajtu**. Kotva není v datech: každé číslo grafiky ji
dostane od svého `upd_*` handleru, který zavolá `set_pixel_adj` (ř. 4962)
s konstantou v `HL`. Platí **x = dolní bajt `HL`, y = horní bajt** (komentáře
v disassembly je u některých handlerů uvádějí v opačném pořadí, ověřeno
výpočtem níže).

Kotvy se proto netahají z binárky, ale **trasují ze zdrojáku** disassembly
(`tools/lib/asm.js`): vyhodnocuje se jen `ld hl,nn`, `ld a,(ix+0)` + `cp n`
(o které grafiku ze skupiny jde) a `bit 6/7,(ix+7)` (překlopení) — na nic
jiného handlery na cestě ke kotvě nevětví. Vyjde kotva pro **177 ze 188**
čísel grafiky; zbytek jsou nulové sprajty, `no_update` (rámeček a panel se
kreslí přímo na pixelovou pozici, kotva je nula) a `upd_111`, který
disassembly označuje jako neplatný — objekt hned nastaví na nulový sprajt,
takže se nikdy nenakreslí.

Kontrola: u kvádru je kotva `(-16,-8)`, u stěnové rovina `(-8,-4)` — v obou
případech přesně levý spodní vrchol siluety krabice, tedy
`(-(rX+rY), -(rX+rY)/2)`. `klsprite anchors` postaví všech 52 měřitelných
kotev proti tomuhle odhadu: **14 se shoduje na pixel** (kvádry, skály, stěny,
pohyblivé plošiny), zbytek jsou grafiky, jejichž obrázek prostě není ta
krabice — oblouky, postavy, ozdobné části, které visí nad vlastní pozicí
(horní půlka strážce `+3`, vrchní část kotle `+12`).

V našich souřadnicích (kap. 7) z toho je:

```
bod    = projekce(x + sx/2, y + sy/2, z)
levý   = bod.x + kotva.x
spodní = bod.y - kotva.y
horní  = spodní - výška + 1
```

### 12.4 Podoba hráče

Hráč je v `graphic_objs_tbl` **dva objekty**: nohy a horní půlka
(`plyr_spr_init_data`, `upd_player_top`, ř. 6183). Horní půlka si každý snímek
opíše pozici nohou, sedí o 12 jednotek výš, má nulovou výšku a příznak
„ignorovat ve 3D" — je to jen obrázek. Její číslo grafiky je vždy číslo nohou
`+16`.

Číslo grafiky nohou nese i směr a fázi chůze (`get_sprite_dir`):

```
směr = (graphic_no >> 3 & 1) | (hflip ? 2 : 0)     0=W, 1=E, 2=N, 3=S
fáze = graphic_no & 7                              0-5 chůze, 6-7 rozhlížení
                                                   (jen horní půlka)
člověk = 16 + skupina*8 + fáze     vlkodlak = totéž ^ 0x20 (tj. 48 + ...)
```

Čtyři izo směry jsou tedy **dva sprajty a jejich zrcadlení**. Krabice hráče je
10×10×23 (`plyr_spr_init_data`: poloměry 5, výška 23) a přeměna na vlkodlaka ji
**nemění** — `chk_and_init_transform` přepíše jen číslo grafiky a kotvu (o řádek
níž, `adj_m7_m12`). `GAME-DESIGN.md` kap. 2 předpokládala u vlkodlaka jiné
rozměry; neplatí to.

### 12.5 Clipping a vynechání

`print_sprite` umí sprajt **uříznout jen u horního okraje** obrazovky (zkrátí
`height_lines`), a `calc_pixel_XY` objekt **vynechá celý**, když jeho kotvený
řádek nevyjde do obrazovky (`cp 192`, tedy v naší orientaci: spodní řádek
sprajtu je nad horním okrajem nebo pod dolním). Vodorovně se nekontroluje nic —
sprajt za pravým okrajem by se v bufferu přelil do dalšího řádku.

Na všech 128 místnostech (`klrender check all`, 3806 krabic): **314 sprajtů**
přesahuje horní okraj a řeže se, **2 se vynechávají** — obě jsou
`spike_ball_high_fall` na `z = 84` (místnosti 79 a 249), tedy trnité koule,
které čekají nad obrazovkou, než spadnou do místnosti. Vodorovně nevyjede nic,
takže formát dat i počátek souřadnic místnosti sedí.

### 12.6 Co z toho je v repu

- `data/sprites.json` — bajty sprajtů tak, jak jsou v originále (hex, dvojice
  maska/obrázek, spodní řádek první), kotvy pro každé číslo grafiky včetně
  variant pro překlopení, a rozmístění rámečku a panelu.
- `app/spriteSheet.js` — čtení a validace, dekódování do mřížky tří stavů
  (průhledno / maska / inkoust), kotvy, pozice na obrazovce. Bez závislostí,
  takže z něj čte hra, editor i offline nástroje.
- `tools/klsprite/klsprite.js` — extrakce, `show` (sprajt jako text), `anchors`,
  `verify`.
- Ve svision přibyla **maska u `SpriteEntity`** (`maskChar`, `maskColor`):
  pixel masky se kreslí barvou papíru, takže sprajt zakryje, co je pod ním.
  Nic víc knihovna kvůli maskám potřebovat nemusela.

## 13. Pohyb a fyzika (odečteno v M4)

Celý hráč je v `upd_player_bottom` (ř. 5140) a v deseti rutinách, které volá.
Nic z toho není složité — složité je pořadí, ve kterém se to děje, protože právě
z něj vychází „pocit" originálu.

### 13.1 Záznam objektu, pokud jde o pohyb

`graphic_objs_tbl` má položky po 32 bajtech; pro fyziku z nich hrají roli:

```
+1,2,3   X, Y, Z        X a Y je střed, Z spodek
+4,5,6   poloměrX, poloměrY, výška
+9,10,11 dX, dY, dZ     dX a dY žijí jeden snímek, dZ je rychlost pádu
+12      0 = X zaraženo  1 = Y zaraženo  2 = Z zaraženo
         3 = skáče       4-7 = počítadlo vstupu do místnosti
+13      0-2 prodleva otočení, 6 = zničen, 7 = smrtící
+14,15   dX_adjust, dY_adjust — co do objektu někdo strčil
```

Bit 2 bajtu +12 („Z zaraženo") je jediná odpověď, kterou originál na otázku
*stojí na něčem?* má: znamená, že poslední svislý posun se musel zkrátit.

### 13.2 Vstup jsou vždycky tytéž čtyři bity

`check_user_input` (ř. 6539) skládá z klávesnice i ze všech tří joysticků
jedno slovo:

```
0 = vlevo   1 = vpravo   2 = vpřed   3 = skok   4 = vzít/položit
```

Metody ovládání (`user_input_method`) se neliší tím, co čtou, ale jak to čtou:

- **rotační** (klávesnice originálu, dvoutlačítkové joysticky) — vlevo a vpravo
  otáčejí o čtvrtinu, „vpřed" jde kupředu,
- **směrová** (osmisměrný joystick, `bit 3`) — `handle_left_right` čte tytéž
  bity jako světové strany. **Bit „vpřed" je zároveň „nahoru" (sever) a bit
  „vzít/položit" je zároveň „dolů" (jih)** — v originálu to není zkratka,
  vychází to z toho, jak `kempston` mapuje páku. Proto tlačítko severu při
  otáčení *zároveň jde dopředu*, kdežto tlačítko východu otočí na místě.

Otočení stojí čas: v rotační metodě běží v bajtu +13 prodleva `or 2`, tedy
čtvrtina otáčky každý třetí snímek; ve směrové metodě je otáčka za snímek, ale
jen když hráč stojí na zemi (`bit 2, (ix+12)`).

### 13.3 Snímek hráče

```
chk_and_init_transform   den/noc (M5)
check_user_input         čtyři bity výše
handle_pickup_drop       předměty (M8)
handle_left_right        otočení
handle_jump              start skoku
handle_forward           animace nohou
chk_plyr_OOB             mimo místnost = dZ se ořízne na ≤ 0
move_player              posun, gravitace, kolize, zápis
```

Pořadí není libovolné: otočení a chůze nejsou tentýž snímek, takže otáčka
o čtvrtinu stojí krok, a skok si nese směr toho snímku, ve kterém začal.

### 13.4 Rychlost, skok, gravitace

- **Chůze 3 jednotky za snímek** (`off_CA32`: W je `dX -= 3`, E `+3`, N
  `dY += 3`, S `-3`). Krychle je 16 jednotek, místnost 128 — přejít místnost
  trvá 43 snímků.
- **Skok začíná `dZ = 8`** (`handle_jump`) a smí začít i v prvním snímku pádu
  (`dZ ≥ -1`), ne však ve dveřích ani při vstupu do místnosti.
- **Gravitace je −2 za snímek, ale jen −1, dokud hráč stoupá a drží skok.**
  Výška skoku je tedy proměnná: klepnutí dá 7+5+3+1 = **16 jednotek**, držení
  7+6+5+4+3+2+1+0 = **28 jednotek**. Nejnižší skok tedy přeskočí jednu krychli
  (12), nejvyšší dvě (24) a na tři (36) nedosáhne ani ten nejvyšší.
- **Ve vzduchu se nedá otočit ani zastavit.** `move_player` volá `calc_plyr_dXY`
  vždycky, když je nastavený příznak skoku — hráč tedy letí dál směrem, kterým
  se odrazil, i když pustí „vpřed", a skok z místa ho posune dopředu. Domněnka
  z `GAME-DESIGN.md` kap. 5, že je skok „z velké části předurčený", platí.
- Pád nemá žádnou mezní rychlost; `dZ` klesá, dokud se o něco nezarazí.
- Animace nohou má šest fází (0–5) a při stání dojde do nejbližší z fází
  **2 nebo 4** (`loc_C994`) — hráč nikdy nezůstane stát rozkročený.

### 13.5 Kolize: zkrátit krok, ne vytlačit

`adj_for_out_of_bounds` (ř. 5706) je celá fyzika. Nedělá sweep a nikdy nikoho
nevytlačuje z průniku — vezme celý krok, a dokud by skončil uvnitř něčeho,
**zkrátí ho o jednotku** (`adj_d_for_out_of_bounds`) a zkusí to znovu.

Osy se řeší **jedna po druhé, v pořadí Z, X, Y**, a testy pozdější osy už
počítají se zkráceným posunem té dřívější, kdežto osy, na které ještě nedošlo,
jsou nulové:

```
Z se řeší s dX = 0, dY = 0
X se řeší s výsledným dZ, ale dY = 0
Y se řeší s výsledným dZ i dX
```

Test průniku (`do_objs_intersect_on_x` a spol.) je
`|střed1 − střed2| < poloměr1 + poloměr2`, u osy Z `|z1 − z2| < výška nižšího`.
**Dotek se počítá jako oddělení** — bez toho by se na kvádru nedalo stát.

Z toho vychází chování, které by se jinak muselo vymýšlet:

- **stoupání na kvádry** — svislý posun se zarazí o vršek kvádru dřív, než se
  řeší vodorovný, takže hráč, který doskočí nad kvádr, na něj v témž snímku
  dojde,
- **klouzání podél stěny** — zaražená osa nezastaví tu druhou,
- **unášení plošinou** — při zarážce v ose Z si hráč (má příznak „pohyblivý")
  opíše `dX`/`dY` objektu pod sebou, a to ještě dřív, než se osa X řeší,
- **tlačení kvádrů** — při zarážce v ose X nebo Y dostane „pohyblivý" objekt
  hráčovo `dX`/`dY` a v příštím snímku se posune sám,
- **spouštěče** — objekt, o který se hráč zarazil shora, dostane `bit 3, (iy+13)`;
  odsud padají a hroutí se kvádry (M5).

Meze místnosti jsou v téže rutině: v X a Y musí krabice skončit **celá uvnitř**,
v Z se hlídá jen podlaha (strop žádný není — proto smí trnitá koule čekat nad
obrazovkou, kap. 12.5). Obojí se vypíná příznakem „je u oblouku", a tím se
z místnosti odchází (M7).

### 13.6 Rytmus hry

Originál není svázaný s obrazovým snímkem — nikde není `halt`. Po vykreslení
spálí `6 − rendered_objs_cnt` kol zpožďovací smyčky (`game_delay`, ř. 2076),
každé 1280 iterací po 26 T, tedy asi 9,5 ms: čím míň se překreslovalo, tím dýl
se čeká, takže tempo zůstává stejné, ať je na obrazovce cokoli. Ten rozpočet —
šest objektů kreslení plus pevná režie průchodu tabulkou a panelu — vychází na
zhruba dvanáct snímků za vteřinu, což je i **80 ms**, se kterými běží MM a JSW.
To je náš tick.

### 13.7 Co z toho je v repu

- `app/physics.js` — `adj_for_out_of_bounds` a testy průniku, nic víc.
- `app/heroController.js` — snímek hráče z kap. 13.3, obě metody ovládání.
- `app/gameWorker.js` — hodiny a snapshot ping-pong do modelu; místnost dostane
  jako rozměr a plochý seznam krabic, o datech ani sprajtech neví.
- Všechny tři jsou **klasické skripty**, ne moduly: klasický worker `import`
  neumí. Offline nástroje je proto nespouštějí v kopii, ale přes
  `tools/lib/workerScripts.js` pouštějí přesně ty soubory, které načítá hra.
- `tools/klwalk/klwalk.js` — `walk` (program kláves, výpis po snímcích, PNG přes
  klrender), `check` (dva invarianty ve všech 128 místnostech), `worker`
  (tentýž program skrz `app/gameWorker.js` a porovnání snímek po snímku).

Změřeno na všech 128 místnostech (`klwalk check all`, 9 procházek po 60 snímcích
v každé): **nikde hráč nevyjde z místnosti ani neskončí uvnitř objektu**, v 73
místnostech si vyleze na něco nad podlahou (nejvýš z = 76 v místnosti 52) a v 67
místnostech stojí uprostřed místnosti nějaký objekt, takže tam startovní pozice
originálu (`plyr_spr_init_data`: střed) není volná — do místnosti se vchází
obloukem, ne se do ní padá, a pořádnou vstupní pozici dostane hráč až v M7.

## 14. Živá místnost (odečteno v M5)

Místnost není hráč a kulisa. Je to **jedna tabulka**, `graphic_objs_tbl`:
čtyřicet slotů po 32 bajtech, v prvním nohy hráče, ve druhém jeho horní půlka,
za nimi pozadí, kvádry a sbíratelné předměty. Jeden snímek hry je jeden průchod
tou tabulkou (`onscreen_loop`, ř. 2001) a nic víc.

### 14.1 Chování se vybírá podle čísla grafiky, ne podle typu

`upd_sprite_jmp_tbl` (ř. 2131) je indexovaná bajtem +0, tedy **číslem sprajtu**.
Typ kvádru z dat v té chvíli už nikdo nezná — po `retrieve_screen` po něm
nezbude stopa. Z toho plyne všechno ostatní:

- kvádr, který se rozpadl, má jiné číslo grafiky, a tím i jiný handler,
- strážce jdoucí na západ a na východ jsou dvě čísla a jeden handler,
- **hráč je prostě řádek, jehož číslo grafiky je zrovna jedno z jeho** — a když
  umře, je to řádek s jiskrami, který se aktualizuje stejným průchodem.

Naše `data/sprites.json` už od M3 nese u každé ze 188 grafik jméno rutiny
vytrasované ze zdrojáku, takže dispečink je datová tabulka a ne `switch`;
`app/objectMotion.js` je pod těmi jmény poskládaný. Klasifikace `collision`
a `motion` v konvertoru tím přestala být pro engine závazná — je to
dokumentace a slovník editoru (M11).

### 14.2 Většina handlerů je jedna instrukce

Ze 40 rutin jich přes polovinu tvoří jediné nastavení pixelového posunu sprajtu
— zdi, oblouky, obyčejné kvádry. Ty posuny jsou u nás data (M3), takže z nich
vyjde `ObjectMotion.still`. Skutečného chování je dvacet kousků a žádný není
delší než obrazovka.

### 14.3 Gravitace objektů je −1, hráčova −2

`dec_dZ_and_update_XYZ` (ř. 4930) sníží `dZ` o jedničku, zavolá kolizi a
posun zapíše. Objekt, který padat nemá, si proto **předvyplní `dZ = 1`**, aby
z toho vyšla nula (`upd_54`, `upd_86_87`). Hráč sem nechodí, gravitaci si
počítá `move_player` sám (−2, nebo −1 při stoupání s drženým skokem).

### 14.4 Smrtelnost jsou dva bity a šíří se v kolizi

Bajt +13: bit 7 = „zabiju to, do čeho narazím", bit 5 = „zabiju to, co narazí
do mě", bit 6 = „jsem zabitý". Rozdávají se **uvnitř `adj_for_out_of_bounds`**,
v každé ose, tomu objektu, s nímž se posun protnul. Hazardy si oba bity nastavují
každý snímek znovu (`set_both_deadly_flags`), protože je nikdo nemaže a po
přestavbě místnosti musí být zpátky.

Ve stejném místě se dějí i dvě další věci, které by se jinak musely vymýšlet:
objekt, o který se někdo zarazil **shora nebo zdola**, dostane bit 3 („někdo na
mně stojí") — a to je celý spouštěcí mechanismus hry — a objekt s příznakem
„pohyblivý" dostane při zarážce v X nebo Y hráčovo `dX`, tedy strčení.

### 14.5 Co jednotlivé věci dělají

- **Strážce po obvodu** (`upd_30_31_158_159`) nemá v datech dráhu. Jde na západ,
  dokud ho něco nezastaví, pak na sever, pak na východ, pak na jih. Obvod tvoří
  nábytek místnosti; v prázdné místnosti obejde stěny. Rychlost 2 jednotky za
  snímek. **Čaroděj má týž handler** (grafiky 158/159), takže Melkhior po své
  komnatě chodí — a je smrtelný na dotek jako strážce.
- **Strážce východ–západ** (`upd_150_151`) se jen otáčí na místě zarážky.
- **Nohy strážce i čaroděje** (`upd_144_…`) se nehýbou samy: horní půlka do nich
  zapíše svou polohu a krok, ony si z toho vezmou natočení a další fázi chůze.
  Kolizní krabice je **horní půlka** (výška 24), nohy jsou dekorace s výškou 0.
- **Duch** (`upd_80_to_83`) si vylosuje krok 3 nebo 4 jednotky v obou osách a
  drží ho, dokud do něčeho nenarazí. Nemá gravitaci — nikdo mu nikdy nedá `dZ`.
- **Pohyblivá plošina** (`upd_54`, `upd_55`) nemá dráhu ani obrátku. Honí
  **trojúhelníkovou vlnu, kterou popisuje sám čítač snímků** (0 až 15 a zpátky,
  perioda 32 snímků), a každý druhý objekt v tabulce je proti ní v protifázi —
  originál to bere zadarmo z bitu 5 vlastní adresy objektu, což je nejnižší bit
  jeho indexu. Plošina tedy ujede 15 jednotek tam a zpátky za 2,5 vteřiny a dvě
  plošiny v jedné místnosti jedou proti sobě. **Pozor:** vlna se porovnává
  s dolními čtyřmi bity **středu** krabice, ne rohu.
- **Padající kvádr** (`upd_91`) klesne o jednotku za každý snímek, ve kterém na
  něm někdo stojí, a zastaví se, jakmile z něj sleze. Je to výtah dolů, ne past.
- **Hroutící se kvádr** (`upd_143`) se změní na poslední jiskru a je pryč.
- **Trnitá koule** (`upd_63`) padá po jedné v místnosti (`is_spike_ball_dropping`),
  šance 1 ku 16 za snímek, a **v místnosti s lichým ID nepadá vůbec**
  (`disable_spike_ball_drop` se plní z čísla místnosti).
- **Míč nahoru a dolů** (`upd_178_179`) skáče 32 jednotek nad své místo; výška je
  proměnná místnosti, takže druhý míč skáče do výšky prvního.
- **Poskakující míč** (`upd_182_183`) při každém dopadu vybere jednu osu a
  poskočí o 2 jednotky — **od Sabremana pryč, k vlkodlakovi blíž**. Originál to
  dělá přepsáním podmínky skokové instrukce za běhu. Jak vysoko vyskočí, závisí
  zase na čísle místnosti (sudé 4, liché 4 + náhoda).
- **Oheň** (`upd_86_87`, `upd_180_181`) přejíždí místnost a na zarážce se otočí.
- **Mříž** (`upd_8`, `upd_9`) se v místnosti hýbe po jedné; nízká stoupá, vysoká
  padá, první čtyři pohyby hned a další s šancí 1 ku 32. Padá zrychleně a při
  pádu zabíjí, stoupá po jedné jednotce.
- **Truhla a stůl** (`upd_85`, `upd_84`) jsou jediné dvě věci, které se dají
  strčit. Stůl si krok po posunu smaže, takže ujede přesně, co do něj kdo strčil;
  **truhla si ho nechá a klouže, dokud do něčeho nenarazí** — v rutině prostě
  chybí ten jeden řádek. `moveable_block` (grafika 62) si krok maže *před*
  posunem, takže s ním navzdory příznaku nikdo nepohne.
- **Kouzlo čaroděje** (`upd_164_to_167`) letí za hráčem 4 jednotky za snímek —
  a 1, když hráč stojí v oblouku, aby ho nevyhnalo z místnosti. **Není smrtelné**,
  je to strkanec.

### 14.6 Den a noc je poloha slunce, nic víc

`print_sun_moon` (ř. 4353) posune slunce o pixel každý osmý snímek a propadne
do `display_sun_moon_frame`, které okno překreslí; na konci dráhy (pixel 225)
se slunce vymění za měsíc, vrátí na 176 a nastaví se `transform_flag_graphic`.
Jeden úsek je 49 pixelů po 8 snímcích = **392 snímků, tedy 31 vteřin**; den
a noc dohromady zhruba minuta a čtvrt. Den se počítá při každém *druhém*
překlopení a `inc_days` končí hru na 64.

Přeměna hráče (`chk_and_init_transform`, ř. 4266) proběhne, jen když hráč
**stojí na zemi a neskáče** — jinak čeká — a je to osm bliknutí grafik 92–95 po
čtyřech snímcích, během nichž se hráč nemůže hnout a jeho horní půlka je
smazaná. Pak se v čísle grafiky překlopí bit 5, a to je celý vlkodlak: **žádná
jiná fyzika, žádná jiná krabice**. Potvrzuje to kapitolu 3.

### 14.7 Smrt, jiskry a návrat

Hráč se zabitím nezmizí. Dostane bit 6, příští snímek se změní na jiskru 112,
ta se každý snímek posune na 119, pak na **grafiku 1 — což znamená „překresli mě
naposled a zapomeň"** (`calc_pixel_XY_and_render`, ř. 7742) — a teprve když mají
obě jeho půlky grafiku 0, hlavní smyčka pozná, že je po něm (`loc_B074`).

`lose_life` (ř. 6736) pak **postaví celou místnost znovu**: každý spadlý kvádr je
zpátky, každá mříž nahoře. Hráč se vrátí na pozici, kterou si místnost odložila
při vstupu (`plyr_spr_1_scratchpad`), jako člověk nebo vlkodlak podle oblohy,
otočený na západ ve druhé fázi chůze — protože ze starého čísla grafiky se
zachovají jen dolní bity. A objeví se **jiskrami 120–127**, které dělá tentýž
mechanismus obráceně; hra jimi i začíná, `plyr_spr_init_data` má grafiku 120.
Zabít se během objevování nedá: `upd_127` bit „zabitý" prostě smaže.

### 14.8 Co z toho je v repu

- `app/objectTable.js` — tabulka, průchod, kontakt a proměnné místnosti.
- `app/objectMotion.js` — dvacet chování pod jmény rutin originálu.
- `app/dayNight.js` — slunce, měsíc a počítadlo dní.
- `app/heroController.js` — hráč jako první dva řádky téže tabulky.
- `app/physics.js` — beze změny v jádru; přibyl seznam toho, do čeho se posun
  trefil (kvůli smrtelnosti a spouštěčům) a přeskočení vlastního řádku.
- Panel kreslí slunce a měsíc (`app/screenFrameEntity.js`); dny, životy a
  inventář jsou M8 a M10.
- Ověřeno offline: `klwalk check all` (9 procházek v každé místnosti, nic
  nevyjede z místnosti a hráč neskončí v objektu) a nový `klwalk life all`
  (200 snímků bez hráče u kláves: co se v které místnosti hýbe, kde umře a
  jestli má každá grafika handler — má).
- **Náhoda:** originál míchá `seed_3` obnovovacím registrem Z80, což je
  nenapodobitelné a nechtěné; u nás je to xorshift, aby šel běh přehrát offline.
  `seed_2` je prostý čítač snímků, ten sedí přesně.
- **Co zbývá:** handlery sbíratelných předmětů a kotle (`upd_96_to_102`,
  `upd_104_to_110`, `upd_160_to_163`, `upd_111`, `upd_131_to_133`) jsou v tabulce
  prázdné — patří k M8, žádná místnost je zatím jako objekt neobsahuje. Zvuky
  (`audio_*`) nikde; ty jsou v M10.

## 15. Přechody mezi místnostmi (odečteno v M7)

Kapitoly 1 a 2.5 už zjistily, že mapa je pevná mřížka a exity v datech nejsou.
M7 dopsalo zbytek: **jak se místnost opustí a kde v té další hráč stojí.**
Nedalo se to vymyslet, protože celý mechanismus visí na jednom příznaku, který
nastavuje **oblouk**, ne hráč.

### 15.1 Svisle se nechodí — otevřená otázka vyřešena

`GAME-DESIGN.md` kap. 2 a `ROADMAP.md` u M7 počítaly s „přechody čtyřmi směry
**+ pádem/výstupem mezi patry**". **Neplatí.** `screen_move_tbl` (ř. 5599) má
přesně čtyři položky, `adj_dZ_for_out_of_bounds` hlídá jen podlahu a strop
místnost nemá — nad ni se dá vyskočit a zase spadnout zpátky.

Výškové propojení hradu se dělá jinak, a je to elegantnější: **oblouk má
vlastní Z**. `high_arch_e` a `high_arch_s` stojí 48 jednotek nad podlahou (a mají
pod sebou kvádr `high_arch_*_base`, po kterém se k nim jde), takže se z místnosti
odchází ve výšce — a v té další hráč stojí na podlaze, protože ho tam postaví
oblouk té místnosti. Ze 286 dveří hradu má **46 na každé straně jinou výšku**.

### 15.2 „Jsem u oblouku" nastavuje oblouk

`upd_2_4` (ř. 4981) je handler blízké půlky každého oblouku a je to jediný kus
místnosti, který o odcházení něco ví. Spočítá si jeden bod — **13 jednotek
směrem do místnosti od svého středu**, což je střed otvoru — a pak dvakrát projde
**první čtyři řádky tabulky** (hráčovy dvě půlky a dva nesené předměty; poznají
se podle bitu 3 příznaků) a testuje `is_near_to`:

- **těsně** (6 jednotek napříč otvorem, 15 podél, 4 na Z): nastaví řádku
  **bit 0 = „je u oblouku"**. Ten dělá dvě věci — `adj_dX/dY_for_out_of_bounds`
  se kvůli němu vrátí, **než se podívá na stěny místnosti**, a `handle_exit_screen`
  díky němu vůbec něco udělá.
- **volně** (15 a 15): posune hráče **o jednu jednotku za snímek na středovou
  osu otvoru** (`adj_ew` / `adj_ns` do bajtů +14/+15, které `calc_plyr_dXY`
  příští krok přičte a smaže). Je to nejpřívětivější věc ve hře a je úplně
  neviditelná: kdo míří do dveří trochu mimo, je do nich narovnán.

Osa se pozná z **horizontálního překlopení oblouku**: překlopený je v severní
nebo jižní stěně a sonduje po X, nepřeklopený ve východní nebo západní a sonduje
po Y. Platí to pro všechny oblouky ve všech 128 místnostech. Tolerance na Z je
to, co brání odejít ze skoku.

Příznak se **maže v `handle_exit_screen` každý snímek** a oblouk ho každý snímek
nastavuje znovu; stojí tedy na tom, že oblouky jsou v tabulce *za* hráčem.

### 15.3 Odchod: krok, který se nikdy neudělá

`handle_exit_screen` (ř. 5567) volá `move_player` mezi kolizí
(`adj_for_out_of_bounds`) a provedením kroku (`add_dXYZ`):

1. běží-li ještě odpočet vstupu, vrať se (jinak by se místnost opustila hned,
   jak se do ní vejde),
2. není-li „u oblouku", vrať se; jinak příznak smaž,
3. **podle strany, na kterou je hráč otočený** (`get_sprite_dir`, ne podle toho,
   kde je) vyber `screen_west/east/north/south`,
4. ta otestuje, jestli by krok dostal **celou krabici za stěnu** — ne dotek,
   celou; po tom, co ho `chk_plyr_OOB` nechal z otvoru vyklonit, to jsou ještě
   dva tři snímky chůze,
5. pokud ano: souřadnici napříč stěnou **zahoď** (originál do ní zapíše 0 nebo
   255 jako značku), spočítej ID sousední místnosti (kap. 1), nastav odpočet
   vstupu na 3 (`or 0x30`), **zkopíruj hráčovy dva řádky do
   `plyr_spr_1_scratchpad`**, v *kopii* přepiš grafiku na jiskru 120 (a tu
   původní si odlož do `byte_D171`/`D191`, což je bajt +16 kopie) a
   `jp game_loop`.

Krok se **neudělá** — `add_dXYZ` se už nespustí. Zbytek tabulky ten snímek
nedostane vůbec.

### 15.3a Ve dveřích se nezjevuje — jiskry patří jen smrti a začátku hry

Tohle je detail, který se dá snadno přehlédnout, a mění, jak přechod vypadá:
**jiskra 120 se zapisuje do kopie, ne do hráče.** Tabulka objektů má hráče
v prvních dvou slotech, nesené předměty ve slotech 2 a 3 a místnost od slotu 4
(deklarace na ř. 168–173) — a `retrieve_screen` plní a maže tabulku **od
`other_objs_here`, tedy od slotu 4**. Hráčovy dva řádky přechodem projdou
nedotčené: přes dveře jde *on sám*, se svou grafikou, tvarem, otočením, fází
chůze i rychlostí padání. Přestaví se mu jen souřadnice.

Kopie ve scratchpadu je startovní data nové místnosti, tedy to, **na co a jako
co se vrátí po smrti** (kap. 14.7) — a právě proto má v sobě jiskru: po smrti se
objeví jiskrami ve dveřích, kterými přišel. Hra jimi začíná ze stejného důvodu:
`main` (ř. 1979) volá `init_start_location`, které scratchpad naplní z
`plyr_spr_init_data` (grafika 0x78 = 120), a hned za tím `player_dies: call
lose_life`, což je ta rutina, která scratchpad **kopíruje do tabulky**. Přechod
mezi místnostmi skáče na `game_loop` až za ni, takže se hráč nikdy nepřestaví.

Odpočet vstupu (3) se tím pádem u dveří utratí **hned** — tři snímky jde hráč
sám a pak je jeho. Po smrti se utratí až po jiskrách, protože během nich
hráčův handler neběží.

### 15.4 Vstup: `adjust_plyr_xyz_for_room_size`

Nová místnost se staví `build_screen_objects`, a to zavolá
`adjust_plyr_xyz_for_room_size` (ř. 6893). Ta ze značky udělá pozici:

- X == 0 (odešel na západ) → přichází **východním** obloukem,
  `X = 128 + (room_size_X − 2) + poloměr`; X == 255 → západním,
  `X = 128 − (room_size_X − 2) − poloměr`. Totéž pro Y a sever/jih.
  Poloměr se vykrátí, takže v našich souřadnicích to je jedna věta:
  **hrana, kterou jde napřed, je 2 jednotky v místnosti** a zbytek trčí ve
  dveřích. Právě proto jsou při vcházení stěny vypnuté.
- Druhá souřadnice **se zachová**. Pozor: originál má souřadnice absolutní
  bajty kolem 128, takže „zachovat" znamená **zachovat odstup od středu
  místnosti**, ne od jejího rohu — sousední místnosti nemusí být stejně velké.
  Střed otvoru je přitom vždycky přesně střed místnosti (ověřeno na všech
  obloucích hradu).
- **Z dodá oblouk.** `adjust_plyr_Z_for_arch` hledá mezi oblouky nové místnosti
  ten ve stěně, kterou hráč vchází, a vezme jeho Z (a horní půlce +12). Stěnu
  pozná z jednoho bajtu: **`X + Y` středu blízké půlky**, což je pixelový řádek
  sprajtu, tedy pozice v místnosti. Čtyři konstanty jsou východ 55, západ 174,
  sever 81, jih 200 a **všech 128 místností s nimi souhlasí** (měřeno od středu
  místnosti, takže na její velikosti nezávisí).

Hledání má **jednu slepou skvrnu, kterou jsme opsali**: jde po sobě jdoucími
objekty pozadí a vzdá se u prvního, který není oblouk (grafika ≥ 6). Místnost 33
má v seznamu `high_arch_e`, pak kvádr pod ním, a teprve pak `arch_w` — takže při
vstupu ze západu se žádný oblouk nenajde a hráči zůstane výška, se kterou přišel.
Oba oblouky tam stojí na podlaze, takže se to nikde neprojeví.

Během odpočtu vstupu **jde hráč sám** a vstup je hluchý (`handle_left_right` se
kvůli odpočtu vrací); tři kroky po třech jednotkách ho dostanou z otvoru do
místnosti. Viz kap. 15.3a — u dveří se to stane hned, po smrti až po jiskrách.

### 15.5 Co se přes dveře přenáší

V originálu **nic** — hra celou dobu běží, jen se přestaví obrazovka: životy,
obloha, počítadlo snímků, náhoda i tvar hráče jsou globální. Přenáší se jen ta
64bajtová kopie hráče. Portcullis to dokonce čte: `upd_9` se nehýbe, dokud běží
odpočet vstupu (`graphic_objs_tbl+0xC`), aby nováčka ve dveřích nerozmáčkla.

### 15.6 Co z toho je v repu

- `app/objectMotion.js` — `upd_2_4` je konečně handler a ne obrázek:
  `arch`, `archProbe`, `nearArch`, `archAlign`, `spriteDir`.
- `app/heroController.js` — `handleExitScreen` a tabulka `walls`; `walkStep`
  utrácí posun od oblouku; startovní data nesou otočení, fázi chůze a odpočet.
- `app/objectTable.js` — `exitRoom` (kopie a značka), `enterRoom` +
  `archStart` + `archInWall` (`adjust_plyr_xyz_for_room_size`); `build` se
  rozpadl na `build`/`fill`, protože přechodem se hráč **nestaví znovu, jen
  přesouvá** (`HeroController.placeAt`, kap. 15.3a), a `commit` na
  `resolveStep`/`applyStep`, protože mezi kolizí a krokem se rozhoduje
  o odchodu.
- `app/gameWorker.js` — nová zpráva `exit` ven a `room` dovnitř. Worker si
  místnost nenačte sám (JSON je věc modelu), takže se hodiny na tu chvíli
  zastaví; všechno ostatní v tabulce zůstává, protože je to jedna hra.
- `app/roomModel.js` — `requestRoom`/`showRoom`, cache místností na aplikaci,
  `?devRoom=` pro vývoj, `[`/`]` chodí po celém hradu.
- `app/roomData.js` — `CASTLE_MAP` (16×16 bitmapa hradu), `roomExists`,
  `castleRooms`, `oppositeDirection`; validace hlídá, že exit nevede do
  neexistující místnosti.
- `data/` — **všech 128 místností** (rozhodnutí A revize M6): bez nich se
  z dveří nedá vyjít.
- Ověřeno offline: `klwalk doors all` (286 dveří z obou stran),
  `klwalk travel` (skutečný worker přes několik místností), `klwalk check all`
  a `life all` beze změny čísel.

## 16. Předměty, kotel a konec hry (odečteno v M8)

Milník, kterým se z hradu stává hra. Sbírání, kotel, vítězství, prohra a skóre
nejsou pět mechanik, ale **tři tabulky a jedna bitová operace**.

### 16.1 Předměty nepatří místnostem

`special_objs_tbl` (ř. 1126) je 32 záznamů po 9 bajtech mimo místnosti:
startovní `X, Y, Z, místnost` a za nimi čtyři bajty aktuálního stavu. Místnost
si při stavbě projde celou tabulku a co v ní najde, nasype do **dvou slotů**
hned za hráčem (`find_special_objs_here`, ř. 1439 → `special_objs_here`
a `special_objs_here_1`); při odchodu z místnosti se poloha zapíše zpátky
(`update_special_objs`, ř. 1529). Důvod je prostý: předmět odnesený dveřmi už
té místnosti nepatří.

Sloty jsou dva a to je celý limit — proto v místnosti nemůžou ležet tři
předměty a proto se v kotlové místnosti nedá odložit víc než jeden
(`handle_pickup_drop` tam počítá jen s prvním slotem).

**Číslo grafiky v datech není.** V tabulce jsou nuly a `init_special_objects`
(ř. 4462) rozdá osm druhů dokola od náhodného začátku: `graphic = 0x60 | (e++ & 7)`.
Každá hra má tedy od každého druhu čtyři kusy a vždycky na týchž 32 místech, jen
jinak rozdané. Sedm druhů se dá nést, osmý (grafika 103, modla) je **život
navíc** a bere se tím, že se do něj vejde (`upd_103`) — ne klávesou.

Krabice předmětu taky není v datech: `find_special_objs_here` každému zapíše
`5, 5, 12`, takže sbíratelný předmět je vždycky 10×10×12, ať vypadá jakkoli.

### 16.2 Inventář jsou tři sloty a jedno `LDDR`

`objects_carried` jsou tři položky po čtyřech bajtech a před nimi čtvrtá
(`inventory`), kam se odkládá právě zvednutý předmět. `adjust_carried` posune
frontu o jednu položku (`LDDR`, ř. 4045) a běží **po každém stisku**, ať se něco
zvedlo, položilo, nebo ne.

Z toho plynou dvě věci, které vypadají jako chyba a nejsou:

- Zvednutí čtvrtého předmětu se neodmítne. Ten na konci fronty se **položí tam,
  kde ležel ten zvedaný** — vypadá to, jako by si předměty vyměnily místo.
- Pokládá se vždycky ten na **konci** fronty (`object_carried_2`), takže jediný
  nesený předmět je nutné třemi stisky „prohnat" panelem, než se položí. Se
  třemi předměty v ruce, což je normální stav hry, vyjde jeden stisk = jeden
  předmět. Panel to ukazuje: nový přírůstek naskočí vlevo a posouvá se doprava.

**Klávesa není v obou režimech tatáž.** `chk_pickup_drop` (ř. 3866) čte u
klávesnice bit 4 — ten, co osmisměrný joystick nastavuje tažením dolů — ale
u osmisměrného režimu si bajt posune a čte **bit 5**, protože dolů je tam směr.
Osmisměrný režim má tedy pro zvedání vlastní klávesu (v originálu spodní řada
klávesnice, u nás `Z`). Do M8 to nevadilo, protože se nezvedalo.

`handle_pickup_drop` (ř. 3887) je jeden stisk, jedna věc — klávesa se musí
pustit, než platí znovu — a odmítá se ve dveřích, ve vzduchu a když hráč na ničem
nestojí. Dosah zvedání je jeho krabice zvětšená o 4 jednotky ve všech směrech
a posunutá o 4 dolů (`is_on_or_near_obj`): pod nohy dosáhne, nad hlavu ne.

Položení je **vystoupení**: předmět jde tam, kde hráč stojí, a hráč se zvedne
o krychli. Proto se předtím ptá, jestli je o krychli výš místo
(`do_any_objs_intersect` s `cant_drop`) — a pokud není, položit nejde.

### 16.3 Kotel je číslo místnosti a bit 3

V kotlové místnosti (136) a jen když hráč stojí aspoň dvě krychle vysoko —
tj. **na kotli** — dostane pokládaný předmět v čísle grafiky **bit 3**. To je
celý rozdíl mezi `upd_96_to_102` (leží na zemi) a `upd_104_to_110` (letí do
kotle). Nic se nikde neregistruje.

Dráha není animace: jednu jednotku za snímek ke středu místnosti v obou osách,
stoupání dokud je pod okrajem kotle, pak vodorovně, a nad středem se propadne —
**skrz kotel**, protože objekt s příznakem „ignoruj ve 3D" se nekoliduje vůbec
(`adj_for_out_of_bounds` se vrátí hned na prvním řádku, ř. 5707; to je pravidlo,
ne optimalizace, a platí i pro jiskry). Hráč zatím visí ve vzduchu:
`move_player` mu dokud `obj_dropping_into_cauldron` běží nastaví `dZ = 2`, což
mu gravitace zase sebere.

`add_obj_to_cauldron` porovná `graphic & 7` s `objects_required[počet]`. Předmět
zmizí tak jako tak; jen ten správný posune sekvenci. `objects_required`
(ř. 4244) je pevných 14 žádostí ze 7 druhů a `shuffle_objects_required` (ř. 2712)
s ní jen **otočí o 4–7 pozic** podle `seed_1`.

### 16.4 Bubliny nad kotlem jsou jediné UI ve hře

`init_cauldron_bubbles` (ř. 3261) na konci každého snímku v místnosti 136 zkopíruje
18 bajtů šablony do druhého slotu předmětů, jakmile je volný. Bubliny vystoupají
k okraji kotle a tam se točí ve čtyřech fázích jiskry — a **každá čtvrtá fáze je
obrázek předmětu, který kotel zrovna chce** (`upd_160_to_163`, `or 168`). To je
celá nápověda hry.

V noci ne. Vlkodlak nedostane nic: bublina si místo toho nastaví bit 2 čísla
grafiky, čímž se z ní stanou čtyři čísla kouzla, a kouzlo ho honí. Je to týž
handler jako čarodějovo kouzlo (`upd_164_to_167`), ale tohle **zabíjí** — šablona
bublin má v bajtu +13 oba smrtící bity a nikdo je nemaže. Čarodějovo kouzlo je
jen strkanec, protože jeho `+13` je nula.

Bubliny taky ustoupí, jakmile do prvního slotu přijde skutečný předmět — tak má
kotlová místnost místo pro předmět, který se do ní nese.

### 16.5 Dva konce

**Čtyřicátý den.** `inc_days` (ř. 4415) přičte jedničku v BCD a porovná s bajtem
64 — a 64 je 0x40, což v BCD čte jako **čtyřicet**. Číslo, na které se čeká, je
tedy to, co ukazuje panel. Jeden den a noc je 784 snímků, takže celá hra je
31 360 snímků, u nás asi 42 minut.

**Lektvar.** Čtrnáctý správný předmět zapne `all_objs_in_cauldron`, a tím se
stanou tři věci: slunce se zastaví (`display_sun_moon_frame` se vrátí na prvním
řádku, takže dny už neběží), hráč se nedá zabít, a `prepare_final_animation`
(ř. 1929) rozebere místnost — jedenáct slotů od druhého předmětového se smaže
a z každého zbylého obyčejného kvádru (grafika 7) se stane jiskra 131. Ty
vystoupají nad kotel — každá čtvrtina místnosti dostane krok **napříč** (poloha
v X určuje krok v Y a naopak, `dX_dY_tbl`), takže z podlahy nevyletí čtyři
proudy, ale vír — a odtud jdou po hráči. Když je některá do šesti jednotek
v obou osách, je konec hry a obrazovka s hotovým lektvarem.

Skóre je na obou obrazovkách totéž (`calc_and_display_percent`, ř. 1381):
každá viděná místnost za jedna, každý předmět v kotli za dva, a jednotka je
0xA41A šestnáctibitového zlomku — tedy 0,641. Celý hrad a celý lektvar dá
99,999 % a přičtená konstanta 0x28 to dotáhne na 100. Hodnocení se vybírá ze tří
bitů: lektvar a dva bity počtu místností.

### 16.6 Co z toho je v repu

- `data/global.json` (nový, `klconv global`) — 32 předmětů se startovní
  polohou v souřadnicích své místnosti, `objects_required` a čtyři startovní
  místnosti. Grafika v souboru **není**, protože ji rozdává až hra.
- `data/sprites.json` — přibyly `fonts.text` (40 znaků 8×8 z `font`)
  a `fonts.day` (4 znaky z `day_font`); panel se bez nich nedá napsat.
- `app/specialObjects.js` (nový) — `special_objs_tbl`, inventář,
  `objects_required` a počítadlo kotle. Přežívá místnosti jako `dayNight.js`.
- `app/objectTable.js` — dva sloty předmětů hned za hráčem (`fill`,
  `specialEntry`, `saveSpecials`), `cauldronBubbles`, `prepareFinalAnimation`,
  `endGame`, `score`, `visited`; `resolveStep` respektuje „ignoruj ve 3D"
  u pohybujícího se objektu; `blockedAbove`.
- `app/heroController.js` — `handlePickupDrop`, `dropObject`, `nearObject`,
  `outOfRoom`, `pickupPressed` (šestý vstupní bit pro osmisměrný režim);
  `movePlayer` drží hráče ve vzduchu, dokud předmět padá do kotle.
- `app/objectMotion.js` — `upd_96_to_102`, `upd_103`, `upd_104_to_110`,
  `upd_111`, `upd_131_to_133`, `upd_160_to_163`, `upd_168_to_175`; `upd_164_to_167`
  umí kotlovou variantu.
- `app/physics.js` — `intersectsAny` (`do_any_objs_intersect`).
- `app/dayNight.js` — `lastDay` a zmrazení oblohy po dokončení lektvaru.
- `app/screenFrameEntity.js` — panel konečně ukazuje DAY a číslo dne, životy
  se sprajtem a tři nesené předměty, každý ve své barvě (`object_attributes`).
- `app/sceneEntity.js` — display list nechává mezi hrdinou a místností dvě
  řádky pro předměty, aby se s tabulkou workeru četly řádek po řádku.
- Ověřeno offline: `klwalk items all` (všech 32 předmětů zvednuto a položeno,
  včetně čtyř modlí za život a tří míst, kde nad hlavou není místo)
  a `klwalk win` (40. den ukončí hru; 14 předmětů do kotle, místnost se rozpadne
  a jiskry hru ukončí vítězstvím, skóre sedí). `klrender render <id> --items
  --status d,l,o,o,o` nakreslí předmět v místnosti i celý panel.
- **Známý následek:** `klwalk doors all` má nově jednu chybu ze 568 průchodů —
  místnost 10 má uprostřed předmět, hráč se o něj cestou zdrží a do východu
  místnosti 9 dorazí v jinou chvíli, kdy je spuštěná mříž. Bez toho předmětu
  projde. Není to chyba fyziky, je to zbytek pevného programu kláves.

## 17. Patra hradu (odečteno v M9)

Vedlejší produkt ověřování `data/` proti dobové mapě (`REVIEW-M9.md`).
Mapa `refs/maps/KnightLore_3.png` je slepenec skutečných obrazovek originálu
v měřítku 1:1, takže se z ní dá vyčíst nejen obsah místnosti, ale i **jak
vysoko ji originál kreslí** — a to je patro, ve kterém stojí.

### 17.1 Hrad má devět podlaží a nikde to není zapsané

Místnost nemá výšku podlahy; všechny stojí ve své byte soustavě na Z = 128
(kap. 2). Rozdíl pater dělá **výška oblouku ve dveřích**: `high_arch_e/s`
stojí 48 jednotek nad podlahou, obyčejný oblouk na podlaze, a hráč odchází
i přichází ve výšce svého oblouku (kap. 15). Rozdíl obou konců jedněch dveří
je tedy krok mezi podlahami sousedních místností.

Když se ten krok rozejde ode dveří ke dveřím z místnosti 0x00, vyjde **devět
podlaží** — od −6 do +2, nejobydlenější je −2 (38 místností) a −3 (32).
Nakreslená mapa to potvrzuje nezávisle: **77 ze 78 porovnatelných dveří** má
v mapě týž svislý rozdíl, jaký říkají výšky oblouků (`klmap levels`).

### 17.2 A přesto se hrad do jednoho výškopisu poskládat nedá

Pět dveří se procházkou po výškách vrátí do místnosti, kterou už procházka
postavila jinam:

| dveře | procházka říká | už tam bylo |
|---|---|---|
| 0x12 sever 0x22 | 0 | −1 |
| 0x34 sever 0x44 | −1 | −2 |
| 0x1D sever 0x2D | +1 | −2 |
| 0x0E východ 0x0F | +2 | −1 |
| 0xED sever 0xFD | −4 | −3 |

Není to chyba dat ani konverze: mřížka hradu se **zacykluje** (východ z 15.
sloupce vede do nultého, sever z 15. řádku do nultého, kap. 1), takže smyčka
kolem hradu nemusí sedět a nesedí. Je to Escherovo schodiště — a v originálu
to nikoho netrápí, protože hráč vidí vždycky jednu místnost a rozdíl pozná jen
z výšky oblouku, kterým právě prochází.

**Důsledek pro nás: žádný.** Naše data patro místnosti nikde neukládají,
protože ho neukládá ani originál; oblouk si výšku nese sám a `retrieve_screen`
staví každou místnost od její vlastní podlahy.

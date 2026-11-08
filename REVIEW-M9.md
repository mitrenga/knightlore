# M9 — ověření všech 128 místností proti originálu

Co M9 zbývalo po rozhodnutí A revize M6: `data/` už mělo všech 128 místností
a konvertor je vysypal čistě, ale **„projít a ověřit každou místnost proti
originálu"** zůstávalo jako práce očima — a v repu není z čeho: snímky
jednotlivých místností z emulátoru tu nejsou (`refs/README.md`, chybějící
emulátor).

Ukázalo se, že jsou. `refs/maps/KnightLore_3.png` (4704×2175) není kresba, ale
**slepenec skutečných obrazovek originálu, pixel po pixelu** — celý hrad na
jednom obrázku. To je přesně to, co M9 potřebuje: obrázek toho, jak má každá
místnost vypadat. Kontrola očima se tím dá udělat strojově, a to nad všemi 128
místnostmi najednou.

Datum: 2026-09-01. Nový nástroj: `tools/klmap/klmap.js`.

---

## 1. Čím se měřilo

Všechno je reprodukovatelné offline, týmiž soubory z `app/`, jaké běží ve hře
(`klmap` kreslí místnost přes `isoProjection`, `depthSort`, `isoRaster`
a `spriteSheet`, stejně jako `klrender`):

```
node tools/klconv/klconv.js verify         # data/ je přesně to, co dává binárka
node tools/klmap/klmap.js  check all       # každá místnost proti mapě originálu
node tools/klmap/klmap.js  levels          # patra hradu ze dvou stran
node tools/klmap/klmap.js  sheet -o castle.png
node tools/klmap/klmap.js  diff <id> -o diff.png
```

`sheet` je obrázek pro oči: celý hrad z `data/` nakreslený přes původní mapu —
**bílá** je tam, kde kreslíme totéž co originál, **červená** jen my, **modrá**
jen mapa.

### Jak se místnost v mapě najde

Slepenec je izometrické dláždění mřížky 16×16 v měřítku 1:1, takže poloha
místnosti je počitatelná: jedna místnost na východ i jedna na sever posune
obrázek o **145 px vpravo**, východ o 72,5 px dolů a sever o 72,5 px nahoru
(konstanty změřené na mapě, ukotvené na místnosti s kotlem). Nepočitatelné je
jediné: **patro**. Hrad má podlaží po 48 jednotkách a mapa kreslí místnost
o tolik výš. Takže x se odvodí na pixel a y se hledá přes šestnáct pater;
místa se přitom rozdávají tak, aby v jednom nestály dvě místnosti — bez toho si
místnost, kterou mapa nekreslí, sedne na obrázek sousedky nad sebou a tváří se
spokojeně.

### Co mapa ověřit může a co ne

Mapa je **jeden snímek běžící hry**, a podle toho se počítá zvlášť:

- **nábytek** (`fixed`) — kvádry, které se nehýbou a nejdou strčit; tohle
  je ta část, kterou snímek skutečně ověřuje,
- **pohyblivé** (`free`) — strážci, koule, plošiny, padající a strkatelné
  kvádry; ty mapa zastihla někde uprostřed jejich dráhy, takže neshoda nic
  neznamená,
- **zdi a oblouky** (`wall`) — slepenec kreslí spoje místností po svém
  a stěnu často z poloviny zakrývá sousední místnost.

---

## 2. Výsledky

`node tools/klconv/klconv.js verify`:

> 129 file(s) converted afresh and compared with data — **every one of them is
> exactly what the binary gives**

Tedy: v `data/` není nic doupraveného rukou, nic nechybí a není tam místnost,
kterou originál nemá. Tohle dosud nekontroloval nikdo.

`node tools/klmap/klmap.js check all`:

| | |
|---|---|
| místností nalezených v mapě | **127 ze 128** |
| nábytek nakreslený tam, kde ho kreslí originál | **826 z 832 (99,3 %)** |
| pohyblivé objekty | 231 z 314 (73,6 %) — snímek je zastihl jinde |
| zdi a oblouky | 1968 z 2341 (84,1 %) — spoje místností |

Jedna místnost se v mapě nenašla: **0x27**. Na jejím místě v dláždění kreslí
mapa něco jiného (tráva, oblouk, koule; naše 0x27 je plošina s bodci) —
nejlepší shoda tam je 41 %, ať se hledá v kterémkoliv patře. Nejlíp se 0x27
uchytí (76 %) na obrázku místnosti 0x45, což je právě ta záměna, kvůli které
se místa rozdávají: 0x45 sedí líp, takže místo dostane ona a 0x27 se hlásí
jako nenalezená. Buď ji slepenec vynechal, nebo ji posunul jinam, než dláždění
předpokládá. **Zůstává na oči.**

Šest kusů nábytku ze 832 mapa nepotvrzuje, ve čtyřech místnostech:

| místnost | kus | shoda |
|---|---|---|
| 0x38 | `block(0,0,36)`, `spike(2,18,0)` | 70 %, 48 % |
| 0x76 | `block(112,48,36)` | 69 % |
| 0xBA | `block(48,80,0)` | 27 % |
| 0xF0 | `block(32,0,36)`, `block(112,64,36)` | 70 %, 66 % |

Pět z těch šesti stojí **u samé stěny a vysoko** (`z = 36`, `x = 0/112` nebo
`y = 0`) — tam, kde slepenec kreslí přes ně sousední místnost. Šestý
(`0xBA block(48,80,0)`) je uvnitř hromady kvádrů a vidět jsou z něj jen ty
pixely, které v mapě padnou na jinak nakreslené bodce; diff místnosti je
jinak bílý. Ani jeden nevypadá na chybu dat, ale na zákryt — potvrzení očima
je práce na deset minut (`klmap diff <id>`).

**Nové typy objektů si M9 nevyžádal.** Zadání s nimi počítalo („doplnit
chybějící typy objektů, na které se narazí"); po M8 je jasné, že všech 29 typů
kvádrů a 24 typů pozadí je hotových a každé číslo grafiky v hradu má handler
(`klwalk life all`).

---

## 3. Patra hradu — dvě čtení, která spolu nemají nic společného

Vedlejší produkt hledání v mapě: kde mapa kreslí místnost svisle, je její
patro. Totéž se dá spočítat z dat — výška oblouku na obou stranách dveří říká,
o kolik je podlaha sousedky výš (M7, `NOTES-ORIGINAL.md` kap. 15). Jedno je
bajt v datech, druhé řádek pixelů na obrázku, který v roce 1984 slepil někdo
jiný. Kde se shodnou, jsou obě správně:

> **77 ze 78 porovnatelných dveří souhlasí.** (64 dveří vypadlo, protože na
> jednom konci stojí místnost složená jen ze zdí — takovou mapa neumí od jiné
> takové rozeznat, viz níže; 1 kvůli nenalezené 0x27.)

Jediná neshoda: `0x38 north to 0x48` — oblouky říkají o patro níž, mapa kreslí
stejné patro. 0x38 je zároveň jedna ze čtyř místností s nepotvrzeným nábytkem,
takže její usazení v mapě je ze všech nejméně jisté.

A jedno zjištění o originálu, které vypadlo mimochodem: **hrad se nedá poskládat
do jednoho konzistentního výškopisu.** Když se patra rozejdou ode dveří ke
dveřím z místnosti 0x00, vyjde devět podlaží (od −6 do +2), ale **pět dveří se
vrátí do místnosti, kterou už procházka postavila o patro (u 0x0E o tři) jinam**:
0x12↑0x22, 0x34↑0x44, 0x1D↑0x2D, 0x0E→0x0F, 0xED↑0xFD. Mřížka hradu se navíc
zacyklí (východ z 15. sloupce vede do nultého), takže na tom není nic
rozbitého — je to Escherovo schodiště a v originálu nikomu nevadí, protože
hráč vidí vždycky jednu místnost. Zapsáno do `NOTES-ORIGINAL.md` kap. 17.

---

## 4. Co mapa ověřit nemůže a zbývá na oči

1. **Místnost 0x27** — v mapě se nenašla (kap. 2).
2. **Šest kusů nábytku** ze čtyř místností — vypadají na zákryt, ne na chybu
   (kap. 2, tabulka). `klmap diff 0x38 -o diff.png` a tak dál.
3. **Pohyblivé objekty** — dráhy strážců, plošin a koulí snímek neověří.
   Ověřené jsou offline jinak: `klwalk life all` (v 59 místnostech se něco
   hýbe, každé číslo grafiky má handler) a M5, kde jsou všechna chování
   odečtená z disassembly.
4. **Místnosti složené jen ze zdí** — 24 z nich (`0x02 0x0B 0x0D 0x2F 0x44 …`,
   celý seznam vypíše `check all`). Vypadají jedna jako druhá, takže to, kam je
   mapa postavila, není důkaz o ničem; jejich obsah ale žádný není, takže není
   co ověřovat.
5. **Barvy.** `klmap` porovnává jen tvar (inkoust proti papíru); atribut
   místnosti se z mapy vytáhnout dá a nevytahuje se. Barvu bere hra z dat
   (`attribute.ink`) a ta jsou z binárky.
6. **Den a noc, panel, zvuky** — na statické mapě nejsou.

---

## 5. Co se změnilo v repu

- `tools/klmap/klmap.js` (nový) — `check`, `diff`, `sheet`, `levels`.
- `tools/lib/png.js` (nový) — zapisovač PNG (přesunutý z `klrender`, přibyla
  barevná varianta pro rozdílové obrázky) a čtečka PNG na masku inkoustu.
- `tools/klrender/klrender.js` — kreslí beze změny, jen PNG píše přes
  `tools/lib/png.js`.
- `tools/klconv/klconv.js` — nový příkaz `verify`.
- `NOTES-ORIGINAL.md` — kap. 17 (patra hradu a jeho švy).
- Data se nezměnila. Nebylo co opravovat.

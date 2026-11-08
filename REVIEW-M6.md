# M6 — revize pahýlu

Společná kontrola po M0–M5, jak ji `ROADMAP.md` zadává: věrnost vzhledu, pocit
z ovládání, výkon, čitelnost kódu, formát dat, hranice mezi svision a hrou,
a pořadí fáze B.

Tohle je **podklad k rozhodnutí, ne uzavření milníku** — M6 je hotové teprve
tím, že závěry odsouhlasíš. Co potřebuje tvoje ruce a ne měření, je v kapitole
9.

Datum revize: 2026-09-01. Stav: `app/` má 5012 řádků v 18 souborech,
`data/` dvanáct místností, `tools/` čtyři nástroje.

---

## 1. Čím se měřilo

Všechno níže je reprodukovatelné bez prohlížeče, offline nástroji, které
spouštějí **tytéž soubory z `app/`**, jaké běží ve hře (`tools/lib/workerScripts.js`).
Aby čísla platila pro celý hrad a ne jen pro dvanáct místností v `data/`,
vygeneroval jsem si všech 128 do dočasného adresáře:

```
node tools/klconv/klconv.js emit all --out /tmp/data128
node tools/klrender/klrender.js check all --data /tmp/data128
node tools/klwalk/klwalk.js  check all   --data /tmp/data128
node tools/klwalk/klwalk.js  life  all   --data /tmp/data128
```

**První závěr revize je právě tohle:** čísla, kterými se M5 uzavřel („všech 128
místností"), dnes v repu nikdo nezreprodukuje — `data/` má dvanáct místností
a `all` znamená dvanáct. Konvertor přitom všech 128 vysype čistě a všechny
tři kontroly na nich projdou. Viz rozhodnutí A.

---

## 2. Věrnost vzhledu

`klrender check all` nad 128 místnostmi:

- 3806 kvádrů, **každý z nich má sprajt** — žádná grafika nechybí,
- kreslený rozsah x 0–255, řádky −29 až 159: scéna se vejde do obrazovky
  a přesahuje jen nahoře, kde ji originál taky ořezává,
- 314 sprajtů přesahuje horní hranu a ořeže se, **2 by originál vynechal**
  (`spriteVisible()` testuje jen spodní řádek, jak `calc_pixel_XY` dělá).

Namátkou jsem proti disassembly ověřil jednu věc, která vypadala jako chyba:
příznak smrtelnosti se nikdy nemaže, takže mříž, která se jednou pohnula,
zůstane `deadly` navždy i když stojí. **Je to správně.** `upd_9` v asm dělá
`set 7, (ix+13)` — „smrtelné, když to trefí hráče" — a nic to nemaže; bit 5
(„smrtelné, když do toho hráč vrazí") mříž nemá nikdy. Stojící mříž se nehýbe,
takže nikoho netrefí, a projít pod ní jde. Náš `ObjectTable.contact()` ty dva
bity rozlišuje stejně. Transkripce sedí i tam, kde vypadá podezřele.

**Závěr: vzhled je hotový v rozsahu, na který M0–M5 sahaly.** Co se nedá
odečíst z čísel — jestli místnost *na pohled* odpovídá screenshotu — čeká na
tebe (kap. 9).

## 3. Živost místnosti

`klwalk life all` nad 128 místnostmi, 200 snímků bez hráče u kláves:

- v 59 místnostech se něco hýbe, 69 je klidných,
- ve 20 hráč zemře, aniž udělá krok,
- viděno 19 různých chování,
- **každé číslo grafiky, které se v hradu vyskytne, má handler.**

`klwalk check all`, devět chůzí po 60 snímcích v každé místnosti: 128 čistých,
nula problémů. Nikdo nevyjede z místnosti, nikdo neskončí uvnitř objektu,
v 55 místnostech hráč na něco vylezl, nejvýš z 76 v místnosti 118.

Čísla M5 tedy platí beze změny.

## 4. Pocit z ovládání

Co se dá změřit, změřené je (`klwalk walk 0 --keys …`, jednotky: krychle je
16×16×12):

| | výška | dálka |
|---|---|---|
| skok s podrženou klávesou | 28 j. = **2,3 krychle** | 42 j. = **2,6 krychle** |
| ťuknutý skok | 16 j. = **1,3 krychle** | 27 j. = **1,7 krychle** |

- Skok je vždycky **skok vpřed** — i „z místa". `move_player` přidává krok
  chůze po celou dobu letu bez ohledu na klávesy, směr se ve vzduchu nedá
  změnit ani v jedné vstupní metodě. Je to originál, ale je to věc, na kterou
  si moderní hráč sáhne jako první.
- Podržená klávesa mění výšku skoku o celou krychli. To je dobrá zpráva:
  výškové rozlišení, které hra potřebuje, se hraje jedním prstem.
- Hráč se objevuje **14 snímků ≈ 1,1 s** jiskrami, během nichž vstup nefunguje.
  Platí to i po každé smrti. Věrné; jestli to při padesáti smrtích za sebou
  otravuje, ukáže až hraní.
- Worker tiká po 80 ms, model kreslí na 60 fps z cache. Latence vstupu je tedy
  do 80 ms — to je tempo originálu, ne naše zpoždění.
- Dvě vstupní metody (`C`) jsou obě z originálu a `directional` je ta, kterou
  dnešní hráč čeká.

## 5. Výkon

Měřeno nad všemi 128 místnostmi, tytéž moduly co ve hře, kreslení do typového
pole (`sort` = `DepthSort.order()`, `draw` = celý display list přes
`IsoRaster.drawSprite()`):

- průměr na místnost: **sort 0,09 ms, kreslení 0,15 ms**,
- největší display list: místnost 33, **38 kvádrů**, sort 0,14 ms, kreslení 0,18 ms.

To ale není číslo prohlížeče. Ve hře jde každý běh pixelů přes `ctx.fillRect()`
v `SceneEntity.newSurface()`, a těch je:

- **6010 volání `fillRect` na jedno překreslení scény** v průměru,
- **9608 v nejhorší místnosti.**

Při dvanácti překresleních za sekundu to je 72–115 tisíc `fillRect` za sekundu.
Na desktopu to sedí na 3,5 ms, které M2 naměřil, a je to v pohodě. Na slabém
TV prohlížeči je `fillRect` běžně 3–10× dražší, což je 20–60 ms na překreslení
z osmdesátimilisekundového rozpočtu — pořád to vyjde, ale s malou rezervou.

Scéna se navíc překresluje jen když se opravdu něco pohnulo
(`SceneEntity.setObjects()` porovnává řádky snapshotu), takže 69 klidných
místností stojí jeden blit za snímek. To je správně navržené.

**Doporučení: neoptimalizovat teď.** `GAME-DESIGN.md` kap. 11 říká dělit vrstvy
teprve až to čísla vyžádají, a nevyžádala. Až to přijde (M12, profil na slabém
zařízení), levná oprava je jasná a nesahá na nic jiného než na `newSurface()`:
každou dvojici (grafika, překlopení) jednou vykreslit do offscreen canvasu
v barvě místnosti a scénu skládat `drawImage()`. Z 6000 volání se stane 38.
Místnost má jednu atributovou barvu, takže cache stačí zahodit při změně
místnosti.

## 6. Čitelnost kódu

Tohle je nejsilnější část pahýlu a nemám k ní výhrady. Konkrétně:

- **Každý netriviální řádek má v komentáři jméno rutiny originálu.** To není
  kosmetika: při revizi jsem třikrát sáhl do `refs/disasm` ověřit něco, co
  vypadalo jako chyba, a pokaždé mě komentář dovedl přesně na to místo.
- **Rozdělení model / worker** je stejné jako v MM a JSW a drží: přes hranici
  jdou dvě zprávy, worker neví o JSON ani o sprajtech, model nehýbe ničím.
- **`tools/lib/workerScripts.js` je nejlepší nápad projektu.** Offline nástroje
  spouštějí ty samé soubory, ne kopii, takže se transkripce kolize nemůže
  rozejít se svou vlastní kontrolou.
- **`objectTable.js` jako jedna tabulka místo „hráč a nepřátelé"** je věc,
  kterou by při přepisu nikdo dobrovolně nevymyslel a bez které by půlka
  chování musela být zvlášť naprogramovaná.

Drobnosti, které stojí za zápis, ale ne za zásah teď:

1. **Dva stylové světy.** `roomData.js`, `hero.js`, `spriteSheet.js` jsou ES
   moduly v `const`/arrow; `physics.js`, `objectTable.js`, `objectMotion.js`,
   `heroController.js`, `dayNight.js` jsou klasické skripty ve `var`/ES5.
   Je to *důsledek* toho, že worker `import` neumí, ne nedbalost, ale někde by
   to mělo být napsané jako pravidlo, aby se to nezačalo míchat.
2. **`ObjectTable.contact()` značí `destroyed` na čemkoliv, do čeho smrtelná
   věc vrazí** — tedy i na zdi, do které vrazí strážce. Dnes `destroyed` čte
   jenom hrdina, takže je to neškodné mrtvé nastavení. V M8, až budou předměty
   a kotel číst řádky tabulky, to past být může. Buď to omezit na hrdinu,
   nebo si na to v M8 vzpomenout.
3. **`SceneEntity.setObjects()` spoléhá, že snapshot má stejné pořadí a délku
   jako display list.** Je to tak, obojí vzniká z jednoho `roomBoxes()`, a je
   to i vysvětlené — ale je to nepsaný kontrakt mezi dvěma soubory, který
   v M7 (dvě místnosti, výměna za běhu) půjde snadno porušit.

## 7. Formát dat

128 místností = 1639 objektů + 1911 „extras" + 32 předmětů, 10 kB na místnost
(1 kB gzipnutě), 1,4 MB celkem. Velikost je bez problému.

Co ale revize našla, je **mrtvé a zdvojené osazenstvo záznamu**:

- **`phase` je mrtvé pole.** Ve všech 1639 objektech je `"always"`, a být jiné
  nemůže — `NOTES-ORIGINAL.md` kap. 3 vyvrátila, že by den a noc měnily
  geometrii. Pryč s ním, včetně `PHASES` a filtrování v `objectBoxes()`
  a `roomBoxes()`.
- **`collision` je z 5/7 hodnot dokumentace.** Engine z něj čte jedinou věc:
  `decoration` → `ignore3D`. `hazard` (499×), `trigger` (73×), `platform` (10×)
  engine nezajímají — chování se od M5 vybírá podle čísla grafiky. `collectible`
  se v datech nevyskytuje vůbec.
- **Dva bity jsou v datech dvakrát.** `collision: "decoration"` a
  `flags.ignoreIn3D` je týž bit originálu (128 místností, 11 výskytů, **0
  neshod**). Stejně tak `collision: "pushable"` a `flags.moveable` (46 a 46).
- **`flags.flipVertical` kód umí, ale data ho nikdy nepoužijí** (1313× jen
  `flipHorizontal`).
- **`data/global.json` neexistuje.** `GAME-DESIGN.md` kap. 6 ho předepisuje
  (startovní místnost, tabulka 32 předmětů, parametry cyklu, délka hry) a M8
  i M9 ho budou potřebovat.

Návrh (rozhodnutí C): `phase` zahodit, `collision` a `motion` **ponechat jako
slovník konvertoru a editoru** a napsat do formátu, že engine z nich čte pouze
`decoration` — jsou to dobrá jména pro to, co objekt *je*, i když už neřídí, co
*dělá*. Zdvojení `decoration`/`ignoreIn3D` a `pushable`/`moveable` nechat být:
jedno je slovník, druhé je bit originálu, a shodují se. `global.json` založit
v M8, ne teď.

## 8. Co patří do svision a co do hry

`GAME-DESIGN.md` kap. 8 říká: „Vše, co je obecné (izo projekce, depth sort,
masky ve sprajtech), patří do svision."

Splněná je z toho jedna třetina — masky přibyly u `SpriteEntity` v M3 a hra je
používá v `screenFrameEntity.js` na panel. `isoProjection.js`, `depthSort.js`
a `isoRaster.js` zůstaly v repu hry.

**Doporučuju to tak nechat**, a to pravidlo v GDD zmírnit:

- `isoProjection.js` **není obecné.** Je to `calc_pixel_XY` Knight Lore
  i s tím, že Filmation nahradil √3/2 jedničkou. Do svision by patřila obecná
  izo projekce, kterou nikdo nepotřebuje.
- `depthSort.js` obecné je, ale jeho jádro je 27položková skoková tabulka
  odečtená z `off_CF69`. Do svision patří, až bude druhý zákazník.
- `isoRaster.js` obecný je nejvíc a **už má správný šev**: kreslí přes rozhraní
  `{width, height, span, pixel}`, takže ho stejně používá hra i offline
  renderer. Přesunout ho půjde kdykoliv beze změny volajících.

Ta věta v GDD měla dobrý důvod — remake Alien 8 nad stejnou izo vrstvou je
v „nápadech mimo scope". Až se ten nápad začne dělat, přesun je mechanický
a `isoRaster.js` je na něj připravený. Do té doby by vydání svision kvůli tomu
stálo práci a nekoupilo nic.

## 9. Co revize nerozhodla a potřebuje tebe

Tohle se offline změřit nedá:

1. **Věrnost na pohled.** `klrender render <id>` umí PNG bez prohlížeče —
   porovnat pár místností se screenshoty originálu je práce na půl hodiny,
   ale je to porovnání očima.
2. **Čitelnost izo skoku na moderní obrazovce** — riziko, které `ROADMAP.md`
   výslovně odkládá na M6. Čísla z kap. 4 říkají, že skok je 2,6 krychle
   daleko a 2,3 vysoko; jestli je na velké obrazovce poznat, kam dopadneš,
   pozná jen ruka na klávesnici.
3. **Jestli „skok je vždycky skok vpřed" vadí.** Je to originál. Pokud vadí,
   patří to mezi volitelné asistence v nastavení (M10), ne do jádra.
4. **Jestli 1,1 s jisker po každé smrti otravuje.**

---

## 10. Rozhodnutí k odsouhlasení

*Stav 2026-09-01, po M7:* **A je provedeno** — bez všech 128 místností nemá M7
kam vyjít ze dveří, takže se to udělalo hned a čísla kapitol 1–3 jsou v repu
reprodukovatelná (`--data` už není potřeba). **B se potvrdilo:** M7 šlo první
a vstupní pozice z oblouku tu nehratelnost odstranila — uprostřed místnosti hra
začíná jen ve čtyřech startovních místnostech originálu a ty mají volný střed.
**C, D a E čekají** na odsouhlasení; nic z M7 na nich nestálo.

**A — Nasypat všech 128 místností do `data/` hned, ne až v M9.**
Konvertor je vysype čistě a všechny tři kontroly na nich projdou (kap. 1–3).
Dnes to má tři důsledky: čísla M5 se v repu nedají zreprodukovat, `[`/`]`
listuje dvanáct místností místo hradu, a M7 nemá kam vyjít ze dveří. Náklad:
1,4 MB v repu. M9 tím nemizí — zůstává v něm to podstatné, totiž **projít
a ověřit každou místnost proti originálu**, což je práce očima, ne konvertorem.

**B — Pořadí fáze B ponechat: M7 → M8 → M9 → M10 → M11 → M12.**
Argument pro to, aby M7 šlo první, je měřitelný: dnes hra staví hrdinu
doprostřed místnosti, což je v **67 ze 128 místností uvnitř něčeho**. Změřil
jsem, co se stane, když se tam opravdu postaví a 200 snímků se zkusí odejít —
**35× přijde o život, 27× se odtamtud nedostane, 5× vyjde bez úhony.** Hra je
tedy dnes ve 62 místnostech ze 128 nehratelná od prvního snímku, a spraví to
teprve vstupní pozice z oblouku, tedy M7. Nic jiného před M7 nemá smysl.

**C — Formát dat: zahodit `phase`, zbytek nechat.**
Detaily v kap. 7. `data/global.json` založit až v M8, kdy pro něj bude obsah.

**D — Izo vrstva zůstává v repu hry, GDD kap. 8 se zmírní.**
Detaily v kap. 8.

**E — Výkon: neoptimalizovat, zapsat recept.**
Čísla zatím problém neukazují (kap. 5). Recept na `newSurface()` je v kap. 5
a vytáhne se, až profil na slabém zařízení v M12 řekne, že je potřeba.

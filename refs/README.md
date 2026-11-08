# refs/ — stažené podklady

Pracovní kopie cizích materiálů z `RESOURCES.md`. **Do repozitáře se
necommitují** (viz `.gitignore`) — jde o cizí dílo a herní data. Cokoliv se
z nich reálně použije, se zapíše do `SOURCES.md` / `CREDITS.md`.

Staženo 2026-08-31. Celkem ~24 MB.

## disasm/ — reverzní inženýrství

| Cesta | Co to je | K čemu |
|---|---|---|
| `jonsole-knightlore/knightlore.asm` | 385 kB komentovaný Z80 zdroják (sjasmplus), pojmenované proměnné a tabulky; autor disassembly tcdev v1.00rc7, relokace a komentáře jonsole | **hlavní zdroj pravdy** pro engine, data i konstanty |
| `jonsole-knightlore/knightlore.sna` | 48K snapshot sestavený z výše uvedeného zdrojáku | binární obraz pro konvertor (M1) i pro emulátor |
| `jonsole-knightlore/knightlore.sld` | mapa symbolů z buildu | dohledání adres v paměti |
| `mrcook-zx-spectrum-games/knight-lore/*.skool,*.ctl` | tatáž disassembly ve formátu SkoolKit | druhý pohled, generování HTML dokumentace |
| `mrcook-zx-spectrum-games/knight-lore/original/knightlore_v100rc7.lst.txt` | 661 kB původní listing tcdev **s originálními adresami** | autoritativní adresy v originální binárce |
| `mrcook-zx-spectrum-games/alien8-{icemark,tcdev}/` | totéž pro **Alien 8** (Filmation I, tentýž engine) | bonus — křížová kontrola, budoucí druhý titul |
| `gitlab-z80-knightlore/knight lore.s` | 167 kB varianta disassembly (ASxxxx) | křížová kontrola |
| `level7-knightlore-disassembly.txt` | 370 kB disassembly **BBC Micro verze** (Paul Proctor, 1985) | nezávislý popis týchž algoritmů; pozor, jiná platforma |

Ostatní stažené repozitáře v `mrcook-zx-spectrum-games/` (Atic Atac, Dun Darach,
Tir Na Nog…) nejsou pro tento projekt potřeba, jen se stáhly s celým repem.

## docs/ — texty a rozbory

Každá stránka je uložena jako `*.html` (originál) i `*.txt` (převod pro
grepování).

- `bannalia-filmation-math` — rozbor projekce a řazení hloubky. **Povinná
  četba před M2.**
- `nvg-original-instructions` — dobový návod (Chris Owen): pravidla,
  terminologie, ovládací klávesy.
- `strategywiki-knight-lore` — předměty, kotel, počty.
- `wikipedia-knight-lore` — historie, technika maskování.
- `spectrumcomputing-9366` — archivní záznam, seznam dobových recenzí a skenů.
- `sda-knightlore` — speedrun komentář = hutný popis mechanik.
- `retroports-disassembly-released` — kontext k vydání disassembly.

## maps/ — obrazové podklady

- `KnightLore_map1.jpg`, `KnightLore_2.jpg`, `KnightLore_3.png` (4704×2175),
  `KnightLore_4.jpg` — dobové mapy hradu. **`KnightLore_3.png` není kresba, ale
  slepenec skutečných obrazovek originálu v měřítku 1:1** — čte ho
  `tools/klmap`, kterým se v M9 ověřilo všech 128 místností (`REVIEW-M9.md`).
- `KnightLore.gif` — 256×192 snímek z hry, **referenční obrázek pro
  pixel-porovnání v M2**.
- `KnightLore_info-sheet.jpg` — informační list.

## original/ — binárka

- `knightlore-jonsole-build.sna` — kopie snapshotu z disassembly (49 179 B =
  27 B hlavička + 48 KB paměti).
- `knightlore_v100rc7.lst.txt` — listing s originálními adresami.

**Chybí:** originální páska (TZX/TAP). Spectrum Computing i archive.org
odmítly přímé stažení (404 / 503) — je potřeba ji stáhnout ručně z
<https://spectrumcomputing.co.uk/entry/9366/ZX-Spectrum/Knight_Lore> nebo
<https://worldofspectrum.net/item/0009366/>. Pro M1 není nutná, snapshot stačí.

## Co ještě chybí (vyžaduje zásah uživatele)

1. **Emulátor s debuggerem** — v systému není nainstalovaný ani Fuse, ani
   ZEsarUX. `sudo apt install fuse-emulator-gtk spectrum-roms` (ZEsarUX má
   lepší debugger, ale instaluje se ručně z GitHubu). Bez něj nelze dělat
   měření podle `RESOURCES.md` kap. 4 a pixel-porovnání v M2.
2. **SkoolKit** (volitelné) — `pip install skoolkit`, pokud budeme chtít
   z `.skool` generovat prohlížitelnou HTML disassembly.
3. Originální páska, viz výše.

## Licenční poznámka

Vše v `refs/` je cizí dílo, staženo pro **studium pravidel a formátu dat**.
Disassembly se používá jako reference, ne jako zdroj kopírovaného kódu —
viz `RESOURCES.md` kap. 7. Autoři: disassembly tcdev, úpravy jonsole,
převod do SkoolKit Michael R. Cook; BBC verze level7.org.uk. Hra samotná
© Ultimate Play The Game / Rare / Microsoft.

#!/usr/bin/env python3
"""Průzkumný skript (ne konvertor pro M1).

Parsuje `location_tbl` přímo ze zdrojáku disassembly
(refs/disasm/jonsole-knightlore/knightlore.asm) a vypíše:
  - počet místností a jejich ID,
  - mřížku hradu 16x16 podle ID (ID = řádek<<4 | sloupec),
  - index velikosti místnosti a barvu (INK) pro každou místnost.

Slouží k ověření formátu dat před psaním skutečného konvertoru z binárky
(M1, ten bude v Node/PHP v `tools/`).

Použití:  python3 tools/recon/dump-location-table.py [cesta/ke/knightlore.asm]
"""
import re
import sys

DEFAULT_ASM = 'refs/disasm/jonsole-knightlore/knightlore.asm'


def read_db_bytes(path, start_label, end_label):
    lines = open(path, encoding='utf-8', errors='replace').read().split('\n')
    start = next(i for i, l in enumerate(lines) if l.startswith(start_label))
    end = next(i for i, l in enumerate(lines) if l.startswith(end_label))
    out = []
    for line in lines[start:end]:
        line = re.sub(r';.*', '', line)
        m = re.search(r'\bDB\b(.*)', line)
        if not m:
            continue
        for tok in m.group(1).split(','):
            tok = tok.strip()
            if tok:
                out.append(int(tok, 16) if tok.startswith('0x') else int(tok))
    return out


def parse_rooms(data):
    """Formát záznamu: [id][size][size-1 dalších bajtů].

    `size` je počítáno od svého vlastního bajtu (viz find_screen v disassembly:
    HL ukazuje na size a posune se o size na další záznam), takže celý záznam
    zabírá 1 + size bajtů.
    """
    rooms = []
    i = 0
    while i + 1 < len(data):
        rid, size = data[i], data[i + 1]
        rooms.append({'id': rid, 'size': size, 'payload': data[i + 2:i + 1 + size]})
        i += 1 + size
    return rooms, len(data) - i


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_ASM
    data = read_db_bytes(path, 'location_tbl:', 'block_type_tbl:')
    rooms, leftover = parse_rooms(data)

    print(f'bajtů tabulky: {len(data)}, místností: {len(rooms)}, zbytek: {leftover}')
    ids = [r['id'] for r in rooms]
    print(f'duplicitní ID: {len(ids) - len(set(ids))}, min/max ID: {min(ids)}/{max(ids)}')

    grid = [['.'] * 16 for _ in range(16)]
    for rid in ids:
        grid[rid >> 4][rid & 15] = '#'
    print('\nmřížka hradu (řádek = ID>>4, sloupec = ID&15):')
    print('\n'.join(''.join(row) for row in grid))

    print('\nID   size  size_idx  ink  bg_typů')
    for r in rooms:
        attr = r['payload'][0]
        bg = r['payload'][1:]
        bg_count = bg.index(0xFF) if 0xFF in bg else len(bg)
        print(f'0x{r["id"]:02X}  {r["size"]:4}  {(attr >> 3) & 0x1F:8}  {attr & 7:3}  {bg_count:6}')


if __name__ == '__main__':
    main()

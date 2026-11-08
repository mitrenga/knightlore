/**
 * Reader of the 48K snapshot built from the jonsole disassembly, together with
 * its symbol file. Shared by the offline tools in tools/; nothing of this runs
 * in the game.
 *
 * Addresses of the original's tables are never written down here: they are
 * looked up by label in the .sld file the disassembly build produces, so a
 * different build of the binary fails loudly instead of decoding rubbish.
 */

import { readFileSync } from 'node:fs';

/** .sna = 27 byte header followed by the 48K of RAM starting at 0x4000. */
const SNA_HEADER = 27;
const RAM_BASE = 0x4000;

export class Snapshot {

  constructor(snapshotPath, symbolsPath) {
    const file = readFileSync(snapshotPath);
    if (file.length !== SNA_HEADER + 0xC000) {
      throw new Error('not a 48K .sna snapshot: ' + snapshotPath);
    }
    this.ram = file.subarray(SNA_HEADER);
    this.symbols = Snapshot.readSymbols(symbolsPath);
  }

  static readSymbols(symbolsPath) {
    const symbols = new Map();
    for (const line of readFileSync(symbolsPath, 'latin1').split('\n')) {
      const fields = line.split('|');
      // fields: source|line|?|?|page|address|type|name, type F = label definition
      if (fields.length < 8 || fields[6] !== 'F') continue;
      if (!symbols.has(fields[7])) symbols.set(fields[7], Number(fields[5]));
    }
    return symbols;
  }

  /** Address of a label from the disassembly. */
  address(label) {
    const address = this.symbols.get(label);
    if (address === undefined) throw new Error('unknown symbol: ' + label);
    return address;
  }

  byte(address) {
    const offset = address - RAM_BASE;
    if (offset < 0 || offset >= this.ram.length) throw new Error('address out of RAM: ' + address);
    return this.ram[offset];
  }

  word(address) {
    return this.byte(address) | (this.byte(address + 1) << 8);
  }

  bytes(address, length) {
    return Array.from({ length }, (unused, index) => this.byte(address + index));
  }

  /** Bytes from `label` up to (not including) `endLabel`. */
  between(label, endLabel) {
    const start = this.address(label);
    return this.bytes(start, this.address(endLabel) - start);
  }

  /**
   * Reads a table of pointers. Its length is not stored anywhere; the original
   * relies on the first pointed-to structure following the table, so the table
   * ends where its first entry begins.
   */
  pointerTable(label) {
    const start = this.address(label);
    const first = this.word(start);
    const count = (first - start) / 2;
    if (!Number.isInteger(count) || count <= 0) {
      throw new Error(label + ': cannot derive the number of entries');
    }
    return Array.from({ length: count }, (unused, index) => this.word(start + index * 2));
  }

} // Snapshot

export default Snapshot;

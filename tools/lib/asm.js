/**
 * Reader of the disassembly source (`refs/disasm/jonsole-knightlore/knightlore.asm`).
 *
 * Two things in the original are code rather than data and cannot be read out
 * of the snapshot without running the game: the sprite anchor each object type
 * uses (`set_pixel_adj`, see NOTES-ORIGINAL.md chapter 12) and the repetition
 * pattern of the screen frame. The anchors are constants inside the update
 * handlers, so this module walks the handler with a deliberately tiny Z80
 * evaluator: it understands only the handful of instructions those handlers
 * use on the way to `set_pixel_adj` and reports "ambiguous" for anything else,
 * rather than guessing.
 */

import { readFileSync } from 'node:fs';

/** Labels the handlers reach `set_pixel_adj` through. */
const SETTERS = new Set(['set_pixel_adj', 'jp_set_pixel_adj', 'loc_C74C']);

/** How many instructions a single handler may take before we give up. */
const STEP_LIMIT = 200;

export class Asm {

  constructor(path) {
    this.lines = readFileSync(path, 'latin1').split('\n');
    this.labels = new Map();
    this.lines.forEach((line, index) => {
      const match = /^([A-Za-z_][\w.]*):/.exec(line);
      if (match && !this.labels.has(match[1])) this.labels.set(match[1], index);
    });
  }

  /** The instruction on a line, without its label and comment. */
  code(index) {
    let line = this.lines[index] ?? '';
    const comment = line.indexOf(';');
    if (comment >= 0) line = line.slice(0, comment);
    return line.replace(/^[A-Za-z_][\w.]*:/, '').trim();
  }

  /** Line number a label is defined on, for error messages and provenance. */
  line(label) {
    const index = this.labels.get(label);
    if (index === undefined) throw new Error('unknown label in the disassembly: ' + label);
    return index + 1;
  }

  /**
   * Words of a `DW a, b, c` table, read from `label` until the first line that
   * is not a DW.
   */
  wordTable(label) {
    if (!this.labels.has(label)) throw new Error('unknown label in the disassembly: ' + label);
    const words = [];
    for (let index = this.labels.get(label); index < this.lines.length; index++) {
      const code = this.code(index);
      if (!code) continue;
      const match = /^DW\s+(.*)$/i.exec(code);
      if (!match) break;
      for (const word of match[1].split(',')) words.push(word.trim());
    }
    return words;
  }

  /**
   * Bytes of a `DB 1, 2, 3` block, read from `label` until the first line that
   * is not a DB.
   */
  byteTable(label) {
    if (!this.labels.has(label)) throw new Error('unknown label in the disassembly: ' + label);
    const bytes = [];
    for (let index = this.labels.get(label); index < this.lines.length; index++) {
      const code = this.code(index);
      if (!code) continue;
      const match = /^DB\s+(.*)$/i.exec(code);
      if (!match) break;
      if (index > this.labels.get(label) && /^[A-Za-z_][\w.]*:/.test(this.lines[index])) break;
      for (const value of match[1].split(',')) {
        const text = value.trim();
        if (!text) continue;
        const number = /^0x/i.test(text) ? parseInt(text, 16) : Number(text);
        if (!Number.isInteger(number)) throw new Error(label + ': cannot read the byte "' + text + '"');
        bytes.push(number & 0xFF);
      }
    }
    return bytes;
  }

  /**
   * Follows an update handler to the `set_pixel_adj` call it makes and returns
   * the anchor it sets, for one combination of graphic number and flip flags.
   *
   * The evaluator knows `ld hl,nn` (the anchor itself), `ld a,(ix+0)` followed
   * by `cp n` (which graphic of the handler's range this is) and
   * `bit 6/7,(ix+7)` (the flip flags), which is exactly what the handlers
   * branch on. A conditional jump on anything else leaves the result marked
   * ambiguous instead of silently picking a branch.
   *
   * @param {string} label handler label from `upd_sprite_jmp_tbl`
   * @param {object} state `{graphic, flipHorizontal, flipVertical}`
   * @returns {object|false} `{x, y, via, ambiguous}` or false when the handler
   *   sets no anchor at all
   */
  traceAnchor(label, state) {
    const via = [label];
    let index = this.labels.get(label);
    if (index === undefined) return false;
    let register = 0;
    let accumulator = false;
    let zero = false;                    // false = unknown
    let ambiguous = false;

    for (let step = 0; step < STEP_LIMIT; step++, index++) {
      const code = this.code(index);
      const here = /^([A-Za-z_][\w.]*):/.exec(this.lines[index]);
      if (here && SETTERS.has(here[1])) {
        return { x: signed(register & 0xFF), y: signed((register >> 8) & 0xFF), via, ambiguous };
      }
      if (!code) continue;

      const name = code.split(/\s+/)[0].toLowerCase();
      const args = code.slice(name.length).trim();
      let match;

      if (name === 'ld' && (match = /^hl,\s*(0x[0-9A-Fa-f]+|\d+)$/.exec(args))) {
        register = Number(match[1]);
        continue;
      }
      if (name === 'ld' && /^a,\s*\(ix\+0\)$/.test(args)) {
        accumulator = 'graphic';
        continue;
      }
      if (name === 'cp' && (match = /^(0x[0-9A-Fa-f]+|\d+)$/.exec(args))) {
        zero = accumulator === 'graphic' ? { value: state.graphic === Number(match[1]) } : false;
        continue;
      }
      if (name === 'bit' && (match = /^([67]),\s*\(ix\+7\)$/.exec(args))) {
        // flags bit 6 = horizontal flip, bit 7 = vertical flip
        const set = match[1] === '6' ? !!state.flipHorizontal : !!state.flipVertical;
        zero = { value: !set };
        continue;
      }
      if (name === 'jr' || name === 'jp') {
        const parts = args.split(',').map((part) => part.trim());
        const condition = parts.length > 1 ? parts[0].toUpperCase() : false;
        const target = parts.length > 1 ? parts[1] : parts[0];
        if (condition === false || SETTERS.has(target)) {
          if (SETTERS.has(target)) {
            return { x: signed(register & 0xFF), y: signed((register >> 8) & 0xFF), via, ambiguous };
          }
          via.push(target);
          const jumped = this.labels.get(target);
          if (jumped === undefined) return false;
          index = jumped - 1;
          continue;
        }
        let taken;
        if (zero !== false && (condition === 'Z' || condition === 'NZ')) {
          taken = condition === 'Z' ? zero.value : !zero.value;
        } else {
          // an unknown condition: keep walking the fall-through path, but say so
          ambiguous = true;
          taken = false;
        }
        if (taken) {
          via.push(target);
          const jumped = this.labels.get(target);
          if (jumped === undefined) return false;
          index = jumped - 1;
        }
        continue;
      }
      if (name === 'call') {
        const target = args.trim();
        if (SETTERS.has(target)) {
          return { x: signed(register & 0xFF), y: signed((register >> 8) & 0xFF), via, ambiguous };
        }
        const called = this.traceAnchor(target, state);
        if (called !== false) {
          return { x: called.x, y: called.y, via: via.concat(called.via), ambiguous: ambiguous || called.ambiguous };
        }
        continue;
      }
      if (name === 'ret' && !args) {
        return false;
      }
    }
    return false;
  } // traceAnchor

} // Asm

/** A byte read as a signed value, which is how the anchors are stored. */
function signed(value) {
  return value > 127 ? value - 256 : value;
}

export default Asm;

// begin code

/**
 * The day and the night, which in the original are one thing: the sun and the
 * moon crossing the little window in the panel (`print_sun_moon` and
 * `display_sun_moon_frame`, line 4353).
 *
 * There is no clock and no timer. Every eighth frame the sun moves one pixel to
 * the right, and when it reaches the right hand end of its run it is replaced
 * by the moon, put back at the left hand end, and the hero is told to change
 * shape. Forty nine pixels at eight frames each is 392 frames, and at the game's
 * twelve and a half frames a second that is a day of about half a minute and a
 * day and a night of just over one.
 *
 * `NOTES-ORIGINAL.md` chapter 3: nothing else in the castle knows about the
 * cycle. The rooms do not change, no object appears or disappears; the sun and
 * the moon decide what the hero looks like, which of the two the cauldron will
 * take an object from (M8), and which way the bouncing ball hops. That is all.
 *
 * A classic script, not a module: it is loaded into the game worker with
 * `importScripts()`, and the offline tools run this very file.
 */

class DayNight {

  constructor() {
    /** Graphic number in the window: the sun, or the moon beside it. */
    this.graphic = DayNight.sun;
    /** Where the sun has got to, in screen pixels (`sun_moon_scratchpad+26`). */
    this.pixelX = DayNight.firstX;
    /** Days gone by, counted at every daybreak (`inc_days`). */
    this.days = 0;
    /**
     * Set the moment the sun is swapped for the moon, cleared by the hero when
     * he starts to change shape (`transform_flag_graphic`).
     */
    this.transformPending = false;
  } // constructor

  /**
   * One frame of the sky.
   *
   * @param {number} frame the frame counter the whole room runs on
   * @param {boolean} [frozen] true once the potion is made: `print_sun_moon`
   *   keeps nudging the sun along, but `display_sun_moon_frame` gives up at its
   *   first line, so the sun never reaches the end of its run, never turns into
   *   the moon and never counts another day
   * @returns {boolean} true when the picture in the window changed
   */
  step(frame, frozen) {
    if ((frame & DayNight.everyFrames) !== 0) {
      return false;
    }
    this.pixelX++;
    if (frozen || this.pixelX < DayNight.lastX) {
      return true;
    }
    this.graphic ^= 1;
    this.pixelX = DayNight.firstX;
    this.transformPending = true;
    if (!this.night()) {
      this.days++;
    }
    return true;
  } // step

  /** Is it night? The moon is the sun's graphic number with bit 0 set. */
  night() {
    return (this.graphic & 1) === 1;
  } // night

  /**
   * How high the sun rides, from how far it has come: a thirteen entry curve
   * (`sun_moon_yoff`), one entry per four pixels of the run.
   *
   * @returns {number} the pixel row, counted the original's way
   */
  pixelY() {
    return DayNight.curve[((this.pixelX+16) >> 2) & 0x0f] || 0;
  } // pixelY

  /**
   * What the panel needs to draw, and the overlay to report.
   *
   * @returns {object} `{graphic, x, y, night, days}`
   */
  state() {
    return {
      graphic: this.graphic,
      x: this.pixelX,
      y: this.pixelY(),
      night: this.night(),
      days: this.days
    };
  } // state

} // DayNight

/** Graphic number of the sun; the moon is the next one (`init_sun`). */
DayNight.sun = 88;

/** Where the run starts and where it ends, in screen pixels. */
DayNight.firstX = 176;
DayNight.lastX = 225;

/** The sun moves on every frame whose counter has these bits clear. */
DayNight.everyFrames = 7;

/**
 * The day the game ends on (`inc_days`: `cp 64`).
 *
 * The original keeps the counter as two BCD digits and compares it with the
 * byte 64, which is 0x40 - and 0x40 read as BCD is forty. So the number it is
 * waiting for is the one the panel is showing: the fortieth day is the last.
 */
DayNight.lastDay = 40;

/** `sun_moon_yoff`: how high the sun is, every four pixels of its run. */
DayNight.curve = [5, 6, 7, 8, 9, 10, 10, 9, 8, 7, 6, 5, 5];

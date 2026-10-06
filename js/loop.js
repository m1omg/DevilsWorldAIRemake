/*
 * Devil's Maze — fixed-timestep main loop.
 *
 * The game always advances in exact 1/60 s ticks. Real elapsed time is summed
 * in whole microseconds (integers, so no rounding drift builds up) and the
 * number of ticks owed is floor(elapsed * 60). A 30 Hz, 60 Hz, 144 Hz or
 * 240 Hz display therefore runs the game at the same speed; faster displays
 * just draw more interpolated frames in between.
 */
(function (root) {
  'use strict';
  const DM = (root.DM = root.DM || {});

  function createLoop(opts) {
    const hz = opts.hz || 60;
    const maxFrameMs = opts.maxFrameMs || 250; // after a stall, don't fast-forward more than this
    const maxSteps = opts.maxSteps || 20;
    let last = null;
    let totalUs = 0;
    let done = 0;
    let alpha = 0;

    return {
      // now: a timestamp in ms (requestAnimationFrame / performance.now()).
      // active: false while paused, so paused time is not owed afterwards.
      frame(now, active) {
        if (last === null) last = now;
        let dt = now - last;
        last = now;
        if (!(dt > 0)) dt = 0;
        if (dt > maxFrameMs) dt = maxFrameMs;
        let steps = 0;
        if (active !== false) {
          totalUs += Math.round(dt * 1000);
          const target = Math.floor((totalUs * hz) / 1e6);
          while (done < target && steps < maxSteps) {
            opts.tick();
            done++;
            steps++;
          }
          if (done < target) {
            // The device cannot keep up: forget the time we could not simulate
            // (the game slows down briefly instead of spiralling).
            totalUs -= Math.round(((target - done) * 1e6) / hz);
          }
          alpha = ((totalUs * hz) % 1e6) / 1e6;
        }
        if (opts.render) opts.render(alpha);
        return steps;
      },
      reset() {
        last = null;
        totalUs = 0;
        done = 0;
        alpha = 0;
      },
      get ticks() {
        return done;
      },
    };
  }

  DM.createLoop = createLoop;
})(typeof window !== 'undefined' ? window : globalThis);

// MAP WORKER: paints the level map's episode lands and prop atlases away from the page's main thread (on an
// OffscreenCanvas), so scrolling into a new episode never holds up a frame. It sends back the finished pixels
// (premultiplied, ready for the GPU) and the things that stand on the land; the map uploads them a few rows a frame.
// Jobs:
//   { type: 'land', id, ratio, px_w, px_h, road: Float32Array [x, half, ...] every road_step px from road_from, options }
//     -> { type: 'land', id, pixels, standing }
//   { type: 'atlas', id, family, land, ratio } -> { type: 'atlas', id, pixels, width, height, cells, anchor_x, anchor_y }
//   Any failure -> { type: 'failed', id, error }: the map then paints on its main thread instead.
importScripts('util.js', 'scenery.js', 'mapart.js');

(function attachMapWorker(scope) {
  'use strict';
  const MAPART = scope.SC.MAPART;

  /** The road's middle and half width at canvas row y, from the samples the map sent (straight between samples). */
  function roadFrom(samples, from, step) {
    const last = samples.length / 2 - 1;
    return (y) => {
      const at = Math.max(0, Math.min(last, (y - from) / step));
      const low = Math.floor(at);
      const high = Math.min(last, low + 1);
      const t = at - low;
      return { x: samples[low * 2] + (samples[high * 2] - samples[low * 2]) * t, half: samples[low * 2 + 1] + (samples[high * 2 + 1] - samples[low * 2 + 1]) * t };
    };
  }

  /** The canvas's pixels, premultiplied by their alpha (what the map's textures expect). */
  function pixelsOf(ctx, width, height) {
    const data = ctx.getImageData(0, 0, width, height).data;
    for (let index = 3; index < data.length; index += 4) {
      const alpha = data[index];
      if (alpha === 255) continue;
      data[index - 3] = (data[index - 3] * alpha) / 255;
      data[index - 2] = (data[index - 2] * alpha) / 255;
      data[index - 1] = (data[index - 1] * alpha) / 255;
    }
    return data;
  }

  scope.onmessage = (event) => {
    const job = event.data;
    try {
      if (job.type === 'land') {
        const canvas = new OffscreenCanvas(job.px_w, job.px_h);
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.scale(job.ratio, job.ratio);
        const options = Object.assign({}, job.options, { road: roadFrom(job.road, job.road_from, job.road_step) });
        const standing = MAPART.paintEpisode(ctx, options);
        const pixels = pixelsOf(ctx, job.px_w, job.px_h);
        scope.postMessage({ type: 'land', id: job.id, pixels, standing }, [pixels.buffer]);
      } else if (job.type === 'atlas') {
        const atlas = MAPART.buildAtlas(job.family, job.land, job.ratio, (width, height) => new OffscreenCanvas(width, height));
        const width = atlas.canvas.width;
        const height = atlas.canvas.height;
        const pixels = pixelsOf(atlas.canvas.getContext('2d', { willReadFrequently: true }), width, height);
        scope.postMessage({ type: 'atlas', id: job.id, pixels, width, height, cells: atlas.cells, anchor_x: atlas.anchor_x, anchor_y: atlas.anchor_y }, [pixels.buffer]);
      }
    } catch (error) {
      scope.postMessage({ type: 'failed', id: job.id, error: String(error && error.message ? error.message : error) });
    }
  };
})(self);

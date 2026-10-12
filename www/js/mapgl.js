// MAPGL: a small WebGL drawer for the level map's world. The map's land, standing props and sky are painted once into
// canvases; this uploads each as a texture (mipmapped where the browser allows, so far-away land stays clean) and draws
// the frame as a handful of batched textured triangles: about one draw call per visible episode, one per sprite atlas
// and one for the sky, instead of hundreds of 2D-canvas draws (which a phone's browser must hand to its GPU every
// frame). The canvas is sized to the screen's real pixels, so the map is as sharp as the phone allows.
// create() returns null where WebGL is missing; the map then keeps its 2D-canvas drawing.
(function attachMapGl(root) {
  'use strict';
  const SC = root.SC || (root.SC = {});

  const VERTEX = `
attribute vec2 a_pos;
attribute vec2 a_uv;
attribute float a_alpha;
uniform vec2 u_view;
varying vec2 v_uv;
varying float v_alpha;
void main() {
  vec2 clip = a_pos / u_view * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_uv = a_uv;
  v_alpha = a_alpha;
}`;
  const FRAGMENT = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 v_uv;
varying float v_alpha;
uniform sampler2D u_tex;
uniform vec4 u_tint;
void main() {
  gl_FragColor = texture2D(u_tex, v_uv) * u_tint * v_alpha;
}`;
  const FLOATS_PER_VERTEX = 5; // x, y (CSS px on the map canvas), u, v, alpha

  function isPowerOfTwo(value) {
    return value > 0 && (value & (value - 1)) === 0;
  }

  function create(canvas) {
    if (!canvas || typeof canvas.getContext !== 'function') return null;
    const options = { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: true, preserveDrawingBuffer: false };
    let gl = null;
    let webgl2 = false;
    try {
      gl = canvas.getContext('webgl2', options);
      webgl2 = !!gl;
      if (!gl) gl = canvas.getContext('webgl', options) || canvas.getContext('experimental-webgl', options);
    } catch (context_error) {
      gl = null;
    }
    if (!gl) return null;

    let program = null;
    let buffer = null;
    let white = null;
    let locations = null;
    let lost = false;
    let max_texture = 2048;
    const textures = new Map(); // key (the source canvas, or the caller's object) -> { texture, width, height }
    const listeners = { lost: [], restored: [] };

    function compile(type, source) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error(`map shader: ${gl.getShaderInfoLog(shader)}`);
      return shader;
    }

    function init() {
      program = gl.createProgram();
      gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
      gl.bindAttribLocation(program, 0, 'a_pos');
      gl.bindAttribLocation(program, 1, 'a_uv');
      gl.bindAttribLocation(program, 2, 'a_alpha');
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(`map program: ${gl.getProgramInfoLog(program)}`);
      locations = { view: gl.getUniformLocation(program, 'u_view'), tex: gl.getUniformLocation(program, 'u_tex'), tint: gl.getUniformLocation(program, 'u_tint') };
      buffer = gl.createBuffer();
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(0);
      gl.enableVertexAttribArray(1);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, FLOATS_PER_VERTEX * 4, 0);
      gl.vertexAttribPointer(1, 2, gl.FLOAT, false, FLOATS_PER_VERTEX * 4, 8);
      gl.vertexAttribPointer(2, 1, gl.FLOAT, false, FLOATS_PER_VERTEX * 4, 16);
      gl.uniform1i(locations.tex, 0);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // textures are uploaded premultiplied
      white = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, white);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      max_texture = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 2048;
    }

    try {
      init();
    } catch (init_error) {
      return null;
    }

    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      lost = true;
      textures.clear();
      listeners.lost.forEach((listener) => listener());
    });
    canvas.addEventListener('webglcontextrestored', () => {
      try {
        init();
        lost = false;
        listeners.restored.forEach((listener) => listener());
      } catch (restore_error) {
        lost = true;
      }
    });

    function filtering(handle, mipmap) {
      const can_mipmap = mipmap && (webgl2 || (isPowerOfTwo(handle.width) && isPowerOfTwo(handle.height)));
      if (can_mipmap) gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, can_mipmap ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }

    /**
     * Uploads a canvas or bitmap once (premultiplied, mipmapped when allowed) and returns its handle; later calls with
     * the same key (default: the source) reuse it.
     */
    function upload(source, mipmap, key) {
      const id = key || source;
      if (lost || !source) return null;
      const known = textures.get(id);
      if (known) return known;
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      const handle = { texture, width: source.width, height: source.height };
      filtering(handle, mipmap);
      textures.set(id, handle);
      return handle;
    }

    /**
     * A texture of width x height to fill a few rows at a time with uploadRows() (so a big picture reaches the GPU over
     * several frames), then finish().
     */
    function allocate(key, width, height) {
      if (lost) return null;
      release(key);
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      const handle = { texture, width, height };
      textures.set(key, handle);
      return handle;
    }

    /** Copies rows y .. y + rows of premultiplied RGBA pixels (the whole picture's array) into the texture. */
    function uploadRows(handle, pixels, y, rows) {
      if (lost || !handle) return;
      gl.bindTexture(gl.TEXTURE_2D, handle.texture);
      const row_bytes = handle.width * 4;
      const view = new Uint8Array(pixels.buffer, pixels.byteOffset + y * row_bytes, rows * row_bytes);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, y, handle.width, rows, gl.RGBA, gl.UNSIGNED_BYTE, view);
    }

    function finish(handle, mipmap) {
      if (lost || !handle) return;
      gl.bindTexture(gl.TEXTURE_2D, handle.texture);
      filtering(handle, mipmap);
    }

    function release(key) {
      const handle = textures.get(key);
      if (!handle) return;
      textures.delete(key);
      if (!lost) gl.deleteTexture(handle.texture);
    }

    /** Starts a frame: the drawing buffer is width_px x height_px; vertices are in CSS px of a view_w x view_h map. */
    function begin(width_px, height_px, view_w, view_h, clear) {
      if (lost) return false;
      if (canvas.width !== width_px || canvas.height !== height_px) {
        canvas.width = width_px;
        canvas.height = height_px;
      }
      gl.viewport(0, 0, width_px, height_px);
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.uniform2f(locations.view, view_w, view_h);
      gl.clearColor(clear[0], clear[1], clear[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return true;
    }

    /** Draws `count` vertices (triangles) of x, y, u, v, alpha from `data` with a texture handle (null: plain colour) and a tint. */
    function draw(handle, data, count, tint) {
      if (lost || count < 3) return;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, handle ? handle.texture : white);
      const color = tint || [1, 1, 1, 1];
      gl.uniform4f(locations.tint, color[0] * color[3], color[1] * color[3], color[2] * color[3], color[3]);
      gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, count * FLOATS_PER_VERTEX), gl.STREAM_DRAW);
      gl.drawArrays(gl.TRIANGLES, 0, count);
    }

    return {
      webgl2,
      get max_texture() {
        return max_texture;
      },
      get lost() {
        return lost;
      },
      upload,
      allocate,
      uploadRows,
      finish,
      release,
      has: (source) => textures.has(source),
      begin,
      draw,
      onLost: (listener) => listeners.lost.push(listener),
      onRestored: (listener) => listeners.restored.push(listener),
    };
  }

  /** A growable vertex list for one draw: quad() and rect() append two triangles. */
  function createBatch(initial) {
    let data = new Float32Array((initial || 1024) * FLOATS_PER_VERTEX);
    let count = 0;
    function ensure(extra) {
      if ((count + extra) * FLOATS_PER_VERTEX <= data.length) return;
      const grown = new Float32Array(Math.max(data.length * 2, (count + extra) * FLOATS_PER_VERTEX));
      grown.set(data.subarray(0, count * FLOATS_PER_VERTEX));
      data = grown;
    }
    function vertex(x, y, u, v, alpha) {
      const at = count * FLOATS_PER_VERTEX;
      data[at] = x;
      data[at + 1] = y;
      data[at + 2] = u;
      data[at + 3] = v;
      data[at + 4] = alpha;
      count += 1;
    }
    return {
      reset() {
        count = 0;
      },
      get count() {
        return count;
      },
      get data() {
        return data;
      },
      /** An opaque quad from four corners (top-left, top-right, bottom-right, bottom-left), each [x, y, u, v]. */
      quad(a, b, c, d) {
        ensure(6);
        vertex(a[0], a[1], a[2], a[3], 1);
        vertex(b[0], b[1], b[2], b[3], 1);
        vertex(c[0], c[1], c[2], c[3], 1);
        vertex(a[0], a[1], a[2], a[3], 1);
        vertex(c[0], c[1], c[2], c[3], 1);
        vertex(d[0], d[1], d[2], d[3], 1);
      },
      /** An axis-aligned quad: screen rectangle x, y, w, h, texture rectangle u0, v0, u1, v1 and opacity (default 1). */
      rect(x, y, w, h, u0, v0, u1, v1, alpha) {
        const a = alpha === undefined ? 1 : alpha;
        ensure(6);
        vertex(x, y, u0, v0, a);
        vertex(x + w, y, u1, v0, a);
        vertex(x + w, y + h, u1, v1, a);
        vertex(x, y, u0, v0, a);
        vertex(x + w, y + h, u1, v1, a);
        vertex(x, y + h, u0, v1, a);
      },
    };
  }

  const MAPGL = { create, createBatch, FLOATS_PER_VERTEX };
  SC.MAPGL = MAPGL;
  if (typeof module === 'object' && module.exports) module.exports = MAPGL;
})(typeof window !== 'undefined' ? window : globalThis);

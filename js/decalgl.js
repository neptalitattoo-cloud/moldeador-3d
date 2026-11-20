// Pinta los recortes de la foto en la capa de tatuaje (espacio UV) con WebGL2, en una sola pasada por recorte:
//  - cada triángulo de la malla se rellena una vez (sin solapes: no salen líneas de malla en el borde suave);
//  - en el borde de las islas UV el tatuaje se extiende `bleed` px hacia fuera (sangrado), sólo fuera de las islas
//    (plantilla/stencil), para que no aparezca una línea color piel al alejar la vista o en Procreate.
// Si no hay WebGL2, app.js usa el dibujo 2D de respaldo.
const VS = `#version 300 es
in vec2 aUV; in vec2 aTC; out vec2 vTC;
void main() { vTC = aTC; gl_Position = vec4(aUV * 2.0 - 1.0, 0.0, 1.0); }`;
const FS = `#version 300 es
precision highp float;
uniform sampler2D uImg; in vec2 vTC; out vec4 o;
void main() {
  if (vTC.x < 0.0 || vTC.y < 0.0 || vTC.x > 1.0 || vTC.y > 1.0) discard;
  o = texture(uImg, vTC);
}`;

export class DecalGL {
  constructor(base) {
    this.base = base;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = 1;
    const gl = this.canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: true,
      antialias: false,
      stencil: true,
      depth: false,
    });
    if (!gl) throw new Error('sin WebGL2');
    this.gl = gl;
    this.lost = false;
    this.canvas.addEventListener('webglcontextlost', e => {
      e.preventDefault();
      this.lost = true;
    });
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    this.prog = p;
    this.aUV = gl.getAttribLocation(p, 'aUV');
    this.aTC = gl.getAttribLocation(p, 'aTC');
    this.buf = gl.createBuffer();
    this.tex = new WeakMap();
    // todas las islas UV (para la plantilla) y sus aristas de borde
    const { FT, VT } = base,
      nVT = base.meta.nVT;
    const isl = new Float32Array((FT.length / 3) * 12);
    for (let f = 0, o = 0; f < FT.length; f += 3)
      for (let k = 0; k < 3; k++, o += 4) {
        isl[o] = VT[2 * FT[f + k]];
        isl[o + 1] = VT[2 * FT[f + k] + 1];
      }
    this.islands = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.islands);
    gl.bufferData(gl.ARRAY_BUFFER, isl, gl.STATIC_DRAW);
    this.nIsl = FT.length;
    const cnt = new Map();
    for (let f = 0; f < FT.length; f += 3)
      for (let k = 0; k < 3; k++) {
        const a = FT[f + k],
          b = FT[f + ((k + 1) % 3)],
          key = Math.min(a, b) * nVT + Math.max(a, b);
        cnt.set(key, (cnt.get(key) || 0) + 1);
      }
    this.border = new Set([...cnt].filter(([, c]) => c === 1).map(([k]) => k));
    this.nVT = nVT;
  }
  _texture(img) {
    const gl = this.gl;
    const t = this.tex.get(img);
    if (t && t.w === img.width && t.h === img.height) return t.t;
    if (t) gl.deleteTexture(t.t);
    const tx = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tx);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.tex.set(img, { t: tx, w: img.width, h: img.height });
    return tx;
  }
  forget(img) {
    const t = this.tex.get(img);
    if (t) this.gl.deleteTexture(t.t);
    this.tex.delete(img);
  }
  /**
   * items: [{ tris (de decalTriangles, con .t), img (canvas del recorte), W, H (cm) }]
   * Devuelve el canvas W×H px (transparente fuera de los tatuajes).
   */
  render(Wpx, Hpx, items, bleed = 6) {
    const gl = this.gl;
    if (this.lost || gl.isContextLost()) throw new Error('contexto WebGL perdido');
    if (this.canvas.width !== Wpx || this.canvas.height !== Hpx) {
      this.canvas.width = Wpx;
      this.canvas.height = Hpx;
    }
    gl.viewport(0, 0, Wpx, Hpx);
    gl.clearColor(0, 0, 0, 0);
    gl.clearStencil(0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    gl.useProgram(this.prog);
    gl.disable(gl.DEPTH_TEST);
    // 1) plantilla = 1 dentro de las islas UV
    gl.enable(gl.STENCIL_TEST);
    gl.stencilFunc(gl.ALWAYS, 1, 0xff);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
    gl.colorMask(false, false, false, false);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.islands);
    gl.enableVertexAttribArray(this.aUV);
    gl.vertexAttribPointer(this.aUV, 2, gl.FLOAT, false, 16, 0);
    gl.disableVertexAttribArray(this.aTC);
    gl.vertexAttrib2f(this.aTC, -1, -1); // fuera del recorte: se descarta
    gl.drawArrays(gl.TRIANGLES, 0, this.nIsl);
    gl.colorMask(true, true, true, true);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // alfa premultiplicado
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.enableVertexAttribArray(this.aTC);
    gl.activeTexture(gl.TEXTURE0);
    const ex = [bleed / Wpx, bleed / Hpx];
    for (const it of items) {
      const { tris, W, H } = it;
      gl.bindTexture(gl.TEXTURE_2D, this._texture(it.img));
      // 2) dentro: cada triángulo una vez
      const inner = new Float32Array(tris.length * 12);
      const tc = ([x, y]) => [x / W + 0.5, y / H + 0.5];
      let o = 0;
      const quads = [];
      for (const t of tris) {
        for (let k = 0; k < 3; k++) {
          const [s, r] = tc(t.p[k]);
          inner[o++] = t.q[k][0];
          inner[o++] = t.q[k][1];
          inner[o++] = s;
          inner[o++] = r;
        }
        // 3) aristas en el borde de una isla: se extruyen hacia fuera
        if (!t.t || !bleed) continue;
        for (let k = 0; k < 3; k++) {
          const a = t.t[k],
            b = t.t[(k + 1) % 3];
          if (!this.border.has(Math.min(a, b) * this.nVT + Math.max(a, b))) continue;
          const qa = t.q[k],
            qb = t.q[(k + 1) % 3],
            qc = t.q[(k + 2) % 3];
          let nx = -(qb[1] - qa[1]) * Hpx,
            ny = (qb[0] - qa[0]) * Wpx; // perpendicular en píxeles
          const l = Math.hypot(nx, ny) || 1;
          nx /= l;
          ny /= l;
          if (nx * (qc[0] - qa[0]) * Wpx + ny * (qc[1] - qa[1]) * Hpx > 0) {
            nx = -nx;
            ny = -ny;
          }
          const ta = tc(t.p[k]),
            tb = tc(t.p[(k + 1) % 3]);
          const A2 = [qa[0] + nx * ex[0], qa[1] + ny * ex[1]],
            B2 = [qb[0] + nx * ex[0], qb[1] + ny * ex[1]];
          quads.push(qa, ta, qb, tb, B2, tb, qa, ta, B2, tb, A2, ta);
        }
      }
      gl.stencilFunc(gl.ALWAYS, 1, 0xff);
      gl.bufferData(gl.ARRAY_BUFFER, inner, gl.STREAM_DRAW);
      gl.vertexAttribPointer(this.aUV, 2, gl.FLOAT, false, 16, 0);
      gl.vertexAttribPointer(this.aTC, 2, gl.FLOAT, false, 16, 8);
      gl.drawArrays(gl.TRIANGLES, 0, tris.length * 3);
      if (quads.length) {
        const qb = new Float32Array(quads.length * 2);
        quads.forEach((v, i) => {
          qb[2 * i] = v[0];
          qb[2 * i + 1] = v[1];
        });
        gl.stencilFunc(gl.EQUAL, 0, 0xff); // sólo fuera de las islas
        gl.bufferData(gl.ARRAY_BUFFER, qb, gl.STREAM_DRAW);
        gl.vertexAttribPointer(this.aUV, 2, gl.FLOAT, false, 16, 0);
        gl.vertexAttribPointer(this.aTC, 2, gl.FLOAT, false, 16, 8);
        gl.drawArrays(gl.TRIANGLES, 0, quads.length / 2);
      }
    }
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.BLEND);
    return this.canvas;
  }
  dispose() {
    const ext = this.gl.getExtension('WEBGL_lose_context');
    if (ext) ext.loseContext();
    this.canvas.width = this.canvas.height = 1;
  }
}

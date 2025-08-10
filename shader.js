// Trippy fluid shader helper
export class TrippyFluid {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl');
    if (!this.gl) throw new Error('WebGL not supported');

    this.time = 0;
    this.running = false;

    this.vertexSrc = `
      attribute vec2 position;
      varying vec2 vUv;
      void main() {
        vUv = position * 0.5 + 0.5;
        gl_Position = vec4(position, 0.0, 1.0);
      }
    `;

    this.fragmentSrc = `
      precision highp float;
      uniform float u_time;
      uniform vec2 u_res;
      varying vec2 vUv;

      // iq noise
      float hash(float n) { return fract(sin(n)*43758.5453123); }
      float noise(in vec3 x){
        vec3 p=floor(x);
        vec3 f=fract(x);
        f=f*f*(3.0-2.0*f);
        float n=p.x+p.y*57.0+p.z*113.0;
        return mix(mix(mix(hash(n+0.0),hash(n+1.0),f.x),
                       mix(hash(n+57.0),hash(n+58.0),f.x),f.y),
                   mix(mix(hash(n+113.0),hash(n+114.0),f.x),
                       mix(hash(n+170.0),hash(n+171.0),f.x),f.y),f.z);
      }

      vec3 palette(float t){
        vec3 a=vec3(0.5,0.5,0.5);
        vec3 b=vec3(0.5,0.5,0.5);
        vec3 c=vec3(1.0,1.0,1.0);
        vec3 d=vec3(0.263,0.416,0.557); // bluish
        return a + b*cos(6.28318*(c*t+d));
      }

      void main() {
        vec2 uv = (gl_FragCoord.xy / u_res.xy);
        vec2 p = uv*2.0 - 1.0;
        p.x *= u_res.x/u_res.y;

        float t = u_time * 0.25;
        float n = 0.0;
        vec3 pos = vec3(p*1.5, t);
        for(int i=0;i<5;i++){
          n += noise(pos)*0.5;
          pos.xy *= mat2(1.2, -0.8, 0.8, 1.2);
          pos += vec3(0.1, -0.07, 0.05);
        }
        float w = smoothstep(0.0, 1.0, n);
        vec3 col = palette(w + t*0.1);
        // add light streaks
        float streak = smoothstep(0.6, 1.0, n) * 0.6;
        col += vec3(0.8, 0.2, 0.9) * streak;

        gl_FragColor = vec4(col, 1.0);
      }
    `;

    this._initGL();
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  _createShader(type, src) {
    const sh = this.gl.createShader(type);
    this.gl.shaderSource(sh, src);
    this.gl.compileShader(sh);
    if (!this.gl.getShaderParameter(sh, this.gl.COMPILE_STATUS)) {
      console.error(this.gl.getShaderInfoLog(sh));
      throw new Error('Shader compile failed');
    }
    return sh;
  }

  _initGL() {
    const gl = this.gl;
    const vs = this._createShader(gl.VERTEX_SHADER, this.vertexSrc);
    const fs = this._createShader(gl.FRAGMENT_SHADER, this.fragmentSrc);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(prog));
      throw new Error('Program link failed');
    }
    gl.useProgram(prog);
    this.prog = prog;

    // Quad
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    const verts = new Float32Array([
      -1, -1,
      1, -1,
      -1,  1,
      -1,  1,
      1, -1,
      1,  1,
    ]);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    const posLoc = gl.getAttribLocation(prog, 'position');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    this.u_time = gl.getUniformLocation(prog, 'u_time');
    this.u_res = gl.getUniformLocation(prog, 'u_res');
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.floor(innerWidth * dpr);
    const h = Math.floor(innerHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.canvas.style.width = innerWidth + 'px';
    this.canvas.style.height = innerHeight + 'px';

    const gl = this.gl;
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
  }

  start() {
    this.running = true;
    const loop = (t) => {
      if (!this.running) return;
      this.time = t * 0.001;
      const gl = this.gl;
      gl.useProgram(this.prog);
      gl.uniform1f(this.u_time, this.time);
      gl.uniform2f(this.u_res, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
    this.canvas.style.display = 'block';
  }

  stop() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this.canvas.style.display = 'none';
  }
}


// Post stack: film grain, chromatic aberration, vignette, VHS artifacts that
// intensify as sanity drops, plus transient glitch/shadow pulses.
// One custom fullscreen pass keeps it cheap.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const DreadShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uWarp: { value: 0 },        // 0..1, rises as sanity falls
    uGrain: { value: 0.06 },
    uVignette: { value: 0.95 },
    uAberration: { value: 1.0 },
    uGlitch: { value: 0 },      // transient
    uShadow: { value: 0 },      // transient edge-shadow
    uShadowAngle: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) }
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uWarp;
    uniform float uGrain;
    uniform float uVignette;
    uniform float uAberration;
    uniform float uGlitch;
    uniform float uShadow;
    uniform float uShadowAngle;
    uniform vec2 uResolution;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec2 uv = vUv;
      vec2 cc = uv - 0.5;
      float r2 = dot(cc, cc);

      // unease warp: slow breathing barrel distortion at low sanity
      float breathe = sin(uTime * 0.7) * 0.5 + 0.5;
      uv = 0.5 + cc * (1.0 + r2 * uWarp * 0.16 * (0.6 + breathe * 0.4));

      // VHS line displacement
      float vhs = uWarp * 0.7 + uGlitch;
      if (vhs > 0.01) {
        float band = floor(uv.y * 90.0);
        float n = hash(vec2(band, floor(uTime * 18.0)));
        float disp = (n - 0.5) * 0.012 * vhs * step(0.72, n);
        uv.x += disp;
        // occasional full tear when glitching hard
        if (uGlitch > 0.5) {
          float tear = step(0.92, hash(vec2(band, floor(uTime * 28.0) + 7.0)));
          uv.x += tear * (hash(vec2(band, 3.0)) - 0.5) * 0.18 * uGlitch;
        }
      }

      // chromatic aberration, radial
      float ab = (0.0012 + uWarp * 0.0035 + uGlitch * 0.004) * uAberration;
      vec2 dir = cc * (1.0 + r2);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + dir * ab).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - dir * ab).b;

      // scanlines (subtle, stronger as the tape degrades)
      float scan = sin(uv.y * uResolution.y * 1.6) * 0.5 + 0.5;
      col *= 1.0 - scan * (0.025 + uWarp * 0.07 + uGlitch * 0.06);

      // grain
      float g = hash(uv * uResolution * 0.5 + fract(uTime) * 100.0) - 0.5;
      col += g * (uGrain + uWarp * 0.05 + uGlitch * 0.08);

      // the shadow at the edge of vision
      if (uShadow > 0.001) {
        vec2 sdir = vec2(cos(uShadowAngle), sin(uShadowAngle));
        vec2 spos = 0.5 + sdir * 0.55;
        float sd = distance(vec2(uv.x, uv.y * (uResolution.y / uResolution.x)),
                            vec2(spos.x, spos.y * (uResolution.y / uResolution.x)));
        float blob = smoothstep(0.34, 0.05, sd);
        col *= 1.0 - blob * uShadow * 0.75;
      }

      // vignette
      float vig = smoothstep(0.95, 0.28, r2 * (1.2 + uWarp * 0.9));
      col *= mix(1.0, vig, uVignette);

      // sick color cast as sanity drops
      col = mix(col, col * vec3(0.92, 0.95, 0.82) + vec3(0.012, 0.0, 0.02), uWarp * 0.5);

      gl_FragColor = vec4(col, 1.0);
    }`
};

export class PostFX {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.enabled = true;
    this.composer = new EffectComposer(renderer);
    this.renderPass = new RenderPass(scene, camera);
    this.pass = new ShaderPass(DreadShader);
    this.outputPass = new OutputPass();
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.pass);
    this.composer.addPass(this.outputPass);

    this.scene = scene;
    this.camera = camera;
    this.glitch = 0;
    this.glitchDecay = 2.5;
    this.shadow = 0;
  }

  setSize(w, h) {
    this.composer.setSize(w, h);
    this.pass.uniforms.uResolution.value.set(w, h);
  }

  /** transient: "did that shadow move?" */
  shadowPulse() {
    this.shadow = 1;
    this.pass.uniforms.uShadowAngle.value = Math.random() * Math.PI * 2;
  }

  glitchPulse(strength = 1, decay = 2.5) {
    this.glitch = Math.max(this.glitch, strength);
    this.glitchDecay = decay;
  }

  update(dt, time, sanity) {
    const u = this.pass.uniforms;
    u.uTime.value = time;
    const warp = 1 - sanity / 100;
    u.uWarp.value += (warp * warp - u.uWarp.value) * Math.min(1, dt * 2);
    this.glitch = Math.max(0, this.glitch - dt * this.glitchDecay);
    u.uGlitch.value = this.glitch;
    this.shadow = Math.max(0, this.shadow - dt * 1.4);
    // ease in/out so it's deniable
    const s = this.shadow;
    u.uShadow.value = s > 0.75 ? (1 - s) * 4 : s / 0.75;
  }

  render(dt) {
    if (this.enabled) {
      this.composer.render(dt);
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }
}

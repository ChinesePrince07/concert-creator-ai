import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/** Cinematic grade: bloom, optional DOF, deterministic grain + vignette. */

const GrainVignetteShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    time: { value: 0 },
    grain: { value: 0.045 },
    vignette: { value: 0.42 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float time;
    uniform float grain;
    uniform float vignette;
    varying vec2 vUv;
    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
    }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float g = hash(vUv * vec2(1613.0, 941.0) + fract(time * 0.31) * 97.0) - 0.5;
      c.rgb += g * grain * (0.4 + 0.6 * c.rgb);
      float d = distance(vUv, vec2(0.5));
      c.rgb *= 1.0 - vignette * smoothstep(0.32, 0.85, d);
      gl_FragColor = c;
    }
  `,
};

export interface PostChain {
  render(t: number): void;
  setSize(w: number, h: number): void;
  setQuality(q: 'preview' | 'export'): void;
  setFocus(distance: number): void;
  setGrain(amount: number): void;
  dispose(): void;
}

export function createPost(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
): PostChain {
  const size = renderer.getSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x, size.y, {
    samples: 4,
    type: THREE.HalfFloatType,
  });
  const composer = new EffectComposer(renderer, target);

  const renderPass = new RenderPass(scene, camera);
  const gtao = new GTAOPass(scene, camera, size.x, size.y);
  gtao.output = GTAOPass.OUTPUT.Default;
  gtao.blendIntensity = 0.75;
  const bloom = new UnrealBloomPass(size.clone(), 0.26, 0.6, 0.9);
  const bokeh = new BokehPass(scene, camera, { focus: 2.2, aperture: 0.00016, maxblur: 0.0075 });
  bokeh.enabled = false;
  const grain = new ShaderPass(GrainVignetteShader);
  const smaa = new SMAAPass();
  smaa.enabled = false;
  const output = new OutputPass();

  composer.addPass(renderPass);
  composer.addPass(gtao);
  composer.addPass(bokeh);
  composer.addPass(bloom);
  composer.addPass(grain);
  composer.addPass(output);
  composer.addPass(smaa);

  return {
    render(t: number) {
      grain.uniforms.time.value = t % 97;
      composer.render();
    },
    setSize(w: number, h: number) {
      composer.setSize(w, h);
    },
    setQuality(q) {
      bokeh.enabled = q === 'export';
      smaa.enabled = q === 'export';
      bloom.strength = q === 'export' ? 0.3 : 0.26;
    },
    setFocus(distance: number) {
      (bokeh.uniforms as Record<string, THREE.IUniform>).focus.value = distance;
    },
    setGrain(amount: number) {
      grain.uniforms.grain.value = amount;
    },
    dispose() {
      composer.dispose();
      target.dispose();
    },
  };
}

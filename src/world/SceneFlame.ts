/** A single instanced billboard effect for existing furnace/lantern emitters. No art mesh. */
import * as THREE from 'three';
import type { ThemeStyle } from './Themes';

export function sceneFlameMaterial(st: ThemeStyle): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 }, uWarm: { value: new THREE.Color(st.glow) },
      uHot: { value: new THREE.Color(st.glowHot) },
    }]),
    vertexShader: /* glsl */ `
      varying vec2 vFlameUv; varying float vFlamePhase;
      #include <fog_pars_vertex>
      void main() {
        vFlameUv = uv;
        vFlamePhase = dot(instanceMatrix[3].xyz, vec3(.31, .57, .23));
        vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        vec2 size = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz));
        mvPosition.xy += vec2(position.x, position.y + .5) * size;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uWarm; uniform vec3 uHot;
      varying vec2 vFlameUv; varying float vFlamePhase;
      #include <fog_pars_fragment>
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i=floor(p), f=fract(p), k=f*f*(3.0-2.0*f);
        return mix(mix(hash(i),hash(i+vec2(1.,0.)),k.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.)),k.x),k.y);
      }
      void main() {
        float t = uTime * 1.7 + vFlamePhase;
        float y = vFlameUv.y;
        float n = noise(vec2(vFlameUv.x * 5., y * 6. - t * 2.));
        float bend = sin(y * 8. - t * 2.) * .065 * y + (n - .5) * .10;
        float x = vFlameUv.x - .5 - bend;
        float width = .29 * pow(1. - y, .65) + .018;
        float alpha = (1. - smoothstep(width - .09, width + .045, abs(x)))
          * smoothstep(0., .06, y) * (1. - smoothstep(.72 + n * .17, 1., y));
        alpha *= .6 + n * .4;
        if (alpha < .012) discard;
        float core = exp(-abs(x) * 13.) * pow(1. - y, 1.1);
        vec3 color = mix(uWarm, uHot, clamp(core * 1.4, 0., 1.));
        gl_FragColor = vec4(color, alpha * .88);
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide, forceSinglePass: true, toneMapped: false, fog: true,
  });
}

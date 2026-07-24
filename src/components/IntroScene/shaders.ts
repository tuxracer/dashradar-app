/**
 * Vertex shader: a single full-screen triangle derived from gl_VertexID, so
 * the renderer needs no vertex buffers at all.
 */
export const INTRO_VERTEX_SHADER = /* glsl */ `#version 300 es
void main() {
  vec2 corner = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

/**
 * Fragment shader: the whole night-drive scene. A dark road under a warm
 * horizon, light streaks rushing outward from the vanishing point, a
 * periodic amber scan wave with phosphor afterglow that blooms a blip as it
 * passes, plus film grain and a vignette. Uniforms: uResolution (pixels),
 * uTime (seconds).
 */
export const INTRO_FRAGMENT_SHADER = /* glsl */ `#version 300 es
precision highp float;

uniform vec2 uResolution;
uniform float uTime;
out vec4 outColor;

const vec2 VANISH = vec2(0.0, 0.30);
const vec3 AMBER = vec3(1.0, 0.702, 0.251);
const vec3 SURFACE = vec3(0.043, 0.039, 0.063);
const float SWEEP_PERIOD = 6.0;
const float PI = 3.14159265;

float hash1(float n) {
  return fract(sin(n) * 43758.5453123);
}

float hash2(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

void main() {
  vec2 uv = (gl_FragCoord.xy * 2.0 - uResolution) / uResolution.y;
  vec3 col = SURFACE * 0.55;

  vec2 d = uv - VANISH;
  float r = length(d);
  float ang = atan(d.y, d.x);

  // Warm horizon band and a hot core at the vanishing point.
  col += AMBER * exp(-abs(uv.y - VANISH.y) * 9.0) * 0.10;
  col += AMBER * exp(-r * 5.5) * 0.22;

  // Subtle perspective ground grid flowing toward the viewer, echoing the
  // in-app radar grid backdrop.
  if (uv.y < VANISH.y) {
    float depth = 0.35 / (VANISH.y - uv.y + 1e-3);
    float gx = d.x * depth;
    float lineZ = smoothstep(0.92, 1.0, abs(fract(depth * 0.8 - uTime * 0.7) * 2.0 - 1.0));
    float lineX = smoothstep(0.94, 1.0, abs(fract(gx * 0.5) * 2.0 - 1.0));
    float near = clamp((VANISH.y - uv.y) * 1.4, 0.0, 1.0);
    col += AMBER * (lineZ + lineX) * 0.045 * near;
  }

  // Light streaks: three layers of dashed rays streaming outward from the
  // vanishing point, like passing lights at night.
  for (int layer = 0; layer < 3; layer++) {
    float fl = float(layer);
    float rays = 42.0 + fl * 26.0;
    float id = floor((ang + PI) / (2.0 * PI) * rays);
    float rnd = hash1(id * 17.13 + fl * 91.7);
    float gate = step(0.80, rnd);
    float rayCenter = (id + 0.5) / rays * 2.0 * PI - PI;
    float width = 0.006 + 0.012 * hash1(id * 3.7 + fl);
    float profile = exp(-pow((ang - rayCenter) / width, 2.0));
    float speed = (0.35 + rnd * 0.65) * (0.55 + fl * 0.30);
    float t = fract(r * (0.9 + rnd * 0.8) - uTime * speed);
    float pulse = smoothstep(0.0, 0.45, t) * smoothstep(1.0, 0.55, t);
    float reach = smoothstep(0.03, 0.40, r);
    vec3 tint = mix(vec3(0.72, 0.82, 1.0), AMBER, step(0.93, rnd));
    col += tint * gate * profile * pulse * reach * (0.50 - fl * 0.12);
  }

  // Amber scan wave: expands from the vanishing point, leaves phosphor
  // afterglow behind the front, fades out near the edge of frame.
  float sweep = fract(uTime / SWEEP_PERIOD);
  float rw = sweep * 1.9;
  float endFade = smoothstep(1.9, 1.1, rw);
  float front = exp(-abs(r - rw) * 26.0);
  float behind = step(r, rw) * exp(-(rw - r) * 6.0);
  col += AMBER * (front * 0.55 + behind * 0.16) * endFade;

  // The blip: blooms as the wavefront crosses it, then decays.
  vec2 blip = vec2(0.55, 0.10);
  float blipR = length(blip - VANISH);
  float since = rw - blipR;
  float excite = step(0.0, since) * exp(-since * 3.5) * endFade;
  col += AMBER * exp(-length(uv - blip) * 30.0) * excite * 1.3;
  col += vec3(1.0) * exp(-length(uv - blip) * 90.0) * excite * 0.7;

  // Vignette and film grain.
  float vig = smoothstep(1.55, 0.45, length(uv * vec2(0.85, 1.0)));
  col *= mix(0.55, 1.0, vig);
  col += (hash2(gl_FragCoord.xy + fract(uTime) * 61.7) - 0.5) * 0.035;

  outColor = vec4(col, 1.0);
}
`;

uniform float uTime;
// xy = centre (world x,z), z = start time, w = strength. w <= 0 means unused.
uniform vec4 uRipples[4];

varying vec3 vWorld;
varying vec3 vNormal;
varying float vCrest;
varying float vRip;

// <waves> is injected here by ocean.ts (generated from waves.ts)

void main() {
  vec3 rest = (modelMatrix * vec4(position, 1.0)).xyz;
  vec3 disp;
  vec3 n;
  float crest;
  gerstner(rest.xz, uTime, disp, n, crest);

  vec2 slope = vec2(0.0);
  float rip = 0.0;
  for (int i = 0; i < 4; i++) {
    vec4 r = uRipples[i];
    float age = uTime - r.z;
    if (r.w > 0.0 && age > 0.0 && age < 6.0) {
      vec2 dv = rest.xz - r.xy;
      float dist = length(dv);
      float x = dist - age * 2.4;
      float wd = 0.55 + age * 0.45;
      float env = exp(-(x * x) / (wd * wd)) * exp(-age * 0.65) * r.w;
      float ph = x * 5.5;
      disp.y += cos(ph) * env * 0.2;
      float dh = env * 0.2 * (-sin(ph) * 5.5 + cos(ph) * (-2.0 * x / (wd * wd)));
      slope += dh * dv / max(dist, 1e-3);
      rip += env;
    }
  }
  n = normalize(n + vec3(-slope.x, 0.0, -slope.y));

  vec3 world = rest + disp;
  vWorld = world;
  vNormal = n;
  vCrest = crest;
  vRip = rip;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}

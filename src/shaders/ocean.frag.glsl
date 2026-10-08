uniform float uTime;
uniform vec3 uSeaTeal;

varying vec3 vWorld;
varying vec3 vNormal;
varying float vCrest;
varying float vRip;

// <sky> is injected here by ocean.ts

void main() {
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  vec3 L = normalize(uSunDir);
  vec2 p = vWorld.xz;
  float t = uTime;

  float fadeD = 1.0 - smoothstep(40.0, 260.0, dist);
  float mask = 0.6 + 0.4 * skyNoise(p * 0.21 + t * 0.03);
  vec2 g = vec2(0.0);
  g += vec2(0.80, 0.60) * cos(dot(vec2(0.80, 0.60), p) * 2.1 - t * 1.3) * 0.050;
  g += vec2(-0.50, 0.85) * cos(dot(vec2(-0.50, 0.85), p) * 3.4 - t * 1.8 + 1.7) * 0.035;
  g += vec2(0.95, -0.30) * cos(dot(vec2(0.95, -0.30), p) * 5.3 - t * 2.4 + 4.1) * 0.022;
  vec3 N = normalize(normalize(vNormal) + vec3(-g.x, 0.0, -g.y) * mask * fadeD * 2.2);

  float facing = clamp(dot(N, V), 0.0, 1.0);

  vec3 deep = uSeaDeep;
  vec3 teal = uSeaTeal;
  vec3 body = mix(deep, teal, 0.3 + 0.35 * sqrt(facing) + 0.35 * smoothstep(-0.4, 1.0, vCrest));
  float sss = smoothstep(0.25, 1.0, vCrest) * pow(clamp(dot(-V, L), 0.0, 1.0), 2.0) * uSunVis;
  body += vec3(0.05, 0.30, 0.27) * sss * 0.9 + vec3(0.9, 0.35, 0.15) * sss * 0.18;

  float facet = pow(max(dot(N, normalize(vec3(L.x, 0.35, L.z))), 0.0), 3.0);
  body += uSunCol * vec3(0.2, 0.1, 0.08) * uSunVis * facet * (0.4 + 0.6 * smoothstep(-0.5, 1.0, vCrest));

  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  vec3 refl = skyColor(R, t) * 0.6;
  float F = clamp(0.02 + 0.98 * pow(1.0 - facing, 5.0), 0.0, 1.0);
  F *= mix(1.0, 0.68, smoothstep(20.0, 260.0, dist));
  F *= 1.0 - 0.28 * smoothstep(0.1, 0.45, uSunDir.y) * uSunVis;
  vec3 col = mix(body, refl, F);

  vec3 H = normalize(L + V);
  float nh = max(dot(N, H), 0.0);
  col += uSunCol * vec3(1.0, 0.85, 0.7) * pow(nh, 420.0) * 5.0 * uSunVis;
  col += uGlow * pow(nh, 36.0) * 0.22 * F * uSunVis;
  vec3 Hm = normalize(normalize(uMoonDir) + V);
  col += vec3(0.7, 0.8, 1.0) * pow(max(dot(N, Hm), 0.0), 420.0) * 3.0 * uMoonStrength;

  float fn = skyNoise(p * 1.7 + vec2(t * 0.08, 0.0)) * 0.6 + skyNoise(p * 4.1 - t * 0.1) * 0.4;
  float lace = skyNoise(p * 2.6 + vec2(0.0, t * 0.12));
  float foam = smoothstep(0.34, 0.8, vCrest + (fn - 0.5) * 0.7) * smoothstep(0.38, 0.72, lace) * 0.8 * smoothstep(14.0, 40.0, dist) * (1.0 - smoothstep(80.0, 240.0, dist));
  foam = max(foam, smoothstep(0.12, 0.55, vRip) * (0.55 + 0.45 * fn));
  vec3 foamCol = vec3(0.7, 0.55, 0.58) * clamp(dot(uHorizonA + uHorizonB, vec3(0.33)) * 0.9 + 0.1, 0.1, 1.0);
  col = mix(col, foamCol, clamp(foam, 0.0, 1.0) * 0.75);

  vec3 fd = normalize(vec3(-V.x, 0.012, -V.z));
  float sd = max(dot(fd, L), 0.0);
  vec3 fogCol = skyGradient(fd) + sunHalo(sd);
  float fog = 1.0 - exp(-pow(dist * 0.0042, 1.35));
  col = mix(col, fogCol, fog);

  gl_FragColor = vec4(col, 1.0);
}

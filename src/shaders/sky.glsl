
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform float uMoonStrength;
uniform float uSunVis;
uniform vec3 uHorizonA;
uniform vec3 uHorizonB;
uniform vec3 uLowA;
uniform vec3 uLowB;
uniform vec3 uMid;
uniform vec3 uTop;
uniform float uStars;
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
uniform vec3 uGlow;
uniform vec3 uSunCol;
uniform vec3 uSeaDeep;

#ifndef SKY_CLOUD_OCTAVES
#define SKY_CLOUD_OCTAVES 4
#endif

float skyHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float skyHash3(vec3 p) {
  p = fract(p * vec3(443.897, 441.423, 437.195));
  p += dot(p, p.yzx + 19.19);
  return fract((p.x + p.y) * p.z);
}

float skyNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = skyHash(i);
  float b = skyHash(i + vec2(1.0, 0.0));
  float c = skyHash(i + vec2(0.0, 1.0));
  float d = skyHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float skyFbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < SKY_CLOUD_OCTAVES; i++) {
    v += a * skyNoise(p);
    p = p * 2.03 + vec2(17.1, 9.2);
    a *= 0.5;
  }
  return v;
}

vec3 skyGradient(vec3 d) {
  // In daylight the visible slice of sky is stretched so the blue shows within the frame.
  float dayK = smoothstep(0.1, 0.45, uSunDir.y) * uSunVis;
  float e = clamp(d.y * (1.0 + 1.9 * dayK), 0.0, 1.0);
  vec2 az = normalize(d.xz + vec2(1e-5));
  float sunSide = 0.5 + 0.5 * dot(az, normalize(uSunDir.xz + vec2(1e-5)));
  vec3 horizon = mix(uHorizonB, uHorizonA, sunSide);
  vec3 low = mix(uLowB, uLowA, sunSide);
  vec3 c = horizon;
  c = mix(c, low, smoothstep(0.0, 0.10, e));
  c = mix(c, uMid, smoothstep(0.06, 0.34, e));
  c = mix(c, uTop, smoothstep(0.26, 0.85, e));
  return c;
}

vec3 sunHalo(float sd) {
  return (uGlow * pow(sd, 10.0) * 0.38 + mix(uGlow, uSunCol, 0.5) * pow(sd, 90.0) * 0.9) * uSunVis;
}

vec3 skyColor(vec3 d, float t) {
  vec3 col = skyGradient(d);
  float e = d.y;

  float starFade = smoothstep(0.12, 0.55, e) * uStars;
  if (starFade > 0.0) {
    vec3 p = d * 170.0;
    vec3 ip = floor(p);
    vec3 fp = fract(p) - 0.5;
    float h = skyHash3(ip);
    float star = step(0.986, h) * smoothstep(0.22, 0.0, length(fp));
    float tw = 0.65 + 0.35 * sin(t * (1.5 + h * 6.0) + h * 40.0);
    col += vec3(0.85, 0.9, 1.0) * star * tw * starFade * (1.2 + 3.0 * step(0.9975, h));
  }

  float sd = max(dot(d, normalize(uSunDir)), 0.0);
  col += sunHalo(sd) + uSunCol * smoothstep(0.99935, 0.99965, sd) * 9.0 * uSunVis;

  float md = max(dot(d, normalize(uMoonDir)), 0.0);
  col += (vec3(0.72, 0.8, 1.0) * smoothstep(0.9990, 0.9994, md) * 4.5
        + vec3(0.25, 0.35, 0.7) * pow(md, 160.0) * 0.5
        + vec3(0.1, 0.14, 0.3) * pow(md, 12.0) * 0.18) * uMoonStrength;

  if (e > 0.0) {
    vec2 uv = d.xz / (e + 0.22) * 0.85 + vec2(t * 0.012, t * 0.004);
    float n = skyFbm(uv * 1.3);
    float dayK = smoothstep(0.1, 0.45, uSunDir.y) * uSunVis;
    float cover = smoothstep(0.5 + 0.16 * dayK, 0.78 + 0.1 * dayK, n) * smoothstep(0.0, 0.10, e) * (1.0 - smoothstep(0.55, 0.95, e) * 0.6);
    float rim = smoothstep(0.82, 0.5, skyFbm(uv * 1.3 + vec2(0.08, 0.05) * normalize(uSunDir.xz + vec2(1e-5)) * 3.0));
    vec3 lit = mix(uCloudLit * 0.8, uCloudLit, pow(sd, 3.0));
    vec3 cloud = mix(uCloudShade, lit, clamp(rim * (0.35 + 0.9 * pow(sd, 1.5)) + 0.12 + 0.6 * dayK, 0.0, 1.0));
    col = mix(col, cloud, cover * 0.85);
  }

  if (e < 0.0) {
    col = mix(col, uSeaDeep, smoothstep(0.0, -0.25, e));
  }
  return col;
}

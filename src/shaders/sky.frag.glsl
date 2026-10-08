uniform float uTime;
varying vec3 vDir;

// <sky> is injected here by sky.ts

void main() {
  gl_FragColor = vec4(skyColor(normalize(vDir), uTime), 1.0);
}

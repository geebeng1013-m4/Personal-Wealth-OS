import { Mesh, Program, Renderer, Triangle } from "ogl";

export type SideRaysOrigin = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export interface SideRaysOptions {
  speed: number;
  rayColor1: string;
  rayColor2: string;
  intensity: number;
  spread: number;
  origin: SideRaysOrigin;
  tilt: number;
  saturation: number;
  blend: number;
  falloff: number;
  opacity: number;
}

const vertexShader = `
  attribute vec2 position;
  void main() {
    gl_Position = vec4(position, 0.0, 1.0);
  }
`;

const fragmentShader = `
  precision highp float;

  uniform float iTime;
  uniform vec2 iResolution;
  uniform float iSpeed;
  uniform vec3 iRayColor1;
  uniform vec3 iRayColor2;
  uniform float iIntensity;
  uniform float iSpread;
  uniform float iFlipX;
  uniform float iFlipY;
  uniform float iTilt;
  uniform float iSaturation;
  uniform float iBlend;
  uniform float iFalloff;
  uniform float iOpacity;

  float rayStrength(vec2 raySource, vec2 rayRefDirection, vec2 coord, float seedA, float seedB, float speed) {
    vec2 sourceToCoord = coord - raySource;
    float cosAngle = dot(normalize(sourceToCoord), rayRefDirection);
    return clamp(
      (0.45 + 0.15 * sin(cosAngle * seedA + iTime * speed)) +
      (0.3 + 0.2 * cos(-cosAngle * seedB + iTime * speed)),
      0.0,
      1.0
    ) * clamp((iResolution.x - length(sourceToCoord)) / iResolution.x, 0.5, 1.0);
  }

  void main() {
    vec2 fragCoord = gl_FragCoord.xy;
    if (iFlipX > 0.5) fragCoord.x = iResolution.x - fragCoord.x;
    if (iFlipY > 0.5) fragCoord.y = iResolution.y - fragCoord.y;

    vec2 coord = vec2(fragCoord.x, iResolution.y - fragCoord.y);
    vec2 rayPos = vec2(iResolution.x * 1.1, -0.5 * iResolution.y);

    float tiltRad = iTilt * 3.14159265 / 180.0;
    float cs = cos(tiltRad);
    float sn = sin(tiltRad);
    vec2 rel = coord - rayPos;
    vec2 tiltedCoord = vec2(rel.x * cs - rel.y * sn, rel.x * sn + rel.y * cs) + rayPos;

    float halfSpread = iSpread * 0.275;
    vec2 rayRefDir1 = normalize(vec2(cos(0.785398 + halfSpread), sin(0.785398 + halfSpread)));
    vec2 rayRefDir2 = normalize(vec2(cos(0.785398 - halfSpread), sin(0.785398 - halfSpread)));

    vec4 rays1 = vec4(iRayColor1, 1.0) * rayStrength(rayPos, rayRefDir1, tiltedCoord, 36.2214, 21.11349, iSpeed);
    vec4 rays2 = vec4(iRayColor2, 1.0) * rayStrength(rayPos, rayRefDir2, tiltedCoord, 22.3991, 18.0234, iSpeed * 0.2);
    vec4 color = rays1 * (1.0 - iBlend) * 0.9 + rays2 * iBlend * 0.9;

    float distanceToLight = length(fragCoord.xy - vec2(rayPos.x, iResolution.y - rayPos.y)) / iResolution.y;
    float brightness = iIntensity * 0.4 / pow(max(distanceToLight, 0.001), iFalloff);
    color.rgb *= brightness;

    float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
    color.rgb = mix(vec3(gray), color.rgb, iSaturation);
    color.a = max(color.r, max(color.g, color.b)) * iOpacity;
    gl_FragColor = color;
  }
`;

function hexToRgb(hex: string): [number, number, number] {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!match) return [1, 1, 1];
  return [
    Number.parseInt(match[1], 16) / 255,
    Number.parseInt(match[2], 16) / 255,
    Number.parseInt(match[3], 16) / 255,
  ];
}

function originToFlip(origin: SideRaysOrigin): [number, number] {
  switch (origin) {
    case "top-left": return [1, 0];
    case "bottom-right": return [0, 1];
    case "bottom-left": return [1, 1];
    default: return [0, 0];
  }
}

/**
 * How hard the light works, best first. The light is a slow drift, so 30 fps
 * reads the same as the display's own 60/90/120/144 Hz while drawing a fraction
 * of the frames, and it is blurry by nature, so one canvas pixel per CSS pixel
 * is enough. A tier with fps 0 draws a single still frame.
 */
const TIERS = [
  { fps: 0, dpr: 0.5 },
  { fps: 20, dpr: 0.5 },
  { fps: 30, dpr: 1 },
] as const;
const TOP_TIER = TIERS.length - 1;
/** Frames measured before judging a tier. */
const SAMPLE_FRAMES = 60;
/** Step down when frames take this much longer than the display's own frame. */
const SLOW_FACTOR = 1.5;

function prefersSavingData(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return connection?.saveData === true;
}

export interface SideRays {
  /** Show the light in `container`, moving the one canvas there if it was elsewhere. */
  attach(container: HTMLElement, intensity: number): void;
}

/**
 * One light for the life of the page.
 *
 * renderApp rebuilds the shell on every navigation and on many in-page clicks.
 * Mounting a fresh light each time threw away the WebGL context and restarted
 * the animation clock, so the light visibly jumped whenever a button was
 * pressed. Instead the canvas is created once and moved into each new
 * container: a canvas keeps its context when it moves in the DOM, and the
 * clock started here keeps running.
 */
export function createSideRays(options: SideRaysOptions): SideRays {
  // Data saver asks for less; a still frame is the least.
  let tier = prefersSavingData() ? 0 : TOP_TIER;
  const renderer = new Renderer({
    alpha: true,
    antialias: false,
    dpr: Math.min(window.devicePixelRatio, TIERS[tier].dpr),
  });
  const gl = renderer.gl;
  gl.canvas.classList.add("side-rays-canvas");

  const [flipX, flipY] = originToFlip(options.origin);
  const program = new Program(gl, {
    vertex: vertexShader,
    fragment: fragmentShader,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      iTime: { value: 0 },
      iResolution: { value: [1, 1] },
      iSpeed: { value: options.speed },
      iRayColor1: { value: hexToRgb(options.rayColor1) },
      iRayColor2: { value: hexToRgb(options.rayColor2) },
      iIntensity: { value: options.intensity },
      iSpread: { value: options.spread },
      iFlipX: { value: flipX },
      iFlipY: { value: flipY },
      iTilt: { value: options.tilt },
      iSaturation: { value: options.saturation },
      iBlend: { value: options.blend },
      iFalloff: { value: options.falloff },
      iOpacity: { value: options.opacity },
    },
  });
  const mesh = new Mesh(gl, { geometry: new Triangle(gl), program });

  let container: HTMLElement | null = null;
  const resize = (): void => {
    if (!container) return;
    renderer.dpr = Math.min(window.devicePixelRatio, TIERS[tier].dpr);
    const width = Math.max(container.clientWidth, 1);
    const height = Math.max(container.clientHeight, 1);
    renderer.setSize(width, height);
    program.uniforms.iResolution.value = [gl.canvas.width, gl.canvas.height];
  };

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const startedAt = performance.now();
  let animationFrame: number | null = null;
  let isVisible = true;
  let needsFrame = true;
  let lastTick = 0;
  let lastDraw = 0;

  // The display's frame time is the shortest gap seen between callbacks: a
  // frame can arrive late, never early. Gaps well above it mean the page is
  // dropping frames, and the light steps down a tier.
  let displayFrameMs = Infinity;
  let sampleSum = 0;
  let sampleCount = 0;
  const measure = (gapMs: number): void => {
    // A gap this long is a paused tab or a stalled page, not a frame.
    if (gapMs <= 0 || gapMs > 250) return;
    displayFrameMs = Math.min(displayFrameMs, gapMs);
    sampleSum += gapMs;
    sampleCount += 1;
    if (sampleCount < SAMPLE_FRAMES) return;
    const averageMs = sampleSum / sampleCount;
    sampleSum = 0;
    sampleCount = 0;
    if (tier > 0 && averageMs > displayFrameMs * SLOW_FACTOR) {
      tier -= 1;
      resize();
      needsFrame = true;
    }
  };

  const render = (now: number): void => {
    animationFrame = null;
    if (!isVisible || document.hidden) return;
    if (lastTick) measure(now - lastTick);
    lastTick = now;
    const { fps } = TIERS[tier];
    // 2 ms of slack so a 60 Hz display lands on every other frame, not every third.
    if (needsFrame || (fps > 0 && now - lastDraw >= 1000 / fps - 2)) {
      program.uniforms.iTime.value = (now - startedAt) / 1000;
      renderer.render({ scene: mesh });
      lastDraw = now;
      needsFrame = false;
    }
    if (!reduceMotion && fps > 0) animationFrame = requestAnimationFrame(render);
  };

  const startRendering = (): void => {
    if (!isVisible || document.hidden || animationFrame !== null) return;
    lastTick = 0;
    animationFrame = requestAnimationFrame(render);
  };

  const stopRendering = (): void => {
    if (animationFrame === null) return;
    cancelAnimationFrame(animationFrame);
    animationFrame = null;
  };

  // Both observers follow the current container. When a render replaces the
  // shell (or the login screen replaces it), the old container leaves the DOM,
  // the intersection observer reports it gone, and drawing stops until the
  // next attach.
  const resizeObserver = new ResizeObserver(resize);
  const intersectionObserver = new IntersectionObserver(([entry]) => {
    isVisible = entry?.isIntersecting ?? false;
    if (isVisible) startRendering();
    else stopRendering();
  }, { threshold: 0.1 });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopRendering();
    else startRendering();
  });

  return {
    attach(next, intensity) {
      program.uniforms.iIntensity.value = intensity;
      if (next !== container) {
        resizeObserver.disconnect();
        intersectionObserver.disconnect();
        container = next;
        container.replaceChildren(gl.canvas);
        resizeObserver.observe(container);
        intersectionObserver.observe(container);
        resize();
      }
      isVisible = true;
      // With reduced motion or a still tier the loop draws a single frame, so
      // each new container needs its own.
      needsFrame = true;
      stopRendering();
      startRendering();
    },
  };
}

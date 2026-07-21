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

export function mountSideRays(container: HTMLElement, options: SideRaysOptions): () => void {
  const renderer = new Renderer({
    alpha: true,
    antialias: false,
    dpr: Math.min(window.devicePixelRatio, 2),
  });
  const gl = renderer.gl;
  gl.canvas.classList.add("side-rays-canvas");
  container.replaceChildren(gl.canvas);

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

  const resize = (): void => {
    renderer.dpr = Math.min(window.devicePixelRatio, 2);
    const width = Math.max(container.clientWidth, 1);
    const height = Math.max(container.clientHeight, 1);
    renderer.setSize(width, height);
    program.uniforms.iResolution.value = [gl.canvas.width, gl.canvas.height];
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  resize();

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const startedAt = performance.now();
  let animationFrame: number | null = null;
  let isVisible = true;
  let isDisposed = false;

  const render = (now: number): void => {
    animationFrame = null;
    if (isDisposed || !isVisible || document.hidden) return;
    program.uniforms.iTime.value = (now - startedAt) / 1000;
    renderer.render({ scene: mesh });
    if (!reduceMotion) animationFrame = requestAnimationFrame(render);
  };

  const startRendering = (): void => {
    if (isDisposed || !isVisible || document.hidden || animationFrame !== null) return;
    animationFrame = requestAnimationFrame(render);
  };

  const stopRendering = (): void => {
    if (animationFrame === null) return;
    cancelAnimationFrame(animationFrame);
    animationFrame = null;
  };

  const intersectionObserver = new IntersectionObserver(([entry]) => {
    isVisible = entry?.isIntersecting ?? false;
    if (isVisible) startRendering();
    else stopRendering();
  }, { threshold: 0.1 });
  intersectionObserver.observe(container);

  const handleVisibilityChange = (): void => {
    if (document.hidden) stopRendering();
    else startRendering();
  };
  document.addEventListener("visibilitychange", handleVisibilityChange);
  startRendering();

  return () => {
    isDisposed = true;
    stopRendering();
    intersectionObserver.disconnect();
    resizeObserver.disconnect();
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    gl.canvas.remove();
  };
}
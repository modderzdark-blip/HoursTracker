export interface DeviceInfo {
  userAgent: string;
  platform: string;
  language: string;
  screen: string;
  viewport: string;
  devicePixelRatio: number;
  orientation: string;
  cores: number | undefined;
  deviceMemoryGB: number | undefined;
  touchPoints: number;
  isMobile: boolean;
  gpuVendor: string;
  gpuRenderer: string;
  webgl2: boolean;
  maxTextureSize: number;
  fullscreen: boolean;
  standalone: boolean;
}

interface NavigatorExtras {
  deviceMemory?: number;
  userAgentData?: { mobile?: boolean; platform?: string };
}

function readGpu(gl: WebGL2RenderingContext | WebGLRenderingContext | null): {
  vendor: string;
  renderer: string;
  maxTex: number;
} {
  if (gl === null) return { vendor: 'n/a', renderer: 'n/a', maxTex: 0 };
  // Modern Chrome returns unmasked strings from RENDERER directly; the debug extension is the
  // fallback for older versions.
  let vendor = String(gl.getParameter(gl.VENDOR));
  let renderer = String(gl.getParameter(gl.RENDERER));
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  if (ext !== null) {
    vendor = String(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL));
    renderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
  }
  return { vendor, renderer, maxTex: Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) };
}

export function detectMobile(): boolean {
  const nav = navigator as Navigator & NavigatorExtras;
  if (nav.userAgentData?.mobile !== undefined) return nav.userAgentData.mobile;
  return (
    /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || navigator.maxTouchPoints > 1
  );
}

/** Collects device facts for the debug log. Pass the game's GL context to avoid creating one. */
export function collectDeviceInfo(
  gl: WebGL2RenderingContext | WebGLRenderingContext | null,
): DeviceInfo {
  const nav = navigator as Navigator & NavigatorExtras;
  const gpu = readGpu(gl);
  return {
    userAgent: navigator.userAgent,
    platform: nav.userAgentData?.platform ?? navigator.platform,
    language: navigator.language,
    screen: `${screen.width}x${screen.height}`,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    devicePixelRatio: window.devicePixelRatio,
    orientation: screen.orientation?.type ?? 'unknown',
    cores: navigator.hardwareConcurrency,
    deviceMemoryGB: nav.deviceMemory,
    touchPoints: navigator.maxTouchPoints,
    isMobile: detectMobile(),
    gpuVendor: gpu.vendor,
    gpuRenderer: gpu.renderer,
    webgl2: typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext,
    maxTextureSize: gpu.maxTex,
    fullscreen: document.fullscreenElement !== null,
    standalone: window.matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches,
  };
}

/** Chrome-only JS heap numbers (MB); undefined elsewhere. */
export function readHeapMB(): { used: number; limit: number } | undefined {
  const mem = (
    performance as Performance & {
      memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number };
    }
  ).memory;
  if (mem === undefined) return undefined;
  return { used: mem.usedJSHeapSize / 1048576, limit: mem.jsHeapSizeLimit / 1048576 };
}

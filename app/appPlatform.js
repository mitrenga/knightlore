const { ZXPlatform } = await import('./svision/js/platform/canvas2D/zx/zxPlatform.js?ver='+window.srcVersion);
// begin code

export function appPlatform() {
  return new ZXPlatform();
} // appPlatform

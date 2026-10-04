/** Inspection runs keep a separate save even when viewing the finished art. */
export function isWhiteboxMode(): boolean {
  return typeof location !== 'undefined' && (location.pathname.endsWith('/whitebox-lab.html')
    || new URLSearchParams(location.search).get('layout') === 'whitebox');
}

/** The reviewed floor plans are now the normal game; legacy stays available for comparison. */
export function usesAuthoredLayout(): boolean {
  if (typeof location === 'undefined') return false;
  const params = new URLSearchParams(location.search);
  // The older inspectors still expose StageDesign-specific altar and camera controls.
  const legacyInspector = location.pathname.endsWith('/adventure-lab.html') || location.pathname.endsWith('/details-lab.html');
  return isWhiteboxMode() || (!legacyInspector && !params.has('classic') && params.get('layout') !== 'legacy');
}

export function showsAuthoredArt(): boolean {
  if (!usesAuthoredLayout()) return false;
  const params = new URLSearchParams(location.search);
  return !params.has('classic') && (!isWhiteboxMode() || params.get('look') === 'art');
}

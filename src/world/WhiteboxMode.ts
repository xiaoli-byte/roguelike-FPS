/** Inspection runs keep a separate save even when viewing the finished art. */
export function isWhiteboxMode(): boolean {
  // Hosts with clean URLs serve the lab as /whitebox-lab; both spellings keep the isolated save.
  return typeof location !== 'undefined' && (/\/whitebox-lab(\.html)?\/?$/.test(location.pathname)
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

/** ?plan=ld03 shows the LD-03 plans for comparison; ?plan=v2 previews every V2 plan, shipped or not. */
export const LD03_PLAN_PARAM = 'ld03';
export const V2_PREVIEW_PARAM = 'v2';
/** Chapters whose V2 plans ship in the normal game. Other chapters' V2 plans stay preview-only until approved. */
export const SHIPPED_REDESIGN_CHAPTERS: readonly string[] = ['desert', 'frost'];
export function usesRedesignLayout(theme?: string): boolean {
  if (typeof location === 'undefined') return false;
  const plan = new URLSearchParams(location.search).get('plan');
  if (plan === LD03_PLAN_PARAM) return false;
  return plan === V2_PREVIEW_PARAM || theme === undefined || SHIPPED_REDESIGN_CHAPTERS.includes(theme);
}

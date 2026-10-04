/** Keep the full-resolution sun map, refreshing animated casters at 30 Hz. */
export class ShadowCadence {
  private elapsed = 0;
  private revision = -1;
  private readonly interval = 1 / 30;

  advance(dt: number, revision: number): boolean {
    if (revision !== this.revision) {
      this.revision = revision; this.elapsed = 0;
      return true;
    }
    this.elapsed += Number.isFinite(dt) ? Math.max(0, dt) : 0;
    if (this.elapsed + 1e-7 < this.interval) return false;
    this.elapsed = Math.max(0, this.elapsed - this.interval) % this.interval;
    return true;
  }
}

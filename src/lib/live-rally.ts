// Image positions cannot prove floor contact. These clues request human review.
export class LiveRally {
  private points: Array<{ x: number; y: number; t: number }> = [];
  private moving = 0;
  private active = false;
  private offered = false;
  private lastTime = 0;

  update(x: number | null, y: number | null, confidence: number, t: number) {
    if (t <= this.lastTime) return null;
    this.lastTime = t;
    const last = this.points.at(-1);
    if (x === null || y === null || confidence < 0.7) {
      this.moving = 0;
      if (last && this.active && !this.offered && t - last.t > 1800) {
        this.offered = true;
        return "Birdie out of view. Did the rally end?";
      }
      return null;
    }
    if (last && t - last.t > 500) this.points = [];
    const previous = this.points.at(-1);
    const distance = previous ? Math.hypot(x - previous.x, y - previous.y) : 0;
    this.moving = distance > 0.012 && distance < 0.2 ? this.moving + 1 : 0;
    if (this.moving >= 4) {
      this.active = true;
      this.offered = false;
    }
    this.points.push({ x, y, t });
    this.points = this.points.filter((p) => t - p.t <= 2000).slice(-60);
    const still = this.points.filter((p) => t - p.t <= 650);
    const first = still[0];
    const earlier = this.points.find((p) => t - p.t >= 800);
    if (
      this.active &&
      !this.offered &&
      first &&
      still.length >= 4 &&
      t - first.t >= 450 &&
      earlier &&
      y - earlier.y > 0.025 &&
      still.every((p) => Math.hypot(x - p.x, y - p.y) < 0.012)
    ) {
      this.offered = true;
      return "Birdie moved down and stayed still. Did it land?";
    }
    return null;
  }

  resolve() {
    this.active = false;
    this.offered = true;
    this.moving = 0;
    this.points = [];
  }
}

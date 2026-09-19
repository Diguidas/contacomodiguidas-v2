// Sprint date-range calculator.
//
// Anchored on a single known sprint (Sprint 21: 10/08/2026 - 21/08/2026,
// a 12-day window) and extrapolated linearly in both directions, since all
// sprints in this team follow the same fixed length back-to-back.
export class Sprint {
  readonly number: number;
  readonly start: Date;
  readonly end: Date;

  constructor({ number, start, end }: { number: number; start: Date; end: Date }) {
    this.number = number;
    this.start = start;
    this.end = end;
  }

  overlaps(rangeStart: Date, rangeEnd: Date | null): boolean {
    const effectiveEnd = rangeEnd ?? new Date();
    const endPlus1 = new Date(this.end.getTime() + 24 * 60 * 60 * 1000);
    const startMinus1 = new Date(this.start.getTime() - 24 * 60 * 60 * 1000);
    return rangeStart.getTime() < endPlus1.getTime() && effectiveEnd.getTime() > startMinus1.getTime();
  }

  get label(): string {
    const fmt = (d: Date) =>
      `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
    return `Sprint ${this.number} (${fmt(this.start)} - ${fmt(this.end)})`;
  }

  equals(other: Sprint | null | undefined): boolean {
    return other != null && other.number === this.number;
  }
}

const ANCHOR_NUMBER = 21;
const ANCHOR_START = new Date(2026, 7, 10); // months are 0-indexed
const ANCHOR_END = new Date(2026, 7, 21);
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DURATION_IN_DAYS = Math.round((ANCHOR_END.getTime() - ANCHOR_START.getTime()) / MS_PER_DAY) + 1;
// Sprints run 12 days but start every 14 days (a 2-day gap between them),
// confirmed against the real Azure Boards iteration list.
const CYCLE_IN_DAYS = 14;

export class SprintService {
  sprintFor(number: number): Sprint {
    const offsetDays = (number - ANCHOR_NUMBER) * CYCLE_IN_DAYS;
    const start = new Date(ANCHOR_START.getTime() + offsetDays * MS_PER_DAY);
    const end = new Date(start.getTime() + (DURATION_IN_DAYS - 1) * MS_PER_DAY);
    return new Sprint({ number, start, end });
  }

  sprintNumberContaining(date: Date): number {
    const diffDays = Math.floor((date.getTime() - ANCHOR_START.getTime()) / MS_PER_DAY);
    const offset = Math.floor(diffDays / CYCLE_IN_DAYS);
    return ANCHOR_NUMBER + offset;
  }

  // Sprints spanning from pastCount sprints before today's sprint to
  // futureCount sprints after, most recent first.
  recentSprints({ pastCount = 30, futureCount = 2 }: { pastCount?: number; futureCount?: number } = {}): Sprint[] {
    const current = this.sprintNumberContaining(new Date());
    const sprints: Sprint[] = [];
    for (let n = current + futureCount; n >= current - pastCount; n--) {
      sprints.push(this.sprintFor(n));
    }
    return sprints;
  }
}

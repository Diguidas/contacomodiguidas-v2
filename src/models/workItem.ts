// Case/whitespace-insensitive membership check for board column names —
// boards are inconsistent about capitalization even after the numeric
// prefix is stripped (e.g. "Validação Funcional" vs "validação funcional").
export function boardColumnMatches(columns: Set<string>, value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return [...columns].some((c) => c.trim().toLowerCase() === normalized);
}

export interface StateChange {
  state: string;
  date: Date;
}

export type ItemGroup = 'mine' | 'taggedForMe';

export interface WorkItemInit {
  id: number;
  title: string;
  type: string;
  currentState: string;
  createdDate: Date;
  changedDate: Date;
  stateHistory: StateChange[];
  currentBoardColumn?: string;
  boardColumnHistory?: StateChange[];
  assignedTo?: string;
  tags?: string[];
  areaPath?: string;
  iterationPath?: string;
  priority?: number | null;
  targetDate?: Date | null;
  originalTargetDate?: Date | null;
  deadlineChangeCount?: number;
  requestType?: string;
  department?: string;
  complexity?: string;
  requesterName?: string;
  childIds?: number[];
}

// States that mean the item will never be delivered — formally removed,
// or abandoned because the user stopped responding and it fell off the
// board entirely. Excluded everywhere, same as Removed always was, so it
// doesn't sit around forever inflating "Entraram" as a carry-over that
// can never close.
const CANCELLED_STATES = new Set(['removed', 'sem retorno do usuário']);

export class WorkItem {
  readonly id: number;
  readonly title: string;
  readonly type: string;
  readonly currentState: string;
  readonly currentBoardColumn: string;
  readonly createdDate: Date;
  readonly changedDate: Date;
  readonly stateHistory: StateChange[];
  readonly boardColumnHistory: StateChange[];
  readonly assignedTo: string;
  readonly tags: string[];
  readonly areaPath: string;
  readonly iterationPath: string;
  readonly priority: number | null;
  readonly targetDate: Date | null;
  readonly originalTargetDate: Date | null;
  readonly deadlineChangeCount: number;
  readonly requestType: string;
  readonly department: string;
  readonly complexity: string;
  readonly requesterName: string;
  readonly childIds: number[];

  constructor(init: WorkItemInit) {
    this.id = init.id;
    this.title = init.title;
    this.type = init.type;
    this.currentState = init.currentState;
    this.createdDate = init.createdDate;
    this.changedDate = init.changedDate;
    this.stateHistory = init.stateHistory;
    this.currentBoardColumn = init.currentBoardColumn ?? '';
    this.boardColumnHistory = init.boardColumnHistory ?? [];
    this.assignedTo = init.assignedTo ?? '';
    this.tags = init.tags ?? [];
    this.areaPath = init.areaPath ?? '';
    this.iterationPath = init.iterationPath ?? '';
    this.priority = init.priority ?? null;
    this.targetDate = init.targetDate ?? null;
    this.originalTargetDate = init.originalTargetDate ?? null;
    this.deadlineChangeCount = init.deadlineChangeCount ?? 0;
    this.requestType = init.requestType ?? '';
    this.department = init.department ?? '';
    this.complexity = init.complexity ?? '';
    this.requesterName = init.requesterName ?? '';
    this.childIds = init.childIds ?? [];
  }

  // Whether the item finished after its *original* promised deadline —
  // null if there's no deadline recorded or the item isn't done yet.
  // Deliberately compares against originalTargetDate, not the current
  // (possibly rescheduled) one — a deadline pushed back right before
  // slipping would otherwise always read as "on time".
  isLate(actualEndDate: Date | null): boolean | null {
    if (this.originalTargetDate == null || actualEndDate == null) return null;
    return actualEndDate.getTime() > this.originalTargetDate.getTime();
  }

  // Classifies the item as 'mine' when assigned to myDisplayName
  // (regardless of tags), or 'taggedForMe' when it carries tagFilter but is
  // assigned to someone else. Returns null otherwise.
  groupFor({ myDisplayName, tagFilter }: { myDisplayName: string; tagFilter: string }): ItemGroup | null {
    if (this.assignedTo.trim().toLowerCase() === myDisplayName.trim().toLowerCase()) {
      return 'mine';
    }
    const hasTag = this.tags.some((t) => t.toLowerCase() === tagFilter.trim().toLowerCase());
    if (hasTag) return 'taggedForMe';
    return null;
  }

  // First moment this item entered any of doneStates, after `after`.
  firstDoneAfter(doneStates: Set<string>, after: Date | null): Date | null {
    for (const change of this.stateHistory) {
      if (doneStates.has(change.state)) {
        if (after == null || change.date.getTime() > after.getTime()) return change.date;
      }
    }
    return null;
  }

  get isCancelled(): boolean {
    return CANCELLED_STATES.has(this.currentState.trim().toLowerCase());
  }

  // An item is done when its System.State is one of doneStates OR its
  // Kanban board column is doneColumn (some boards close items purely by
  // moving the card, without ever changing State).
  isDone(doneStates: Set<string>, doneColumn?: string | null): boolean {
    return (
      doneStates.has(this.currentState) ||
      (!!doneColumn && doneColumn.length > 0 && boardColumnMatches(new Set([doneColumn]), this.currentBoardColumn))
    );
  }

  // First moment this item's Kanban board column was any of `columns`.
  firstEnteredColumn(columns: Set<string>): Date | null {
    for (const change of this.boardColumnHistory) {
      if (boardColumnMatches(columns, change.state)) return change.date;
    }
    return null;
  }

  // The board column this item was actually sitting in at `asOf` — the
  // last boardColumnHistory entry at or before that moment, falling back
  // to the earliest known entry if `asOf` predates all of them (or to
  // currentBoardColumn if there's no history at all). Needed to judge a
  // past sprint honestly: currentBoardColumn only ever reflects *now*, so
  // using it to reconstruct "where was this card at the end of Sprint N"
  // silently answers a different question for anything that kept moving
  // after that sprint ended.
  boardColumnAsOf(asOf: Date): string {
    if (this.boardColumnHistory.length === 0) return this.currentBoardColumn;
    let result: string | undefined;
    for (const change of this.boardColumnHistory) {
      if (change.date.getTime() > asOf.getTime()) break;
      result = change.state;
    }
    return result ?? this.boardColumnHistory[0].state;
  }

  // First moment this item's board column was any of `columns`, after
  // `after` — mirrors firstDoneAfter but over the board column history.
  firstColumnAfter(columns: Set<string>, after: Date | null): Date | null {
    for (const change of this.boardColumnHistory) {
      if (boardColumnMatches(columns, change.state)) {
        if (after == null || change.date.getTime() > after.getTime()) return change.date;
      }
    }
    return null;
  }

  // Total wall-clock time this item's board column was one of `columns`,
  // summed across every interval up to `until` (defaults to now). This is
  // the "only counts time actually sitting in these columns" rule — periods
  // spent in other columns (backlog, queued, blocked, etc.) don't count.
  //
  // `since`, when given, clamps the start of every interval so time spent
  // before it isn't counted — needed to answer "how long did this sit in
  // this column *during this window*" rather than "in total up to now".
  durationInColumnsMs(columns: Set<string>, { since, until }: { since?: Date; until?: Date } = {}): number {
    if (this.boardColumnHistory.length === 0) return 0;
    const endTime = until ?? new Date();
    let total = 0;
    for (let i = 0; i < this.boardColumnHistory.length; i++) {
      const change = this.boardColumnHistory[i];
      if (change.date.getTime() > endTime.getTime()) break;
      const rawSegmentEnd =
        i + 1 < this.boardColumnHistory.length ? this.boardColumnHistory[i + 1].date : endTime;
      const segmentEnd = rawSegmentEnd.getTime() > endTime.getTime() ? endTime : rawSegmentEnd;
      const segmentStart = since != null && change.date.getTime() < since.getTime() ? since : change.date;
      if (segmentEnd.getTime() > segmentStart.getTime() && boardColumnMatches(columns, change.state)) {
        total += segmentEnd.getTime() - segmentStart.getTime();
      }
    }
    return total;
  }
}

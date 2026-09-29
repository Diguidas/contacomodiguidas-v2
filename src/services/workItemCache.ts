import { WorkItem } from '../models/workItem';
import type { StateChange, WorkItemInit } from '../models/workItem';

// Persists the Dashboard's rolling window (items + cachedFromSprintNumber)
// to sessionStorage — survives the browser reloading the tab (Chrome's
// Memory Saver discards inactive tabs and reloads them on refocus, which
// otherwise wipes every bit of in-memory React state and forces a full
// Azure DevOps re-fetch on every tab switch). sessionStorage specifically:
// tied to this tab, cleared when it's actually closed, exactly matching
// what "cache for this session" should mean — never localStorage, which
// would leak stale data across actual browser restarts.
const STORAGE_PREFIX = 'workItemsCache:v1:';

interface SerializedStateChange {
  state: string;
  date: string;
}

interface SerializedWorkItem extends Omit<WorkItemInit, 'createdDate' | 'changedDate' | 'stateHistory' | 'boardColumnHistory' | 'targetDate' | 'originalTargetDate'> {
  createdDate: string;
  changedDate: string;
  stateHistory: SerializedStateChange[];
  boardColumnHistory: SerializedStateChange[];
  targetDate: string | null;
  originalTargetDate: string | null;
}

interface CachedPayload {
  fromSprintNumber: number;
  lastUpdated: string;
  items: SerializedWorkItem[];
}

function keyFor(organization: string, project: string): string {
  return `${STORAGE_PREFIX}${organization}:${project}`;
}

function serializeChanges(changes: StateChange[]): SerializedStateChange[] {
  return changes.map((c) => ({ state: c.state, date: c.date.toISOString() }));
}
function deserializeChanges(changes: SerializedStateChange[]): StateChange[] {
  return changes.map((c) => ({ state: c.state, date: new Date(c.date) }));
}

function serializeItem(item: WorkItem): SerializedWorkItem {
  return {
    id: item.id,
    title: item.title,
    type: item.type,
    currentState: item.currentState,
    createdDate: item.createdDate.toISOString(),
    changedDate: item.changedDate.toISOString(),
    stateHistory: serializeChanges(item.stateHistory),
    currentBoardColumn: item.currentBoardColumn,
    boardColumnHistory: serializeChanges(item.boardColumnHistory),
    assignedTo: item.assignedTo,
    tags: item.tags,
    areaPath: item.areaPath,
    iterationPath: item.iterationPath,
    priority: item.priority,
    targetDate: item.targetDate?.toISOString() ?? null,
    originalTargetDate: item.originalTargetDate?.toISOString() ?? null,
    deadlineChangeCount: item.deadlineChangeCount,
    requestType: item.requestType,
    department: item.department,
    complexity: item.complexity,
    requesterName: item.requesterName,
    childIds: item.childIds,
  };
}

function deserializeItem(raw: SerializedWorkItem): WorkItem {
  return new WorkItem({
    ...raw,
    createdDate: new Date(raw.createdDate),
    changedDate: new Date(raw.changedDate),
    stateHistory: deserializeChanges(raw.stateHistory),
    boardColumnHistory: deserializeChanges(raw.boardColumnHistory),
    targetDate: raw.targetDate == null ? null : new Date(raw.targetDate),
    originalTargetDate: raw.originalTargetDate == null ? null : new Date(raw.originalTargetDate),
  });
}

export function saveWorkItemCache(
  organization: string,
  project: string,
  data: { items: WorkItem[]; fromSprintNumber: number; lastUpdated: Date },
): void {
  const payload: CachedPayload = {
    fromSprintNumber: data.fromSprintNumber,
    lastUpdated: data.lastUpdated.toISOString(),
    items: data.items.map(serializeItem),
  };
  try {
    sessionStorage.setItem(keyFor(organization, project), JSON.stringify(payload));
  } catch (e) {
    // Quota exceeded or storage unavailable (private browsing, etc.) — the
    // cache is a nice-to-have, not a requirement, so just skip it silently.
    console.warn('Não foi possível salvar o cache de itens na sessão:', e);
  }
}

export function loadWorkItemCache(
  organization: string,
  project: string,
): { items: WorkItem[]; fromSprintNumber: number; lastUpdated: Date } | null {
  try {
    const raw = sessionStorage.getItem(keyFor(organization, project));
    if (raw == null) return null;
    const payload = JSON.parse(raw) as CachedPayload;
    return {
      items: payload.items.map(deserializeItem),
      fromSprintNumber: payload.fromSprintNumber,
      lastUpdated: new Date(payload.lastUpdated),
    };
  } catch (e) {
    console.warn('Não foi possível ler o cache de itens da sessão:', e);
    return null;
  }
}

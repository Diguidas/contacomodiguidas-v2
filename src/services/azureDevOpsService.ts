import { WorkItem } from '../models/workItem';
import type { StateChange } from '../models/workItem';
import { AppSettings } from './settingsService';

export class AzureDevOpsException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AzureDevOpsException';
  }
}

// Strips a leading numbered-column prefix like "10- ", "4- " or "1 " —
// with or without a dash, since boards aren't consistent about it.
export function normalizeBoardColumn(raw: string): string {
  return raw.trim().replace(/^\d+\s*-?\s*/, '').trim();
}

function wiqlDate(d: Date): string {
  const y = String(d.getFullYear()).padStart(4, '0');
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// One Custom.Prazo edit, with who made it — so the "original deadline" can
// be restricted to edits made by the card's own owner, not a bystander.
interface DeadlineEdit {
  date: Date;
  value: string;
  changedBy: string;
}

interface Histories {
  state: StateChange[];
  boardColumn: StateChange[];
  deadlines: DeadlineEdit[];
}

// Just enough to show a child work item in a list — no history fetch, so
// looking up a Feature's children (possibly dozens, well outside the
// normal fetch window) stays a single batched round trip instead of one
// extra history call per child.
export interface ChildSummary {
  id: number;
  title: string;
  type: string;
  state: string;
  boardColumn: string;
  assignedTo: string;
}

export class AzureDevOpsService {
  private readonly settings: AppSettings;

  constructor(settings: AppSettings) {
    this.settings = settings;
  }

  private apiUrl(pathAndQuery: string): string {
    return `https://dev.azure.com/${this.settings.organization}/${this.settings.project}/_apis/${pathAndQuery}`;
  }

  private get headers(): Record<string, string> {
    const token = btoa(`:${this.settings.personalAccessToken}`);
    return {
      Authorization: `Basic ${token}`,
      'Content-Type': 'application/json',
    };
  }

  // Fetches work items and their full history.
  //
  // Always scoped down to keep it fast: items that are still open (any
  // state) always come back — regardless of age, since "Itens em aberto"
  // needs to see all of them — plus items changed within
  // changedSince..changedUntil (the selected sprint's date range), which
  // covers work completed in that window.
  async fetchMyWorkItems(options: { changedSince?: Date; changedUntil?: Date } = {}): Promise<WorkItem[]> {
    const ids = await this.fetchMyWorkItemIds(options);
    if (ids.length === 0) return [];
    // Two separate batch calls, not one — Azure DevOps rejects `fields`
    // combined with `$expand` (ConflictingParametersException), so the
    // narrow field set and the relations graph (for child work items) have
    // to be fetched independently and merged by id afterward.
    const [items, childIdsById] = await Promise.all([this.fetchWorkItemDetails(ids), this.fetchChildIds(ids)]);
    // One extra HTTP round-trip per item (for its column/state history) —
    // run these with bounded concurrency instead of one-at-a-time, which is
    // the main reason a full-project fetch used to take forever.
    const concurrency = 8;
    const withHistory: WorkItem[] = [];
    for (let i = 0; i < items.length; i += concurrency) {
      const batch = items.slice(i, Math.min(i + concurrency, items.length));
      const results = await Promise.all(
        batch.map(async (item) => {
          const histories = await this.fetchHistories(item.id as number);
          return this.toWorkItem(item, histories, childIdsById.get(item.id as number) ?? []);
        }),
      );
      withHistory.push(...results);
    }
    return withHistory;
  }

  // Looks up specific work items by id — used for a Feature's children that
  // fall outside the normal fetch window (already closed, not touched
  // recently). No history round trip per item; just the flat fields needed
  // to show a row in "Projetos".
  async fetchChildSummaries(ids: number[]): Promise<Map<number, ChildSummary>> {
    const result = new Map<number, ChildSummary>();
    if (ids.length === 0) return result;
    const items = await this.fetchWorkItemDetails(ids);
    for (const item of items) {
      const fields = item.fields as Record<string, any>;
      const assignedToField = fields['System.AssignedTo'];
      let assignedTo = '';
      if (assignedToField && typeof assignedToField === 'object') {
        assignedTo = assignedToField.displayName ?? '';
      } else if (typeof assignedToField === 'string') {
        assignedTo = assignedToField;
      }
      result.set(item.id as number, {
        id: item.id as number,
        title: fields['System.Title'] ?? '(sem título)',
        type: fields['System.WorkItemType'] ?? '',
        state: fields['System.State'] ?? '',
        boardColumn: normalizeBoardColumn(fields['System.BoardColumn'] ?? ''),
        assignedTo,
      });
    }
    return result;
  }

  // Returns the raw JSON payloads (work item fields + full update history)
  // for a handful of items, so it can be inspected to decide which fields
  // and states matter for cycle time / aging.
  async fetchRawSample(limit = 5): Promise<Array<Record<string, unknown>>> {
    const ids = await this.fetchMyWorkItemIds({});
    const sampleIds = ids.slice(0, limit);
    const samples: Array<Record<string, unknown>> = [];
    for (const id of sampleIds) {
      const itemResponse = await fetch(this.apiUrl(`wit/workitems/${id}?$expand=all&api-version=7.1`), {
        headers: this.headers,
      });
      await this.checkResponse(itemResponse);
      const updatesResponse = await fetch(this.apiUrl(`wit/workitems/${id}/updates?api-version=7.1`), {
        headers: this.headers,
      });
      await this.checkResponse(updatesResponse);
      samples.push({
        workItem: await itemResponse.json(),
        updates: await updatesResponse.json(),
      });
    }
    return samples;
  }

  private async fetchMyWorkItemIds(options: { changedSince?: Date; changedUntil?: Date }): Promise<number[]> {
    // Deliberately fetches from the whole project, not just items assigned
    // to you or tagged for you — otherwise "Responsável específico" could
    // only ever show other people's items when they happen to also carry
    // your tag. The dashboard's own filters (Meus itens / Marcados /
    // Responsável específico) decide what's shown client-side from this set.
    //
    // Scoped down to keep it fast: an open item shows up no matter how old
    // (Itens em aberto must never miss one), and anything else only counts
    // if it changed within [changedSince, changedUntil] (the selected
    // sprint's window). `doneStates` is the System.State side of "done" —
    // a rough filter here, since board-column-only completion is sorted out
    // precisely client-side afterwards; a few extra closed items slipping
    // through is harmless.
    const { changedSince, changedUntil } = options;
    const doneStates = this.settings.doneStateSet;
    const notDoneClause =
      doneStates.size === 0
        ? null
        : `NOT [System.State] IN (${[...doneStates].map((s) => `'${s.replace(/'/g, "''")}'`).join(',')})`;
    let recentClause: string | null = null;
    if (changedSince != null && changedUntil != null) {
      recentClause = `([System.ChangedDate] >= '${wiqlDate(changedSince)}' AND [System.ChangedDate] <= '${wiqlDate(changedUntil)}')`;
    } else if (changedSince != null) {
      recentClause = `[System.ChangedDate] >= '${wiqlDate(changedSince)}'`;
    }
    const parts = [notDoneClause, recentClause].filter((p): p is string => p != null);
    const scopeClause = parts.length > 0 ? `AND (${parts.join(' OR ')})` : '';
    const wiql = {
      query: `
        SELECT [System.Id]
        FROM WorkItems
        WHERE [System.TeamProject] = @project
          AND [System.WorkItemType] <> ''
          ${scopeClause}
        ORDER BY [System.ChangedDate] DESC
      `,
    };
    const response = await fetch(this.apiUrl('wit/wiql?api-version=7.1'), {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(wiql),
    });
    await this.checkResponse(response);
    const data = await response.json();
    const workItems: Array<{ id: number }> = data.workItems ?? [];
    return workItems.map((w) => w.id);
  }

  private async fetchWorkItemDetails(ids: number[]): Promise<Array<Record<string, any>>> {
    const results: Array<Record<string, any>> = [];
    const chunkSize = 200;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, Math.min(i + chunkSize, ids.length));
      const idsParam = chunk.join(',');
      const response = await fetch(
        this.apiUrl(
          `wit/workitems?ids=${idsParam}&fields=System.Id,System.Title,System.WorkItemType,` +
            'System.State,System.BoardColumn,System.CreatedDate,System.ChangedDate,' +
            'System.AssignedTo,System.Tags,System.AreaPath,System.IterationPath,' +
            'Microsoft.VSTS.Common.Priority,Microsoft.VSTS.Scheduling.TargetDate,' +
            'Microsoft.VSTS.Scheduling.DueDate,Custom.Prazo,' +
            'Custom.2d4ef589-5823-4d3e-9be3-b5ec97179be8,' +
            'Custom.Departamento,Custom.Complexidade,Custom.Prioridade,Custom.Solicitante' +
            '&api-version=7.1',
        ),
        { headers: this.headers },
      );
      await this.checkResponse(response);
      const data = await response.json();
      const value: Array<Record<string, any>> = data.value ?? [];
      results.push(...value);
    }
    return results;
  }

  // A separate batched call for the relations graph — Azure DevOps rejects
  // `fields` combined with `$expand` in the same request, so child work item
  // ids (Hierarchy-Forward relations) have to be fetched independently and
  // merged in by id afterward.
  private async fetchChildIds(ids: number[]): Promise<Map<number, number[]>> {
    const result = new Map<number, number[]>();
    const chunkSize = 200;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, Math.min(i + chunkSize, ids.length));
      const idsParam = chunk.join(',');
      const response = await fetch(this.apiUrl(`wit/workitems?ids=${idsParam}&$expand=relations&api-version=7.1`), {
        headers: this.headers,
      });
      await this.checkResponse(response);
      const data = await response.json();
      const value: Array<Record<string, any>> = data.value ?? [];
      for (const item of value) {
        result.set(item.id as number, this.childIdsOf(item));
      }
    }
    return result;
  }

  private async fetchHistories(id: number): Promise<Histories> {
    const response = await fetch(this.apiUrl(`wit/workitems/${id}/updates?api-version=7.1`), {
      headers: this.headers,
    });
    await this.checkResponse(response);
    const data = await response.json();
    const updates: Array<Record<string, any>> = data.value ?? [];
    const state: StateChange[] = [];
    const boardColumn: StateChange[] = [];
    // Every value Custom.Prazo (deadline) has ever been set to, with who set
    // it — the earliest one set by the card's own owner is the *original*
    // promised date, before any reschedule (by the owner or anyone else).
    const deadlineEdits: DeadlineEdit[] = [];
    for (const update of updates) {
      const fields = update.fields as Record<string, any> | undefined;
      if (fields == null) continue;
      // `revisedDate` on the latest revision is a sentinel far-future date
      // (e.g. 9999-01-01) meaning "not yet superseded" — use the revision's
      // own changed-date field instead, which reflects when the field
      // actually changed.
      const changedDate: string | undefined = fields['System.ChangedDate']?.newValue;
      const fallbackDate: string | undefined = update.revisedDate;
      const dateString = changedDate ?? fallbackDate;
      if (dateString == null) continue;
      const date = new Date(dateString);
      if (isNaN(date.getTime()) || date.getFullYear() >= 9000) continue;

      const newState: string | undefined = fields['System.State']?.newValue;
      if (newState != null) state.push({ state: newState, date });

      const newColumn: string | undefined = fields['System.BoardColumn']?.newValue;
      if (newColumn != null) {
        boardColumn.push({ state: normalizeBoardColumn(newColumn), date });
      }

      const newDeadline: string | undefined = fields['Custom.Prazo']?.newValue;
      if (newDeadline != null) {
        const revisedBy = update.revisedBy as Record<string, any> | undefined;
        const changedBy: string = revisedBy?.displayName ?? '';
        deadlineEdits.push({ date, value: newDeadline, changedBy });
      }
    }
    state.sort((a, b) => a.date.getTime() - b.date.getTime());
    boardColumn.sort((a, b) => a.date.getTime() - b.date.getTime());
    deadlineEdits.sort((a, b) => a.date.getTime() - b.date.getTime());
    return { state, boardColumn, deadlines: deadlineEdits };
  }

  // Extracts child work item IDs from the Hierarchy-Forward relations —
  // the "child" direction of a parent/child link (Feature -> User Story,
  // typically). Each relation's `url` ends in `.../workItems/{id}`.
  private childIdsOf(item: Record<string, any>): number[] {
    const relations: Array<Record<string, any>> = item.relations ?? [];
    const ids: number[] = [];
    for (const r of relations) {
      if (r.rel !== 'System.LinkTypes.Hierarchy-Forward') continue;
      const url: string = r.url ?? '';
      const match = url.match(/\/(\d+)$/);
      if (match) ids.push(Number(match[1]));
    }
    return ids;
  }

  private toWorkItem(item: Record<string, any>, histories: Histories, childIds: number[]): WorkItem {
    const fields = item.fields as Record<string, any>;
    const assignedToField = fields['System.AssignedTo'];
    let assignedTo = '';
    if (assignedToField && typeof assignedToField === 'object') {
      assignedTo = assignedToField.displayName ?? '';
    } else if (typeof assignedToField === 'string') {
      assignedTo = assignedToField;
    }
    const tagsField: string = fields['System.Tags'] ?? '';
    const tags = tagsField
      .split(';')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    const createdDate = new Date(fields['System.CreatedDate']);
    const currentBoardColumn = normalizeBoardColumn(fields['System.BoardColumn'] ?? '');
    // If the board column never changed since creation, the updates feed
    // has no entry for it — seed one so duration calculations still work.
    const boardColumnHistory =
      histories.boardColumn.length === 0 && currentBoardColumn !== ''
        ? [{ state: currentBoardColumn, date: createdDate }]
        : histories.boardColumn;
    const targetDateRaw: string | undefined =
      fields['Custom.Prazo'] ?? fields['Microsoft.VSTS.Scheduling.TargetDate'] ?? fields['Microsoft.VSTS.Scheduling.DueDate'];
    // The "original promise" only counts when set by the card's own owner —
    // a deadline entered by someone else isn't the owner's commitment. If
    // the owner never set one themselves, there's no valid original promise
    // to hold them to (originalTargetDate stays null).
    const ownerDeadlineEdits = histories.deadlines.filter(
      (d) => d.changedBy.trim().toLowerCase() === assignedTo.trim().toLowerCase(),
    );
    const originalDeadlineRaw = ownerDeadlineEdits.length > 0 ? ownerDeadlineEdits[0].value : null;
    // Reschedules = times the owner changed it *after* first setting it.
    const deadlineChangeCount = ownerDeadlineEdits.length === 0 ? 0 : ownerDeadlineEdits.length - 1;

    const parseDate = (raw: string | null | undefined): Date | null => {
      if (raw == null) return null;
      const d = new Date(raw);
      return isNaN(d.getTime()) ? null : d;
    };

    return new WorkItem({
      id: item.id as number,
      title: fields['System.Title'] ?? '(sem título)',
      type: fields['System.WorkItemType'] ?? '',
      currentState: fields['System.State'] ?? '',
      currentBoardColumn,
      createdDate,
      changedDate: new Date(fields['System.ChangedDate']),
      stateHistory: histories.state,
      boardColumnHistory,
      assignedTo,
      tags,
      areaPath: fields['System.AreaPath'] ?? '',
      iterationPath: fields['System.IterationPath'] ?? '',
      priority: fields['Custom.Prioridade'] ?? fields['Microsoft.VSTS.Common.Priority'] ?? null,
      targetDate: parseDate(targetDateRaw),
      originalTargetDate: parseDate(originalDeadlineRaw),
      deadlineChangeCount,
      requestType: fields['Custom.2d4ef589-5823-4d3e-9be3-b5ec97179be8'] ?? '',
      department: fields['Custom.Departamento'] ?? '',
      complexity: fields['Custom.Complexidade'] ?? '',
      requesterName: fields['Custom.Solicitante'] ?? '',
      childIds,
    });
  }

  private async checkResponse(response: Response): Promise<void> {
    if (response.status === 401 || response.status === 203) {
      throw new AzureDevOpsException(
        'Falha de autenticação. Verifique organização, projeto e o Personal Access Token.',
      );
    }
    if (response.status >= 400) {
      const body = await response.text().catch(() => '');
      throw new AzureDevOpsException(`Erro ${response.status} ao consultar o Azure Boards: ${body}`);
    }
  }
}

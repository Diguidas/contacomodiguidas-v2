export interface AppSettingsInit {
  organization?: string;
  project?: string;
  personalAccessToken?: string;
  triageColumns?: string;
  queueColumns?: string;
  developerColumns?: string;
  userColumns?: string;
  vendorColumns?: string;
  generalColumns?: string;
  doneColumn?: string;
  doneStates?: string;
  myDisplayName?: string;
  tagFilter?: string;
  personStageOverrides?: Record<string, string>;
}

const DEFAULTS: Required<AppSettingsInit> = {
  organization: '',
  project: '',
  personalAccessToken: '',
  triageColumns: 'Triagem,New',
  queueColumns: 'Liberado para Desenvolvimento',
  developerColumns: 'Desenvolvimento,Em Correção',
  userColumns: 'Aguard. Def. Usuário,Validação de Usuário',
  vendorColumns: 'Aguardando Fornecedor',
  generalColumns: 'Backlog,Em Andamento,Validação Funcional,Request',
  doneColumn: 'Concluído',
  doneStates: 'Done,Closed,Resolved,Concluído',
  myDisplayName: 'Guilherme Silva Franklin',
  tagFilter: 'Guilherme',
  personStageOverrides: {},
};

export class AppSettings {
  readonly organization: string;
  readonly project: string;
  readonly personalAccessToken: string;

  // Kanban board columns (System.BoardColumn), grouped by who/what the wait
  // time is attributed to. Each bucket accumulates only the wall-clock time
  // the card's board column matched one of its own values.
  readonly triageColumns: string; // "própria" — aguardando alguém pegar
  readonly queueColumns: string; // "própria" — liberado, aguardando dev pegar
  readonly developerColumns: string; // tempo do desenvolvedor
  readonly userColumns: string; // tempo aguardando o usuário/solicitante
  readonly vendorColumns: string; // tempo aguardando fornecedor externo
  readonly generalColumns: string; // conta para o tempo geral (fluxo normal)
  readonly doneColumn: string; // board column that marks the item as concluded

  readonly doneStates: string; // System.State fallback for "done" detection
  readonly myDisplayName: string;
  readonly tagFilter: string;

  // Per-person override of which stage counts as "their" work in the team
  // rankings (Ranking de execução própria / Health Score Velocidade) —
  // display name -> 'geral' or 'desenvolvimento'. A name with no entry here
  // falls back to auto-detection (whichever stage they accumulated more
  // time in).
  readonly personStageOverrides: Record<string, string>;

  constructor(init: AppSettingsInit = {}) {
    this.organization = init.organization ?? DEFAULTS.organization;
    this.project = init.project ?? DEFAULTS.project;
    this.personalAccessToken = init.personalAccessToken ?? DEFAULTS.personalAccessToken;
    this.triageColumns = init.triageColumns ?? DEFAULTS.triageColumns;
    this.queueColumns = init.queueColumns ?? DEFAULTS.queueColumns;
    this.developerColumns = init.developerColumns ?? DEFAULTS.developerColumns;
    this.userColumns = init.userColumns ?? DEFAULTS.userColumns;
    this.vendorColumns = init.vendorColumns ?? DEFAULTS.vendorColumns;
    this.generalColumns = init.generalColumns ?? DEFAULTS.generalColumns;
    this.doneColumn = init.doneColumn ?? DEFAULTS.doneColumn;
    this.doneStates = init.doneStates ?? DEFAULTS.doneStates;
    this.myDisplayName = init.myDisplayName ?? DEFAULTS.myDisplayName;
    this.tagFilter = init.tagFilter ?? DEFAULTS.tagFilter;
    this.personStageOverrides = init.personStageOverrides ?? DEFAULTS.personStageOverrides;
  }

  get isConfigured(): boolean {
    return this.organization !== '' && this.project !== '' && this.personalAccessToken !== '';
  }

  private toSet(value: string): Set<string> {
    return new Set(
      value
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    );
  }

  get triageColumnSet(): Set<string> {
    return this.toSet(this.triageColumns);
  }
  get queueColumnSet(): Set<string> {
    return this.toSet(this.queueColumns);
  }
  get developerColumnSet(): Set<string> {
    return this.toSet(this.developerColumns);
  }
  get userColumnSet(): Set<string> {
    return this.toSet(this.userColumns);
  }
  get vendorColumnSet(): Set<string> {
    return this.toSet(this.vendorColumns);
  }
  get generalColumnSet(): Set<string> {
    return this.toSet(this.generalColumns);
  }
  get doneStateSet(): Set<string> {
    return this.toSet(this.doneStates);
  }

  copyWith(patch: AppSettingsInit): AppSettings {
    return new AppSettings({
      organization: patch.organization ?? this.organization,
      project: patch.project ?? this.project,
      personalAccessToken: patch.personalAccessToken ?? this.personalAccessToken,
      triageColumns: patch.triageColumns ?? this.triageColumns,
      queueColumns: patch.queueColumns ?? this.queueColumns,
      developerColumns: patch.developerColumns ?? this.developerColumns,
      userColumns: patch.userColumns ?? this.userColumns,
      vendorColumns: patch.vendorColumns ?? this.vendorColumns,
      generalColumns: patch.generalColumns ?? this.generalColumns,
      doneColumn: patch.doneColumn ?? this.doneColumn,
      doneStates: patch.doneStates ?? this.doneStates,
      myDisplayName: patch.myDisplayName ?? this.myDisplayName,
      tagFilter: patch.tagFilter ?? this.tagFilter,
      personStageOverrides: patch.personStageOverrides ?? this.personStageOverrides,
    });
  }
}


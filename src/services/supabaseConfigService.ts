import { supabase } from './supabaseClient';
import { AppSettings } from './settingsService';

// Same shape SettingsService (localStorage) used to own — now backed by the
// single shared `app_config` row in Supabase instead of one copy per
// browser. Every logged-in user can read it (needed client-side to call
// the Azure DevOps API directly); only an admin can write to it — enforced
// by Postgres RLS (see supabase/schema.sql), not just by hiding the UI.
interface AppConfigRow {
  organization: string;
  project: string;
  personal_access_token: string;
  triage_columns: string;
  queue_columns: string;
  developer_columns: string;
  user_columns: string;
  vendor_columns: string;
  general_columns: string;
  done_column: string;
  done_states: string;
  my_display_name: string;
  tag_filter: string;
  person_stage_overrides: Record<string, string>;
}

function rowToSettings(row: AppConfigRow): AppSettings {
  return new AppSettings({
    organization: row.organization,
    project: row.project,
    personalAccessToken: row.personal_access_token,
    triageColumns: row.triage_columns,
    queueColumns: row.queue_columns,
    developerColumns: row.developer_columns,
    userColumns: row.user_columns,
    vendorColumns: row.vendor_columns,
    generalColumns: row.general_columns,
    doneColumn: row.done_column,
    doneStates: row.done_states,
    myDisplayName: row.my_display_name,
    tagFilter: row.tag_filter,
    personStageOverrides: row.person_stage_overrides ?? {},
  });
}

export class SupabaseConfigService {
  async load(): Promise<AppSettings> {
    const { data, error } = await supabase.from('app_config').select('*').eq('id', 1).single();
    if (error) throw error;
    return rowToSettings(data as AppConfigRow);
  }

  async save(settings: AppSettings): Promise<void> {
    const { error } = await supabase
      .from('app_config')
      .update({
        organization: settings.organization,
        project: settings.project,
        personal_access_token: settings.personalAccessToken,
        triage_columns: settings.triageColumns,
        queue_columns: settings.queueColumns,
        developer_columns: settings.developerColumns,
        user_columns: settings.userColumns,
        vendor_columns: settings.vendorColumns,
        general_columns: settings.generalColumns,
        done_column: settings.doneColumn,
        done_states: settings.doneStates,
        my_display_name: settings.myDisplayName,
        tag_filter: settings.tagFilter,
        person_stage_overrides: settings.personStageOverrides,
        updated_at: new Date().toISOString(),
      })
      .eq('id', 1);
    if (error) throw error;
  }
}

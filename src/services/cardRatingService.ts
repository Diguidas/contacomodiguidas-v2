import { supabase } from './supabaseClient';

// A single 1-5 star rating + comment a responsible gives one card they
// completed — about how that specific ticket/requester went (confusing
// requester, scope kept changing, etc). One per work item, given by whoever
// closed it. department/requesterName/itemTitle are a snapshot taken at
// rating time (see supabase/schema.sql) so every screen that lists ratings
// can show them without re-fetching Azure DevOps.
export class CardRating {
  readonly workItemId: number;
  readonly ratedBy: string;
  readonly department: string;
  readonly requesterName: string;
  readonly itemTitle: string;
  readonly stars: number;
  readonly comment: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;

  constructor(init: {
    workItemId: number;
    ratedBy: string;
    department: string;
    requesterName: string;
    itemTitle: string;
    stars: number;
    comment: string;
    createdAt: Date;
    updatedAt: Date;
  }) {
    this.workItemId = init.workItemId;
    this.ratedBy = init.ratedBy;
    this.department = init.department;
    this.requesterName = init.requesterName;
    this.itemTitle = init.itemTitle;
    this.stars = init.stars;
    this.comment = init.comment;
    this.createdAt = init.createdAt;
    this.updatedAt = init.updatedAt;
  }
}

interface CardRatingRow {
  work_item_id: number;
  rated_by: string;
  department: string;
  requester_name: string;
  item_title: string;
  stars: number;
  comment: string;
  created_at: string;
  updated_at: string;
}

function rowToRating(row: CardRatingRow): CardRating {
  return new CardRating({
    workItemId: row.work_item_id,
    ratedBy: row.rated_by,
    department: row.department,
    requesterName: row.requester_name,
    itemTitle: row.item_title,
    stars: row.stars,
    comment: row.comment,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  });
}

export class CardRatingService {
  async loadAll(): Promise<CardRating[]> {
    const { data, error } = await supabase.from('card_ratings').select('*');
    if (error) throw error;
    return (data as CardRatingRow[]).map(rowToRating);
  }

  async save(init: {
    workItemId: number;
    ratedBy: string;
    department: string;
    requesterName: string;
    itemTitle: string;
    stars: number;
    comment: string;
  }): Promise<void> {
    const { error } = await supabase.from('card_ratings').upsert(
      {
        work_item_id: init.workItemId,
        rated_by: init.ratedBy,
        department: init.department,
        requester_name: init.requesterName,
        item_title: init.itemTitle,
        stars: init.stars,
        comment: init.comment,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'work_item_id' },
    );
    if (error) throw error;
  }
}

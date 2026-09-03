export type ItemKind = "todo" | "event";

export interface Item {
  id: string;
  user_id: string;
  kind: ItemKind;
  title: string;
  datetime: string | null; // ISO 8601 for events; null for todos
  all_day: boolean;
  reminder: string | null; // ISO 8601 or null
  status: "pending" | "done";
  created_at: string;
  order: number;
  pinned: boolean;
  rating: number; // 0 = no rating; otherwise one of 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5
}

// Shape returned by the LLM proxy / parser.
export interface ParsedItem {
  title: string;
  kind: ItemKind;
  datetime: string | null;
  reminder: string | null;
}

export interface DraftItem {
  title: string;
  kind: ItemKind;
  datetime: string | null;
  reminder: string | null;
}

export interface PolishResult {
  items: DraftItem[];
}

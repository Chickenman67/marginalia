export type ItemKind = "todo" | "event";

export interface Item {
  id: string;
  space_token: string;
  kind: ItemKind;
  title: string;
  datetime: string | null; // ISO 8601 for events; null for todos
  all_day: boolean;
  reminder: string | null; // ISO 8601 or null
  status: "pending" | "done";
  created_at: string;
  order: number;
  pinned: boolean;
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

export interface AppConfig {
  supabaseUrl: string;
  supabaseAnon: string;
  parseFunction: string;
}

const env = import.meta.env;

export const config: AppConfig = {
  supabaseUrl: (env.VITE_SUPABASE_URL as string) || "",
  supabaseAnon: (env.VITE_SUPABASE_ANON as string) || "",
  parseFunction: (env.VITE_SUPABASE_URL as string)
    ? `${env.VITE_SUPABASE_URL}/functions/v1/parse`
    : ""
};

export const STORAGE_KEYS = {
  llmKey: "scheduleapp.llmKey",
  provider: "scheduleapp.provider"
};
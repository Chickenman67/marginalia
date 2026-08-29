import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      VITE_SUPABASE_URL: "",
      VITE_SUPABASE_ANON: ""
    }
  }
});

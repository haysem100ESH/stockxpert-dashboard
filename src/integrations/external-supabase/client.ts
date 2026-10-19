// Connects to the StockXpert project's own existing database (not Lovable Cloud).
// The anon key is a public, browser-safe key; data access is governed by that database's policies.
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://tcqlsxmgazrftpbumauk.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRjcWxzeG1nYXpyZnRwYnVtYXVrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTYyODk0ODEsImV4cCI6MjA3MTg2NTQ4MX0.BZd-jIdwMVCn2AdKEl5QU6qgcFMrhgpp2SO3e2NXS20";

export const SUPABASE_PROJECT_URL = SUPABASE_URL;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const supabase: any = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: typeof window !== "undefined" ? window.localStorage : undefined,
    persistSession: true,
    autoRefreshToken: true,
  },
});

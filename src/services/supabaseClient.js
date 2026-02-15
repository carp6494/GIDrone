import { createClient } from "@supabase/supabase-js"

const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL ?? "http://localhost"
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? ""

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn("Missing Supabase env vars: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY")
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

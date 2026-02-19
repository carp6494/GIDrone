import { createClient } from "@supabase/supabase-js"

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // Keep the user signed in across refreshes
    persistSession: true,

    // Allows Supabase to read session tokens from the URL after OAuth redirects
    detectSessionInUrl: true,

    // Saves sessions in browser storage (default is localStorage)
    storage: localStorage,

    // Use PKCE for OAuth (recommended)
    flowType: "pkce",

    // Optional: keeps token refresh running
    autoRefreshToken: true,
  },
})

import { createClient } from "@supabase/supabase-js"
import type { Session, User } from "@supabase/supabase-js"

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? "http://localhost"
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? ""

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    "Missing Supabase env vars: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY"
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: {
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${supabaseAnonKey}`,
    },
  },
})

export const getSupabaseAuthState = async () => {
  const { data, error } = await supabase.auth.getSession()
  if (error) {
    return { session: null, user: null, error }
  }
  const session = (data.session ?? null) as Session | null
  const user = (session?.user ?? null) as User | null
  supabase.realtime.setAuth(session?.access_token ?? "")
  return { session, user, error: null }
}

export const onSupabaseAuthStateChange = (
  handler: (user: User | null, session: Session | null) => void
) => {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    supabase.realtime.setAuth(session?.access_token ?? "")
    handler(session?.user ?? null, session ?? null)
  })
  return data
}

export const syncSupabaseAuth = async () => {
  const { data, error } = await supabase.auth.getSession()
  if (error) return
  supabase.realtime.setAuth(data.session?.access_token ?? "")
}

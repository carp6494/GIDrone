import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import type { User } from "@supabase/supabase-js"

import {
  getSupabaseAuthState,
  onSupabaseAuthStateChange,
  supabase,
} from "../lib/supabase"

type AuthContextValue = {
  user: User | null
  loading: boolean
  error: string | null
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error("useAuth must be used within AuthWrapper.")
  }
  return context
}

type AuthWrapperProps = {
  children: ReactNode
}

export function AuthWrapper({ children }: AuthWrapperProps) {
  const [user, setUser] = useState<AuthContextValue["user"]>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true

    const loadSession = async () => {
      try {
        const { user: currentUser, error: authError } =
          await getSupabaseAuthState()
        if (!mounted) return
        if (authError) {
          setError(authError.message)
        }
        setUser(currentUser ?? null)
      } catch (sessionError) {
        if (!mounted) return
        setError(
          sessionError instanceof Error
            ? sessionError.message
            : "Unable to read authentication session."
        )
      } finally {
        if (mounted) {
          setLoading(false)
        }
      }
    }

    loadSession()

    const { subscription } = onSupabaseAuthStateChange((nextUser) => {
      if (!mounted) return
      setError(null)
      setUser(nextUser ?? null)
      setLoading(false)
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  const signOut = async () => {
    setError(null)
    try {
      const { error: signOutError } = await supabase.auth.signOut()
      if (signOutError) {
        throw signOutError
      }
    } catch (signOutError) {
      setError(
        signOutError instanceof Error
          ? signOutError.message
          : "Unable to sign out."
      )
    }
  }

  const value = useMemo(
    () => ({ user, loading, error, signOut }),
    [user, loading, error]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

import type { ReactNode } from "react"

type AuthGuardProps = {
  user: { id: string } | null
  loading: boolean
  children: ReactNode
  fallback: ReactNode
}

export function AuthGuard({
  user,
  loading,
  children,
  fallback,
}: AuthGuardProps) {
  if (loading) {
    return (
      <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-6 text-sm text-slate-300">
        Checking authentication...
      </div>
    )
  }

  if (!user) {
    return <>{fallback}</>
  }

  return <>{children}</>
}

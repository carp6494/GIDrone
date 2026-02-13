import { useState } from "react"
import { Loader2, LogIn, Mail } from "lucide-react"

import { supabase } from "../lib/supabase"

type AuthProps = {
  variant?: "full" | "panel"
}

export function Auth({ variant = "full" }: AuthProps) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [mode, setMode] = useState<"password" | "magic">("password")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")

  const handleAuth = async () => {
    if (submitting) return
    setSubmitting(true)
    setError(null)
    setStatus(null)
    try {
      const trimmedEmail = email.trim()
      if (!trimmedEmail) {
        setError("Enter your email to continue.")
        return
      }
      if (mode === "magic") {
        const { error: otpError } = await supabase.auth.signInWithOtp({
          email: trimmedEmail,
          options: {
            emailRedirectTo: window.location.origin,
          },
        })
        if (otpError) {
          throw otpError
        }
        setStatus("Magic link sent. Check your inbox to finish signing in.")
        return
      }
      if (!password) {
        setError("Enter your password to continue.")
        return
      }
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      })
      if (signInError) {
        throw signInError
      }
      setStatus("Signed in. Welcome back.")
    } catch (authError) {
      setError(
        authError instanceof Error
          ? authError.message
          : "Authentication failed. Please try again."
      )
    } finally {
      setSubmitting(false)
    }
  }

  const card = (
    <div className="w-full rounded-3xl border border-slate-800 bg-slate-900/70 p-8 shadow-xl">
      <div className="flex flex-col gap-3 text-center">
        <p className="text-xs uppercase tracking-[0.45em] text-emerald-300">
          Mission Slate Access
        </p>
        <h2 className="text-3xl font-semibold text-white">
          Secure operator access
        </h2>
        <p className="text-sm text-slate-300">
          Authenticate to manage sites, upload winner photos, and export
          mission-ready datasets.
        </p>
      </div>

      <div className="mt-6 space-y-4">
        <div className="flex items-center justify-center gap-2 text-[11px] uppercase tracking-[0.3em] text-slate-500">
          <button
            type="button"
            onClick={() => setMode("password")}
            className={`rounded-full border px-3 py-1 transition ${
              mode === "password"
                ? "border-emerald-400/70 bg-emerald-400/10 text-emerald-200"
                : "border-slate-800 text-slate-500 hover:border-slate-600 hover:text-slate-300"
            }`}
          >
            Password
          </button>
          <button
            type="button"
            onClick={() => setMode("magic")}
            className={`rounded-full border px-3 py-1 transition ${
              mode === "magic"
                ? "border-emerald-400/70 bg-emerald-400/10 text-emerald-200"
                : "border-slate-800 text-slate-500 hover:border-slate-600 hover:text-slate-300"
            }`}
          >
            Magic Link
          </button>
        </div>
        <label className="block text-left text-xs text-slate-400">
          Email
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="operator@mission-slate.com"
            className="mt-2 w-full rounded-2xl border border-slate-800 bg-slate-950/60 px-4 py-3 text-sm text-slate-200"
          />
        </label>
        {mode === "password" ? (
          <label className="block text-left text-xs text-slate-400">
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
              className="mt-2 w-full rounded-2xl border border-slate-800 bg-slate-950/60 px-4 py-3 text-sm text-slate-200"
            />
          </label>
        ) : null}
        <button
          type="button"
          onClick={handleAuth}
          disabled={submitting}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-emerald-400 px-5 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
        >
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Securing...
            </>
          ) : (
            <>
              {mode === "magic" ? (
                <Mail className="h-4 w-4" />
              ) : (
                <LogIn className="h-4 w-4" />
              )}
              {mode === "magic" ? "Send magic link" : "Sign in"}
            </>
          )}
        </button>
        <p className="text-center text-[11px] text-slate-500">
          Supabase authentication required for Mission Slate access.
        </p>
      </div>

      {(error || status) && (
        <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-xs">
          {error && <p className="text-rose-300">{error}</p>}
          {status && <p className="text-emerald-300">{status}</p>}
        </div>
      )}
    </div>
  )

  if (variant === "panel") {
    return <div className="w-full">{card}</div>
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="relative min-h-screen overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(15,23,42,0.9),_transparent_60%)]" />
        <div className="pointer-events-none absolute -left-32 top-20 h-80 w-80 rounded-full bg-emerald-500/15 blur-[140px]" />
        <div className="pointer-events-none absolute bottom-0 right-0 h-72 w-72 rounded-full bg-cyan-500/15 blur-[160px]" />

        <main className="relative mx-auto flex min-h-screen w-full max-w-3xl flex-col items-center justify-center px-6 py-12">
          {card}
        </main>
      </div>
    </div>
  )
}

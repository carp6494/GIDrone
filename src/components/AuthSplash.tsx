import splashBackground from "../assets/GIDrone-Splash.jpg"

const logo = new URL("../assets/GIDrone4.PNG", import.meta.url).href

type AuthSplashProps = {
  onSignInGoogle: () => void
  onSignInMicrosoft: () => void
  onSendMagicLink: () => void
  email: string
  onEmailChange: (value: string) => void
  authError?: string | null
}

export function AuthSplash({
  onSignInGoogle,
  onSignInMicrosoft,
  onSendMagicLink,
  email,
  onEmailChange,
  authError = null,
}: AuthSplashProps) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-950 text-white">
      <img
        src={splashBackground}
        alt=""
        aria-hidden="true"
        className="absolute inset-0 h-full w-full object-cover opacity-60"
      />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_15%,rgba(14,165,233,0.1),transparent_42%),radial-gradient(circle_at_82%_78%,rgba(59,130,246,0.1),transparent_46%),linear-gradient(160deg,rgba(2,6,23,0.68)_0%,rgba(11,17,32,0.7)_45%,rgba(17,24,39,0.78)_100%)]" />
      <div className="absolute inset-0 opacity-10 [background-image:linear-gradient(rgba(148,163,184,0.14)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.14)_1px,transparent_1px)] [background-size:42px_42px]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,rgba(56,189,248,0.1),transparent_55%)]" />

      <header className="absolute left-0 top-0 z-10 p-4 sm:p-8">
        <img
          src={logo}
          alt="GI Drone"
          className="h-10 w-auto select-none sm:h-14"
          draggable={false}
        />
      </header>

      <main className="relative z-10 flex min-h-screen items-start justify-center px-4 py-20 sm:items-center sm:py-16">
        <section className="w-full max-w-md rounded-3xl border border-white/15 bg-white/10 p-5 shadow-2xl shadow-slate-950/40 backdrop-blur-xl sm:max-h-[calc(100svh-4rem)] sm:overflow-y-auto sm:p-8">
          <div className="space-y-2 text-center">
            <h1 className="text-[clamp(1.6rem,4vw,1.875rem)] font-semibold tracking-tight text-white">
              Welcome to GI Drone
            </h1>
            <p className="text-sm leading-6 text-slate-200">
              Sign in to access your sites and weather tools.
            </p>
          </div>

          <div className="mt-6 space-y-3">
            <button
              type="button"
              onClick={onSignInGoogle}
              className="flex w-full items-center justify-center gap-3 rounded-2xl border border-white/20 bg-white px-4 py-3 text-sm font-semibold text-slate-900 transition hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
            >
              <svg
                aria-hidden="true"
                className="h-5 w-5"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M21.805 10.023H12.25v3.955h5.49c-.237 1.272-.954 2.35-2.028 3.073v2.553h3.29c1.926-1.772 3.053-4.384 3.053-7.354 0-.742-.067-1.455-.25-2.227Z"
                  fill="#4285F4"
                />
                <path
                  d="M12.25 22c2.744 0 5.045-.908 6.726-2.396l-3.29-2.553c-.909.613-2.07.978-3.436.978-2.645 0-4.888-1.785-5.69-4.19H3.169v2.632A10.16 10.16 0 0 0 12.25 22Z"
                  fill="#34A853"
                />
                <path
                  d="M6.56 13.84a6.104 6.104 0 0 1-.318-1.84c0-.64.115-1.26.318-1.84V7.527H3.169A10.14 10.14 0 0 0 2.09 12c0 1.624.39 3.162 1.08 4.473L6.56 13.84Z"
                  fill="#FBBC05"
                />
                <path
                  d="M12.25 5.97c1.493 0 2.83.514 3.883 1.523l2.91-2.91C17.29 2.953 14.99 2 12.25 2a10.16 10.16 0 0 0-9.08 5.528L6.56 10.16c.802-2.406 3.045-4.19 5.69-4.19Z"
                  fill="#EA4335"
                />
              </svg>
              Sign in with Google
            </button>

            <button
              type="button"
              onClick={onSignInMicrosoft}
              className="flex w-full items-center justify-center gap-3 rounded-2xl border border-white/20 bg-white px-4 py-3 text-sm font-semibold text-slate-900 transition hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
            >
              <span className="grid h-5 w-5 grid-cols-2 grid-rows-2 gap-[2px]" aria-hidden="true">
                <span className="bg-[#f25022]" />
                <span className="bg-[#7fba00]" />
                <span className="bg-[#00a4ef]" />
                <span className="bg-[#ffb900]" />
              </span>
              Sign in with Microsoft
            </button>

            <div className="rounded-2xl border border-white/15 bg-slate-950/35 p-3">
              <label className="mb-2 block text-left text-[11px] font-medium uppercase tracking-[0.18em] text-slate-300">
                Email magic link
              </label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  type="email"
                  value={email}
                  onChange={(event) => onEmailChange(event.target.value)}
                  placeholder="you@example.com"
                  className="w-full rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-sm text-white placeholder:text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
                />
                <button
                  type="button"
                  onClick={onSendMagicLink}
                  className="rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-100 transition hover:bg-white/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
                >
                  Send link
                </button>
              </div>
            </div>
          </div>

          {authError ? (
            <p className="mt-4 rounded-xl border border-rose-400/25 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
              {authError}
            </p>
          ) : null}
        </section>
      </main>
    </div>
  )
}

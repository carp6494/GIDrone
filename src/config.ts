export const CONFIG = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
  mapboxToken: import.meta.env.VITE_MAPBOX_ACCESS_TOKEN,

  openWeatherBaseUrl: "https://api.openweathermap.org/data/2.5",
  checkWxBaseUrl: "https://api.checkwx.com",
  aviationWeatherBaseUrl: "https://aviationweather.gov",
  faaTfrBaseUrl: "https://tfr.faa.gov",
  nasaDipBaseUrl: "https://api.nasa.gov"
} as const

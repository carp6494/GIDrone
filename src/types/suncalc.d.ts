declare module "suncalc" {
  export type SunCalcTimes = {
    sunrise: Date
    sunset: Date
    dawn: Date
    dusk: Date
    [key: string]: Date
  }

  export function getTimes(date: Date, lat: number, lon: number): SunCalcTimes
}

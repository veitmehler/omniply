/**
 * Measurements in the units the clinic's own readers use (Veit, 2026-11-25).
 *
 * Research facts keep the units of their source. A study from the United
 * States put "lifting 10 lb or more" into an article for an Australian clinic
 * that otherwise wrote "fortnight" and "000" (Gemini read of the GEMINI2
 * bench). The conversion is done here, in code, before the writer sees the
 * fact: the arithmetic is always right, and the fact carries both figures, so
 * the fact check and the citation placement still recognise the sentence.
 *
 *   metric clinic:   "lifting 10 lb or more"  →  "lifting 10 lb (about 4.5 kg) or more"
 *   US clinic:       "walking 5 km a day"     →  "walking 5 km (about 3.1 miles) a day"
 *
 * United States: pounds, miles, inches, feet, Fahrenheit. Everywhere else,
 * the United Kingdom included: metric.
 */

export type MeasurementSystem = 'metric' | 'imperial'

const US_STATES =
  'Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming'
const US_STATE_CODES = 'AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC'
const US_RE = new RegExp(`\\b(?:United States(?: of America)?|U\\.S\\.A?\\.?|USA|US)\\b|\\b(?:${US_STATES})\\b|,\\s*(?:${US_STATE_CODES})\\b`)
/** Another country named outright settles it: "Georgia" the country, "Western Australia", "Washington, UK". */
const OTHER_COUNTRY_RE =
  /\b(?:Australia|Canada|United Kingdom|UK|England|Scotland|Wales|Ireland|New Zealand|Dominican Republic|Mexico|Germany|France|Spain|Italy|Netherlands|South Africa|India|Singapore|Georgia \(country\)|Tbilisi)\b/i

/** The system of the clinic's country, read from the account's free-text location ("Kawana, Queensland, Australia", "Miami, FL"). Unknown = metric. */
export function measurementSystemFor(geolocation: string | null | undefined): MeasurementSystem {
  const g = (geolocation ?? '').trim()
  if (!g || OTHER_COUNTRY_RE.test(g)) return 'metric'
  return US_RE.test(g) ? 'imperial' : 'metric'
}

interface Unit {
  /** Matches the unit as written after a number. */
  re: string
  /** Converts one value. */
  to: (v: number) => number
  /** Target unit label, singular and plural. */
  label: [string, string]
}

/** Units of a US source, converted for a metric reader. */
const TO_METRIC: Unit[] = [
  { re: 'lbs?\\.?|pounds?', to: (v) => v * 0.45359237, label: ['kg', 'kg'] },
  { re: 'oz\\.?|ounces?', to: (v) => v * 28.349523, label: ['g', 'g'] },
  { re: 'miles?', to: (v) => v * 1.609344, label: ['km', 'km'] },
  { re: 'mph|miles per hour', to: (v) => v * 1.609344, label: ['km/h', 'km/h'] },
  { re: 'inch(?:es)?', to: (v) => v * 2.54, label: ['cm', 'cm'] },
  { re: 'feet|foot|ft\\.?', to: (v) => v * 0.3048, label: ['m', 'm'] },
  { re: '(?:°\\s?F|degrees Fahrenheit)', to: (v) => ((v - 32) * 5) / 9, label: ['°C', '°C'] },
]

/** Units of a metric source, converted for a US reader. */
const TO_IMPERIAL: Unit[] = [
  { re: 'kg|kilograms?|kilos?', to: (v) => v * 2.2046226, label: ['lb', 'lb'] },
  { re: 'km/h|kilomet(?:er|re)s per hour', to: (v) => v / 1.609344, label: ['mph', 'mph'] },
  { re: 'km|kilomet(?:er|re)s?', to: (v) => v / 1.609344, label: ['mile', 'miles'] },
  { re: 'cm|centimet(?:er|re)s?', to: (v) => v / 2.54, label: ['inch', 'inches'] },
  { re: 'met(?:er|re)s?', to: (v) => v / 0.3048, label: ['foot', 'feet'] },
  { re: '(?:°\\s?C|degrees Celsius)', to: (v) => (v * 9) / 5 + 32, label: ['°F', '°F'] },
]

/** "about 4.5 kg": one decimal under ten, whole numbers above; never "4.0". */
export function roundForReader(v: number): string {
  const abs = Math.abs(v)
  const r = abs < 10 ? Math.round(v * 10) / 10 : Math.round(v)
  return String(Object.is(r, -0) ? 0 : r)
}

const NUM = '\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?'
const parse = (s: string) => Number(s.replace(/,/g, ''))

/**
 * Add the local figure after every measurement written in the other system.
 * A measurement that already carries a bracket is left alone, and so is one
 * already in the reader's own units.
 */
export function withLocalUnits(text: string, system: MeasurementSystem): string {
  const units = system === 'metric' ? TO_METRIC : TO_IMPERIAL
  let out = text
  for (const u of units) {
    // "10 lb", "5 to 12 lb", "5-12 lb", "5–12 lb"; the unit must end at a word boundary and not already be followed by a bracket.
    const re = new RegExp(`(?<![\\w.])(${NUM})(?:(\\s*(?:to|-|–|—)\\s*)(${NUM}))?(\\s?-?\\s?)(${u.re})(?![\\w°/])(?!\\s*\\()`, 'gi')
    out = out.replace(re, (whole, a: string, sep: string | undefined, b: string | undefined) => {
      const first = u.to(parse(a))
      if (!Number.isFinite(first)) return whole
      const last = b ? u.to(parse(b)) : null
      void sep
      const figure = last !== null ? `${roundForReader(first)} to ${roundForReader(last)}` : roundForReader(first)
      const label = u.label[roundForReader(last ?? first) === '1' ? 0 : 1]
      return `${whole} (about ${figure} ${label})`
    })
  }
  return out
}

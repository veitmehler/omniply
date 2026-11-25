import { describe, it, expect } from 'vitest'
import { measurementSystemFor, roundForReader, withLocalUnits } from '../units'

describe('measurementSystemFor', () => {
  it('United States clinics read imperial; every other clinic reads metric', () => {
    expect(measurementSystemFor('Miami, Florida, USA')).toBe('imperial')
    expect(measurementSystemFor('Miami, FL')).toBe('imperial')
    expect(measurementSystemFor('Austin, Texas')).toBe('imperial')
    expect(measurementSystemFor('United States')).toBe('imperial')
    expect(measurementSystemFor('Australia, Queensland')).toBe('metric')
    expect(measurementSystemFor('Kawana, Queensland, Australia')).toBe('metric')
    expect(measurementSystemFor('Cabarete, Dominican Republic')).toBe('metric')
    expect(measurementSystemFor('London, UK')).toBe('metric')
    expect(measurementSystemFor('')).toBe('metric')
    expect(measurementSystemFor(null)).toBe('metric')
  })
  it('a named other country beats a word that is also a US state', () => {
    expect(measurementSystemFor('Perth, Western Australia')).toBe('metric')
    expect(measurementSystemFor('Washington, Tyne and Wear, England')).toBe('metric')
  })
})

describe('roundForReader', () => {
  it('one decimal under ten, whole numbers above, never a trailing .0', () => {
    expect(roundForReader(4.5359)).toBe('4.5')
    expect(roundForReader(2.0003)).toBe('2')
    expect(roundForReader(22.68)).toBe('23')
    expect(roundForReader(-0.02)).toBe('0')
  })
})

describe('withLocalUnits', () => {
  it('the bench case: a US study in an Australian article', () => {
    expect(withLocalUnits('Each additional hour spent lifting 10 lb or more was linked to a flare.', 'metric')).toBe('Each additional hour spent lifting 10 lb (about 4.5 kg) or more was linked to a flare.')
  })
  it('converts weights, distances, lengths, speeds and temperatures for a metric reader', () => {
    expect(withLocalUnits('a 150-pound adult', 'metric')).toBe('a 150-pound (about 68 kg) adult')
    expect(withLocalUnits('walking 2 miles a day', 'metric')).toBe('walking 2 miles (about 3.2 km) a day')
    expect(withLocalUnits('a pillow 4 inches thick', 'metric')).toBe('a pillow 4 inches (about 10 cm) thick')
    expect(withLocalUnits('water at 104°F', 'metric')).toBe('water at 104°F (about 40 °C)')
    expect(withLocalUnits('running at 6 mph', 'metric')).toBe('running at 6 mph (about 9.7 km/h)')
  })
  it('converts a range once', () => {
    expect(withLocalUnits('loads of 5 to 12 lb', 'metric')).toBe('loads of 5 to 12 lb (about 2.3 to 5.4 kg)')
    expect(withLocalUnits('a 20-30 lbs load', 'metric')).toBe('a 20-30 lbs (about 9.1 to 14 kg) load')
  })
  it('converts metric sources for a US reader', () => {
    expect(withLocalUnits('lifting more than 25 kg', 'imperial')).toBe('lifting more than 25 kg (about 55 lb)')
    expect(withLocalUnits('a 5 km walk', 'imperial')).toBe('a 5 km (about 3.1 miles) walk')
    expect(withLocalUnits('a cold plunge at 10°C', 'imperial')).toBe('a cold plunge at 10°C (about 50 °F)')
    expect(withLocalUnits('1.6 km', 'imperial')).toBe('1.6 km (about 1 mile)')
  })
  it('leaves the reader\'s own units, bracketed conversions and unitless figures alone', () => {
    expect(withLocalUnits('lifting more than 25 kg', 'metric')).toBe('lifting more than 25 kg')
    expect(withLocalUnits('lifting 10 lb (4.5 kg) or more', 'metric')).toBe('lifting 10 lb (4.5 kg) or more')
    expect(withLocalUnits('in 30% to 61% of people within 24 hours', 'metric')).toBe('in 30% to 61% of people within 24 hours')
    expect(withLocalUnits('pain in both feet for 10 days', 'metric')).toBe('pain in both feet for 10 days')
    expect(withLocalUnits('1.3 ATA for 60 minutes', 'imperial')).toBe('1.3 ATA for 60 minutes')
    expect(withLocalUnits('a 2 in 5 chance', 'metric')).toBe('a 2 in 5 chance')
  })
})

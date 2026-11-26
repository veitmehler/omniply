/**
 * The place whose licensing body and advertising regulator read an article.
 *
 * The writer's claims rules have said "the advertising regulator in
 * {{jurisdiction}}" since the consolidation round, but nothing ever filled the
 * placeholder: the sentence went out as "the regulator in  will read this"
 * (found 2026-11-26). It is filled from the practice's location.
 *
 * The location field holds either a region ("Australia, Queensland", "Texas,
 * USA") or a street address ("Plaza Mariposa, Kite Beach, Cabarete, Dominican
 * Republic"). A region is used as it is. From an address only the last part,
 * the country or state, says whose rules apply.
 */
export function jurisdictionFor(geolocation: string | null | undefined): string {
  const parts = (geolocation ?? '').split(',').map((p) => p.trim()).filter(Boolean)
  if (parts.length === 0) return 'the country the practice is in'
  if (parts.length <= 2) return parts.join(', ')
  // An address: street, district, town, country. A part with a digit in it is a street number or a postcode, not a place.
  const places = parts.filter((p) => !/\d/.test(p))
  return places[places.length - 1] ?? parts[parts.length - 1]
}

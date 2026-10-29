/* One-time capture: render the CURRENT (pre-refactor) chiro debrief with the
 * fixture inputs and save it as the byte-identity baseline. */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildBarsHtml, buildDebriefHtml } from '../xray-debrief-template'
import { FIXTURE_DATA, FIXTURE_SCORES, FIXTURE_WEAKEST } from './xray-debrief-fixture'

const data = { ...FIXTURE_DATA, barsHtml: buildBarsHtml(FIXTURE_SCORES, FIXTURE_WEAKEST) }
const html = buildDebriefHtml(data)
const out = join(__dirname, 'xray-debrief-chiro.fixture.html')
writeFileSync(out, html)
console.log('captured', out, html.length, 'chars')

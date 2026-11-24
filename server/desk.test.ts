import assert from 'node:assert/strict';
import {
  meanWordConfidence, textCleanliness, isEnglishText, languageAllowed, classifyCard, headlineCase, stripBoilerplate, looksLikeId, humanizeId,
  pickHeadline, leadFromText, yearFromItem, yearFromText, isProseSentence, skipReason, buildDesk, DESK_BEATS, beatQueryUrl,
} from './desk';

// Real excerpts fetched from Archive.org on 2026-11-24 (shortened).
const CLEAN_CIA = `Approved For Release 2003/09/10 : CIA-RDP96-00788R001700210023-7\n\nMONROE INSTITUTE OF APPLIED SCIENCES\nGATEWAY\nINTERMEDIATE\nWORKBOOK\n\nRESTRICTION\nThe material contained herein is intended for the personal and private -\nuse only by those who have completed the first Session of the Gateway\nProgram. The attempted application by others may result in undesir-\nable and uncontrolled effects detrimental to any such unauthorized\nuser. Copyright 1977 Monroe Institute of Applied Sciences for the use of Gateway participants only.`;
const CLEAN_MKULTRA = `8 OCT 1975\n\nMEMORANDUM FOR: Inspector General\n\nSUBJECT : Destruction of Drug and Toxin Related Files\n\n1. On your instructions, I have investigated the destruction of\nAgency records related to drugs and toxins. This investigation was conducted between 17-30 September 1975 and was limited to avoid interfering in any way with other ongoing investigations of this matter, including that of the FBI.\n2. I discussed this matter with the following people who were present at the time.`;
const GARBAGE_FORM = `I \n\n\nGENDARMERIE  NATIONALE \n\n\nËOMPAnMIC  r'M  nooM \n\nVanité: \n\nbWT Ê |^0^3ve<fêAUi»0  AOUT7 1^88 \n\nHEN SEIQNEMENTS ADMINISTRATIFS\n\nCAÙftS ffÉSGffVt ÀU oesrh\n\nN°^IÉCE Nl/fU,LLET\n\nu»,l,  8,8  7078 \n\nf Gendarme  « 0«P»J«  - Gendarme  « A«P«J* \n\nvu  L-Ita  «ticleis?6  i 2°  «t  75  d«  Ced.  d.  wooidur.  *ta*U. \n\nVU £T TfiANSMti  SfGNATUfïZ £T CACHET \\ srCNAi 31.400 DN/GEND. OB .OM. EMP. SERV. DU 21.07 1971 CLA!`;
const CABLE = `This  record  is  a partial  extract  of  the  original  cable.  The  full  text  of  the  original  cable  is  not  available.\nUNCLAS  LILONGWE  000123\nSIPDIS\nSENSITIVE\nE.O.  12958:  N/A\nTAGS:  PGOV  KDEM  MI\nSUBJECT:  HOPES  FADE  FOR  OPPOSITION'S  "GRAND  COALITION"\nREF:  A.  03  LILONGWE  1202\nSUMMARY\n1.1.  (SBU)  Republican  Party  (RP)  President  Gwanda  Chakuamba  and  People's  Progressive`;

// hOCR confidence
const hocr = (confs: number[]) => confs.map((c, i) => `<span class='ocrx_word' id='w${i}' title='bbox 1 1 2 2; x_wconf ${c}; x_fsize 8'>w</span>`).join('');
assert.equal(meanWordConfidence(hocr(Array(40).fill(92)))?.mean, 92);
assert.equal(meanWordConfidence(hocr([...Array(20).fill(100), ...Array(20).fill(50)]))?.mean, 75);
assert.equal(meanWordConfidence(hocr(Array(10).fill(90))), null, 'under 30 words is not a score');
assert.equal(meanWordConfidence('<html>no layout</html>'), null);

// plain-text cleanliness: real good text passes, real garbage fails
assert.ok(textCleanliness(CLEAN_CIA) >= 85, `cia ${textCleanliness(CLEAN_CIA)}`);
assert.ok(textCleanliness(CLEAN_MKULTRA) >= 85, `mkultra ${textCleanliness(CLEAN_MKULTRA)}`);
assert.ok(textCleanliness(GARBAGE_FORM) < 70, `garbage ${textCleanliness(GARBAGE_FORM)}`);
assert.equal(textCleanliness('too short'), 0);

// language
assert.ok(isEnglishText(CLEAN_CIA) && isEnglishText(CLEAN_MKULTRA));
assert.ok(!isEnglishText('Détermination de l\'ordre de grandeur de la puissance d\'une source lumineuse à partir de l\'examen de clichés photographiques que nous avons effectué pour le compte du centre national d\'études spatiales dans le cadre de cette enquête préliminaire'));
assert.ok(languageAllowed(undefined) && languageAllowed('English') && languageAllowed(['eng']) && languageAllowed('en'));
assert.ok(!languageAllowed('French') && !languageAllowed(['French', 'Spanish']));

// card classification (thresholds from the 2026-11-24 probe)
assert.deepEqual(classifyCard({ meanConf: 92, cleanliness: 0 }).cardType, 'story');
assert.equal(classifyCard({ meanConf: 75, cleanliness: 0 }).cardType, 'story');
assert.equal(classifyCard({ meanConf: 71, cleanliness: 99 }).cardType, 'scan', 'the OCR score wins over cleanliness');
assert.equal(classifyCard({ meanConf: 71, cleanliness: 0 }).confidence.tone, 'amber');
assert.equal(classifyCard({ meanConf: 32, cleanliness: 0 }).confidence.tone, 'red');
assert.equal(classifyCard({ meanConf: 92, cleanliness: 0 }).confidence.label, '92% OCR');
assert.equal(classifyCard({ meanConf: null, cleanliness: 95 }).confidence.label, 'Plain text');
assert.equal(classifyCard({ meanConf: null, cleanliness: 95 }).cardType, 'story');
assert.equal(classifyCard({ meanConf: null, cleanliness: 40 }).cardType, 'scan');
assert.equal(classifyCard({ meanConf: null, cleanliness: 40 }).confidence.label, 'No OCR score');

// headlines
assert.equal(headlineCase('GATEWAY INTERMEDIATE WORKBOOK'), 'Gateway Intermediate Workbook');
assert.equal(headlineCase('CIA REPORT ON THE USSR'), 'CIA Report on the USSR');
assert.equal(headlineCase('Already Mixed Case'), 'Already Mixed Case');
assert.ok(looksLikeId('MKULTRA DOC_0000146170') && looksLikeId('04LILONGWE123') && looksLikeId('1958-07-8856806-Riga-USSR'));
assert.ok(!looksLikeId('Destruction of Drug and Toxin Related Files'));
assert.equal(pickHeadline({ title: 'CIA Reading Room cia-rdp96-00788r001700210023-7: GATEWAY INTERMEDIATE WORKBOOK', identifier: 'x', collectionName: 'The CIA Reading Room Mirror', text: CLEAN_CIA }), 'Gateway Intermediate Workbook');
assert.equal(pickHeadline({ title: 'MKULTRA DOC_0000146170', identifier: 'DOC_0000146170', collectionName: 'MKULTRA files', text: CLEAN_MKULTRA }), 'Destruction of Drug and Toxin Related Files');
assert.equal(pickHeadline({ title: '04LILONGWE123', identifier: '04LILONGWE123', collectionName: 'U.S. State Department', text: CABLE }), `Hopes Fade for Opposition's "Grand Coalition"`);
assert.equal(pickHeadline({ title: '1958-07-8856806-Riga-USSR', identifier: '1958-07-8856806-Riga-USSR', collectionName: 'Project Blue Book', text: GARBAGE_FORM }), 'Project Blue Book: Riga USSR');
assert.equal(humanizeId('88307078-543-88-R', 'UFO Files'), 'UFO Files 88307078-543-88-R');

// lead: verbatim, boilerplate and headings stripped
assert.ok(stripBoilerplate(CLEAN_CIA).indexOf('Approved For Release') < 0);
const lead = leadFromText(CLEAN_CIA)!;
assert.ok(lead.startsWith('The material contained herein is intended for the personal and private use only'), lead);
assert.ok(leadFromText(CLEAN_CIA, 600)!.includes('undesirable'), 'hyphenation at line ends is joined');
assert.ok(lead.length <= 260);
assert.ok(leadFromText(CLEAN_MKULTRA)!.startsWith('1. On your instructions') || leadFromText(CLEAN_MKULTRA)!.startsWith('On your instructions'));
assert.equal(leadFromText(GARBAGE_FORM), null, 'no clean sentence, no lead');
assert.equal(leadFromText(CABLE.split('\n').slice(0, 7).join('\n')), null, 'cable header lines are not a lead');

// years
assert.deepEqual(yearFromItem('1977-06-23', 'x'), { year: 1977, note: null });
assert.deepEqual(yearFromItem('1975', 'x'), { year: 1975, note: null });
assert.deepEqual(yearFromItem(undefined, '04LILONGWE123'), { year: 2004, note: 'from cable ID' });
assert.deepEqual(yearFromItem(undefined, '88307078X1'), { year: null, note: null });
assert.deepEqual(yearFromItem(undefined, '1958-07-8856806-Riga-USSR'), { year: 1958, note: 'from item ID' });
assert.deepEqual(yearFromItem(undefined, '98LILONGWE1'), { year: 1998, note: 'from cable ID' });

// skip reasons
const okFiles = [{ name: 'a_djvu.txt', size: 5000 }];
assert.equal(skipReason({ metadata: {}, files: okFiles }, {}), null);
assert.equal(skipReason({ metadata: { private: 'true' }, files: okFiles }, {}), 'restricted');
assert.equal(skipReason({ metadata: { 'access-restricted-item': 'true' }, files: okFiles }, {}), 'restricted');
assert.equal(skipReason({ metadata: {}, files: okFiles, is_dark: true }, {}), 'restricted');
assert.equal(skipReason({ metadata: { language: 'French' }, files: okFiles }, {}), 'not English');
assert.equal(skipReason({ metadata: {}, files: [] }, {}), 'no OCR text');
assert.equal(skipReason({ metadata: {}, files: [{ name: 'a_djvu.txt', size: 0 }] }, {}), 'no OCR text');
assert.equal(skipReason({ metadata: {}, files: [{ name: 'a_djvu.txt', size: 99_000_000 }] }, {}), 'text file too large');


// live-probe regressions (2026-11-24): header blocks and release stamps are not leads
assert.equal(leadFromText('ee 9 June 1983 US Army Operational Group Fort Meade, MD 20755 1. You t'), null);
assert.equal(leadFromText('pase 1999/09/24 : CIA-RDP85-00671R000200060001-5 BOX_& Foner OL/ The N'), null);
assert.ok(!isProseSentence('Sent: Subject Sullivan, Jacob J <SullivanJJ@state.gov> Friday, December 12 2009'));
assert.ok(isProseSentence('Australian UFO files available on the website of the National Archives of Australia are listed here.'));
assert.equal(humanizeId('DOC_0000190090', 'MKULTRA files'), 'MKULTRA document 190090');
assert.equal(pickHeadline({ title: 'I hereby acknowledge receipt of the following:', identifier: 'DOC_0000017354', collectionName: 'MKULTRA files', text: '' }), 'MKULTRA document 17354');
assert.equal(yearFromText('8 OCT 1975\n\nMEMORANDUM'), 1975);
assert.equal(yearFromText('Report dated July 26, 1963 follows'), 1963);
assert.equal(yearFromText('no dates here at all'), null);
assert.equal(yearFromText('Order Code RS20864 Updated January 3, 2005 CRS Report'), 2005);

// beats: FBI is configured but never queried
assert.equal(DESK_BEATS.find((b) => b.id === 'fbi')!.enabled, false);
assert.ok(beatQueryUrl(['project-blue-book', 'ufo-files'], 24).includes('collection%3A(project-blue-book%20OR%20ufo-files)'));

(async () => {
  const queried: string[] = [];
  const text = (t: string) => new Response(t, { status: 206 });
  const meta: Record<string, unknown> = {
    goodcia: { metadata: { title: 'CIA Reading Room goodcia: GATEWAY INTERMEDIATE WORKBOOK', date: '1977-01-01', collection: ['ciareadingroom', 'usgovernmentmirrors'], imagecount: 21 }, files: [{ name: 'goodcia_djvu.txt', size: 9000 }, { name: 'goodcia_hocr.html', size: 900000 }] },
    scancard: { metadata: { title: '1958-07-8856806-Riga-USSR', collection: 'project-blue-book', language: 'English', imagecount: 2 }, files: [{ name: 'scancard_djvu.txt', size: 5000 }, { name: 'scancard_hocr.html', size: 100000 }] },
    locked: { metadata: { title: 'Locked item', private: 'true' }, files: [{ name: 'locked_djvu.txt', size: 9000 }] },
    french: { metadata: { title: 'Note technique', language: 'French' }, files: [{ name: 'french_djvu.txt', size: 9000 }] },
    notext: { metadata: { title: 'No text here at all' }, files: [{ name: 'notext.pdf', size: 9000 }] },
    nolead: { metadata: { title: 'Table of Names', language: 'English' }, files: [{ name: 'nolead_djvu.txt', size: 5000 }, { name: 'nolead_hocr.html', size: 100000 }] },
    mk: { metadata: { title: 'MKULTRA DOC_0000146170', collection: 'mkultrafiles' }, files: [{ name: 'mk_djvu.txt', size: 13241 }] },
  };
  const docsByBeat: Record<string, string[]> = { ciareadingroom: ['locked', 'goodcia', 'french', 'notext'], 'project-blue-book': ['scancard'], 'state-department': ['nolead'], mkultrafiles: ['mk'] };
  const f = (async (url: string) => {
    queried.push(url);
    if (url.includes('advancedsearch')) {
      const col = Object.keys(docsByBeat).find((c) => decodeURIComponent(url).includes(`collection:(${c}`) || decodeURIComponent(url).includes(`${c} OR`) || decodeURIComponent(url).includes(`OR ${c})`))!;
      return new Response(JSON.stringify({ response: { docs: docsByBeat[col].map((identifier) => ({ identifier })) } }));
    }
    const mm = url.match(/\/metadata\/([^/?]+)/);
    if (mm) return new Response(JSON.stringify(meta[decodeURIComponent(mm[1])]));
    if (url.endsWith('goodcia_djvu.txt')) return text(CLEAN_CIA);
    if (url.endsWith('goodcia_hocr.html')) return text(hocr(Array(60).fill(92)));
    if (url.endsWith('scancard_djvu.txt')) return text(GARBAGE_FORM);
    if (url.endsWith('scancard_hocr.html')) return text(hocr(Array(60).fill(32)));
    if (url.endsWith('nolead_djvu.txt')) return text('NAMES OF PERSONS LISTED\n'.repeat(30));
    if (url.endsWith('nolead_hocr.html')) return text(hocr(Array(60).fill(95)));
    if (url.endsWith('mk_djvu.txt')) return text(CLEAN_MKULTRA);
    return new Response('nope', { status: 404 });
  }) as unknown as typeof fetch;
  const lib = [{ identifier: 'ciareadingroom', name: 'The CIA Reading Room Mirror' }, { identifier: 'project-blue-book', name: 'Project Blue Book' }, { identifier: 'mkultrafiles', name: 'MKULTRA files' }];
  const feed = await buildDesk({ fetchImpl: f, lib, now: () => new Date('2026-11-24T12:00:00Z') });
  const byId = Object.fromEntries(feed.items.map((i) => [i.id, i]));
  assert.deepEqual(Object.keys(byId).sort(), ['goodcia', 'mk', 'nolead', 'scancard'], 'restricted, French and text-less items are skipped');
  assert.equal(byId.goodcia.cardType, 'story');
  assert.equal(byId.goodcia.headline, 'Gateway Intermediate Workbook');
  assert.equal(byId.goodcia.confidence.label, '92% OCR');
  assert.equal(byId.goodcia.source, 'The CIA Reading Room Mirror');
  assert.equal(byId.goodcia.year, 1977);
  assert.equal(byId.goodcia.pages, 21);
  assert.ok(byId.goodcia.lead!.startsWith('The material contained herein'));
  assert.equal(byId.goodcia.thumbUrl, 'https://archive.org/download/goodcia/page/n0_w400.jpg');
  assert.equal(byId.goodcia.pageUrl, 'https://archive.org/download/goodcia/page/n0_w800.jpg');
  assert.equal(byId.scancard.cardType, 'scan');
  assert.equal(byId.scancard.lead, null);
  assert.equal(byId.scancard.confidence.tone, 'red');
  assert.equal(byId.scancard.headline, 'Project Blue Book scancard');
  assert.equal(byId.mk.cardType, 'story');
  assert.equal(byId.mk.confidence.label, 'Plain text');
  assert.equal(byId.mk.headline, 'Destruction of Drug and Toxin Related Files');
  assert.equal(byId.mk.year, 1975);
  assert.equal(byId.mk.yearNote, 'from text');
  assert.ok(byId.goodcia.rawOcr.includes('MONROE INSTITUTE'), 'raw OCR is kept verbatim');
  assert.ok(!feed.items.some((i) => 'url' in i), 'items carry no links to Archive.org');
  assert.ok(!JSON.stringify(feed.items).includes('archive.org/details'), 'no details-page links anywhere in the feed');
  assert.equal(feed.beats.find((b) => b.id === 'fbi')!.enabled, false);
  assert.ok(!queried.some((u) => u.includes('nsia-fbi-files')), 'FBI is never queried');
  assert.equal(byId.nolead.cardType, 'scan', 'high OCR but no readable sentence: scan card, never an empty story');
  assert.equal(byId.nolead.lead, null);
  assert.equal(feed.count, 4);

  // every query failing is an error, never an empty success
  const dead = (async () => new Response('x', { status: 503 })) as unknown as typeof fetch;
  await assert.rejects(buildDesk({ fetchImpl: dead, lib }), /every Archive\.org query failed/);
  console.log('desk tests ok');
})();

// docDate / excerpt (Step 2)
import { dateFromText, dateFromMeta, excerptFromText } from './desk';
import assert2 from 'node:assert';
assert2.equal(dateFromText('Memo\n9 June 1983\nThe rest'), '1983-06-09');
assert2.equal(dateFromText('Dated July 26, 1963 at the office'), '1963-07-26');
assert2.equal(dateFromText('In June 1983 something'), null, 'month and year only is not a day');
assert2.equal(dateFromText('31 February 1983'), null, 'impossible date');
assert2.equal(dateFromMeta('1967-01-01T00:00:00Z'), null, 'Archive year-only dates are not days');
assert2.equal(dateFromMeta('1967-03-14'), '1967-03-14');
const sent = 'The committee reviewed the evidence carefully and concluded that the reported sightings could not be explained by any known aircraft in the region. ';
const long = sent.repeat(12);
const ex = excerptFromText(long, 1200)!;
assert2.ok(ex.length > 300 && ex.length <= 1200 && ex.startsWith('The committee'));
assert2.equal(excerptFromText(sent, 1200), null, 'short text gets no expander');
console.log('desk date/excerpt tests ok');

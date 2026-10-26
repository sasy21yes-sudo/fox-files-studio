import type { Source } from '../types';

/**
 * Precompiled bibliography.
 *
 * These entries were checked against the linked documents when the project was
 * built (October 2026). The app does not re-verify them over the network at
 * runtime, and the Sources panel says so.
 */
export const SOURCES_VERIFIED_ON = '21 October 2026';

export const SOURCES: Source[] = [
  {
    id: 'senate-1977',
    title:
      'Project MKULTRA, the CIA’s Program of Research in Behavioral Modification — Joint Hearing before the Select Committee on Intelligence and the Subcommittee on Health and Scientific Research of the Committee on Human Resources',
    publisher: 'United States Senate, 95th Congress, 1st Session',
    date: 'August 3, 1977',
    url: 'https://www.intelligence.senate.gov/sites/default/files/hearings/95mkultra.pdf',
    claims: [
      'Director of Central Intelligence Adm. Stansfield Turner testified that MKULTRA ran from 1953 to 1964.',
      'The recovered material contained 149 MKULTRA subprojects and named 80 institutions, including 44 colleges or universities, plus 185 non-government researchers and assistants.',
      'Turner’s categories of subprojects included behavioral drugs and alcohol, hypnosis, sleep research and behavioral change, polygraph research, and others; the hearing record also includes material on “truth” drugs as aids to interrogation.',
      'Six subprojects involved tests on unwitting subjects; some unwitting testing took place in safe houses in San Francisco and New York City.',
      'Dr. Frank Olson, an Army civilian employee, died in 1953 about a week after unwittingly consuming LSD at a meeting called by the CIA.',
      'The 1963 CIA Inspector General report led to the end of unwitting testing in 1964.',
      'MKULTRA files were destroyed in 1973 under the authority of the then-Director of Central Intelligence; Sen. Edward Kennedy’s remarks name Richard Helms.',
      'In 1977 a CIA employee found seven boxes of MKULTRA records at a retired-records center; Turner described them mainly as finance folders (approvals of advances, vouchers, accountings).',
      'Sen. Kennedy stated that the CIA drugged American citizens without their knowledge or consent.',
    ],
  },
  {
    id: 'church-1976',
    title:
      'Final Report of the Select Committee to Study Governmental Operations with Respect to Intelligence Activities — Book I: Foreign and Military Intelligence',
    publisher: 'United States Senate, 94th Congress, 2d Session (Report No. 94-755)',
    date: 'April 26, 1976',
    url: 'https://www.intelligence.senate.gov/sites/default/files/94755_I.pdf',
    altUrl: 'https://archive.org/details/finalreportofsel01unit',
    claims: [
      'A Senate select committee investigated U.S. intelligence activities and published its final report in 1976.',
      'Book I contains Chapter XVII, “Testing and Use of Chemical and Biological Agents by the Intelligence Community,” including a section on CIA drug-testing programs (from p. 385).',
    ],
  },
  {
    id: 'senate-history-church',
    title: 'Church Committee — Senate Select Committee to Study Governmental Operations with Respect to Intelligence Activities',
    publisher: 'United States Senate Historical Office (senate.gov)',
    date: 'Accessed October 2026',
    url: 'https://www.senate.gov/about/powers-procedures/investigations/church-committee.htm',
    claims: [
      'The Senate created the committee on January 27, 1975, with Senator Frank Church as chairman.',
      'The committee examined whether intelligence agencies had engaged in illegal, improper or unethical activities.',
    ],
  },
  {
    id: 'cia-sp68-1957',
    title: 'Memorandum for the Record — Subject: MKULTRA, Subproject 68',
    publisher: 'Central Intelligence Agency (CIA Reading Room, document 00234482)',
    date: 'February 26, 1957',
    url: 'https://archive.org/details/cia-readingroom-document-00234482',
    claims: [
      'Subproject 68 funded a two-year research program, from March 18, 1957, by Dr. Ewen Cameron, Chairman of the Department of Psychiatry at McGill University, Montreal, Canada.',
      'The program studied “the effects upon human behavior of the repetition of verbal signals”; one aim was to improve the technique of “(hetero)psychic driving”.',
      'Its aims included “chemical agents which will break down the ongoing patterns of behavior” and methods of inactivating the patient during the period of driving (exposure to repetition).',
      'The drugs listed include Artane, Anectine, bulbocapnine, curare and LSD-25.',
      'The money passed through the Society for the Investigation of Human Ecology, Inc., described as a cover organization; the cost was $38,180 over two years.',
      'The memo states that Dr. Cameron and his staff “will remain completely unwitting of U.S. Government interest”.',
    ],
  },
  {
    id: 'canada-ami-1992',
    title: 'Info Source — Régime d’aide aux personnes déstructurées à l’Institut Allan Memorial',
    publisher: 'Department of Justice Canada',
    date: 'Accessed October 2026',
    url: 'https://justice.gc.ca/fra/trans/aiprp-atip/infosource/p5.html',
    claims: [
      'Former patients of Dr. Ewen Cameron at the Allan Memorial Institute who had undergone a treatment called “depatterning” (déstructuration) could apply for an ex gratia payment of $100,000.',
      'The plan was established by Order in Council P.C. 1992-2302 of November 16, 1992, and ended on January 31, 1994.',
    ],
  },
];

export const sourceById = (id: string): Source | undefined => SOURCES.find((s) => s.id === id);

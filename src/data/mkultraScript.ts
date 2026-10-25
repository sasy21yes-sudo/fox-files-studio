import type { MkSceneId } from '../types';

/**
 * Original English narration for "MKUltra: The Secret Experiments".
 *
 * Every factual statement is limited to what the bundled sources support
 * (see sources.ts). The narration paraphrases the record; it contains no
 * quotations attributed to real people.
 */
/**
 * An explainer pop-up synced to the narration: it appears when the subtitle cue
 * containing `cue` is spoken (and stays a little after). If the narration is
 * edited and the text is no longer found, the beat simply does not appear.
 */
export type Beat =
  | { cue: string; kind: 'question'; text: string }
  | { cue: string; kind: 'span'; from: string; to: string; label: string }
  | { cue: string; kind: 'count'; value: number; label: string; note?: string }
  | { cue: string; kind: 'versus'; left: string; right: string; caption?: string }
  | { cue: string; kind: 'define'; word: string; pos: string; meaning: string }
  | { cue: string; kind: 'waffle'; total: number; hit: number; label: string; note?: string }
  | { cue: string; kind: 'list'; items: string[]; title?: string }
  | { cue: string; kind: 'record'; tag: string; who: string; text: string; highlight: string; note: string }
  | { cue: string; kind: 'statement'; lines: string[] }
  /** A person named in the narration: identikit card (role and year must come from the narration or sources). */
  | { cue: string; kind: 'person'; name: string; role: string; year?: string };

export interface ScriptEntry {
  id: MkSceneId;
  title: string;
  summary: string;
  narration: string;
  keywords: string[];
  sourceIds: string[];
  duration: number;
  beats: Beat[];
}

/**
 * Explainer-style narration (question → context → evidence → what it means),
 * written to be read slowly with pauses. Facts are limited to the bundled sources.
 */
export const MKULTRA_SCRIPT: ScriptEntry[] = [
  {
    id: 'file',
    title: 'The File',
    summary: 'A dark room. Agent Fox enters, a folder lands on the desk, and the title appears.',
    narration:
      'In 1977, the United States Senate held a hearing about a secret CIA program. Its files had been destroyed years earlier. But not all of them. The program was called MKUltra. So what was it? And how do we know?',
    keywords: ['1977', 'secret CIA program', 'destroyed', 'MKUltra'],
    sourceIds: ['senate-1977'],
    duration: 26,
    beats: [
      { cue: 'But not all of them', kind: 'statement', lines: ['FILES: DESTROYED IN 1973', 'SOME: FOUND IN 1977'] },
      { cue: 'And how do we know?', kind: 'question', text: 'What was it? How do we know?' },
    ],
  },
  {
    id: 'question',
    title: 'The Record',
    summary: 'Agent Fox examines declassified paperwork while a vintage map and archive labels drift behind him.',
    narration:
      "Let's start with what the CIA itself told the Senate. According to the CIA director's testimony, MKUltra ran from 1953 to 1964. That's eleven years. The surviving records list 149 subprojects. They name 80 institutions, and 44 of them were colleges and universities. They also name 185 researchers and assistants from outside the government.",
    keywords: ['1953', '1964', 'eleven years', '149 subprojects', '80 institutions', '44', '185'],
    sourceIds: ['senate-1977'],
    duration: 33,
    beats: [
      { cue: "That's eleven years", kind: 'span', from: '1953', to: '1964', label: '11 YEARS' },
      { cue: '185 researchers', kind: 'count', value: 185, label: 'OUTSIDE RESEARCHERS', note: '& assistants named in the records' },
    ],
  },
  {
    id: 'experiments',
    title: 'The Experiments',
    summary: 'A laboratory sketch: a glass vial, paperwork and a reel-to-reel recorder animate into view.',
    narration:
      'So what were all these subprojects actually doing? The director sorted them into categories. Among them: drugs and alcohol. Hypnosis. Sleep research. Polygraphs. The record also covers drugs meant as aids to interrogation. LSD was among the drugs tested. And here is the part that matters most. Some of the people tested were volunteers. Some were never told.',
    keywords: ['categories', 'LSD', 'interrogation', 'volunteers', 'never told'],
    sourceIds: ['senate-1977'],
    duration: 34,
    beats: [
      { cue: 'actually doing?', kind: 'question', text: 'What were they actually doing?' },
      { cue: 'Sleep research', kind: 'list', title: 'SOME OF THE CATEGORIES', items: ['DRUGS & ALCOHOL', 'HYPNOSIS', 'SLEEP RESEARCH', 'POLYGRAPHS'] },
      { cue: 'were volunteers', kind: 'versus', left: 'VOLUNTEERS', right: 'NEVER TOLD', caption: 'Two very different kinds of test subject' },
    ],
  },
  {
    id: 'cost',
    title: 'The Human Cost',
    summary: 'Evidence of testing without informed consent. The room turns quiet and serious.',
    narration:
      "The testimony counted six subprojects that tested drugs on unwitting people. Some of those tests happened in safe houses in San Francisco and New York City. There was no informed consent. One case shows what that meant. Dr. Frank Olson was an Army civilian employee. In 1953, at a meeting called by the CIA, he was given LSD without knowing it. About a week later, he was dead.",
    keywords: ['six subprojects', 'unwitting', 'safe houses', 'no informed consent', 'Frank Olson'],
    sourceIds: ['senate-1977'],
    duration: 40,
    beats: [
      { cue: 'six subprojects', kind: 'waffle', total: 149, hit: 6, label: '6 OF 149 SUBPROJECTS', note: 'tested drugs on people who did not know' },
    ],
  },
  {
    id: 'revelation',
    title: 'The Revelation',
    summary: 'Committee and hearing papers fill an evidence board. Agent Fox points to the records.',
    narration:
      "So how did any of this come out? In January 1975, the Senate created a special committee, chaired by Senator Frank Church. Its job was to find out whether America's intelligence agencies had done anything illegal, improper or unethical. Then, in 1977, a CIA employee found seven boxes of MKUltra records at a retired records center. That August, senators questioned the CIA director at a joint hearing. Senator Edward Kennedy said the CIA had drugged American citizens without their knowledge or consent.",
    keywords: ['Frank Church', 'illegal, improper or unethical', 'seven boxes', 'joint hearing', 'Edward Kennedy'],
    sourceIds: ['senate-history-church', 'church-1976', 'senate-1977'],
    duration: 46,
    beats: [
      { cue: 'come out?', kind: 'question', text: 'How did it come out?' },
      { cue: 'illegal, improper or unethical', kind: 'list', items: ['ILLEGAL?', 'IMPROPER?', 'UNETHICAL?'] },
      {
        // (on the start of the sentence: on its last words the card stayed 2 s - the episode's key line)
        cue: 'Senator Edward Kennedy said',
        kind: 'record',
        tag: 'U.S. SENATE · AUG 3, 1977',
        who: 'Sen. Edward Kennedy',
        text: 'The CIA drugged American citizens without their knowledge or consent.',
        highlight: 'without their knowledge or consent',
        note: 'Paraphrased from the hearing record',
      },
    ],
  },
  {
    id: 'known',
    title: 'What We Know',
    summary: 'The room brightens. Agent Fox closes the folder and a source-based takeaway appears.',
    narration:
      "But those boxes were never the full story. A 1963 report by the CIA's Inspector General led to the end of unwitting testing in 1964. And in 1973, MKUltra files were destroyed on the authority of the CIA director at the time. Senator Kennedy named him: Richard Helms. What survived was mostly finance folders. Advances, vouchers, accountings. So what do we actually know? Enough to show it happened. Not enough to know everything that happened. Much of the full story may never be known.",
    keywords: ['1963', '1964', '1973', 'destroyed', 'Richard Helms', 'finance folders', 'never be known'],
    sourceIds: ['senate-1977'],
    duration: 46,
    beats: [
      { cue: 'end of unwitting testing', kind: 'span', from: '1963 report', to: '1964', label: 'UNWITTING TESTS END' },
      { cue: 'Enough to show it happened', kind: 'statement', lines: ['ENOUGH TO SHOW IT HAPPENED.'] },
      { cue: 'Not enough to know everything', kind: 'statement', lines: ['NOT ENOUGH TO KNOW', 'EVERYTHING THAT HAPPENED.'] },
    ],
  },
];

/**
 * Cold-open hook for the vertical Short. Supported by Sen. Kennedy's statement
 * and DCI Turner's testimony on unwitting subjects (Senate hearing, Aug. 3, 1977).
 */
export const SHORT_HOOK = {
  text: "The CIA drugged people who never knew. It's in the Senate record.",
  keywords: ['CIA', 'never knew', 'Senate record'],
  sourceIds: ['senate-1977'],
};

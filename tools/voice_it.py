"""Italian narration text, made speakable before any TTS engine reads it.

- Years and numbers become words (1977 -> "millenovecentosettantasette", 185 -> "centottantacinque").
- Acronyms and names are respelled as an Italian speaker says them (CIA -> "C.I.A." read "ci-ai-èi"
  in Italian news, MKUltra -> "emme cappa ultra"...). The table is the place to fix a name:
  add the written form and how it must sound.

Usage as a module: speakable_it(text) -> text.  CLI: python tools/voice_it.py "Nel 1977 la CIA..."
"""
import re
import sys

from num2words import num2words

# Written -> spoken (Italian). Longest keys are matched first; whole words only.
SAY_IT = {
    'MKUltra': 'emme cappa ultra',
    'MKULTRA': 'emme cappa ultra',
    'CIA': 'ci-ai-èi',
    'FBI': 'effe-bi-ài',
    'USA': 'u-esse-a',
    'LSD': 'elle-esse-dì',
    'DCI': 'di-ci-ài',
    'Stansfield Turner': 'Stènsfild Tèrner',
    'Turner': 'Tèrner',
    'Edward Kennedy': 'Èduard Kènnedi',
    'Kennedy': 'Kènnedi',
    'Frank Church': 'Frank Cèrc',
    'Church': 'Cèrc',
    'Frank Olson': 'Frank Òlson',
    'Olson': 'Òlson',
    'Richard Helms': 'Rìciard Hèlms',
    'Helms': 'Hèlms',
    'San Francisco': 'San Francisco',
    'New York': 'Niu Iòrk',
    'Agent Fox': 'Agent Fox',
}
_SAY_RE = re.compile(r'\b(' + '|'.join(re.escape(k) for k in sorted(SAY_IT, key=len, reverse=True)) + r')\b')


def _num(m: re.Match) -> str:
    raw = m.group(0)
    digits = raw.replace('.', '')
    try:
        return num2words(int(digits), lang='it')
    except Exception:
        return raw


def speakable_it(text: str) -> str:
    t = _SAY_RE.sub(lambda m: SAY_IT[m.group(1)], text)
    t = re.sub(r'(\d+)\s*%', lambda m: num2words(int(m.group(1)), lang='it') + ' per cento', t)
    t = re.sub(r'\b\d{1,3}(?:\.\d{3})+\b|\b\d+\b', _num, t)
    return re.sub(r'\s+', ' ', t).strip()


if __name__ == '__main__':
    print(speakable_it(' '.join(sys.argv[1:])))

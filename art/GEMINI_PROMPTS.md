# Prompt per Gemini — asset di Agent Fox

Generatore: Gemini (modello immagini "Nano Banana"), una chat nuova per ogni gruppo.
I prompt sono in inglese perché i modelli di immagini li seguono meglio.

## Come usarli

1. **Allega sempre i riferimenti** (Gemini ne accetta fino a 14):
   - `art/agent-fox-model-sheet-painted.png` (sempre)
   - `art/parts/fullbody.jpg` (sempre)
   - più quelli indicati in ogni prompt.
2. Incolla prima il **BLOCCO STILE**, poi il prompt del foglio, nello stesso messaggio.
3. Se puoi scegliere la risoluzione: **4K** (va bene anche 2K). Formato **16:9** salvo dove indicato.
4. Rigenera finché passa la **checklist** in fondo. Meglio 3 tentativi buoni che 10 fogli mediocri.
5. Salva in **PNG** con il nome indicato dentro `art/incoming/`, fai commit, poi chiedi a Claude Code di integrarli ("integra gli asset in art/incoming").

---

## BLOCCO STILE (da incollare sempre per primo)

```
You are drawing production assets for a 2D cartoon. The character is AGENT FOX, exactly as in the attached model sheet and reference images: an anthropomorphic red fox detective, orange fur with cream muzzle, cheeks, chest and tail tip, big round white eyes with black pupils, black nose, pointed ears with cream inner fur, dark brown fedora with a lighter band and a small brass badge on the band, brown double-breasted trench coat with belt and brass buckle, white shirt, red tie, white cartoon gloves, dark trousers, black shoes, big bushy tail.

STYLE (match the references exactly): 1930s rubber-hose cartoon with a modern hand-painted finish, in the spirit of classic 1930s animation and Cuphead. One single dark-brown ink outline weight everywhere, flat colours with ONE soft cel shade per part, light from the top-left. Same proportions, same palette, same line weight and same scale as the references. Do not redesign, restyle or "improve" the character.

SHEET RULES:
- Background: one flat, pure chroma-key green (#00FF00) everywhere. No gradient, no floor, no cast shadows on the background, no green tints or green reflections on the character.
- Every item is a separate drawing with generous empty green space around it. Nothing overlaps, nothing touches another item or the image border.
- No text, no numbers, no labels, no arrows, no frames, no grid lines, no watermark.
- All items at the same scale as the references, cleanly cut, crisp edges, no motion blur.
```

---

## 1. Teste da altre angolazioni — `heads_turnaround.png`
Allega anche: `art/parts/head.jpg`

```
Sheet of AGENT FOX head turnaround, 6 drawings in two rows, all the same size and on the same eye line:
Row 1, WITH the fedora: front view; 3/4 view facing right; full side profile facing right.
Row 2, the same three angles WITHOUT the fedora (bare head, ears fully visible).
All heads are "blank": NO eyes, NO eyebrows and NO mouth opening — just the empty eye area in fur colour and the closed muzzle with the black nose, exactly like the blank head reference. Neck cut off cleanly just under the cream ruff.
```

## 2. Cappello da altre angolazioni — `hats_turnaround.png`
```
Sheet of AGENT FOX's fedora alone, 6 drawings: front view, 3/4 view facing right, side profile facing right, seen slightly from above, seen slightly from below, and tilted 30 degrees as if being tipped. Same hat as the reference (dark brown, lighter band, small brass badge), same scale.
```

## 3. Mani nuove, vista dorso — `hands_new_back.png`
Allega anche: `art/parts/hands.jpg`

```
Sheet of 12 white cartoon gloves of AGENT FOX, all RIGHT hands, seen from the BACK of the hand, each with a short brown coat cuff at the wrist, wrist pointing to the left, same glove design, same number of fingers and same size as the glove reference:
1 counting one (index up), 2 counting two, 3 counting three, 4 pinching a sheet of paper (paper corner only), 5 holding a pencil, 6 holding a round magnifying glass by the handle, 7 "stop" palm-out gesture, 8 hand on chin (thinking), 9 clenched trembling fist, 10 relaxed hanging, 11 snapping fingers, 12 knocking on a door.
Arrange in 3 rows of 4.
```

## 4. Le stesse mani, vista palmo — `hands_new_front.png`
Allega anche: `art/parts/hands.jpg` e il foglio del punto 3 appena generato.

```
The same 12 gloves as the attached sheet, in the same order and size, but seen from the PALM side. Same cuff, same wrist direction (to the left). 3 rows of 4.
```

## 5. Bocche per le emozioni — `mouths_emotions.png`
Allega anche: `art/parts/mouths.jpg`

```
Sheet of 12 muzzle/mouth pieces of AGENT FOX in side 3/4 view, exactly the same shape, size, angle and cut-off edge as the mouth reference sheet, so they can be swapped on the same head:
1 big scream (jaw wide open, tongue visible), 2 gasp (small round open mouth), 3 whisper (lips barely parted), 4 sly smirk, 5 gritted teeth, 6 big laugh, 7 sad frown, 8 disgusted grimace, 9 nervous wavy mouth, 10 confident grin, 11 blowing air (cheeks puffed), 12 jaw dropped in shock.
3 rows of 4, same spacing as the reference.
```

## 6. Sopracciglia e palpebre — `brows_lids.png`
Allega anche: `art/parts/brows.jpg`, `art/parts/eyes.jpg`

```
Sheet of AGENT FOX eyebrows and eyelids as separate pieces, same scale as the references:
Row 1: 6 eyebrow pairs: neutral, raised (surprise), worried (inner ends up), angry (inner ends down), sceptical (one up one down), sad.
Row 2: 6 eyelid pieces in fur colour with a dark lash line: half-closed top lid, sleepy top lid, squint (top and bottom), closed happy arc, closed tight (wincing), wide open scared (lid pulled up).
```

## 7. Pose chiave a corpo intero — `poses_key.png`
Allega anche: `art/parts/arms.jpg`, `art/parts/legs8.jpg`

```
Sheet of 8 full-body key poses of AGENT FOX, 3/4 view facing right, all standing on the same invisible ground line and at the same scale as the full-body reference, strong rubber-hose cartoon acting with clear silhouettes:
1 startled "take" (body stretched up, eyes huge, hat popping off the head), 2 anticipation crouch before running, 3 running (side view, legs in a wheel blur shape but drawn clean), 4 pointing dramatically at something off-screen right, 5 leaning in suspiciously with the magnifying glass, 6 slumped and sad, 7 triumphant arms up, 8 tipping the hat with a wink.
2 rows of 4.
```

## 8. Animazione a mano: lo spavento (8 fotogrammi) — `anim_take.png`
Allega anche: il foglio del punto 7.

```
An 8-frame hand-drawn animation sequence of AGENT FOX getting startled, like a 1930s cartoon "take", for playback at 12 frames per second. Same character, same scale, same camera, feet locked on the same ground position in every frame, frames arranged left to right, top to bottom, in 2 rows of 4:
1 neutral reading a document, 2 small anticipation squash (body compresses, eyes start to widen), 3 bigger squash, 4 explosive stretch (body tall and thin, eyes huge, hat flying up), 5 overshoot (body slightly tilted back), 6 settle squash, 7 hat falling back toward the head, 8 final shocked hold with hat back on.
Keep every frame on-model; only the pose changes.
```

## 9. Animazione a mano: corsa (8 fotogrammi) — `anim_run.png`
```
An 8-frame run cycle of AGENT FOX in pure side view facing right, rubber-hose style (bouncy, arms pumping, coat and tail trailing), loopable: frame 8 flows back into frame 1. Same scale, body centred at the same horizontal position in every frame (running in place), feet contact the same ground line. 2 rows of 4, read left to right, top to bottom.
```

## 10. Animazione a mano: pensare (6 fotogrammi) — `anim_think.png`
```
A 6-frame loopable "thinking" animation of AGENT FOX, 3/4 view facing right: hand on chin, eyes shifting left then right, eyebrows moving, tail swishing slowly, a slight body sway. Feet locked in the same place in every frame, same scale. 2 rows of 3, read left to right, top to bottom.
```

## 11. Oggetti di scena — `props.png`
```
Sheet of 15 props for AGENT FOX's world, same painted cartoon style, same ink line, each separate on green:
manila case folder (closed, blank cover, no text), open folder with blank typed pages, single typed page (lines only, no readable text), rubber stamp, round magnifying glass, coffee mug with steam, glass lab vial with liquid, reel-to-reel tape recorder, 1930s typewriter, black rotary telephone, folded newspaper (no readable text), cardboard records box, corkboard pin with red string end, flashlight, leather briefcase.
Any lettering on objects must be unreadable scribbles: no real words, no logos.
```

## 12. Effetti cartoon — `fx.png`
```
Sheet of 1930s cartoon effect animations, same ink and painted style, each effect as a horizontal strip of 4 frames (left to right) on green:
row 1 smoke puff appearing and dissolving, row 2 dust cloud from a quick exit, row 3 impact star burst, row 4 sweat drops flying off, row 5 exclamation mark "!" popping in with a squash and stretch, row 6 question mark "?" wobbling, row 7 speed lines, row 8 sparkle twinkle.
No text other than the "!" and "?" symbols.
```

## 13. Fondali dipinti, a livelli (uno per scena)

Ogni scena = **3 immagini separate**:
- `bg_<scena>_back.png`: fondo pieno, **senza** verde;
- `bg_<scena>_mid.png`: mobili e oggetti su verde;
- `bg_<scena>_front.png`: primo piano su verde.

Formato 16:9, 4K. Il centro dell'immagine deve funzionare anche ritagliato in verticale (9:16).

Prompt base (cambia solo la DESCRIZIONE):
```
Painted background for a 1930s rubber-hose cartoon, same style, palette and ink line as the attached AGENT FOX references (warm sepia browns, cream, brass, deep shadows), hand-painted with soft texture, light from the top-left. NO characters, no text, no readable writing, no logos. Leave the lower-middle area free for the character to stand (floor visible). The central vertical strip (a 9:16 crop from the middle) must contain the most important elements.
Make it as THREE separate images that stack exactly on top of each other:
(1) BACK LAYER: walls, windows, far background, fully painted, no green.
(2) MID LAYER: furniture and props only, on flat chroma-key green #00FF00.
(3) FRONT LAYER: a few close foreground silhouettes at the edges (e.g. a lamp, a plant, a chair back), on flat chroma-key green #00FF00.
SCENE: <DESCRIZIONE>
```

Descrizioni:
- **file** (Il fascicolo): `a detective's office at night: venetian blinds with moonlight stripes, rain on the window, a heavy desk with a green banker's lamp, a hanging bulb, a coat rack, a wall clock, a cup of coffee.`
- **question** (Gli atti): `a government records archive: long rows of filing cabinets and shelves of boxes, a large illustrated map pinned on the wall, a ladder, warm dusty light.`
- **experiments** (Gli esperimenti): `a 1950s laboratory: white tiled walls, glass shelves with vials and bottles, a workbench with a reel-to-reel recorder, a hanging pendulum lamp, cold greenish light mixed with warm.`
- **cost** (Il costo umano): `a quiet, empty room in dim light: one bare hanging bulb, an empty wooden chair, a window with blinds and city lights outside, long shadows; sober and respectful mood.`
- **revelation** (La rivelazione): `an investigator's evidence wall: big corkboard with pinned papers and red strings, a framed sketch of the Capitol dome, a desk with stacks of files and a desk microphone, warm spotlight.`
- **known** (Cosa sappiamo): `the detective's office at dawn: blinds open, golden morning light, the desk with a closed case folder and a newspaper, a filing cabinet, dust motes in the light.`

---

## Checklist prima di salvare

- [ ] È proprio Agent Fox: stesso muso, stesse proporzioni, cappello col distintivo, cravatta rossa.
- [ ] Fondo verde pieno e uniforme, senza ombre né sfumature; nessun riflesso verde sui bordi.
- [ ] Nessun pezzo si tocca o si sovrappone; nessuno tocca il bordo dell'immagine.
- [ ] Mani: stesso numero di dita del riferimento; pollice dal lato giusto (dorso e palmo coerenti).
- [ ] Nessuna scritta leggibile, nessun numero, nessuna etichetta.
- [ ] Animazioni: piedi sempre nello stesso punto, stessa scala in ogni fotogramma.
- [ ] Stile: un solo spessore di contorno, colori piatti con una sola ombra.

**Ordine consigliato:** 1 (teste), 3–4 (mani), 5 (bocche), 7 (pose), poi i fondali della scena 1 (`file`) per la prova pilota; il resto dopo.

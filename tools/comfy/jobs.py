"""
Piece prompts for tools/comfy/edit.py, translated from art/GEMINI_PROMPTS.md
into one edit per piece (Qwen-Image-Edit works on one drawing at a time).

Each job: image = the drawing to edit (path#k = k-th piece of a part sheet),
refs = extra references (max 2), prompt = the edit instruction. edit.py adds
the STYLE text. Corrections learnt from rejected renders are written into the
prompts here so re-runs start from what worked.

Run: python tools/comfy/run_jobs.py <sheet> [--pieces a,b] [--count 3]
"""

MODEL_SHEET = 'art/agent-fox-model-sheet-painted.png'
MS_HANDS = MODEL_SHEET + '@20,672,340,328'      # HANDS panel: cuff, button, glove
MS_HEADS = MODEL_SHEET + '@525,112,1010,195'    # EXPRESSIONS panel: hat, badge, 3/4 heads
MS_POSES = MODEL_SHEET + '@370,680,1165,268'    # KEY POSES panel

GLOVE = 'art/parts/hands.jpg'
OPEN, RELAXED, FIST, POINT, FLAT, HOLD, THUMB, WAVE = (f'{GLOVE}#{i}' for i in range(8))

# Learnt on hands_new_back/one v1-v6: say "back of the hand" in visual terms
# (knuckles, not fingertips), put the cuff at the lower left like the model
# sheet, ask for a SHORT cuff (otherwise a long sleeve runs off the image),
# and keep a single raised finger at the edge next to the thumb (a central
# raised finger seen from the back reads as an obscene gesture).
BACK = ('Redraw the white cartoon glove of image 1 as a RIGHT hand seen from the BACK of the hand '
        '(we see the back and the knuckles, the thumb is on the upper/left side). '
        'The wrist with a SHORT brown coat cuff and a small brass button is at the lower left, exactly like the gloves '
        'in image 2, cut off cleanly at the cuff with no forearm. Same white glove as image 1 with a thumb and three '
        'fingers, same size. No shadow under the hand. Pose: ')


def back(image, pose):
    return dict(image=image, refs=[MS_HANDS], prompt=BACK + pose)


JOBS = {
    'hands_new_back': {
        'one': back(POINT, 'counting one: the INDEX finger, at the outer edge of the hand next to the thumb, points up toward '
                           'the upper right; the other two fingers are curled; the thumb rests against the side of the hand.'),
        # Described from scratch (v1-v6) the thumb always stayed up: build two and three by small edits of the
        # approved "one" / "two", whose thumb is already tucked.
        'two': dict(image='approved:hands_new_back/one', refs=[MS_HANDS], prompt=(
            'Keep this glove exactly as it is (same back view, same tucked thumb, same cuff, same size), but ALSO straighten '
            'the finger next to the index finger, so two fingers are raised side by side in a slight V, counting two. '
            'The thumb and the last finger stay curled exactly as they are.')),
        'three': dict(image='approved:hands_new_back/two', refs=[MS_HANDS], prompt=(
            'Keep this glove exactly as it is (same back view, same tucked thumb, same cuff, same size), but ALSO straighten '
            'the last curled finger, so all three fingers are raised side by side, counting three. The thumb stays tucked '
            'exactly as it is. Exactly three fingers and one thumb.')),
        'pinch_paper': back(RELAXED, 'pinching the corner of a sheet of paper between the thumb and the index finger; only a '
                                     'small triangular corner of plain white paper (no writing) shows; the other fingers are '
                                     'relaxed and slightly curled.'),
        # v1-v2 read as a thumbs-up; v4 got the writing grip but lost the brown cuff (its source glove has none),
        # so v4 is edited once more to add the cuff.
        'pencil': dict(image='art/incoming/pieces/hands_new_back/pencil_v4.png', refs=[MS_HANDS], prompt=(
            'Keep this glove and pencil exactly as they are (same writing grip, same size, same line), and add at the wrist '
            'on the left a SHORT brown coat cuff with a small brass button, exactly like the gloves in image 2, cut off '
            'cleanly with no forearm. No shadow.')),
        'magnifier': back(HOLD, 'holding a round magnifying glass by its handle in a fist, the brass-rimmed lens up at the '
                                'upper right; the lens is clear glass with a light reflection, nothing behind it.'),
        # v1-v3 started from the waving glove (a palm view with five digits) and kept both faults.
        'stop': back(OPEN, 'a firm "stop" gesture: the hand flat and upright, the three fingers pressed together side by '
                           'side pointing straight up, the thumb close along the side. We see the plain BACK of the hand, '
                           'no palm creases. Exactly three fingers and one thumb.'),
        # v1-v3 turned "thinking" into pointing or hang-loose: ask for a loose fist instead of finger positions.
        'chin': back(FIST, 'thinking pose: a LOOSE relaxed fist tilted upward, as if propping up a chin from below, all '
                           'fingers softly curled and the thumb resting on the side of the index finger. No finger is '
                           'pointing or sticking out. No face drawn.'),
        'fist_tremble': back(FIST, 'a tightly clenched angry fist, knuckles up, the thumb wrapped over the fingers; no motion lines.'),
        'relaxed': back(RELAXED, 'relaxed and hanging down: the wrist and cuff at the upper left, the fingers loosely '
                                 'drooping down toward the lower right, slightly curled.'),
        # v1-v3 became a finger-gun or a thumbs-up; v4-v6 (from the approved pinch minus the paper) stayed an empty
        # pinch with the thumb hidden. Start from the approved "one", whose index is already up and thumb visible.
        'snap': dict(image='approved:hands_new_back/one', refs=[MS_HANDS], prompt=(
            'Keep this glove exactly as it is (same back view, same cuff, same size, same raised index finger), but bring '
            'the thumb forward so its tip presses firmly against the tip of the curled middle finger, the two tips touching '
            'in plain sight in front of the knuckles, ready to snap the fingers. The last finger stays curled. Exactly three '
            'fingers and one thumb. No motion lines.')),
        'knock': back(FIST, 'knocking on a door: a loose fist with the knuckles pointing to the right, as if about to rap on '
                            'a door; no door drawn, no motion lines.'),
    },
}

# Palm side: start from the approved back view of the same gesture so the two match.
FRONT = ('Show exactly the same hand gesture as image 1, but seen from the PALM side: the same RIGHT hand turned around, '
         'so we see the palm and the fingertips of any curled fingers, and the thumb is now on the lower/right side. '
         'Keep the same glove, the same finger positions, the same size and the same short brown cuff with the brass '
         'button at the lower left, cut off cleanly at the cuff. No shadow under the hand.')
JOBS['hands_new_front'] = {n: dict(image=f'approved:hands_new_back/{n}', refs=[MS_HANDS], prompt=FRONT)
                           for n in JOBS['hands_new_back']}

# Round 1 (FRONT prompt from the approved back views) kept only stop, chin and fist_tremble: the model opens
# the hand when asked to turn it. Round 2 builds the rest by small edits of approved palm-side pieces.
KEEP_PALM = 'Keep this glove exactly as it is (same palm-side view, same cuff, same size, same line), but '
JOBS['hands_new_front'].update({
    'one': dict(image='approved:hands_new_front/stop', refs=[MS_HANDS], prompt=KEEP_PALM + (
        'curl the two right fingers down onto the palm and fold the thumb across them, so only the INDEX finger at the '
        'left edge stays straight up, counting one. Exactly three fingers and one thumb.')),
    'knock': dict(image='approved:hands_new_front/fist_tremble', refs=[MS_HANDS], prompt=KEEP_PALM + (
        'loosen the fist a little and tilt it so the curled fingers point to the right, as if about to knock on a door; '
        'the thumb rests along the curled index finger, nothing sticks out. No door, no motion lines.')),
    'pencil': dict(image='approved:hands_new_front/chin', refs=[MS_HANDS], prompt=KEEP_PALM + (
        'the loose fist now holds a yellow wooden pencil with a pink eraser, gripped between the thumb and the index '
        'finger, the sharpened tip pointing down to the lower right. The pencil is fully inside the image.')),
    'magnifier': dict(image='approved:hands_new_front/chin', refs=[MS_HANDS], prompt=KEEP_PALM + (
        'the fist now holds the handle of a round magnifying glass with a brass rim, the lens above the hand at the upper '
        'right, clear glass with a light reflection. The whole lens is inside the image.')),
    'relaxed': dict(image='approved:hands_new_front/stop', refs=[MS_HANDS], prompt=KEEP_PALM + (
        'let the hand hang down relaxed: the cuff at the upper left, the fingers pointing down to the lower right and '
        'softly curled, the palm still facing us. Exactly three fingers and one thumb.')),
    'pinch_paper': dict(image='approved:hands_new_front/stop', refs=[MS_HANDS], prompt=KEEP_PALM + (
        'bring the tips of the thumb and the index finger together to pinch the corner of a small plain white sheet of '
        'paper (no writing), the other two fingers softly curled. Exactly three fingers and one thumb.')),
    'two': dict(image='approved:hands_new_front/one', refs=[MS_HANDS], prompt=KEEP_PALM + (
        'ALSO straighten the finger next to the index, so two fingers are raised side by side in a slight V, counting '
        'two. The thumb and the last finger stay folded exactly as they are.')),
    'three': dict(image='approved:hands_new_front/two', refs=[MS_HANDS], prompt=KEEP_PALM + (
        'ALSO straighten the last folded finger, so all three fingers are raised, counting three. The thumb stays '
        'folded across the palm exactly as it is. Exactly three fingers and one thumb.')),
})

# Mouths: each emotion starts from the closest of Salvatore's 12 mouth drawings and only the mouth may change,
# so every piece keeps the muzzle silhouette, nose and cut-off edge and still swaps onto the same head.
MOUTH = 'art/parts/mouths.jpg'
KEEP_MUZZLE = ('Change ONLY the mouth of this fox muzzle piece. Keep exactly the same outline of the muzzle, the same '
               'black nose, the same angle, the same jagged cut-off cream fur edge on the left and the same size, so it '
               'can be swapped on the same head. New mouth: ')


def mouth(k, expr):
    return dict(image=f'{MOUTH}#{k}', refs=[MS_HEADS], prompt=KEEP_MUZZLE + expr)


JOBS['mouths_emotions'] = {
    'scream': mouth(3, 'a big scream, the jaw wide open, the pink tongue visible, small fangs.'),
    'gasp': mouth(4, 'a gasp, a small round open mouth.'),
    'whisper': mouth(1, 'whispering, the lips barely parted, a thin dark gap.'),
    'smirk': mouth(10, 'a sly smirk, one corner of the mouth raised, mouth closed.'),
    'gritted': mouth(7, 'gritted teeth, both rows of white teeth clenched and visible, lips pulled back.'),
    'laugh': mouth(9, 'a big laugh, the mouth wide open and curved up, tongue visible.'),
    'frown': mouth(11, 'a sad frown, the closed mouth line curving down.'),
    'disgust': mouth(7, 'a disgusted grimace, the upper lip pulled up on one side, a crooked mouth.'),
    'nervous': mouth(0, 'a nervous wavy mouth, a closed zigzag line.'),
    'grin': mouth(2, 'a confident grin, a wide closed-teeth smile curving up.'),
    'blow': mouth(6, 'blowing air, the lips pursed into a small round "o" and the cheek puffed out.'),
    'jawdrop': mouth(5, 'the jaw dropped in shock, the lower jaw hanging very low, a tall open mouth.'),
}

# Heads: the 3/4 views already exist as Salvatore's drawings (head.jpg a, b) and are used as they are;
# only the front and side views are drawn, starting from those.
HEAD = 'art/parts/head.jpg'
BLANK = ('The head stays "blank": NO eyes, NO eyebrows and NO mouth opening, just the empty eye area in fur colour and '
         'the closed muzzle with the black nose, exactly like image 1. Neck cut off cleanly just under the cream ruff. '
         'Same size, same colours and same line as image 1. ')
JOBS['heads_turnaround'] = {
    'hat_front': dict(image=f'{HEAD}#0', refs=[MS_HEADS], prompt='Turn this fox head to a FRONT view, facing the viewer, '
                      'symmetrical, both ears visible, the fedora seen from the front with the small brass badge on the band. ' + BLANK),
    'hat_34': dict(copy=f'{HEAD}#0'),
    'hat_side': dict(image=f'{HEAD}#0', refs=[MS_HEADS], prompt='Turn this fox head to a full SIDE PROFILE facing right, '
                     'the long muzzle pointing right, one ear visible, the fedora seen from the side. ' + BLANK),
    'bare_front': dict(image=f'{HEAD}#1', refs=[MS_HEADS], prompt='Turn this bare fox head to a FRONT view, facing the viewer, '
                       'symmetrical, both ears fully visible, no hat. ' + BLANK),
    'bare_34': dict(copy=f'{HEAD}#1'),
    'bare_side': dict(image=f'{HEAD}#1', refs=[MS_HEADS], prompt='Turn this bare fox head to a full SIDE PROFILE facing right, '
                      'the long muzzle pointing right, one ear visible, no hat. ' + BLANK),
}

# Key poses: edit the full-body reference so the design, scale and line stay his.
POSE = ('Change only the pose of AGENT FOX in image 1, keeping exactly the same character design, proportions, colours, '
        'outline, size and position on the same ground line, 3/4 view facing right, full body with feet visible. '
        'Rubber-hose cartoon acting with a clear silhouette. No shadow on the ground. Pose: ')


def pose(p):
    return dict(image='art/parts/fullbody.jpg', refs=[MS_POSES], prompt=POSE + p)


JOBS['poses_key'] = {
    # v1-v3 of take stayed a mild standing pose, crouch became a running stride: push the extremes.
    'take': pose('an EXTREME startled cartoon "take": the whole body stretched up very tall and thin, both feet off the '
                 'ground, arms flung up and out, eyes huge, mouth open, the fedora flying up well above the head. '
                 'No ground shadow.'),
    'crouch': pose('an anticipation crouch, the moment BEFORE running: squashed down low with a deep knee bend, BOTH feet '
                   'flat on the ground, body compressed and leaning back to the left, both arms pulled back behind him, '
                   'eyes on the right. Not running yet. No ground shadow.'),
    'run': pose('running, in side view facing right, legs in a wide stride drawn clean, arms pumping, coat and tail trailing.'),
    'point': pose('pointing dramatically at something off-screen right with the right arm fully extended, body leaning forward.'),
    'magnifier': pose('leaning in suspiciously, peering through a round brass magnifying glass held in the right hand.'),
    'slumped': pose('slumped and sad, shoulders down, head low, arms hanging, tail drooping.'),
    'triumph': pose('triumphant, both arms raised high above the head, big smile, chest out.'),
    'tiphat': pose('tipping the fedora with the right hand and winking, a friendly smile.'),
}


# ------------------------------------------------------------------ rig restyle toward the master look
# Salvatore chose poses_key/magnifier_v4 (art/reference/agent-fox-master.png) as THE Agent Fox.
# Each rig part is redrawn in that style but keeps its place, size and angle on its sheet, so
# tools/bake_rig.py (which measures the original sheets) keeps working. Sheet = 'rig_<art/parts name>',
# piece = 'p<k>' (k-th piece of the sheet, row-major).
MASTER = 'art/reference/agent-fox-master.png'
MASTER_HEAD = MASTER + '@590,25,290,280'
KEEP_PLACE = ('Keep exactly the same angle, size and position as image 1 so it still fits the rest of the cut-out puppet. '
              'Plain green background, no shadow, nothing else in the picture.')
JOBS['rig_head'] = {
    'p1': dict(image='art/parts/head.jpg#1', refs=[MASTER_HEAD], prompt=(
        'Redraw this blank fox head (image 1) as the head of the fox in image 2: the same slimmer skull, the same longer '
        'pointed muzzle with the black nose at its tip, the same tall ears, the same orange fur with soft cel shading and '
        'the same jagged cream cheek ruff, the same clean dark outline. 3/4 view facing right. The face stays BLANK: no '
        'eyes, no eyebrows, no mouth line, just smooth fur where they go. Neck cut off cleanly under the ruff. ' + KEEP_PLACE)),
}
JOBS['rig_eyes'] = {
    'p0': dict(image='art/parts/eyes.jpg#0', refs=[MASTER_HEAD], prompt=(
        'Redraw this eye white (image 1) like the eyes of the fox in image 2: an upright oval white with a thin dark '
        'outline, no pupil. ' + KEEP_PLACE)),
    'p1': dict(image='art/parts/eyes.jpg#1', refs=[MASTER_HEAD], prompt=(
        'Redraw this pupil (image 1) like the pupils of the fox in image 2: a solid near-black oval with one small white '
        'highlight. ' + KEEP_PLACE)),
}
JOBS['rig_legs9'] = {
    'p4': dict(image='art/parts/legs9.jpg#4', refs=[MASTER], prompt=(
        'Redraw this fox tail (image 1) like the tail of the fox in image 2: fuller and fluffier, orange with soft '
        'shading, a large white tip with jagged fur tufts, clean dark outline. The base stays at the same place and the '
        'length is about the same. ' + KEEP_PLACE)),
}
JOBS['rig_arms'] = {
    'p0': dict(image='art/parts/arms.jpg#0', refs=[MASTER], prompt=(
        'Redraw this trench-coat sleeve (image 1) like the coat sleeves of the fox in image 2: the same brown gabardine, '
        'soft cel shading, a few fabric folds, clean dark outline. Keep the same straight tube shape, length and width, '
        'no hand and no cuff strap. ' + KEEP_PLACE)),
}

# The 12 lip-sync mouths, redrawn ON the restyled head: each is the approved blank head with the mouth
# shape of the old mouth drawing k (image 2). The mouth sprite is then cut from where the render differs
# from the blank head (tools/comfy/rig_mouths.py), so it fits the new muzzle without hand alignment.
MOUTH_SHAPES = [
    'REST: mouth closed, a short gently curved lip line, no teeth',
    'M/B/P: lips pressed firmly together, a closed straight lip line, no teeth',
    'consonant: mouth just slightly open, the upper and lower front teeth visible close together',
    'A: jaw dropped wide open, dark mouth, pink tongue, small fangs top and bottom',
    'E/I: mouth half open in a small wide oval, dark inside, a little tongue',
    'O: a round tall open mouth, dark inside',
    'U/W: lips pushed forward into a small round pucker, like a kiss, tiny dark opening',
    'F/V: upper teeth resting on the lower lip, mouth barely open',
    'L/T/D/N: mouth open, both rows of teeth visible, the tongue tip touching behind the upper teeth',
    'TH/tongue: mouth open with the pink tongue visible and slightly out between the teeth',
    'SMILE: mouth closed in a happy upward curve, no teeth',
    'NEUTRAL-SERIOUS: mouth closed, a short straight lip line turning slightly down at the corner',
]
JOBS['rig_mouthheads'] = {
    f'm{k}': dict(image='approved:rig_head/p1', refs=[f'art/parts/mouths.jpg#{k}'], prompt=(
        f'Give the fox head in image 1 this mouth: {MOUTH_SHAPES[k]} (as drawn in image 2), fitted to the long muzzle of '
        'image 1 under its black nose. Change NOTHING else: the same head, nose, ears, fur, cheek ruff, outline, size and '
        'position as image 1, and still no eyes and no eyebrows. Plain green background, no shadow.'))
    for k in range(12)
}

# Round 2 of tail and sleeves: a full-body reference made the model redraw the whole fox, so the reference
# is now just the matching part of the master.
MASTER_TAIL = MASTER + '@400,250,180,265'
MASTER_FOREARM = MASTER + '@720,265,160,165'
JOBS['rig_legs9']['p4'] = dict(image='art/parts/legs9.jpg#4', refs=[MASTER_TAIL], prompt=(
    'Redraw ONLY this fox tail (image 1) in the style of the tail in image 2: fuller and fluffier, orange with soft '
    'shading, a large cream-white tip with jagged fur tufts, clean dark outline. Keep the curve of image 1: the base at '
    'the same end, the white tip at the other end, the same length. ' + KEEP_PLACE))
for k in (1, 3):
    JOBS['rig_arms'][f'p{k}'] = dict(image=f'art/parts/arms.jpg#{k}', refs=[MASTER_FOREARM], prompt=(
        'Redraw ONLY this trench-coat forearm sleeve (image 1) in the style of the sleeve in image 2: the same brown '
        'gabardine with soft shading, and at the lower end, instead of the buckled strap, a wide turned-back cuff with a '
        'small brass button and a thin white shirt cuff peeking out below it, as in image 2. No hand, no glove. Keep '
        'the same straight tube shape, length and width. ' + KEEP_PLACE))

# Tail round 3: v3-v4 kept the small white tip; ask for the master's proportions explicitly.
JOBS['rig_legs9']['p4'] = dict(image='art/parts/legs9.jpg#4', refs=[MASTER_TAIL], prompt=(
    'Make this fox tail (image 1) look like the tail in image 2: much FLUFFIER and wider, with soft jagged fur tufts '
    'along its edges, and a LARGE cream-white tip that covers the last third of the tail (the end at the upper left), '
    'separated from the orange by a jagged line. Same curve, same base end on the right, same overall length, clean dark '
    'outline, soft cel shading. ' + KEEP_PLACE))

# Round 3 (palm side): the "one" edit raised two fingers, kept as "two". One and three are built from it.
JOBS['hands_new_front']['one'] = dict(image='approved:hands_new_front/two', refs=[MS_HANDS], prompt=KEEP_PALM + (
    'fold the MIDDLE finger down onto the palm like the curled fingers next to it, so only the index finger stays '
    'straight up, counting one. Exactly three fingers and one thumb.'))
JOBS['hands_new_front']['three'] = dict(image='approved:hands_new_front/two', refs=[MS_HANDS], prompt=KEEP_PALM + (
    'ALSO straighten the curled ring finger next to the two raised fingers, so three fingers are raised side by side, '
    'counting three; the thumb stays folded across the palm. Exactly three fingers and one thumb.'))
# Round 4 of the palm-side "one": folding a finger of "two" did not work; raise one finger from the fist instead.
JOBS['hands_new_front']['one'] = dict(image='approved:hands_new_front/fist_tremble', refs=[MS_HANDS], prompt=KEEP_PALM + (
    'raise ONLY the index finger (the one at the top of the fist) straight up, pointing up, counting one; the other two '
    'fingers stay curled and the thumb stays folded over them. Exactly three fingers and one thumb.'))
# m3 (A) v1 lifted the whole upper muzzle and nose: the head's own nose showed under it (double nose).
JOBS['rig_mouthheads']['m3'] = dict(image='approved:rig_head/p1', refs=['art/parts/mouths.jpg#3'], prompt=(
    'Give the fox head in image 1 a wide open mouth for the sound A (as drawn in image 2): ONLY the lower jaw drops '
    'down, showing the dark mouth, a pink tongue and small fangs. The upper muzzle, the black nose and the top line of '
    'the snout stay EXACTLY where they are in image 1, not lifted, not moved. Change nothing else: same head, ears, fur, '
    'ruff, outline, size and position, still no eyes and no eyebrows. Plain green background, no shadow.'))
# m3 round 3: start from the approved E/I mouth (nose in place, mouth half open) and only drop the jaw further.
JOBS['rig_mouthheads']['m3'] = dict(image='approved:rig_mouthheads/m4', refs=['art/parts/mouths.jpg#3'], prompt=(
    'Open this mouth (image 1) much wider for the sound A, as in image 2, by dropping ONLY the lower jaw: the dark mouth, '
    'the pink tongue and small fangs show more. The black nose, the top line of the snout and the upper lip do not move '
    'at all. Change nothing else. Plain green background, no shadow.'))

# Emotion mouths on the restyled head (the mouths_emotions sheet was drawn on the old muzzle): the approved
# blank head with the expression of the approved emotion piece (image 2), cut like the lip-sync mouths.
_EMO = {k: v['prompt'].split('New mouth: ', 1)[1] for k, v in JOBS['mouths_emotions'].items() if k != 'blow'}
JOBS['rig_emotions'] = {
    k: dict(image='approved:rig_head/p1', refs=[f'approved:mouths_emotions/{k}'], prompt=(
        f'Give the fox head in image 1 this mouth: {expr} (as drawn in image 2), fitted to the long muzzle of image 1 '
        'under its black nose. The black nose and the top line of the snout stay exactly where they are; only the '
        'mouth and the lower jaw change. Change NOTHING else: same head, ears, fur, cheek ruff, outline, size and '
        'position, still no eyes and no eyebrows. Plain green background, no shadow.'))
    for k, expr in _EMO.items()
}

# ------------------------------------------------------------------ front-facing talking (bust shot)
# Agent Fox looking into the camera, master look. Pieces for a separate front rig (tools/bake_front.py).
FRONT_HEAD = ('Turn this fox head (the fox in image 1) to a perfectly FRONT view, looking straight at the viewer, '
              'symmetrical left and right: the same fedora with its band and small DIAMOND-shaped brass badge in the '
              'middle, the same tall ears on both sides, the same orange fur with soft cel shading, the long muzzle seen '
              'from the front with the black nose at its tip, the same jagged cream cheek ruff on both sides, the same '
              'clean dark outline. Head only, neck cut off cleanly just under the ruff. Plain green background, no shadow. ')
JOBS['front'] = {
    'head': dict(image=MASTER_HEAD, refs=[MASTER], prompt=FRONT_HEAD + (
        'The face is BLANK: no eyes, no eyebrows, no mouth line, just smooth fur where they go.')),
    'face': dict(image=MASTER_HEAD, refs=[MASTER], prompt=FRONT_HEAD + (
        'Draw the face like the fox in image 2: the same large oval eyes with dark-brown pupils and a white catch-light, '
        'the same thick dark-brown eyebrows, mouth closed in a calm line.')),
    'torso': dict(image='art/parts/torso.jpg#0', refs=[MASTER], prompt=(
        'Redraw this trench-coat torso (image 1) in a perfectly FRONT view, symmetrical, in the style of the coat in '
        'image 2: brown gabardine with soft shading, wide lapels on both sides, white shirt collar, dark-red tie, two '
        'rows of brass buttons, belt with a brass buckle at the waist, both shoulders. NO head (an empty collar opening '
        'with the dark inside of the collar), NO arms: the sleeves are cut off cleanly at the shoulder seams. Cut off at '
        'the hips just below the belt. Plain green background, no shadow.')),
}
# Round 2: the blank front head from the approved front face (erase, like the 3/4 heads); the torso from a
# 3/4 render, pushed to a straight-on symmetric view.
JOBS['front']['head'] = dict(image='approved:front/face', refs=[], prompt=(
    'Keep this fox head exactly as it is (same angle, hat, ears, fur, ruff, nose, outline, size and position). Only '
    'ERASE the eyes, the eyebrows and the mouth line: where they were, paint smooth orange and cream fur matching the '
    'surroundings, so the face is blank. Keep the black nose. Plain green background.'))
JOBS['front']['torso'] = dict(image='art/incoming/pieces/front/torso_v2.png', refs=['approved:front/face'], prompt=(
    'Turn this headless trench-coat torso to a perfectly FRONT view, straight on and SYMMETRICAL: the collar opening '
    'centred at the top, the white shirt collar and dark-red tie exactly in the middle, both lapels mirror images, both '
    'shoulders at the same height and width, the belt with its brass buckle centred, the buttons in two straight rows. '
    'No arms (sleeves cut off at the shoulder seams), no head. Flat even lighting with no white glare. Plain green '
    'background, no shadow.'))
# Front lip-sync mouths on the approved blank front head (same canvas, so the sprite is cut in place).
JOBS['front_mouths'] = {
    f'm{k}': dict(image='approved:front/head', refs=['approved:front/face'], prompt=(
        f'Give this front-facing fox head (image 1) this mouth: {MOUTH_SHAPES[k]}, seen from the front, centred under '
        'the black nose, in the style of the mouth in image 2. Change NOTHING else: same head, hat, ears, nose, fur, ruff, '
        'outline, size and position as image 1, and still no eyes and no eyebrows. Plain green background.'))
    for k in range(12)
}

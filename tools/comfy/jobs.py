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
    'take': pose('a startled "take": the body stretched up tall, eyes huge, the fedora popping up off the head.'),
    'crouch': pose('an anticipation crouch before running: knees bent, body leaning back, arms pulled back.'),
    'run': pose('running, in side view facing right, legs in a wide stride drawn clean, arms pumping, coat and tail trailing.'),
    'point': pose('pointing dramatically at something off-screen right with the right arm fully extended, body leaning forward.'),
    'magnifier': pose('leaning in suspiciously, peering through a round brass magnifying glass held in the right hand.'),
    'slumped': pose('slumped and sad, shoulders down, head low, arms hanging, tail drooping.'),
    'triumph': pose('triumphant, both arms raised high above the head, big smile, chest out.'),
    'tiphat': pose('tipping the fedora with the right hand and winking, a friendly smile.'),
}

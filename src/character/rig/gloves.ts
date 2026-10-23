/**
 * Which way each glove drawing faces, so both hands mirror correctly (Salvatore's rule):
 * the hand on the RIGHT of the picture shows its thumb on the LEFT when we see the palm and on the
 * RIGHT when we see the knuckles (the back of the hand); the hand on the left of the picture is the
 * mirror image (palm: thumb right, knuckles: thumb left).
 *
 * `thumb` is the side of the thumb in the drawing as baked, fingers pointing up, not flipped. The
 * thumb's side relative to the fingers does not change when the hand turns, so the rule holds at any
 * angle. null = drawn edge-on, the thumb's side cannot be read: the pose decides.
 * The "_back" variants (the far arm's darker gloves) face the same way as their base drawing.
 */
type View = { palm: boolean; thumb: 'L' | 'R' } | null;

const VIEW: Record<string, View> = {
  fist: { palm: true, thumb: 'L' },
  flat: null,
  grip: { palm: true, thumb: 'L' },
  n_chin: null,
  n_chin_palm: { palm: true, thumb: 'R' },
  n_fist_tremble: { palm: false, thumb: 'L' },
  n_fist_tremble_palm: { palm: true, thumb: 'L' },
  n_knock: { palm: false, thumb: 'L' },
  n_knock_palm: { palm: true, thumb: 'L' },
  n_magnifier: { palm: false, thumb: 'L' },
  n_magnifier_palm: { palm: true, thumb: 'R' },
  n_one: { palm: false, thumb: 'L' },
  n_one_palm: { palm: true, thumb: 'L' },
  n_pencil: { palm: true, thumb: 'L' },
  n_pencil_palm: { palm: true, thumb: 'R' },
  n_pinch_paper: null,
  n_pinch_paper_palm: { palm: true, thumb: 'R' },
  n_relaxed: null,
  n_relaxed_palm: { palm: true, thumb: 'R' },
  n_stop: { palm: false, thumb: 'R' },
  n_stop_palm: { palm: true, thumb: 'R' },
  n_three: { palm: true, thumb: 'L' },
  n_three_palm: { palm: true, thumb: 'R' },
  n_two: { palm: false, thumb: 'L' },
  n_two_palm: { palm: true, thumb: 'R' },
  open: { palm: true, thumb: 'L' },
  point: { palm: true, thumb: 'L' },
  relaxed: null,
  thumb: null,
  wave: { palm: true, thumb: 'L' },
};

/**
 * Whether to mirror a glove (flip across its own axis) so its thumb lands where the rule wants it.
 * name: the glove without "hand_" and without "_back"; onRight: the hand is on the right of the picture.
 */
export function gloveFlip(name: string, onRight: boolean, fallback: boolean): boolean {
  const v = VIEW[name];
  if (!v) return fallback;
  const want: 'L' | 'R' = onRight === v.palm ? 'L' : 'R';
  return v.thumb !== want;
}

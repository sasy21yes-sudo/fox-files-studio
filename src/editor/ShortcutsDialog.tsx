const KEYS: [string, string][] = [
  ['Space', 'Play / pause'],
  ['J · K · L', 'Back 2 s · pause · play'],
  ['← →', 'One frame (1/30 s)'],
  ['Shift + ← →', 'One second'],
  ['Home · End', 'Start · end of the episode'],
  ['Ctrl + Z', 'Undo'],
  ['Ctrl + Shift + Z · Ctrl + Y', 'Redo'],
  ['Delete', 'Delete the selected element, shot, action, key or pop-up'],
  ['Ctrl + C · Ctrl + V', 'Copy the selected element · paste it into the selected scene'],
  ['Ctrl + D', 'Duplicate the selected element'],
  ['Drag a handle', 'Move an element in the preview (paused, data scenes); Shift = straight'],
  ['Ctrl + Enter', 'Send the prompt (Ask Claude, Generate image)'],
  ['Ctrl + wheel', 'Zoom the timeline'],
  ['?', 'This list'],
  ['Esc', 'Close dialogs, leave theatre mode'],
];

/** Keyboard shortcuts ("?"). */
export function ShortcutsDialog({ onClose }: { onClose(): void }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="keys-title" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal keys-modal">
        <header className="modal-head">
          <h2 id="keys-title">Keyboard shortcuts</h2>
          <button className="btn icon ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <dl className="keys-list">
          {KEYS.map(([k, what]) => (
            <div key={k} className="keys-row">
              <dt>
                <kbd>{k}</kbd>
              </dt>
              <dd>{what}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

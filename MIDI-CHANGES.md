# MIDI Controller Support, Polyphony, & Improved Keyboard

This document summarizes the changes that added MIDI controller support,
velocity-sensitive note playback, a 10-voice polyphony cap, a piano-style
on-screen keyboard with octave controls, and computer-keyboard input.

## What's new

### 1. MIDI controller input

- A new **"MIDI Controller"** section appears alongside the other synth
  controls. It contains a dropdown that lists every MIDI input device the
  browser can see.
- On load, the app asks the browser for permission to use MIDI. Once granted,
  any connected controllers show up in the dropdown.
- Pick a device from the dropdown and any keys you play on the controller
  will trigger notes on the synth using whatever oscillator waveforms you
  currently have selected.
- If you plug in or unplug a MIDI device while the app is open, the dropdown
  updates automatically. If the device you had selected disappears, the
  selection is cleared.
- If the browser doesn't support Web MIDI (for example Safari without the
  feature enabled) or the user denies permission, a friendly message is
  shown in place of the dropdown.

### 2. Velocity sensitivity

- The synth now responds to standard MIDI note velocity (0–127). Harder hits
  produce louder notes and softer hits produce quieter notes.
- Velocity is applied by scaling the peak (attack/decay/sustain) gain of each
  note by `velocity / 127`.
- The on-screen keyboard buttons use a fixed mid-range velocity (100) so they
  behave the same as before.
- MIDI "Note On" messages with a velocity of 0 are treated as "Note Off" per
  the MIDI spec, so controllers that send them will correctly release the
  note.

### 3. 10-voice polyphony limit

- The synth can now play up to **10 notes simultaneously**.
- When an 11th note comes in, the **oldest currently-playing voice is
  stolen** (immediately stopped) to make room for the new note. This is a
  common technique in hardware and software synths and avoids runaway CPU
  usage when a lot of keys are held down at once.
- Each active voice now tracks when it started so the oldest one can be
  identified quickly.

### 4. Piano-style on-screen keyboard

- The old row of purple buttons was replaced with a proper piano keyboard:
  a row of white keys with black keys (sharps/flats) overlaid in the correct
  positions between the right white keys.
- Each white key is labelled with its note name (C, D, E, F, G, A, B, C) and
  each key shows a small hint for its matching computer-keyboard shortcut.
- Pressing a key (mouse or computer keyboard) lights it up so you can see
  what's playing.

### 5. Octave up / down controls

- A pair of **Octave −** / **Octave +** buttons sits above the keyboard with
  a readout of the current octave (default: 4, so the leftmost C is C4 /
  MIDI 60).
- Pressing either button shifts the on-screen keyboard one octave down or up.
  The range is clamped to octaves 0–8 so you can't wander off the end of the
  MIDI spectrum; the buttons disable themselves at the limits.
- **Octave controls only affect the on-screen keyboard and the computer
  keyboard mapping. A connected MIDI controller is unaffected** — its notes
  come through at their true pitches regardless of the on-screen octave.

### 6. Computer-keyboard input

- You can now play the synth from the computer keyboard without a MIDI
  device plugged in.
- **White keys:** `A S D F G H J K` → `C D E F G A B C`
- **Black keys (sharps / flats):** `W E T Y U` → `C♯/D♭, D♯/E♭, F♯/G♭,
  G♯/A♭, A♯/B♭`
- Holding a key plays the note for as long as it's held, and releasing the
  key triggers the normal release phase of the envelope.
- Key auto-repeat (holding a key long enough to trigger the OS' repeat
  behaviour) is ignored, so notes don't re-trigger while you hold them.
- Shortcuts are ignored while you're typing in a text field, select, or
  other editable element, so the oscillator waveform selectors and other
  controls still work normally.
- If you switch tabs or focus away while holding notes, those notes are
  automatically released (no stuck notes).
- If you change octave while holding a computer-keyboard key, the original
  note keeps playing until you release that key (which releases the correct
  note), and any new keypress plays in the new octave.

## Files changed

- `audio/AudioProvider.tsx` — added an optional `velocity` argument to
  `playNote`, normalized velocity into the gain curve, added a
  `MAX_POLYPHONY` constant (10), tracked `startedAt` on each voice, and added
  voice-stealing logic that runs before each new note is started.
- `components/controls/MIDIController.tsx` — **new**. Handles Web MIDI access,
  device discovery, hot-plug events, and message parsing (Note On / Note Off
  with velocity). Exposes a `<MIDIController onNoteOn onNoteOff />` component
  that renders the dropdown UI.
- `components/controls/PianoKeyboard.tsx` — **new**. Renders the piano-style
  keyboard with sharps/flats, octave up/down controls, and listens to the
  computer keyboard for `A–K` / `W E T Y U` input. Emits the same
  `onNoteOn(note, velocity)` / `onNoteOff(note)` callbacks used by the MIDI
  controller so the page wires them up identically.
- `app/page.tsx` — replaced the old button-row keyboard with `PianoKeyboard`,
  and forwards both the on-screen/computer and MIDI events into a shared
  `handleNoteOn` / `handleNoteOff` pair that reads the current oscillator
  selections through a ref.
- `app/globals.css` — removed the old `.keyboard-key` styles and added
  styles for the piano keyboard (white and black keys, pressed state,
  octave controls) and the MIDI controller panel.

## Browser support note

Web MIDI is supported in Chromium-based browsers (Chrome, Edge, Opera, Brave)
and in recent versions of Firefox. Safari requires enabling MIDI support via
the Develop menu's experimental features. The app detects lack of support
and shows a message rather than crashing.

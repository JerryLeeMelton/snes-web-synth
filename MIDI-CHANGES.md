# MIDI Controller Support & Polyphony

This document summarizes the changes that added MIDI controller support,
velocity-sensitive note playback, and a 10-voice polyphony cap to the synth.

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

## Files changed

- `audio/AudioProvider.tsx` — added an optional `velocity` argument to
  `playNote`, normalized velocity into the gain curve, added a
  `MAX_POLYPHONY` constant (10), tracked `startedAt` on each voice, and added
  voice-stealing logic that runs before each new note is started.
- `components/controls/MIDIController.tsx` — **new**. Handles Web MIDI access,
  device discovery, hot-plug events, and message parsing (Note On / Note Off
  with velocity). Exposes a `<MIDIController onNoteOn onNoteOff />` component
  that renders the dropdown UI.
- `app/page.tsx` — renders the `MIDIController` inside the existing synth
  controls and forwards MIDI events into the existing `playNote` / `stopNote`
  functions. Oscillator-type selections are read through a ref so MIDI input
  always uses the latest waveform picks without re-attaching listeners.
- `app/globals.css` — added styling for the new MIDI controller section so it
  matches the other control panels.

## Browser support note

Web MIDI is supported in Chromium-based browsers (Chrome, Edge, Opera, Brave)
and in recent versions of Firefox. Safari requires enabling MIDI support via
the Develop menu's experimental features. The app detects lack of support
and shows a message rather than crashing.

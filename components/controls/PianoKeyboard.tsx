"use client"

import { useEffect, useRef, useState } from "react"

interface PianoKeyboardProps {
  onNoteOn: (note: number, velocity: number) => void
  onNoteOff: (note: number) => void
}

type WhiteKey = {
  offset: number
  label: string
  computerKey: string
}

type BlackKey = {
  offset: number
  label: string
  computerKey: string
  // Position expressed in "white-key slots" from the left edge of the
  // keyboard. A slot of 1 means the black key is centered on the boundary
  // between the 1st and 2nd white keys.
  slot: number
}

const WHITE_KEYS: WhiteKey[] = [
  { offset: 0, label: "C", computerKey: "a" },
  { offset: 2, label: "D", computerKey: "s" },
  { offset: 4, label: "E", computerKey: "d" },
  { offset: 5, label: "F", computerKey: "f" },
  { offset: 7, label: "G", computerKey: "g" },
  { offset: 9, label: "A", computerKey: "h" },
  { offset: 11, label: "B", computerKey: "j" },
  { offset: 12, label: "C", computerKey: "k" },
]

const BLACK_KEYS: BlackKey[] = [
  { offset: 1, label: "C♯/D♭", computerKey: "w", slot: 1 },
  { offset: 3, label: "D♯/E♭", computerKey: "e", slot: 2 },
  { offset: 6, label: "F♯/G♭", computerKey: "t", slot: 4 },
  { offset: 8, label: "G♯/A♭", computerKey: "y", slot: 5 },
  { offset: 10, label: "A♯/B♭", computerKey: "u", slot: 6 },
]

const MIN_OCTAVE = 0
const MAX_OCTAVE = 8
const DEFAULT_OCTAVE = 4
const ON_SCREEN_VELOCITY = 100

const COMPUTER_KEY_TO_OFFSET = new Map<string, number>([
  ...WHITE_KEYS.map((k) => [k.computerKey, k.offset] as [string, number]),
  ...BLACK_KEYS.map((k) => [k.computerKey, k.offset] as [string, number]),
])

function baseMidiForOctave(octave: number) {
  // MIDI note 60 is C4, so C<octave> = (octave + 1) * 12.
  return (octave + 1) * 12
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  )
}

export default function PianoKeyboard({
  onNoteOn,
  onNoteOff,
}: PianoKeyboardProps) {
  const [octave, setOctave] = useState(DEFAULT_OCTAVE)
  const [pressedOffsets, setPressedOffsets] = useState<Set<number>>(
    () => new Set(),
  )

  const octaveRef = useRef(octave)
  const onNoteOnRef = useRef(onNoteOn)
  const onNoteOffRef = useRef(onNoteOff)
  // Map from a computer key -> the exact MIDI note we triggered on press, so
  // releasing still targets the right note even if the octave shifted while
  // the key was held.
  const heldComputerKeysRef = useRef<Map<string, number>>(new Map())

  useEffect(() => {
    octaveRef.current = octave
  }, [octave])

  useEffect(() => {
    onNoteOnRef.current = onNoteOn
    onNoteOffRef.current = onNoteOff
  }, [onNoteOn, onNoteOff])

  const pressOffset = (offset: number) => {
    const note = baseMidiForOctave(octaveRef.current) + offset
    onNoteOnRef.current(note, ON_SCREEN_VELOCITY)
    setPressedOffsets((prev) => {
      if (prev.has(offset)) return prev
      const next = new Set(prev)
      next.add(offset)
      return next
    })
    return note
  }

  const releaseOffset = (offset: number, note: number) => {
    onNoteOffRef.current(note)
    setPressedOffsets((prev) => {
      if (!prev.has(offset)) return prev
      const next = new Set(prev)
      next.delete(offset)
      return next
    })
  }

  const shiftOctave = (delta: number) => {
    setOctave((prev) =>
      Math.min(MAX_OCTAVE, Math.max(MIN_OCTAVE, prev + delta)),
    )
  }

  // Global computer-keyboard listeners.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (isEditableTarget(e.target)) return
      const key = e.key.toLowerCase()
      const offset = COMPUTER_KEY_TO_OFFSET.get(key)
      if (offset === undefined) return
      if (heldComputerKeysRef.current.has(key)) return
      const note = pressOffset(offset)
      heldComputerKeysRef.current.set(key, note)
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase()
      const heldNote = heldComputerKeysRef.current.get(key)
      if (heldNote === undefined) return
      heldComputerKeysRef.current.delete(key)
      const offset = COMPUTER_KEY_TO_OFFSET.get(key)
      if (offset === undefined) {
        onNoteOffRef.current(heldNote)
        return
      }
      releaseOffset(offset, heldNote)
    }

    const releaseAllHeldComputerKeys = () => {
      const offsetsToClear: number[] = []
      heldComputerKeysRef.current.forEach((note, key) => {
        onNoteOffRef.current(note)
        const offset = COMPUTER_KEY_TO_OFFSET.get(key)
        if (offset !== undefined) offsetsToClear.push(offset)
      })
      heldComputerKeysRef.current.clear()
      if (offsetsToClear.length > 0) {
        setPressedOffsets((prev) => {
          const next = new Set(prev)
          for (const o of offsetsToClear) next.delete(o)
          return next
        })
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    window.addEventListener("keyup", handleKeyUp)
    window.addEventListener("blur", releaseAllHeldComputerKeys)

    return () => {
      window.removeEventListener("keydown", handleKeyDown)
      window.removeEventListener("keyup", handleKeyUp)
      window.removeEventListener("blur", releaseAllHeldComputerKeys)
    }
  }, [])

  const baseMidi = baseMidiForOctave(octave)

  return (
    <div className="piano-container">
      <div className="piano-octave-controls">
        <button
          type="button"
          className="octave-button"
          onClick={() => shiftOctave(-1)}
          disabled={octave <= MIN_OCTAVE}
          aria-label="Octave down"
        >
          Octave −
        </button>
        <span className="octave-display">Octave: {octave}</span>
        <button
          type="button"
          className="octave-button"
          onClick={() => shiftOctave(1)}
          disabled={octave >= MAX_OCTAVE}
          aria-label="Octave up"
        >
          Octave +
        </button>
      </div>
      <div className="piano-keyboard">
        <div className="piano-white-keys">
          {WHITE_KEYS.map(({ offset, label, computerKey }) => {
            const note = baseMidi + offset
            const isPressed = pressedOffsets.has(offset)
            return (
              <button
                type="button"
                key={offset}
                className={
                  "piano-white-key" + (isPressed ? " piano-key-pressed" : "")
                }
                onMouseDown={() => pressOffset(offset)}
                onMouseUp={() => releaseOffset(offset, note)}
                onMouseLeave={() => {
                  if (pressedOffsets.has(offset)) {
                    releaseOffset(offset, note)
                  }
                }}
              >
                <span className="piano-key-label">{label}</span>
                <span className="piano-key-hint">
                  {computerKey.toUpperCase()}
                </span>
              </button>
            )
          })}
        </div>
        <div className="piano-black-keys">
          {BLACK_KEYS.map(({ offset, label, computerKey, slot }) => {
            const note = baseMidi + offset
            const isPressed = pressedOffsets.has(offset)
            return (
              <button
                type="button"
                key={offset}
                aria-label={label}
                className={
                  "piano-black-key" + (isPressed ? " piano-key-pressed" : "")
                }
                style={{
                  left: `calc(${slot} * var(--white-key-width) - var(--black-key-width) / 2)`,
                }}
                onMouseDown={(e) => {
                  e.preventDefault()
                  pressOffset(offset)
                }}
                onMouseUp={() => releaseOffset(offset, note)}
                onMouseLeave={() => {
                  if (pressedOffsets.has(offset)) {
                    releaseOffset(offset, note)
                  }
                }}
              >
                <span className="piano-key-hint">
                  {computerKey.toUpperCase()}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

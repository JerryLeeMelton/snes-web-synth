"use client"

import { useCallback, useRef, useState, useEffect } from "react"
import { useAudio } from "@/audio/AudioProvider"
import ADSRSliders from "@/components/controls/ADSRSliders"
import MIDIController from "@/components/controls/MIDIController"

const KEYBOARD_KEYS = [
  { note: 60, label: "C" },
  { note: 62, label: "D" },
  { note: 64, label: "E" },
  { note: 65, label: "F" },
  { note: 67, label: "G" },
  { note: 69, label: "A" },
  { note: 71, label: "B" },
  { note: 72, label: "C" },
]

const OSCILLATOR_TYPES = ["sine", "square", "sawtooth", "triangle"]

// Default velocity for the on-screen keyboard (mid-range MIDI velocity)
const ON_SCREEN_VELOCITY = 100

export default function Home() {
  const {
    playNote,
    stopNote,
    setVolEnvelope,
    volEnvelopeRangeValues,
    volEnvelopeRef,
  } = useAudio()

  const [oscillatorTypes, setOscillatorTypes] = useState<OscillatorType[]>([
    "sine",
    "sine",
    "sine",
    "sine",
  ])

  // Keep the latest oscillator types in a ref so MIDI callbacks stay stable
  // while still using the current waveform selections.
  const oscillatorTypesRef = useRef(oscillatorTypes)
  useEffect(() => {
    oscillatorTypesRef.current = oscillatorTypes
  }, [oscillatorTypes])

  const handleMidiNoteOn = useCallback(
    (note: number, velocity: number) => {
      playNote(note, oscillatorTypesRef.current, velocity)
    },
    [playNote],
  )

  const handleMidiNoteOff = useCallback(
    (note: number) => {
      stopNote(note)
    },
    [stopNote],
  )

  return (
    <div className="flex flex-col flex-1 items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <div className="keyboard-container">
        {KEYBOARD_KEYS.map(({ note, label }) => (
          <button
            key={note}
            onMouseDown={() => {
              playNote(note, oscillatorTypes, ON_SCREEN_VELOCITY)
            }}
            onMouseUp={() => {
              stopNote(note)
            }}
            onMouseLeave={() => {
              stopNote(note)
            }}
            className={"keyboard-key"}
          >
            {label}
          </button>
        ))}
      </div>
      <div className={"synth-controls"}>
        <div className="volume-envelope-container">
          <ADSRSliders
            setEnvelope={setVolEnvelope}
            adsrRangeValues={volEnvelopeRangeValues}
          />
        </div>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="oscillator-controls-container">
            <div>Oscillator{" " + (i + 1)}</div>
            <div>
              {/* Oscillator Waveform Selector */}
              <select
                value={oscillatorTypes[i]}
                onChange={(e) => {
                  const next = [...oscillatorTypes]
                  next[i] = e.target.value as OscillatorType
                  setOscillatorTypes(next)
                }}
              >
                {OSCILLATOR_TYPES.map((oscType) => (
                  <option key={oscType}>{oscType}</option>
                ))}
              </select>
            </div>
          </div>
        ))}
        <MIDIController
          onNoteOn={handleMidiNoteOn}
          onNoteOff={handleMidiNoteOff}
        />
      </div>
    </div>
  )
}

"use client"

import { useEffect, useRef, useState } from "react"
import { useAudio } from "@/audio/AudioProvider"

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

export default function Home() {
  const { playNote, stopNote } = useAudio()

  const [oscillatorTypes, setOscillatorTypes] = useState<OscillatorType[]>([
    "sine",
    "sine",
    "sine",
    "sine",
  ])

  return (
    <div className="flex flex-col flex-1 items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <div className="keyboard-container">
        {KEYBOARD_KEYS.map(({ note, label }) => (
          <button
            key={note}
            onMouseDown={() => {
              playNote(note, oscillatorTypes)
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
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="oscillator-control-container">
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
        ))}
      </div>
    </div>
  )
}

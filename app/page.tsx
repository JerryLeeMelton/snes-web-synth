"use client"

import { useEffect, useRef, useState } from "react"
import { useAudio } from "@/audio/AudioProvider"

const keyboardKeys = [
  { note: 60, label: "C" },
  { note: 62, label: "D" },
  { note: 64, label: "E" },
  { note: 65, label: "F" },
  { note: 67, label: "G" },
  { note: 69, label: "A" },
  { note: 71, label: "B" },
  { note: 72, label: "C" },
]

export default function Home() {
  const { playNote, stopNote } = useAudio()
  return (
    <div className="flex flex-col flex-1 items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <div className="keyboard-container">
        {keyboardKeys.map(({ note, label }) => (
          <button
            key={note}
            onMouseDown={() => {
              playNote(note)
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
    </div>
  )
}

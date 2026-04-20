"use client"

import { useCallback, useRef, useState, useEffect } from "react"
import { useAudio } from "@/audio/AudioProvider"
import ADSRSliders from "@/components/controls/ADSRSliders"
import MIDIController from "@/components/controls/MIDIController"
import PianoKeyboard from "@/components/controls/PianoKeyboard"

const OSCILLATOR_TYPES = ["sine", "square", "sawtooth", "triangle"]

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

  // Keep the latest oscillator types in a ref so external input sources
  // (MIDI, on-screen keyboard, computer keyboard) always use the current
  // waveform selections without re-attaching listeners.
  const oscillatorTypesRef = useRef(oscillatorTypes)
  useEffect(() => {
    oscillatorTypesRef.current = oscillatorTypes
  }, [oscillatorTypes])

  const handleNoteOn = useCallback(
    (note: number, velocity: number) => {
      playNote(note, oscillatorTypesRef.current, velocity)
    },
    [playNote],
  )

  const handleNoteOff = useCallback(
    (note: number) => {
      stopNote(note)
    },
    [stopNote],
  )

  return (
    <div className="flex flex-col flex-1 items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <PianoKeyboard onNoteOn={handleNoteOn} onNoteOff={handleNoteOff} />
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
          onNoteOn={handleNoteOn}
          onNoteOff={handleNoteOff}
        />
      </div>
    </div>
  )
}

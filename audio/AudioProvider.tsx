"use client"

import { createContext, useContext, useRef, ReactNode, useEffect } from "react"

type AudioContextType = {
  // getAudioContext: () => AudioContext
  playNote: (note: number, oscillatorTypes: OscillatorType[]) => void
  stopNote: (note: number) => void
  setVolEnvelope: (envelopeData: {
    attack: number
    decay: number
    sustain: number
    release: number
  }) => void
  volEnvelopeRangeValues: {
    attack: { min: number; max: number; default: number }
    decay: { min: number; max: number; default: number }
    sustain: { min: number; max: number; default: number }
    release: { min: number; max: number; default: number }
  }
  volEnvelopeRef: React.RefObject<Envelope>
}

export type Voice = {
  oscillators: OscillatorNode[]
  gain: GainNode
}

export type Envelope = {
  attack: number
  decay: number
  sustain: number
  release: number
}

const volEnvelopeRangeValues = {
  attack: { min: 0.001, max: 2.0, default: 0.02 },
  decay: { min: 0.001, max: 2.0, default: 0.1 },
  sustain: { min: 0, max: 1.0, default: 0.7 },
  release: { min: 0.001, max: 3.0, default: 0.05 },
}

const AudioCtx = createContext<AudioContextType | null>(null)

function midiToFreqency(note: number) {
  return 440 * Math.pow(2, (note - 69) / 12)
}

export default function AudioProvider({ children }: { children: ReactNode }) {
  const audioContextRef = useRef<AudioContext | null>(null)
  const voicesRef = useRef<Map<number, Voice>>(new Map())
  const volEnvelopeRef = useRef<Envelope>({
    attack: volEnvelopeRangeValues.attack.default,
    decay: volEnvelopeRangeValues.decay.default,
    sustain: volEnvelopeRangeValues.sustain.default,
    release: volEnvelopeRangeValues.release.default,
  })

  useEffect(() => {
    console.log(
      "volumeEnvelopeRef.current updated.  == ",
      volEnvelopeRef.current,
    )
  }, [volEnvelopeRef.current])

  function getAudioContext() {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext()
    }

    return audioContextRef.current
  }

  function setVolEnvelope(envelopeData: Envelope) {
    volEnvelopeRef.current = envelopeData
  }

  function playNote(note: number, oscillatorTypes: OscillatorType[]): void {
    if (voicesRef.current.has(note)) {
      return // Return early, note already playing somehow
    }

    // Get an initialize audio context
    const audioContext = getAudioContext()
    audioContext.resume()

    // Set the note's frequency and gain
    const { attack, decay, sustain } = volEnvelopeRef.current
    const now = audioContext.currentTime
    const noteFrequency = midiToFreqency(note)
    const gain = audioContext.createGain()
    gain.gain.setValueAtTime(0, now)
    // Apply attack from volume envelope
    gain.gain.linearRampToValueAtTime(0.3, now + attack)
    gain.gain.linearRampToValueAtTime(sustain, now + attack + decay)
    gain.connect(audioContext.destination)

    // Create oscillators and give them the note data
    const oscillators = oscillatorTypes.map((type) => {
      const osc = audioContext.createOscillator()
      osc.type = type
      osc.frequency.value = noteFrequency
      osc.connect(gain)
      return osc
    })

    // Play the note!
    oscillators.forEach((osc) => {
      osc.start()
    })

    // Add note to the voiceRef for tracking and later stopping
    voicesRef.current.set(note, { oscillators: oscillators, gain })
  }

  function stopNote(note: number): void {
    const voice = voicesRef.current.get(note)

    if (!voice) {
      return // Invalid voice, return
    }

    const audioContext = getAudioContext()
    const now = audioContext.currentTime
    const releaseTime = volEnvelopeRef.current.release

    // Short default release value to avoid pops
    voice.gain.gain.setValueAtTime(voice.gain.gain.value, now)
    voice.gain.gain.linearRampToValueAtTime(0, now + releaseTime)

    // Stop oscillators after release finishes
    setTimeout(() => {
      voice.oscillators.forEach((oscillator) => oscillator.stop())
      voice.gain.disconnect()
    }, releaseTime + 100)

    voicesRef.current.delete(note)
  }

  return (
    <AudioCtx.Provider
      value={{
        playNote,
        stopNote,
        volEnvelopeRef,
        setVolEnvelope,
        volEnvelopeRangeValues,
      }}
    >
      {children}
    </AudioCtx.Provider>
  )
}

export function useAudio() {
  const context = useContext(AudioCtx)

  if (!context) {
    throw new Error("Something went wrong! context was null")
  }

  return context
}

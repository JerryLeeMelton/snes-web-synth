"use client"

import { createContext, useContext, useRef, ReactNode } from "react"

type AudioContextType = {
  // getAudioContext: () => AudioContext
  playNote: (note: number, oscillatorTypes: OscillatorType[]) => void
  stopNote: (note: number) => void
}

type Voice = {
  oscillators: OscillatorNode[]
  gain: GainNode
}

const AudioCtx = createContext<AudioContextType | null>(null)

function midiToFreqency(note: number) {
  return 440 * Math.pow(2, (note - 69) / 12)
}

export default function AudioProvider({ children }: { children: ReactNode }) {
  const audioContextRef = useRef<AudioContext | null>(null)
  const voicesRef = useRef<Map<number, Voice>>(new Map())

  function getAudioContext() {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext()
    }

    return audioContextRef.current
  }

  function playNote(note: number, oscillatorTypes: OscillatorType[]): void {
    if (voicesRef.current.has(note)) {
      return // Return early, note already playing somehow
    }

    // Get an initialize audio context
    const audioContext = getAudioContext()
    audioContext.resume()

    // Set the note's frequency and gain
    const noteFrequency = midiToFreqency(note)
    const gain = audioContext.createGain()
    gain.gain.setValueAtTime(0, audioContext.currentTime)
    // Short default ramp to avoid pops
    gain.gain.linearRampToValueAtTime(0.3, audioContext.currentTime + 0.02)
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
    const releaseTime = 0.05

    // Short default release value to avoid pops
    voice.gain.gain.setValueAtTime(voice.gain.gain.value, now)
    voice.gain.gain.linearRampToValueAtTime(0, now + releaseTime)

    // Stop oscillators after release finishes
    setTimeout(() => {
      voice.oscillators.forEach((oscillator) => oscillator.stop())
      voice.gain.disconnect()
    })

    voicesRef.current.delete(note)
  }

  return (
    <AudioCtx.Provider value={{ playNote, stopNote }}>
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

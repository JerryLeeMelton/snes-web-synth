"use client"

import { createContext, useContext, useRef, ReactNode } from "react"

type AudioContextType = {
  // getAudioContext: () => AudioContext
  playNote: (note: number, oscillatorType: OscillatorType) => void
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

  function playNote(note: number, oscillatorType: OscillatorType): void {
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
    const osc1 = audioContext.createOscillator()
    osc1.type = oscillatorType
    osc1.frequency.value = noteFrequency
    osc1.connect(gain)

    const osc2 = audioContext.createOscillator()
    osc2.type = oscillatorType
    osc2.frequency.value = noteFrequency
    osc2.detune.value = 5
    osc2.connect(gain)

    const osc3 = audioContext.createOscillator()
    osc2.type = oscillatorType
    osc2.frequency.value = noteFrequency
    osc2.detune.value = 5
    osc2.connect(gain)

    // Play the note!
    osc1.start()
    osc2.start()
    osc3.start()

    // Add note to the voiceRef for tracking and later stopping
    voicesRef.current.set(note, { oscillators: [osc1, osc2, osc3], gain })
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

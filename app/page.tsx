"use client"

import { useEffect, useRef, useState } from "react"

export default function Home() {
  const audioContextRef = useRef<AudioContext | null>(null)
  const oscOneRef = useRef<OscillatorNode | null>(null)
  const gainRef = useRef<GainNode | null>(null)
  const [oscPlaying, setOscPlaying] = useState<boolean>(false)

  useEffect(() => {
    const audioContext = new AudioContext()
    const oscOne = audioContext.createOscillator()
    const gain = audioContext.createGain()

    oscOne.type = "sine"
    oscOne.frequency.value = 440
    gain.gain.value = 0

    oscOne.connect(gain).connect(audioContext.destination)
    oscOne.start()

    audioContextRef.current = audioContext
    oscOneRef.current = oscOne
    gainRef.current = gain

    return () => {
      oscOne.stop()
      audioContext.close()
    }
  }, [])

  function toggleOscillator(): void {
    console.log("Starting or Stopping osc1")

    const audioContext = audioContextRef.current
    const gain = gainRef.current

    if (!audioContext || !gain) return

    audioContext.resume()

    if (!oscPlaying) {
      gain.gain.setValueAtTime(1, audioContext.currentTime)
    } else {
      gain.gain.setValueAtTime(0, audioContext.currentTime)
    }

    setOscPlaying(!oscPlaying)
  }

  return (
    <div className="flex flex-col flex-1 items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <button onClick={toggleOscillator}>Toggle Oscillator</button>
    </div>
  )
}

"use client"

import { createContext, useContext, useRef, ReactNode } from "react"

type AudioContextType = {
  getAudioContext: () => AudioContext
}

const AudioCtx = createContext<AudioContextType | null>(null)

export default function AudioProvider({ children }: { children: ReactNode }) {
  const audioContextRef = useRef<AudioContext | null>(null)

  function getAudioContext() {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext()
    }

    return audioContextRef.current
  }

  return (
    <AudioCtx.Provider value={{ getAudioContext }}>
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

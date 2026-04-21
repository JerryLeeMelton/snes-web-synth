"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  ReactNode,
} from "react"

export type SynthMode = "snes" | "standard"

type AudioContextType = {
  playNote: (
    note: number,
    oscillatorTypes: OscillatorType[],
    velocity?: number,
  ) => void
  stopNote: (note: number) => void
  setVolEnvelope: (envelopeData: Envelope) => void
  volEnvelopeRangeValues: {
    attack: { min: number; max: number; default: number }
    decay: { min: number; max: number; default: number }
    sustain: { min: number; max: number; default: number }
    release: { min: number; max: number; default: number }
  }
  volEnvelopeRef: React.RefObject<Envelope>
  mode: SynthMode
  setMode: (mode: SynthMode) => void
}

export type Voice = {
  oscillators: OscillatorNode[]
  gain: GainNode
  startedAt: number
  releaseTimeout?: ReturnType<typeof setTimeout>
}

export type Envelope = {
  attack: number
  decay: number
  sustain: number
  release: number
}

export const MAX_POLYPHONY = 10

const volEnvelopeRangeValues = {
  attack: { min: 0.001, max: 2.0, default: 0.02 },
  decay: { min: 0.001, max: 2.0, default: 0.1 },
  sustain: { min: 0, max: 1.0, default: 0.7 },
  release: { min: 0.001, max: 3.0, default: 0.05 },
}

// AudioWorklet.addModule() doesn't go through Next's basePath rewriter, so we
// prefix the asset URL ourselves. The env var is injected at build time from
// next.config.ts; fall back to no prefix for tests / local runs without it.
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? ""
const SNES_WORKLET_URL = `${BASE_PATH}/worklets/snes-dsp.js`

const AudioCtx = createContext<AudioContextType | null>(null)

function midiToFrequency(note: number) {
  return 440 * Math.pow(2, (note - 69) / 12)
}

export default function AudioProvider({ children }: { children: ReactNode }) {
  // Core audio graph refs. The graph looks like:
  //   voice.gain -> busGain -> [snesNode? ->] masterGain -> destination
  // `busGain` is a single fan-in node that every voice connects to. That lets
  // us switch processing modes by re-wiring one edge instead of touching every
  // active voice, which keeps mode switches click-free.
  const audioContextRef = useRef<AudioContext | null>(null)
  const masterGainRef = useRef<GainNode | null>(null)
  const busGainRef = useRef<GainNode | null>(null)
  const snesNodeRef = useRef<AudioWorkletNode | null>(null)
  const snesWorkletLoadingRef = useRef<Promise<void> | null>(null)
  const voicesRef = useRef<Map<number, Voice>>(new Map())
  const modeRef = useRef<SynthMode>("snes")

  const [mode, setModeState] = useState<SynthMode>("snes")

  const volEnvelopeRef = useRef<Envelope>({
    attack: volEnvelopeRangeValues.attack.default,
    decay: volEnvelopeRangeValues.decay.default,
    sustain: volEnvelopeRangeValues.sustain.default,
    release: volEnvelopeRangeValues.release.default,
  })

  function ensureAudioContext(): AudioContext {
    if (!audioContextRef.current) {
      const ctx = new AudioContext()
      audioContextRef.current = ctx

      const master = ctx.createGain()
      master.gain.value = 0.4
      master.connect(ctx.destination)
      masterGainRef.current = master

      const bus = ctx.createGain()
      bus.gain.value = 1
      busGainRef.current = bus

      // Initial routing reflects the current mode. If SNES is selected, the
      // worklet is loaded lazily; until it's ready we route through master so
      // notes played before load still make sound (they just miss the SNES
      // processing for the first few ms).
      bus.connect(master)
      if (modeRef.current === "snes") {
        loadSnesWorklet(ctx).then(() => applyRouting())
      }
    }
    return audioContextRef.current
  }

  function loadSnesWorklet(ctx: AudioContext): Promise<void> {
    if (snesNodeRef.current) return Promise.resolve()
    if (snesWorkletLoadingRef.current) return snesWorkletLoadingRef.current

    const loading = ctx.audioWorklet
      .addModule(SNES_WORKLET_URL)
      .then(() => {
        if (!audioContextRef.current) return
        const node = new AudioWorkletNode(ctx, "snes-dsp", {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [2],
          channelCount: 2,
          channelCountMode: "explicit",
          channelInterpretation: "speakers",
        })
        snesNodeRef.current = node
      })
      .catch((err) => {
        console.error("Failed to load SNES DSP worklet", err)
        // Allow a subsequent mode switch to retry the load rather than being
        // stuck on a cached rejected promise.
        snesWorkletLoadingRef.current = null
      })

    snesWorkletLoadingRef.current = loading
    return loading
  }

  /**
   * Re-wire the bus output to match the current mode. Safe to call any time;
   * disconnects and reconnects only the one edge between bus and master.
   */
  function applyRouting() {
    const ctx = audioContextRef.current
    const bus = busGainRef.current
    const master = masterGainRef.current
    if (!ctx || !bus || !master) return

    try {
      bus.disconnect()
    } catch {
      // no existing connections -- safe to ignore
    }

    if (modeRef.current === "snes" && snesNodeRef.current) {
      try {
        snesNodeRef.current.disconnect()
      } catch {}
      bus.connect(snesNodeRef.current)
      snesNodeRef.current.connect(master)
    } else {
      bus.connect(master)
    }
  }

  const setMode = useCallback((next: SynthMode) => {
    modeRef.current = next
    setModeState(next)

    const ctx = audioContextRef.current
    if (!ctx) return

    if (next === "snes") {
      loadSnesWorklet(ctx).then(() => applyRouting())
    } else {
      applyRouting()
    }
  }, [])

  function setVolEnvelope(envelopeData: Envelope) {
    volEnvelopeRef.current = envelopeData
  }

  function killVoiceImmediately(note: number) {
    const existing = voicesRef.current.get(note)
    if (!existing) return
    clearTimeout(existing.releaseTimeout)
    const ctx = audioContextRef.current!
    existing.gain.gain.cancelScheduledValues(ctx.currentTime)
    existing.gain.gain.setValueAtTime(0, ctx.currentTime)
    for (const osc of existing.oscillators) {
      try {
        osc.stop()
      } catch {
        // Oscillator may already be stopped; safe to ignore.
      }
    }
    existing.gain.disconnect()
    voicesRef.current.delete(note)
  }

  function playNote(
    note: number,
    oscillatorTypes: OscillatorType[],
    velocity: number = 100,
  ): void {
    // Kill any existing voice on this note so a retrigger starts clean instead
    // of stacking a new envelope on top of an in-progress release.
    if (voicesRef.current.has(note)) {
      killVoiceImmediately(note)
    }

    // Enforce polyphony limit by stealing the oldest active voice.
    while (voicesRef.current.size >= MAX_POLYPHONY) {
      let oldestNote: number | null = null
      let oldestStart = Infinity
      for (const [n, v] of voicesRef.current) {
        if (v.startedAt < oldestStart) {
          oldestStart = v.startedAt
          oldestNote = n
        }
      }
      if (oldestNote === null) break
      killVoiceImmediately(oldestNote)
    }

    const audioContext = ensureAudioContext()
    audioContext.resume()

    // Normalize MIDI velocity (0-127) to a 0-1 gain scalar.
    const velocityScale = Math.min(Math.max(velocity, 0), 127) / 127

    const { attack, decay, sustain } = volEnvelopeRef.current
    const now = audioContext.currentTime
    const noteFrequency = midiToFrequency(note)
    // Adjust gain by oscillator count to prevent clipping, then scale by velocity.
    const peakGain = (1 / oscillatorTypes.length) * velocityScale
    const sustainGain = sustain * peakGain

    const gain = audioContext.createGain()
    gain.gain.setValueAtTime(0, now)
    gain.gain.linearRampToValueAtTime(peakGain, now + attack)
    gain.gain.linearRampToValueAtTime(sustainGain, now + attack + decay)
    gain.connect(busGainRef.current!)

    const oscillators = oscillatorTypes.map((type) => {
      const osc = audioContext.createOscillator()
      osc.type = type
      osc.frequency.value = noteFrequency
      osc.connect(gain)
      return osc
    })

    for (const osc of oscillators) osc.start()

    voicesRef.current.set(note, { oscillators, gain, startedAt: now })
  }

  function stopNote(note: number): void {
    const voice = voicesRef.current.get(note)
    if (!voice) return

    clearTimeout(voice.releaseTimeout)

    const audioContext = audioContextRef.current
    if (!audioContext) return
    const now = audioContext.currentTime
    const releaseTime = volEnvelopeRef.current.release

    voice.gain.gain.cancelScheduledValues(now)
    voice.gain.gain.setValueAtTime(voice.gain.gain.value, now)
    voice.gain.gain.linearRampToValueAtTime(0, now + releaseTime)

    voice.releaseTimeout = setTimeout(
      () => {
        for (const oscillator of voice.oscillators) {
          try {
            oscillator.stop()
          } catch {
            // Already stopped.
          }
        }
        voice.gain.disconnect()
        voicesRef.current.delete(note)
      },
      releaseTime * 1000 + 100,
    )
  }

  useEffect(() => {
    // Snapshot the voices map at effect setup so cleanup operates on the exact
    // object that was live at mount time.
    const voices = voicesRef.current
    return () => {
      const ctx = audioContextRef.current
      if (!ctx) return
      for (const voice of voices.values()) {
        clearTimeout(voice.releaseTimeout)
        try {
          voice.gain.disconnect()
        } catch {}
      }
      voices.clear()
      try {
        snesNodeRef.current?.disconnect()
      } catch {}
      try {
        busGainRef.current?.disconnect()
      } catch {}
      try {
        masterGainRef.current?.disconnect()
      } catch {}
      ctx.close().catch(() => {})
    }
  }, [])

  return (
    <AudioCtx.Provider
      value={{
        playNote,
        stopNote,
        volEnvelopeRef,
        setVolEnvelope,
        volEnvelopeRangeValues,
        mode,
        setMode,
      }}
    >
      {children}
    </AudioCtx.Provider>
  )
}

export function useAudio() {
  const context = useContext(AudioCtx)
  if (!context) {
    throw new Error("useAudio must be used within an AudioProvider")
  }
  return context
}

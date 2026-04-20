"use client"

import { useEffect, useRef, useState } from "react"

interface MIDIControllerProps {
  onNoteOn: (note: number, velocity: number) => void
  onNoteOff: (note: number) => void
}

type MIDIInputInfo = {
  id: string
  name: string
}

const MIDI_NOTE_ON = 0x90
const MIDI_NOTE_OFF = 0x80
const MIDI_STATUS_MASK = 0xf0

export default function MIDIController({
  onNoteOn,
  onNoteOff,
}: MIDIControllerProps) {
  const [isSupported, setIsSupported] = useState(true)
  const [accessError, setAccessError] = useState<string | null>(null)
  const [inputs, setInputs] = useState<MIDIInputInfo[]>([])
  const [selectedInputId, setSelectedInputId] = useState<string>("")

  const midiAccessRef = useRef<MIDIAccess | null>(null)
  const selectedInputRef = useRef<MIDIInput | null>(null)
  // Keep the latest callbacks in refs so the MIDI message handler always sees
  // fresh closures (oscillator types, etc.) without re-attaching listeners.
  const onNoteOnRef = useRef(onNoteOn)
  const onNoteOffRef = useRef(onNoteOff)

  useEffect(() => {
    onNoteOnRef.current = onNoteOn
    onNoteOffRef.current = onNoteOff
  }, [onNoteOn, onNoteOff])

  const refreshInputs = (access: MIDIAccess) => {
    const list: MIDIInputInfo[] = []
    access.inputs.forEach((input) => {
      list.push({ id: input.id, name: input.name ?? "Unknown device" })
    })
    setInputs(list)
    setSelectedInputId((prev) => {
      if (!prev) return prev
      return list.some((i) => i.id === prev) ? prev : ""
    })
  }

  const detachSelectedInput = () => {
    const current = selectedInputRef.current
    if (current) {
      current.onmidimessage = null
      selectedInputRef.current = null
    }
  }

  const handleMIDIMessage = (event: MIDIMessageEvent) => {
    const data = event.data
    if (!data || data.length < 2) return

    const status = data[0] & MIDI_STATUS_MASK
    const note = data[1]
    const velocity = data.length > 2 ? data[2] : 0

    if (status === MIDI_NOTE_ON) {
      // Per the MIDI spec, a Note On with velocity 0 is a Note Off.
      if (velocity === 0) {
        onNoteOffRef.current(note)
      } else {
        onNoteOnRef.current(note, velocity)
      }
    } else if (status === MIDI_NOTE_OFF) {
      onNoteOffRef.current(note)
    }
  }

  // Request MIDI access once on mount and track device connect/disconnect.
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.requestMIDIAccess) {
      // Feature detection must happen after mount to avoid SSR hydration
      // mismatches, so we intentionally flip state from the effect.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsSupported(false)
      return
    }

    let cancelled = false

    navigator
      .requestMIDIAccess()
      .then((access) => {
        if (cancelled) return
        midiAccessRef.current = access
        refreshInputs(access)
        access.onstatechange = () => {
          refreshInputs(access)
        }
      })
      .catch((err) => {
        if (cancelled) return
        setAccessError(
          err instanceof Error ? err.message : "Could not access MIDI devices",
        )
      })

    return () => {
      cancelled = true
      const access = midiAccessRef.current
      if (access) {
        access.onstatechange = null
      }
      detachSelectedInput()
    }
  }, [])

  // Attach a message listener whenever the selected input changes.
  useEffect(() => {
    detachSelectedInput()
    const access = midiAccessRef.current
    if (!access || !selectedInputId) return

    const input = access.inputs.get(selectedInputId)
    if (!input) return

    input.onmidimessage = handleMIDIMessage
    selectedInputRef.current = input

    return () => {
      detachSelectedInput()
    }
  }, [selectedInputId])

  return (
    <div className="midi-controller-container">
      <div className="midi-controller-heading">MIDI Controller</div>
      {!isSupported && (
        <div className="midi-controller-message">
          Web MIDI is not supported in this browser.
        </div>
      )}
      {isSupported && accessError && (
        <div className="midi-controller-message">
          MIDI access denied: {accessError}
        </div>
      )}
      {isSupported && !accessError && (
        <select
          value={selectedInputId}
          onChange={(e) => setSelectedInputId(e.target.value)}
        >
          <option value="">
            {inputs.length === 0
              ? "No MIDI devices detected"
              : "Select a MIDI input..."}
          </option>
          {inputs.map((input) => (
            <option key={input.id} value={input.id}>
              {input.name}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}

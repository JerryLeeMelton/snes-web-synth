import { Envelope } from "@/audio/AudioProvider"
import { useState } from "react"

interface ADSRSlidersProps {
  setEnvelope: (envelopeData: {
    attack: number
    decay: number
    sustain: number
    release: number
  }) => void
  adsrRangeValues: {
    attack: { min: number; max: number; default: number }
    decay: { min: number; max: number; default: number }
    sustain: { min: number; max: number; default: number }
    release: { min: number; max: number; default: number }
  }
}

const ADSR_PARAMETERS: { label: string; key: keyof Envelope }[] = [
  { label: "Attack", key: "attack" },
  { label: "Decay", key: "decay" },
  { label: "Sustain", key: "sustain" },
  { label: "Release", key: "release" },
]

export default function ADSRSliders({
  setEnvelope,
  adsrRangeValues,
}: ADSRSlidersProps) {
  const [envelope, setEnvelopeState] = useState<Envelope>({
    attack: adsrRangeValues.attack.default,
    decay: adsrRangeValues.decay.default,
    sustain: adsrRangeValues.sustain.default,
    release: adsrRangeValues.release.default,
  })

  return (
    <div>
      {ADSR_PARAMETERS.map(({ label, key }) => (
        <div key={key}>
          <label>{label}</label>
          <input
            type="range"
            min={adsrRangeValues[key].min}
            max={adsrRangeValues[key].max}
            value={envelope[key]}
            step={"any"}
            className="adsr-slider"
            onChange={(e) => {
              const newEnvelope = { ...envelope, [key]: Number(e.target.value) }
              setEnvelopeState(newEnvelope)
              setEnvelope(newEnvelope)
            }}
          ></input>
          {/* <label htmlFor=""></label> */}
        </div>
      ))}
    </div>
  )
}

# SNES Sound Clone — Change Summary

This change adds a **Mode Select** to the synth that switches between the
existing "Standard Mode" audio path and a new "SNES Mode" that emulates the
signature sonic character of the Super Nintendo's S-DSP. SNES Mode is the
default.

## User-facing changes

- New `Mode Select` dropdown at the top of the page with two options:
  - **SNES Mode** (default) — routes all voices through the SNES DSP
    emulation described below.
  - **Standard Mode** — the original direct-to-output routing, preserved bit-
    for-bit so existing synth behavior remains available.
- The mode switch is seamless: already-playing notes keep ringing while the
  output stage is rewired, so you can audibly A/B the two modes in real time.

## Files changed / added

| File | Change |
| --- | --- |
| `public/worklets/snes-dsp.js` | **New.** AudioWorklet that implements the SNES DSP output stage. |
| `audio/AudioProvider.tsx` | Refactored into a bus-based routing graph with a `mode` / `setMode` API and lazy AudioWorklet loading. |
| `app/page.tsx` | Added the `Mode Select` dropdown. |
| `app/globals.css` | Styling for the mode-select row. |

## Audio graph

```
voice.gain ──►  busGain ──► [ snes-dsp worklet ──► ] masterGain ──► destination
```

A single `busGain` node is the fan-in point for every voice. Switching modes
only re-wires the one edge between `busGain` and `masterGain`, so no per-voice
surgery is needed on every mode change. The SNES worklet is loaded lazily the
first time SNES Mode is entered and is cached thereafter.

## SNES DSP emulation (`public/worklets/snes-dsp.js`)

The goal of this module is to reproduce the *signature* characteristics of
the SPC700 / S-DSP audio pipeline — the specific timbral fingerprint that
makes SNES audio instantly recognizable — while keeping the existing
oscillator-driven voice architecture intact. The processor is implemented as
an `AudioWorklet`, which runs on the dedicated audio thread for glitch-free
low-latency processing.

### 1. 32 kHz fixed internal rate with zero-order-hold reconstruction

The real S-DSP runs at ~32040 Hz regardless of the host clock. We decimate
the incoming host-rate audio (typically 44.1 or 48 kHz) down to 32 kHz using
a simple phase accumulator, process at that rate, and reconstruct back up to
host rate using **zero-order hold** — which is exactly how the SNES DAC
behaves. The ZOH introduces the characteristic stair-step sinc-roll-off /
aliasing pattern heard on high notes on real hardware.

### 2. 4-point Gaussian interpolation (the "muffled" SNES signature)

The S-DSP pitches BRR samples using a 4-tap Gaussian kernel indexed by an
8-bit fractional pitch phase. The kernel's narrow bandwidth (substantially
attenuated above ~8 kHz) is the single biggest reason SNES audio sounds
"muffled" — it acts as a very aggressive anti-alias / reconstruction filter.

The worklet embeds the **exact 512-entry Gaussian table** from the S-DSP ROM
(commonly referenced from Anomie/Blargg/no$sns documentation) as an
`Int16Array`, and applies the 4-tap convolution to every DSP tick:

```
t   = phase * 256                    # 0..255 fractional position
out = g[255-t]·s[-3] + g[511-t]·s[-2] + g[256+t]·s[-1] + g[t]·s[0]  / 2048
```

This gives us the real frequency response rather than a crude one-pole
approximation, so the upper-midrange rolloff matches hardware.

### 3. BRR-style block quantization

BRR (Bit Rate Reduction) is the SNES's on-chip ADPCM format: 16-sample
blocks, one shared shift value per block, 4-bit signed nibbles per sample.
The audible fingerprint is a **block-level quantization noise** that scales
with the loudest sample in each 16-sample window — sustained tones acquire a
distinctive buzzy texture that clean 16-bit PCM doesn't have.

We reproduce this on the live signal by:
1. Buffering 16 samples per channel.
2. Finding the peak magnitude of the block.
3. Picking the smallest shift (0..12) that keeps every nibble in `[-8, 7]`.
4. Round-tripping each sample: quantize to a 4-bit nibble, decode back out.

This is "BRR filter 0" (no predictor) — it's enough to impose BRR's
characteristic block-quantization artifact on arbitrary synth waveforms
without destroying the underlying oscillator timbre. Latency is one block
(~0.5 ms at 32 kHz).

### 4. 8-tap FIR echo with feedback

The S-DSP echo is an 8-tap FIR filter over a circular delay buffer with
per-tap 8-bit signed coefficients, a configurable delay (EDL, in 16 ms
units), a feedback amount, and an echo-to-dry mix. We implement the same
topology in stereo with a 16 384-sample power-of-two buffer (`~512 ms` max
delay at 32 kHz). Echo is **disabled by default** because with arbitrary
synth waveforms it's easy to overwhelm the dry signal; the worklet exposes a
`MessagePort` API (`echoEnabled`, `echoDelay`, `echoFeedback`, `echoMix`,
`fir`) so it can be driven from the UI in a later iteration.

### 5. 16-bit saturation clip

Final output is clipped to `[-1, 1]` to emulate the DSP's signed-16-bit
saturation. This is audible when summing many voices.

## Performance

The worklet is written for the hot-path discipline required inside
`AudioWorkletProcessor.process`:

- **No allocations in the render loop.** Every buffer (Gaussian table, BRR
  input/output blocks, echo buffer, history window, FIR coefficients) is a
  pre-allocated typed array (`Int16Array` / `Float32Array` / `Int8Array`).
- **Typed-array field hoisting.** At the top of `process()` we hoist every
  `this.*` buffer and scalar to a local `const`/`let`, so the inner loop
  runs against locals — this lets V8 keep them in registers and skips the
  per-access property lookup.
- **Power-of-two circular buffer.** The echo buffer length is 16 384, so the
  write/read index wrap is a single `& ECHO_MASK` instead of a modulo.
- **Integer math in the Gaussian kernel.** Coefficients are read directly
  from the `Int16Array`, multiplied by floats, and summed; the `/ 2048`
  normalization is replaced with a multiply by a cached reciprocal.
- **Phase-accumulator decimation.** The 32 kHz tick rate is maintained with
  one float add + one compare per host frame. No resampler library, no
  per-frame trig.
- **Zero-order hold between ticks.** Host frames that fall between DSP
  ticks just copy the last held sample — no work beyond two writes.
- **Single global worklet.** All 8 voices sum into one bus, which feeds one
  worklet instance, rather than one-worklet-per-voice. That keeps CPU cost
  constant regardless of voice count.
- **Feature toggles short-circuit whole stages.** `gaussEnabled`,
  `brrEnabled`, `clipEnabled`, `echoEnabled` each skip their stage entirely
  when off, so disabled features cost nothing.

## Things deliberately left out (and why)

- **No per-voice gaussian interpolation.** The most fully-authentic approach
  would regenerate each voice as a pitched BRR sample with its own 4-tap
  kernel. That would require throwing out the existing `OscillatorNode`
  architecture, which the task explicitly asked to preserve. Running the
  Gaussian kernel on the summed bus still captures the dominant timbral
  characteristic (the ~8 kHz rolloff + kernel overshoot).
- **No pitch modulation / noise channel / ADSR hardware quirks.** These are
  S-DSP features that belong to the voice generator rather than the output
  stage. They can be layered in later without touching the worklet.
- **Echo defaults to off.** Real SNES soundtracks tune echo per-track. A
  global always-on echo with aggressive defaults would swamp the synth.

## How to verify

1. `npm run dev` and open the app.
2. The `Mode Select` dropdown at the top defaults to **SNES Mode**.
3. Play any key. Notes above roughly MIDI C5 will audibly lose highs
   (Gaussian rolloff) and sustained tones will pick up a subtle buzz
   (BRR quantization). Switch to **Standard Mode** mid-note to A/B.
4. `npm run lint` — clean.
5. `npm run build` — successful production build.

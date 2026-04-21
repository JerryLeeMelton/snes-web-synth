/*
 * SNES S-DSP inspired output-stage processor.
 *
 * Emulates the signature characteristics of the Super Nintendo's S-DSP:
 *   - Fixed 32 kHz internal processing rate with zero-order-hold reconstruction
 *     (the SPC700 clocks the DSP at ~32040 Hz; we use 32000 for simplicity).
 *   - 4-point Gaussian interpolation at the internal rate, using the exact
 *     512-entry kernel from the S-DSP ROM. The kernel's narrow bandwidth is the
 *     dominant reason SNES audio sounds "muffled" above ~8 kHz.
 *   - BRR-style block quantization: each 16-sample block is fit to a 4-bit range
 *     with a shared shift (0..12), reproducing BRR's characteristic blocky
 *     quantization noise on sustained tones.
 *   - 8-tap FIR echo with feedback and an echo-to-dry mix, matching the
 *     S-DSP echo topology. Delay is set in ~16 ms units like the real ESA/EDL.
 *   - Final saturation to a 16-bit signed range to capture the DSP's hard clip.
 *
 * Performance notes:
 *   - All buffers are typed arrays (Int16 / Float32). The hot loop avoids
 *     allocations, uses integer arithmetic for the Gaussian kernel, and uses a
 *     power-of-two echo buffer so indexing is a single bitwise AND.
 *   - The processor runs once per render quantum (128 frames). Downsampling
 *     from host-rate to 32 kHz is done with a phase accumulator; upsampling
 *     back is a zero-order hold -- exactly how the real DAC reconstructs.
 */

const SNES_RATE = 32000
const BRR_BLOCK = 16
const ECHO_BUFFER_SIZE = 16384 // power of 2, covers ~512 ms of delay at 32 kHz
const ECHO_MASK = ECHO_BUFFER_SIZE - 1
const FIR_TAPS = 8

// Gaussian interpolation table from the S-DSP (Blargg / Anomie / no$sns references).
// 512 entries, used with 8-bit fractional pitch phase. Sum of the 4 taps ~= 2048.
// Precomputed as a typed array for fast integer multiplication in the hot loop.
// prettier-ignore
const GAUSS = new Int16Array([
  0x000, 0x000, 0x000, 0x000, 0x000, 0x000, 0x000, 0x000, 0x000, 0x000, 0x000, 0x000, 0x000, 0x000, 0x000, 0x000,
  0x001, 0x001, 0x001, 0x001, 0x001, 0x001, 0x001, 0x001, 0x001, 0x001, 0x001, 0x002, 0x002, 0x002, 0x002, 0x002,
  0x002, 0x002, 0x003, 0x003, 0x003, 0x003, 0x003, 0x004, 0x004, 0x004, 0x004, 0x004, 0x005, 0x005, 0x005, 0x005,
  0x006, 0x006, 0x006, 0x006, 0x007, 0x007, 0x007, 0x008, 0x008, 0x008, 0x009, 0x009, 0x009, 0x00A, 0x00A, 0x00A,
  0x00B, 0x00B, 0x00B, 0x00C, 0x00C, 0x00D, 0x00D, 0x00E, 0x00E, 0x00F, 0x00F, 0x00F, 0x010, 0x010, 0x011, 0x011,
  0x012, 0x013, 0x013, 0x014, 0x014, 0x015, 0x015, 0x016, 0x017, 0x017, 0x018, 0x018, 0x019, 0x01A, 0x01B, 0x01B,
  0x01C, 0x01D, 0x01D, 0x01E, 0x01F, 0x020, 0x020, 0x021, 0x022, 0x023, 0x024, 0x024, 0x025, 0x026, 0x027, 0x028,
  0x029, 0x02A, 0x02B, 0x02C, 0x02D, 0x02E, 0x02F, 0x030, 0x031, 0x032, 0x033, 0x034, 0x035, 0x036, 0x037, 0x038,
  0x03A, 0x03B, 0x03C, 0x03D, 0x03E, 0x040, 0x041, 0x042, 0x043, 0x045, 0x046, 0x047, 0x049, 0x04A, 0x04C, 0x04D,
  0x04E, 0x050, 0x051, 0x053, 0x054, 0x056, 0x057, 0x059, 0x05A, 0x05C, 0x05E, 0x05F, 0x061, 0x063, 0x064, 0x066,
  0x068, 0x06A, 0x06B, 0x06D, 0x06F, 0x071, 0x073, 0x075, 0x076, 0x078, 0x07A, 0x07C, 0x07E, 0x080, 0x082, 0x084,
  0x086, 0x089, 0x08B, 0x08D, 0x08F, 0x091, 0x093, 0x096, 0x098, 0x09A, 0x09C, 0x09F, 0x0A1, 0x0A3, 0x0A6, 0x0A8,
  0x0AB, 0x0AD, 0x0AF, 0x0B2, 0x0B4, 0x0B7, 0x0BA, 0x0BC, 0x0BF, 0x0C1, 0x0C4, 0x0C7, 0x0C9, 0x0CC, 0x0CF, 0x0D2,
  0x0D4, 0x0D7, 0x0DA, 0x0DD, 0x0E0, 0x0E3, 0x0E6, 0x0E9, 0x0EC, 0x0EF, 0x0F2, 0x0F5, 0x0F8, 0x0FB, 0x0FE, 0x101,
  0x104, 0x107, 0x10B, 0x10E, 0x111, 0x114, 0x118, 0x11B, 0x11E, 0x122, 0x125, 0x129, 0x12C, 0x130, 0x133, 0x137,
  0x13A, 0x13E, 0x141, 0x145, 0x148, 0x14C, 0x150, 0x153, 0x157, 0x15B, 0x15F, 0x162, 0x166, 0x16A, 0x16E, 0x172,
  0x176, 0x17A, 0x17D, 0x181, 0x185, 0x189, 0x18D, 0x191, 0x195, 0x19A, 0x19E, 0x1A2, 0x1A6, 0x1AA, 0x1AE, 0x1B2,
  0x1B7, 0x1BB, 0x1BF, 0x1C3, 0x1C8, 0x1CC, 0x1D0, 0x1D5, 0x1D9, 0x1DD, 0x1E2, 0x1E6, 0x1EB, 0x1EF, 0x1F3, 0x1F8,
  0x1FC, 0x201, 0x205, 0x20A, 0x20F, 0x213, 0x218, 0x21C, 0x221, 0x226, 0x22A, 0x22F, 0x233, 0x238, 0x23D, 0x241,
  0x246, 0x24B, 0x250, 0x254, 0x259, 0x25E, 0x263, 0x267, 0x26C, 0x271, 0x276, 0x27B, 0x280, 0x284, 0x289, 0x28E,
  0x293, 0x298, 0x29D, 0x2A2, 0x2A6, 0x2AB, 0x2B0, 0x2B5, 0x2BA, 0x2BF, 0x2C4, 0x2C9, 0x2CE, 0x2D3, 0x2D8, 0x2DC,
  0x2E1, 0x2E6, 0x2EB, 0x2F0, 0x2F5, 0x2FA, 0x2FF, 0x304, 0x309, 0x30E, 0x313, 0x318, 0x31D, 0x322, 0x326, 0x32B,
  0x330, 0x335, 0x33A, 0x33F, 0x344, 0x349, 0x34E, 0x353, 0x357, 0x35C, 0x361, 0x366, 0x36B, 0x370, 0x374, 0x379,
  0x37E, 0x383, 0x388, 0x38C, 0x391, 0x396, 0x39B, 0x39F, 0x3A4, 0x3A9, 0x3AD, 0x3B2, 0x3B7, 0x3BB, 0x3C0, 0x3C5,
  0x3C9, 0x3CE, 0x3D2, 0x3D7, 0x3DC, 0x3E0, 0x3E5, 0x3E9, 0x3ED, 0x3F2, 0x3F6, 0x3FB, 0x3FF, 0x403, 0x408, 0x40C,
  0x410, 0x415, 0x419, 0x41D, 0x421, 0x425, 0x42A, 0x42E, 0x432, 0x436, 0x43A, 0x43E, 0x442, 0x446, 0x44A, 0x44E,
  0x452, 0x455, 0x459, 0x45D, 0x461, 0x465, 0x468, 0x46C, 0x470, 0x473, 0x477, 0x47A, 0x47E, 0x481, 0x485, 0x488,
  0x48C, 0x48F, 0x492, 0x496, 0x499, 0x49C, 0x49F, 0x4A2, 0x4A6, 0x4A9, 0x4AC, 0x4AF, 0x4B2, 0x4B5, 0x4B7, 0x4BA,
  0x4BD, 0x4C0, 0x4C3, 0x4C5, 0x4C8, 0x4CB, 0x4CD, 0x4D0, 0x4D2, 0x4D5, 0x4D7, 0x4D9, 0x4DC, 0x4DE, 0x4E0, 0x4E3,
  0x4E5, 0x4E7, 0x4E9, 0x4EB, 0x4ED, 0x4EF, 0x4F1, 0x4F3, 0x4F5, 0x4F6, 0x4F8, 0x4FA, 0x4FB, 0x4FD, 0x4FF, 0x500,
  0x502, 0x503, 0x504, 0x506, 0x507, 0x508, 0x50A, 0x50B, 0x50C, 0x50D, 0x50E, 0x50F, 0x510, 0x511, 0x511, 0x512,
  0x513, 0x514, 0x514, 0x515, 0x516, 0x516, 0x517, 0x517, 0x517, 0x518, 0x518, 0x518, 0x518, 0x518, 0x519, 0x519,
])

// SNES FIR echo reset values (from kwes/Anomie). These produce a gentle lowpass
// echo -- the classic "F-Zero tunnel" sound. Coefficients are signed 8-bit and
// normalized by 128 at runtime.
const DEFAULT_FIR = new Int8Array([0x7F, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])

class SnesDspProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()

    const opts = (options && options.processorOptions) || {}

    // Phase accumulator for host-rate -> SNES-rate decimation.
    this._phase = 0
    this._phaseStep = SNES_RATE / sampleRate

    // 4-tap history per channel for Gaussian interpolation of the input signal.
    // We treat the incoming host-rate audio as the sample source and interpolate
    // at the SNES rate using the Gaussian kernel -- this is the same kernel the
    // S-DSP uses for pitch-shifted BRR playback, and is the biggest single
    // contributor to SNES timbre.
    this._histL = new Float32Array(4)
    this._histR = new Float32Array(4)

    // Zero-order hold output (DAC reconstruction) for frames between DSP ticks.
    this._heldL = 0
    this._heldR = 0

    // BRR block state. We collect 16 samples per channel, pick a shared shift,
    // quantize each to 4 bits, then decode back to produce the block's output.
    // A single shared index works because both channels tick together.
    this._brrIdx = 0
    this._brrInL = new Float32Array(BRR_BLOCK)
    this._brrInR = new Float32Array(BRR_BLOCK)
    this._brrOutL = new Float32Array(BRR_BLOCK)
    this._brrOutR = new Float32Array(BRR_BLOCK)

    // Echo buffers (stereo, at SNES rate). Power-of-two length for fast masking.
    this._echoL = new Float32Array(ECHO_BUFFER_SIZE)
    this._echoR = new Float32Array(ECHO_BUFFER_SIZE)
    this._echoIdx = 0
    this._echoDelay = 2048 // ~64 ms at 32 kHz, typical EDL=4 (each step = 16 ms)
    this._echoFeedback = 0.35
    this._echoMix = 0.22
    // Echo is off by default: with arbitrary synth waveforms it's easy to
    // overwhelm the dry signal. Users can enable it for the classic SNES
    // tunnel/reverb character.
    this._echoEnabled = !!opts.echoEnabled
    this._fir = new Int8Array(DEFAULT_FIR)

    // Feature toggles (all default on for the SNES mode, but the main thread
    // can tune or disable individual stages for A/B testing).
    this._gaussEnabled = opts.gaussEnabled !== false
    this._brrEnabled = opts.brrEnabled !== false
    this._clipEnabled = opts.clipEnabled !== false

    this.port.onmessage = (e) => this._onMessage(e.data)
  }

  _onMessage(msg) {
    if (!msg || typeof msg !== 'object') return
    switch (msg.type) {
      case 'echoDelay':
        // Clamp to a safe range; EDL 0..15 = 0..240 ms at 32 kHz.
        this._echoDelay = Math.max(1, Math.min(ECHO_BUFFER_SIZE - 1, msg.value | 0))
        break
      case 'echoFeedback':
        this._echoFeedback = Math.max(0, Math.min(0.95, +msg.value))
        break
      case 'echoMix':
        this._echoMix = Math.max(0, Math.min(1, +msg.value))
        break
      case 'echoEnabled':
        this._echoEnabled = !!msg.value
        break
      case 'gaussEnabled':
        this._gaussEnabled = !!msg.value
        break
      case 'brrEnabled':
        this._brrEnabled = !!msg.value
        break
      case 'clipEnabled':
        this._clipEnabled = !!msg.value
        break
      case 'fir':
        if (msg.value && msg.value.length === FIR_TAPS) {
          for (let i = 0; i < FIR_TAPS; i++) this._fir[i] = msg.value[i] | 0
        }
        break
    }
  }

  /**
   * Encode a 16-sample block of floats in [-1,1] into BRR and decode it back,
   * writing the decoded signal into `dst`. Uses shared-shift 4-bit quantization
   * with no predictor filter (BRR filter 0) -- clean enough to preserve the
   * synth signal while imposing BRR's characteristic block-level quantization.
   */
  _processBrrBlock(src, dst) {
    // Find peak magnitude in the block, pick smallest shift that keeps all
    // nibbles in signed 4-bit (-8..7) after scaling to 15-bit.
    let peak = 0
    for (let i = 0; i < BRR_BLOCK; i++) {
      const a = src[i] < 0 ? -src[i] : src[i]
      if (a > peak) peak = a
    }
    // Convert peak to a 15-bit integer range; find shift so peak >> shift <= 7.
    // peak*32767 is the nominal 16-bit magnitude; we target nibble range 7.
    let peakInt = (peak * 32767) | 0
    let shift = 0
    while ((peakInt >> shift) > 7 && shift < 12) shift++
    const scale = 1 << shift

    for (let i = 0; i < BRR_BLOCK; i++) {
      // Quantize: round(sample_int / scale) clipped to [-8, 7]
      let s = (src[i] * 32767) | 0
      let n = s >= 0 ? ((s + (scale >> 1)) / scale) | 0 : -(((-s + (scale >> 1)) / scale) | 0)
      if (n > 7) n = 7
      else if (n < -8) n = -8
      // Decode back: (nibble * scale) / 32767, which is the BRR output before
      // the predictor filter. This is an intentionally lossy round-trip.
      dst[i] = (n * scale) / 32767
    }
  }

  process(inputs, outputs) {
    const input = inputs[0]
    const output = outputs[0]
    if (!output || output.length === 0) return true

    const outL = output[0]
    const outR = output.length > 1 ? output[1] : outL
    const frames = outL.length

    // Graceful silence if upstream is disconnected. We still run the echo tail
    // so that released notes can decay naturally through the feedback network.
    const hasInput = input && input.length > 0 && input[0]
    const inL = hasInput ? input[0] : null
    const inR = hasInput && input.length > 1 ? input[1] : inL

    const gauss = GAUSS
    const histL = this._histL
    const histR = this._histR
    const brrInL = this._brrInL
    const brrInR = this._brrInR
    const brrOutL = this._brrOutL
    const brrOutR = this._brrOutR
    const echoL = this._echoL
    const echoR = this._echoR
    const fir = this._fir

    let phase = this._phase
    const phaseStep = this._phaseStep
    let heldL = this._heldL
    let heldR = this._heldR
    let brrIdx = this._brrIdx
    let echoIdx = this._echoIdx
    const echoDelay = this._echoDelay
    const echoFeedback = this._echoFeedback
    const echoMix = this._echoMix
    const echoEnabled = this._echoEnabled
    const gaussEnabled = this._gaussEnabled
    const brrEnabled = this._brrEnabled
    const clipEnabled = this._clipEnabled

    for (let i = 0; i < frames; i++) {
      const sL = inL ? inL[i] : 0
      const sR = inR ? inR[i] : 0

      // Advance phase. When it wraps past 1, produce a new DSP sample.
      // Using a while-loop handles the (rare) case where host-rate is below
      // 32 kHz, though in practice host >= 44.1 kHz so this runs 0 or 1 times.
      phase += phaseStep
      while (phase >= 1) {
        phase -= 1

        // Shift histories and insert newest input sample. The fractional
        // position used in the gaussian kernel is `phase` (0..1), mapped to
        // 0..255 because the kernel is indexed with 8 bits of fraction.
        histL[0] = histL[1]; histL[1] = histL[2]; histL[2] = histL[3]; histL[3] = sL
        histR[0] = histR[1]; histR[1] = histR[2]; histR[2] = histR[3]; histR[3] = sR

        let gL, gR
        if (gaussEnabled) {
          // 8-bit fractional phase in [0, 255]. The S-DSP's kernel is a
          // length-512 symmetric table; the 4 taps are:
          //   g[255-t], g[511-t], g[256+t], g[t]   (from Anomie's notes)
          const t = (phase * 256) | 0 // 0..255
          const c0 = gauss[255 - t]
          const c1 = gauss[511 - t]
          const c2 = gauss[256 + t]
          const c3 = gauss[t]
          // Sum is ~0x7FF, so divide by 2048. Using multiply to avoid div.
          const inv = 1 / 2048
          gL = (c0 * histL[0] + c1 * histL[1] + c2 * histL[2] + c3 * histL[3]) * inv
          gR = (c0 * histR[0] + c1 * histR[1] + c2 * histR[2] + c3 * histR[3]) * inv
        } else {
          gL = histL[3]
          gR = histR[3]
        }

        // BRR block quantization. We stream the interpolated signal into a
        // 16-sample input block and read out from the previously-processed
        // block in lockstep, which gives a single-block (~0.5 ms) latency.
        let vL, vR
        if (brrEnabled) {
          // Read previously-processed value at this position first; zeroed on
          // the very first block, which is an acceptable ~0.5 ms of silence.
          vL = brrOutL[brrIdx]
          vR = brrOutR[brrIdx]
          brrInL[brrIdx] = gL
          brrInR[brrIdx] = gR
          brrIdx++
          if (brrIdx === BRR_BLOCK) {
            this._processBrrBlock(brrInL, brrOutL)
            this._processBrrBlock(brrInR, brrOutR)
            brrIdx = 0
          }
        } else {
          vL = gL
          vR = gR
        }

        // Echo stage: 8-tap FIR over the echo buffer, fed back plus mixed in.
        if (echoEnabled) {
          let firL = 0
          let firR = 0
          // Read the delayed block of 8 samples ending at (echoIdx - echoDelay).
          const base = (echoIdx - echoDelay) & ECHO_MASK
          for (let k = 0; k < FIR_TAPS; k++) {
            const idx = (base + k) & ECHO_MASK
            const c = fir[k]
            firL += echoL[idx] * c
            firR += echoR[idx] * c
          }
          firL *= 1 / 128
          firR *= 1 / 128
          // Write current output + feedback into the echo buffer.
          echoL[echoIdx] = vL + firL * echoFeedback
          echoR[echoIdx] = vR + firR * echoFeedback
          echoIdx = (echoIdx + 1) & ECHO_MASK
          vL = vL + firL * echoMix
          vR = vR + firR * echoMix
        }

        // Final output stage: simulate the DSP's 16-bit signed saturation.
        if (clipEnabled) {
          if (vL > 1) vL = 1
          else if (vL < -1) vL = -1
          if (vR > 1) vR = 1
          else if (vR < -1) vR = -1
        }

        heldL = vL
        heldR = vR
      }

      // Zero-order hold -- this is exactly how the DAC holds each 32 kHz
      // sample for ~31 microseconds, creating the characteristic sinc aliasing
      // pattern that's audible on high notes.
      outL[i] = heldL
      outR[i] = heldR
    }

    this._phase = phase
    this._heldL = heldL
    this._heldR = heldR
    this._brrIdx = brrIdx
    this._echoIdx = echoIdx

    return true
  }
}

registerProcessor('snes-dsp', SnesDspProcessor)

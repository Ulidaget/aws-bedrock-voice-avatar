/**
 * Audio capture + playback helpers for Nova Sonic.
 *
 * Capture: getUserMedia -> AudioContext -> ScriptProcessor -> downsample to
 * 16 kHz mono PCM16 -> callback with ArrayBuffer chunks.
 *
 * Playback: queue of 24 kHz mono PCM16 chunks played gap-free. Exposes the
 * current output amplitude so the avatar can lip-sync.
 */

function floatTo16BitPCM(input: Float32Array): ArrayBuffer {
  const out = new DataView(new ArrayBuffer(input.length * 2));
  for (let i = 0; i < input.length; i++) {
    let s = Math.max(-1, Math.min(1, input[i]));
    out.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return out.buffer;
}

function downsample(buffer: Float32Array, inRate: number, outRate: number): Float32Array {
  if (outRate === inRate) return buffer;
  const ratio = inRate / outRate;
  const newLen = Math.round(buffer.length / ratio);
  const result = new Float32Array(newLen);
  let offsetResult = 0;
  let offsetBuffer = 0;
  while (offsetResult < newLen) {
    const nextOffset = Math.round((offsetResult + 1) * ratio);
    let accum = 0;
    let count = 0;
    for (let i = offsetBuffer; i < nextOffset && i < buffer.length; i++) {
      accum += buffer[i];
      count++;
    }
    result[offsetResult] = count > 0 ? accum / count : 0;
    offsetResult++;
    offsetBuffer = nextOffset;
  }
  return result;
}

export class AudioCapture {
  private ctx?: AudioContext;
  private stream?: MediaStream;
  private source?: MediaStreamAudioSourceNode;
  private processor?: ScriptProcessorNode;

  constructor(private targetRate: number, private onChunk: (pcm: ArrayBuffer) => void) {}

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
    });
    this.ctx = new AudioContext();
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.processor = this.ctx.createScriptProcessor(4096, 1, 1);
    this.processor.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      const down = downsample(input, this.ctx!.sampleRate, this.targetRate);
      this.onChunk(floatTo16BitPCM(down));
    };
    this.source.connect(this.processor);
    this.processor.connect(this.ctx.destination);
  }

  stop(): void {
    this.processor?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close();
    this.processor = undefined;
    this.source = undefined;
    this.stream = undefined;
    this.ctx = undefined;
  }
}

export class AudioPlayer {
  private ctx: AudioContext;
  private nextStartTime = 0;
  private analyser?: AnalyserNode;
  private gain: GainNode;
  // All currently scheduled / playing sources, so flush() can truly stop them.
  private sources = new Set<AudioBufferSourceNode>();

  constructor(private sampleRate: number) {
    this.ctx = new AudioContext({ sampleRate });
    this.gain = this.ctx.createGain();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.gain.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
  }

  /** Enqueue a 24 kHz mono PCM16 chunk for gap-free playback. */
  enqueue(pcm: ArrayBuffer): void {
    const view = new DataView(pcm);
    const frames = pcm.byteLength / 2;
    const buffer = this.ctx.createBuffer(1, frames, this.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) {
      channel[i] = view.getInt16(i * 2, true) / 0x8000;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.gain);
    const now = this.ctx.currentTime;
    const startAt = Math.max(now, this.nextStartTime);
    src.start(startAt);
    this.nextStartTime = startAt + buffer.duration;

    // Track the source and drop it from the set when it finishes on its own.
    this.sources.add(src);
    src.onended = () => this.sources.delete(src);
  }

  /**
   * Stop ALL playback immediately (barge-in / turn change).
   *
   * Bajar el volumen no basta: las AudioBufferSourceNode ya agendadas siguen
   * sonando. Hay que detenerlas de verdad y descartarlas para no solapar el
   * audio viejo con el nuevo (dos voces a la vez).
   */
  flush(): void {
    this.nextStartTime = 0;
    for (const src of this.sources) {
      try {
        src.onended = null;
        src.stop();
        src.disconnect();
      } catch {
        /* already stopped */
      }
    }
    this.sources.clear();
    // Reset gain in case a previous fade left it low.
    this.gain.gain.cancelScheduledValues(this.ctx.currentTime);
    this.gain.gain.setValueAtTime(1, this.ctx.currentTime);
  }

  /** Current output amplitude 0..1 for avatar lip-sync. */
  amplitude(): number {
    if (!this.analyser) return 0;
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128;
      sum += v * v;
    }
    return Math.min(1, Math.sqrt(sum / data.length) * 3);
  }

  async resume(): Promise<void> {
    if (this.ctx.state === "suspended") await this.ctx.resume();
  }
}

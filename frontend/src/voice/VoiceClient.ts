/**
 * VoiceClient — the frontend voice engine.
 *
 * Owns the WebSocket to the backend proxy, the mic capture, and the audio
 * playback. Drives the 6-state machine and exposes callbacks the UI + avatar
 * subscribe to. This is the frontend counterpart to the backend VoiceProvider
 * seam: swap the transport here without touching UI or avatar code.
 */
import { config, VoiceStateName } from "../config";
import { AudioCapture, AudioPlayer } from "./audio";

export interface VoiceClientCallbacks {
  onState: (state: VoiceStateName) => void;
  onTranscript: (role: string, text: string) => void;
  onError: (message: string) => void;
  onAmplitude: (amp: number) => void;
}

export class VoiceClient {
  private ws?: WebSocket;
  private capture?: AudioCapture;
  private player: AudioPlayer;
  private state: VoiceStateName = "IDLE";
  private ampTimer?: number;

  constructor(private cbs: VoiceClientCallbacks, private getToken: () => string | null) {
    this.player = new AudioPlayer(config.outputSampleRate);
  }

  get currentState(): VoiceStateName {
    return this.state;
  }

  async connect(agentId?: string, voiceId?: string): Promise<void> {
    // Guard against opening a second session (e.g. double-invoked effects or
    // a double click). Only connect when there is no live socket.
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }
    await this.player.resume();
    const token = this.getToken();
    const url =
      config.authDisabled || !token
        ? config.wssEndpoint
        : `${config.wssEndpoint}?token=${encodeURIComponent(token)}`;

    this.ws = new WebSocket(url);
    this.ws.binaryType = "arraybuffer";

    this.ws.onopen = () => {
      // C1: tell the backend which agent to run. Omitted -> backend uses default.
      // C10-B: optional voiceId overrides the agent's voice for this session.
      const start: Record<string, unknown> = {
        type: "start",
        agentId: agentId ?? config.defaultAgentId,
      };
      if (voiceId) start.voiceId = voiceId;
      this.send(start);
      this.startCapture();
      this.startAmplitudeLoop();
    };
    this.ws.onmessage = (ev) => this.onMessage(ev);
    this.ws.onerror = () => this.cbs.onError("WebSocket error");
    this.ws.onclose = (ev) => {
      if (ev.code === 4401) this.cbs.onError("Unauthorized (invalid session token)");
      this.setState("IDLE");
      this.teardown();
    };
  }

  interrupt(): void {
    this.player.flush();
    this.send({ type: "interrupt" });
  }

  sendText(text: string): void {
    this.send({ type: "text", text });
  }

  async disconnect(): Promise<void> {
    this.send({ type: "stop" });
    this.teardown();
    this.setState("IDLE");
  }

  // -- internals ---------------------------------------------------------
  private async startCapture(): Promise<void> {
    this.capture = new AudioCapture(config.inputSampleRate, (pcm) => {
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(pcm);
    });
    try {
      await this.capture.start();
    } catch {
      this.cbs.onError("Microphone permission denied");
      this.setState("ERROR");
    }
  }

  private startAmplitudeLoop(): void {
    const tick = () => {
      const amp = this.state === "SPEAKING" ? this.player.amplitude() : 0;
      this.cbs.onAmplitude(amp);
      this.ampTimer = window.requestAnimationFrame(tick);
    };
    this.ampTimer = window.requestAnimationFrame(tick);
  }

  private onMessage(ev: MessageEvent): void {
    if (ev.data instanceof ArrayBuffer) {
      this.player.enqueue(ev.data);
      return;
    }
    try {
      const msg = JSON.parse(ev.data as string);
      if (msg.type === "state") {
        const next = msg.state as VoiceStateName;
        // Only flush queued audio on a REAL barge-in (INTERRUPTED). Do NOT flush
        // on SPEAKING->LISTENING: the model splits one reply into several audio
        // blocks and briefly returns to LISTENING between them, so flushing
        // there would cut the assistant off after a few words.
        if (next === "INTERRUPTED") {
          this.player.flush();
        }
        this.setState(next);
      } else if (msg.type === "transcript") {
        this.cbs.onTranscript(msg.role, msg.text);
      } else if (msg.type === "error") {
        this.cbs.onError(msg.message);
      }
    } catch {
      /* ignore malformed */
    }
  }

  private setState(state: VoiceStateName): void {
    this.state = state;
    this.cbs.onState(state);
  }

  private send(obj: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  private teardown(): void {
    this.capture?.stop();
    this.capture = undefined;
    if (this.ampTimer) cancelAnimationFrame(this.ampTimer);
    this.ampTimer = undefined;
    this.ws = undefined;
  }
}

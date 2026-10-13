/**
 * AvatarController — the replaceable avatar seam.
 *
 * Any avatar implementation (WebGL/Three.js today, a managed video provider
 * later) implements this interface. It consumes ONLY voice-state events and an
 * output-audio amplitude, so it stays decoupled from the voice engine.
 */
import { VoiceStateName } from "../config";

export interface AvatarController {
  mount(container: HTMLElement): void;
  setState(state: VoiceStateName): void;
  /** amplitude 0..1 of the current output audio, for lip-sync while SPEAKING */
  setAmplitude(amp: number): void;
  dispose(): void;
}

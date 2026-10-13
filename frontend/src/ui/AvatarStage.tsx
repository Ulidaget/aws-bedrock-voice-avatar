import { useEffect, useRef } from "react";
import { VoiceStateName } from "../config";
import { WebGLAvatar } from "../avatar/WebGLAvatar";
import { AvatarController } from "../avatar/AvatarController";

interface Props {
  state: VoiceStateName;
  amplitude: number;
}

export function AvatarStage({ state, amplitude }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<AvatarController | null>(null);

  useEffect(() => {
    const controller = new WebGLAvatar();
    controllerRef.current = controller;
    if (containerRef.current) controller.mount(containerRef.current);
    return () => controller.dispose();
  }, []);

  useEffect(() => {
    controllerRef.current?.setState(state);
  }, [state]);

  useEffect(() => {
    controllerRef.current?.setAmplitude(amplitude);
  }, [amplitude]);

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: 360, borderRadius: 16, overflow: "hidden" }}
    />
  );
}

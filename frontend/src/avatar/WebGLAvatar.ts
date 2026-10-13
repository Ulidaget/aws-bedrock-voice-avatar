/**
 * WebGLAvatar — a friendly, expressive Three.js procedural avatar for Phase 0.
 *
 * A rounded, approachable character head with:
 *  - soft 3-point lighting (key + fill + rim) for a warm look
 *  - eyes with iris + highlight that actually blink
 *  - eyebrows that shift with the voice state (attentive, thinking, surprised…)
 *  - lips that open with output-audio amplitude (lip-sync) while SPEAKING
 *  - a soft glowing aura behind the head that reflects the current state
 *
 * The mouth openness is driven by the output-audio amplitude while SPEAKING so
 * it stays decoupled from the voice provider. Swap this for a Ready Player Me
 * GLB or a managed provider behind AvatarController without touching voice code.
 */
import * as THREE from "three";
import { VoiceStateName } from "../config";
import { AvatarController } from "./AvatarController";

const STATE_COLORS: Record<VoiceStateName, number> = {
  IDLE: 0x8b93a7,
  LISTENING: 0x22c55e,
  PROCESSING: 0xf59e0b,
  SPEAKING: 0x3b82f6,
  INTERRUPTED: 0xef4444,
  ERROR: 0xdc2626,
};

export class WebGLAvatar implements AvatarController {
  private renderer?: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera?: THREE.PerspectiveCamera;

  private root = new THREE.Group();
  private head?: THREE.Mesh;
  private leftEye = new THREE.Group();
  private rightEye = new THREE.Group();
  private leftLid?: THREE.Mesh;
  private rightLid?: THREE.Mesh;
  private leftBrow?: THREE.Mesh;
  private rightBrow?: THREE.Mesh;
  private mouth?: THREE.Mesh;
  private aura?: THREE.Mesh;
  private auraMat?: THREE.MeshBasicMaterial;

  private state: VoiceStateName = "IDLE";
  private amplitude = 0;
  private raf?: number;
  private clock = new THREE.Clock();

  // Blink timing
  private nextBlink = 2 + Math.random() * 3;
  private blinkT = -1;
  // Smoothed mouth openness
  private mouthOpen = 0.05;

  mount(container: HTMLElement): void {
    const width = container.clientWidth || 360;
    const height = container.clientHeight || 360;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 100);
    this.camera.position.set(0, 0.05, 4.2);

    // --- Lighting: soft 3-point ---
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 1.0);
    key.position.set(2.5, 3, 4);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xbcd4ff, 0.35);
    fill.position.set(-3, 0, 2);
    this.scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffe0b0, 0.5);
    rim.position.set(0, 2, -4);
    this.scene.add(rim);

    this.scene.add(this.root);

    // --- Head: slightly squashed sphere for a friendly, rounded look ---
    const headMat = new THREE.MeshStandardMaterial({
      color: 0xffd9b8,
      roughness: 0.75,
      metalness: 0.0,
    });
    this.head = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 64), headMat);
    this.head.scale.set(1.0, 0.96, 0.92);
    this.root.add(this.head);

    // Cheeks (soft blush) for warmth
    const cheekMat = new THREE.MeshStandardMaterial({
      color: 0xff9d8a,
      roughness: 0.9,
      transparent: true,
      opacity: 0.35,
    });
    const cheekGeo = new THREE.CircleGeometry(0.16, 24);
    const lCheek = new THREE.Mesh(cheekGeo, cheekMat);
    lCheek.position.set(-0.45, -0.12, 0.86);
    lCheek.rotation.y = -0.35;
    const rCheek = new THREE.Mesh(cheekGeo, cheekMat);
    rCheek.position.set(0.45, -0.12, 0.86);
    rCheek.rotation.y = 0.35;
    this.head.add(lCheek, rCheek);

    // --- Eyes: white + iris + highlight, grouped so they can blink & move ---
    const buildEye = (group: THREE.Group, x: number) => {
      const whiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
      const white = new THREE.Mesh(new THREE.SphereGeometry(0.17, 32, 32), whiteMat);
      white.scale.set(1, 1.15, 0.6);
      group.add(white);

      const iris = new THREE.Mesh(
        new THREE.SphereGeometry(0.09, 24, 24),
        new THREE.MeshStandardMaterial({ color: 0x5b3a29, roughness: 0.25 })
      );
      iris.position.z = 0.11;
      group.add(iris);

      const pupil = new THREE.Mesh(
        new THREE.SphereGeometry(0.045, 16, 16),
        new THREE.MeshBasicMaterial({ color: 0x100a08 })
      );
      pupil.position.z = 0.16;
      group.add(pupil);

      const glint = new THREE.Mesh(
        new THREE.SphereGeometry(0.02, 12, 12),
        new THREE.MeshBasicMaterial({ color: 0xffffff })
      );
      glint.position.set(0.03, 0.04, 0.18);
      group.add(glint);

      // Upper lid (a thin flattened sphere that drops down to blink)
      const lid = new THREE.Mesh(
        new THREE.SphereGeometry(0.185, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: 0xffd9b8, roughness: 0.75 })
      );
      lid.scale.set(1, 1.2, 0.65);
      lid.position.y = 0.19; // parked up (open) by default
      group.add(lid);

      group.position.set(x, 0.22, 0.82);
      this.head!.add(group);
      return lid;
    };
    this.leftLid = buildEye(this.leftEye, -0.36);
    this.rightLid = buildEye(this.rightEye, 0.36);

    // --- Eyebrows ---
    const browMat = new THREE.MeshStandardMaterial({ color: 0x6b4a34, roughness: 0.8 });
    const browGeo = new THREE.CapsuleGeometry(0.035, 0.22, 4, 8);
    this.leftBrow = new THREE.Mesh(browGeo, browMat);
    this.leftBrow.rotation.z = Math.PI / 2;
    this.leftBrow.position.set(-0.36, 0.5, 0.84);
    this.rightBrow = new THREE.Mesh(browGeo, browMat);
    this.rightBrow.rotation.z = Math.PI / 2;
    this.rightBrow.position.set(0.36, 0.5, 0.84);
    this.head.add(this.leftBrow, this.rightBrow);

    // --- Mouth: a rounded torus arc that scales for lip-sync ---
    this.mouth = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 32, 24),
      new THREE.MeshStandardMaterial({ color: 0x9b3b3b, roughness: 0.6 })
    );
    this.mouth.scale.set(1.1, 0.18, 0.5);
    this.mouth.position.set(0, -0.42, 0.86);
    this.head.add(this.mouth);

    // --- State aura: soft glowing disc behind the head ---
    this.auraMat = new THREE.MeshBasicMaterial({
      color: STATE_COLORS.IDLE,
      transparent: true,
      opacity: 0.22,
    });
    this.aura = new THREE.Mesh(new THREE.CircleGeometry(1.7, 64), this.auraMat);
    this.aura.position.z = -0.9;
    this.scene.add(this.aura);

    window.addEventListener("resize", this.onResize);
    this.animate();
  }

  setState(state: VoiceStateName): void {
    this.state = state;
    if (this.auraMat) this.auraMat.color.setHex(STATE_COLORS[state]);
  }

  setAmplitude(amp: number): void {
    this.amplitude = amp;
  }

  dispose(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.onResize);
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
  }

  private onResize = () => {
    if (!this.renderer || !this.camera) return;
    const el = this.renderer.domElement.parentElement;
    if (!el) return;
    const w = el.clientWidth;
    const h = el.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  private animate = () => {
    this.raf = requestAnimationFrame(this.animate);
    const t = this.clock.getElapsedTime();
    const dt = Math.min(this.clock.getDelta(), 0.05);

    // --- Head: gentle idle breathing + per-state motion ---
    if (this.head) {
      this.root.rotation.y = Math.sin(t * 0.5) * 0.1;
      this.root.position.y = Math.sin(t * 1.1) * 0.015;
      this.root.rotation.x = 0;
      this.root.rotation.z = 0;

      if (this.state === "LISTENING") {
        this.root.rotation.x = Math.sin(t * 1.8) * 0.05; // attentive nods
      } else if (this.state === "PROCESSING") {
        this.root.rotation.z = Math.sin(t * 2.5) * 0.07; // curious tilt
      } else if (this.state === "INTERRUPTED" || this.state === "ERROR") {
        this.root.position.x = Math.sin(t * 30) * 0.01; // tiny shake
      } else {
        this.root.position.x = 0;
      }
    }

    // --- Blink ---
    if (this.blinkT < 0 && t > this.nextBlink) {
      this.blinkT = 0;
      this.nextBlink = t + 2.5 + Math.random() * 3.5;
    }
    let lid = 0; // 0 = open, 1 = closed
    if (this.blinkT >= 0) {
      this.blinkT += dt;
      const dur = 0.16;
      const p = this.blinkT / dur;
      lid = p < 0.5 ? p * 2 : Math.max(0, 2 - p * 2);
      if (this.blinkT > dur) this.blinkT = -1;
    }
    if (this.leftLid && this.rightLid) {
      // lower the lid from its parked-up position (0.19) down over the eye
      const y = 0.19 - lid * 0.22;
      this.leftLid.position.y = y;
      this.rightLid.position.y = y;
    }

    // --- Eyebrows react to state ---
    if (this.leftBrow && this.rightBrow) {
      let browY = 0.5;
      let browTilt = 0;
      if (this.state === "PROCESSING") {
        browY = 0.52 + Math.sin(t * 4) * 0.02; // thinking, slightly raised & moving
        browTilt = 0.12;
      } else if (this.state === "SPEAKING") {
        browY = 0.53; // lively
      } else if (this.state === "INTERRUPTED" || this.state === "ERROR") {
        browY = 0.47;
        browTilt = -0.2; // frown
      } else if (this.state === "LISTENING") {
        browY = 0.54; // attentive, raised
      }
      this.leftBrow.position.y = browY;
      this.rightBrow.position.y = browY;
      this.leftBrow.rotation.x = -browTilt;
      this.rightBrow.rotation.x = browTilt;
    }

    // --- Mouth lip-sync (smoothed) ---
    if (this.mouth) {
      const target =
        this.state === "SPEAKING"
          ? 0.18 + this.amplitude * 1.6
          : this.state === "PROCESSING"
          ? 0.14
          : 0.12; // gentle closed smile otherwise
      // smooth toward target so it doesn't jitter
      this.mouthOpen += (target - this.mouthOpen) * Math.min(1, dt * 18);
      this.mouth.scale.y = this.mouthOpen;
      // widen a touch while speaking
      this.mouth.scale.x = 1.1 + (this.state === "SPEAKING" ? this.amplitude * 0.25 : 0);
    }

    // --- Aura pulse ---
    if (this.aura && this.auraMat) {
      const base =
        this.state === "IDLE" ? 0.16 : this.state === "SPEAKING" ? 0.3 : 0.24;
      const pulse =
        this.state === "PROCESSING"
          ? Math.sin(t * 5) * 0.06
          : this.state === "SPEAKING"
          ? this.amplitude * 0.15
          : Math.sin(t * 1.5) * 0.03;
      this.auraMat.opacity = base + pulse;
      const s = 1 + (this.state === "SPEAKING" ? this.amplitude * 0.08 : 0);
      this.aura.scale.set(s, s, 1);
    }

    if (this.renderer && this.camera) this.renderer.render(this.scene, this.camera);
  };
}

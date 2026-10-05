// Sound design adapted from Meowdes Refs / ui-synth-sounds. Generated locally with Web Audio.
type Sound = "soft" | "copy" | "success" | "error" | "on" | "off";
let ctx: AudioContext | undefined,
  master: GainNode | undefined,
  enabled = true,
  volume = 0.2;
const last = new Map<Sound, number>();
const active = new Set<AudioScheduledSourceNode>();
export function configureSound(on: boolean, level: number) {
  enabled = on;
  volume = level;
  if (master && ctx) {
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setTargetAtTime(on ? level : 0, ctx.currentTime, 0.008);
  }
  if (!on) {
    for (const source of active) {
      try {
        source.stop();
      } catch {}
    }
    active.clear();
  }
}
export function unlockSound() {
  try {
    if (!ctx) {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = enabled ? volume : 0;
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
  } catch {}
}
export function playSound(kind: Sound) {
  if (!enabled || volume === 0 || !ctx || ctx.state !== "running" || !master)
    return;
  const now = performance.now();
  if (now - (last.get(kind) || -Infinity) < (kind === "success" ? 1000 : 120))
    return;
  last.set(kind, now);
  const audio = ctx,
    output = master;
  function tone(
    start: number,
    end: number,
    delay: number,
    duration: number,
    gain: number,
    type: OscillatorType = "sine",
  ) {
    const osc = audio.createOscillator(),
      env = audio.createGain(),
      at = audio.currentTime + delay;
    osc.type = type;
    osc.frequency.setValueAtTime(start, at);
    osc.frequency.exponentialRampToValueAtTime(end, at + duration);
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(gain, at + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    osc.connect(env);
    env.connect(output);
    osc.start(at);
    osc.stop(at + duration + 0.02);
    active.add(osc);
    osc.onended = () => {
      active.delete(osc);
      osc.disconnect();
      env.disconnect();
    };
  }
  try {
    if (kind === "soft") tone(760, 580, 0, 0.068, 0.26);
    if (kind === "copy") {
      tone(900, 700, 0, 0.035, 0.15);
      tone(1150, 880, 0.055, 0.035, 0.12);
    }
    if (kind === "success")
      [523.25, 659.25, 783.99].forEach((f, i) =>
        tone(f, f, i * 0.065, 0.13, 0.14),
      );
    if (kind === "error") tone(160, 110, 0, 0.12, 0.11, "triangle");
    if (kind === "on") {
      tone(520, 520, 0, 0.055, 0.2);
      tone(760, 760, 0.035, 0.06, 0.2);
    }
    if (kind === "off") {
      tone(620, 620, 0, 0.055, 0.2);
      tone(410, 410, 0.035, 0.06, 0.2);
    }
  } catch {}
}

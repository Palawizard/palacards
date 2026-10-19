"use client";

import { useSyncExternalStore } from "react";

/**
 * Bruitages du jeu, synthétisés à la volée avec Web Audio : aucun fichier à charger ni licence à
 * suivre, et chaque son reste accordé au reste (même gamme, même « papier » que l'album).
 *
 * Le contexte audio naît au premier geste du joueur (règle des navigateurs). Le son est activé par
 * défaut, à volume doux ; le choix (activé, volume) est retenu sur l'appareil.
 */
export type Sfx =
  | "tear"
  | "deal"
  | "flip"
  | "sr"
  | "ur"
  | "l"
  | "shiny"
  | "coin"
  | "achievement"
  | "correct"
  | "wrong"
  | "victory"
  | "defeat";

const STORAGE_KEY = "palacards:sfx";
const VOLUME_KEY = "palacards:sfx-volume";
/** Gain de sortie à 100 % : le volume d'origine du jeu, que le curseur ne fait que baisser. */
const MASTER_VOLUME = 0.32;
/** Volume par défaut, en pourcentage (100 = volume d'origine). */
export const DEFAULT_SFX_VOLUME = 100;

// --- Réglage (activé / coupé, volume), partagé entre composants -------------------------------

const listeners = new Set<() => void>();
let enabledCache: boolean | null = null;
let volumeCache: number | null = null;

function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // stockage indisponible (navigation privée) : le réglage vaut pour la session
  }
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function readEnabled(): boolean {
  if (enabledCache !== null) return enabledCache;
  try {
    enabledCache = localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    enabledCache = true;
  }
  return enabledCache;
}

/** Ramène une valeur quelconque à un pourcentage entier entre 0 et 100. */
export function clampVolume(v: number): number {
  return Number.isFinite(v) ? Math.min(100, Math.max(0, Math.round(v))) : DEFAULT_SFX_VOLUME;
}

function readVolume(): number {
  if (volumeCache !== null) return volumeCache;
  try {
    const raw = localStorage.getItem(VOLUME_KEY);
    volumeCache = raw === null ? DEFAULT_SFX_VOLUME : clampVolume(Number(raw));
  } catch {
    volumeCache = DEFAULT_SFX_VOLUME;
  }
  return volumeCache;
}

/** Son réellement audible : activé et volume au-dessus de 0 %. */
function readAudible(): boolean {
  return readEnabled() && readVolume() > 0;
}

/** Gain de sortie pour un pourcentage : courbe quadratique, plus proche de l'oreille qu'une droite. */
function gainFor(volume: number): number {
  return MASTER_VOLUME * (volume / 100) ** 2;
}

export function setSfxEnabled(on: boolean) {
  enabledCache = on;
  store(STORAGE_KEY, on ? "on" : "off");
  // Réactiver depuis un curseur à 0 % : on repart du volume par défaut, sinon rien ne s'entendrait.
  if (on && readVolume() === 0) setVolume(DEFAULT_SFX_VOLUME);
  listeners.forEach((l) => l());
  if (on) play("coin");
}

function setVolume(volume: number) {
  volumeCache = volume;
  store(VOLUME_KEY, String(volume));
  if (master) master.gain.value = gainFor(volume);
}

/**
 * Règle le volume (0 à 100 %), appliqué tout de suite aux sons suivants. Monter le curseur alors que
 * le son est coupé le réactive : le curseur et le bouton de son disent toujours la même chose.
 */
export function setSfxVolume(volume: number) {
  const v = clampVolume(volume);
  setVolume(v);
  if (v > 0 && !readEnabled()) {
    enabledCache = true;
    store(STORAGE_KEY, "on");
  }
  listeners.forEach((l) => l());
}

/** Son audible (activé et volume au-dessus de 0 %) : c'est ce qu'affiche le bouton de son. */
export function useSfxEnabled(): boolean {
  return useSyncExternalStore(subscribe, readAudible, () => true);
}

/** Volume réglé, en pourcentage. */
export function useSfxVolume(): number {
  return useSyncExternalStore(subscribe, readVolume, () => DEFAULT_SFX_VOLUME);
}

// --- Moteur ---------------------------------------------------------------------------------

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
const noiseByContext = new WeakMap<BaseAudioContext, AudioBuffer>();

/** Une seconde de bruit blanc, générée une fois par contexte audio. */
function noiseOf(c: BaseAudioContext): AudioBuffer {
  let buf = noiseByContext.get(c);
  if (!buf) {
    buf = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noiseByContext.set(c, buf);
  }
  return buf;
}

function engine(): { ctx: AudioContext; out: GainNode } | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor({ latencyHint: "interactive" });
    // Compresseur doux en sortie : les accords des grosses raretés ne saturent jamais.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    master = ctx.createGain();
    master.gain.value = gainFor(readVolume());
    master.connect(comp).connect(ctx.destination);
  }
  // « suspended » avant le premier geste, « interrupted » sur iOS après un appel ou un retour
  // d'arrière-plan : dans les deux cas, on relance.
  if (ctx.state !== "running") void ctx.resume().catch(() => {});
  return { ctx, out: master! };
}

/**
 * Sur iPhone, le mode silencieux coupe aussi les sons du jeu (comportement normal d'iOS, et la
 * musique du joueur continue). À `true`, le jeu sonne malgré le mode silencieux, mais met en pause
 * la musique en cours (Safari 17 et plus).
 */
const IGNORE_IOS_SILENT_MODE = false;

/**
 * Évènements qu'un navigateur accepte comme geste pour lancer l'audio. Au doigt, seul le relâché
 * compte (`pointerup`, `touchend`) : `pointerdown` ne suffit qu'à la souris.
 */
const GESTURES = ["pointerdown", "pointerup", "touchend", "click", "keydown"] as const;

/** Démarre (ou relance) l'audio pendant un geste du joueur, si le son est activé. */
function wakeAudio() {
  if (!readAudible() || ctx?.state === "running") return;
  if (IGNORE_IOS_SILENT_MODE) {
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    if (session) session.type = "playback";
  }
  const e = engine();
  if (!e) return;
  // Anciennes versions d'iOS : un son muet joué pendant le geste ouvre la sortie pour de bon.
  try {
    const src = e.ctx.createBufferSource();
    src.buffer = e.ctx.createBuffer(1, 1, e.ctx.sampleRate);
    src.connect(e.ctx.destination);
    src.start();
  } catch {
    // sans conséquence : le resume() suffit sur les navigateurs récents
  }
}

/**
 * Débloque l'audio au geste du joueur (iOS exige un démarrage dans un gestionnaire d'événement).
 * Les écouteurs restent en place : iOS suspend l'audio en arrière-plan ou pendant un appel, et
 * seul un nouveau geste le relance. Tant que l'audio tourne, ils ne font rien. Renvoie de quoi
 * retirer les écouteurs.
 */
export function unlockAudioOnGestures(): () => void {
  if (typeof window === "undefined") return () => {};
  const opts = { capture: true, passive: true };
  for (const type of GESTURES) window.addEventListener(type, wakeAudio, opts);
  return () => {
    for (const type of GESTURES) window.removeEventListener(type, wakeAudio, opts);
  };
}

/** Appareil iOS (iPhone, iPad, y compris l'iPad qui se présente comme un Mac). */
export function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

type Env = { a?: number; d: number; peak?: number };

/** Note simple (oscillateur + enveloppe percussive). */
function tone(
  c: BaseAudioContext,
  out: AudioNode,
  t: number,
  freq: number,
  { a = 0.004, d, peak = 0.5 }: Env,
  type: OscillatorType = "sine",
  glideTo?: number,
) {
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t + a + d);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + a + d + 0.05);
}

/** Cloche FM : porteuse + modulatrice non harmonique, timbre de carillon. */
function bell(c: BaseAudioContext, out: AudioNode, t: number, freq: number, d: number, peak = 0.35) {
  const car = c.createOscillator();
  const mod = c.createOscillator();
  const modGain = c.createGain();
  const g = c.createGain();
  car.frequency.value = freq;
  mod.frequency.value = freq * 3.5;
  modGain.gain.setValueAtTime(freq * 2.2, t);
  modGain.gain.exponentialRampToValueAtTime(freq * 0.05, t + d);
  mod.connect(modGain).connect(car.frequency);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  car.connect(g).connect(out);
  car.start(t);
  mod.start(t);
  car.stop(t + d + 0.05);
  mod.stop(t + d + 0.05);
}

/** Souffle de bruit filtré (papier, frottement, impact). */
function hiss(
  c: BaseAudioContext,
  out: AudioNode,
  t: number,
  { d, peak = 0.4, a = 0.003 }: Env,
  filter: { type: BiquadFilterType; from: number; to?: number; q?: number },
) {
  const src = c.createBufferSource();
  src.buffer = noiseOf(c);
  src.loopStart = Math.random() * 0.5;
  src.loop = true;
  const f = c.createBiquadFilter();
  f.type = filter.type;
  f.Q.value = filter.q ?? 0.8;
  f.frequency.setValueAtTime(filter.from, t);
  if (filter.to) f.frequency.exponentialRampToValueAtTime(filter.to, t + a + d);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  src.connect(f).connect(g).connect(out);
  src.start(t, Math.random() * 0.5);
  src.stop(t + a + d + 0.05);
}

const NOTE = (semitonesFromA4: number) => 440 * 2 ** (semitonesFromA4 / 12);
// Gamme de do majeur autour de do5 : tous les jingles s'y accordent.
const C5 = NOTE(3);
const E5 = NOTE(7);
const G5 = NOTE(10);
const A5 = NOTE(12);
const B5 = NOTE(14);
const C6 = NOTE(15);
const E6 = NOTE(19);
const G6 = NOTE(22);
const B6 = NOTE(26);
const C7 = NOTE(27);

type Recipe = (c: BaseAudioContext, out: AudioNode, t: number) => void;

const RECIPES: Record<Sfx, Recipe> = {
  // Pochette alu déchirée : crépitements serrés qui montent dans l'aigu.
  tear(c, out, t) {
    for (let i = 0; i < 9; i++) {
      const at = t + i * 0.028 + Math.random() * 0.012;
      hiss(
        c,
        out,
        at,
        { d: 0.035 + Math.random() * 0.03, peak: 0.22 + Math.random() * 0.2 },
        {
          type: "bandpass",
          from: 1800 + i * 380,
          q: 2.5,
        },
      );
    }
    hiss(c, out, t, { d: 0.32, peak: 0.12 }, { type: "highpass", from: 2500, to: 6000 });
  },
  // Carte qui glisse sur la table.
  deal(c, out, t) {
    hiss(c, out, t, { a: 0.012, d: 0.13, peak: 0.7 }, { type: "bandpass", from: 3200, to: 900, q: 1.1 });
  },
  // Retournement : claquement sec du carton, petit corps grave.
  flip(c, out, t) {
    hiss(c, out, t, { a: 0.001, d: 0.045, peak: 0.45 }, { type: "highpass", from: 2200 });
    tone(c, out, t, 210, { a: 0.002, d: 0.06, peak: 0.25 }, "sine", 110);
  },
  // Super rare : trois étincelles qui montent.
  sr(c, out, t) {
    [E6, G6, B6].forEach((f, i) => bell(c, out, t + i * 0.07, f, 0.55, 0.22));
    hiss(c, out, t + 0.05, { a: 0.05, d: 0.5, peak: 0.07 }, { type: "bandpass", from: 7000, to: 11000, q: 3 });
  },
  // Ultra rare : montée de souffle, impact grave, accord de cloches.
  ur(c, out, t) {
    hiss(c, out, t, { a: 0.18, d: 0.05, peak: 0.12 }, { type: "bandpass", from: 600, to: 5000, q: 1.2 });
    const hit = t + 0.2;
    tone(c, out, hit, 120, { a: 0.003, d: 0.35, peak: 0.55 }, "sine", 55);
    [C5, E5, G5, C6].forEach((f, i) => bell(c, out, hit + i * 0.012, f, 1.3, 0.2));
    [E6, G6, C7].forEach((f, i) => bell(c, out, hit + 0.18 + i * 0.08, f, 0.7, 0.12));
  },
  // Légendaire : arpège montant, impact, accord tenu et pluie de clochettes.
  l(c, out, t) {
    [C5, E5, G5, C6, E6].forEach((f, i) => bell(c, out, t + i * 0.065, f, 0.5, 0.18));
    const hit = t + 0.36;
    tone(c, out, hit, 90, { a: 0.003, d: 0.6, peak: 0.7 }, "sine", 38);
    hiss(c, out, hit, { a: 0.002, d: 0.35, peak: 0.25 }, { type: "lowpass", from: 2400, to: 300 });
    // Accord tenu, légèrement désaccordé : de l'ampleur sans sonner synthé.
    const pad = c.createGain();
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 2600;
    pad.gain.setValueAtTime(0.0001, hit);
    pad.gain.exponentialRampToValueAtTime(0.09, hit + 0.12);
    pad.gain.exponentialRampToValueAtTime(0.0001, hit + 2.1);
    pad.connect(lp).connect(out);
    for (const f of [C5, E5, G5, C6]) {
      for (const detune of [-7, 7]) {
        const o = c.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = f;
        o.detune.value = detune;
        o.connect(pad);
        o.start(hit);
        o.stop(hit + 2.2);
      }
    }
    const sparkle = [C7, G6, E6, B6, C7, G6, E6, C7, A5 * 4, G6];
    sparkle.forEach((f, i) => bell(c, out, hit + 0.15 + i * 0.11 + Math.random() * 0.04, f, 0.45, 0.07));
  },
  // Brillante : glissando de harpe sur trois octaves, puis un scintillement qui retombe en miroir.
  shiny(c, out, t) {
    const scale = [C5, E5, G5, A5, C6, E6, G6, A5 * 2, C7, E6 * 2, G6 * 2];
    scale.forEach((f, i) => bell(c, out, t + i * 0.034, f, 0.5, 0.1 + i * 0.008));
    hiss(c, out, t + 0.05, { a: 0.25, d: 0.9, peak: 0.08 }, { type: "bandpass", from: 6000, to: 12000, q: 4 });
    const top = t + scale.length * 0.034;
    [C7, G6 * 2, E6 * 2, C7, G6, E6].forEach((f, i) =>
      bell(c, out, top + 0.08 + i * 0.09 + Math.random() * 0.03, f, 0.6, 0.06),
    );
  },
  // Pièce : deux « ping » rapides, si puis mi.
  coin(c, out, t) {
    tone(c, out, t, B5, { a: 0.002, d: 0.08, peak: 0.3 }, "square");
    tone(c, out, t + 0.075, E6, { a: 0.002, d: 0.32, peak: 0.28 }, "square");
  },
  achievement(c, out, t) {
    [G5, C6, E6].forEach((f, i) => bell(c, out, t + i * 0.09, f, 0.6, 0.2));
    [C6, E6, G6].forEach((f) => bell(c, out, t + 0.3, f, 1.1, 0.12));
  },
  correct(c, out, t) {
    tone(c, out, t, E5, { a: 0.004, d: 0.12, peak: 0.25 }, "triangle");
    tone(c, out, t + 0.09, A5, { a: 0.004, d: 0.28, peak: 0.25 }, "triangle");
  },
  wrong(c, out, t) {
    tone(c, out, t, 220, { a: 0.004, d: 0.14, peak: 0.18 }, "square", 180);
    tone(c, out, t + 0.16, 175, { a: 0.004, d: 0.24, peak: 0.18 }, "square", 130);
  },
  victory(c, out, t) {
    [C5, E5, G5].forEach((f, i) => tone(c, out, t + i * 0.1, f, { a: 0.005, d: 0.16, peak: 0.22 }, "triangle"));
    [C5, E5, G5, C6].forEach((f) => tone(c, out, t + 0.32, f, { a: 0.01, d: 0.9, peak: 0.14 }, "triangle"));
    [E6, G6, C7].forEach((f, i) => bell(c, out, t + 0.34 + i * 0.07, f, 0.6, 0.08));
  },
  defeat(c, out, t) {
    [G5 / 2, NOTE(-3), C5 / 2].forEach((f, i) =>
      tone(c, out, t + i * 0.22, f, { a: 0.01, d: 0.4, peak: 0.2 }, "triangle"),
    );
  },
};

/** Dernier départ de chaque son : dix cartes retournées d'un coup ne font qu'un seul claquement. */
const lastPlayed = new Map<string, number>();

/**
 * Joue un bruitage (sans effet si le son est coupé, à 0 %, ou si le navigateur n'a pas encore
 * autorisé l'audio).
 */
export function play(name: Sfx, delayMs = 0) {
  if (!readAudible()) return;
  const at = performance.now() + delayMs;
  if (Math.abs(at - (lastPlayed.get(name) ?? -1e9)) < 45) return;
  lastPlayed.set(name, at);
  const e = engine();
  if (!e) return;
  if (e.ctx.state === "running") return schedule(e, name, delayMs);
  // Premier son juste après le geste : le contexte finit de démarrer, on joue dès qu'il tourne. Un
  // son qui attendrait plus longtemps (iOS sans geste) tomberait à contretemps : on l'abandonne.
  if (e.ctx.state === "closed") return;
  const asked = performance.now();
  void e.ctx.resume().then(
    () => {
      const late = performance.now() - asked;
      if (late < MAX_RESUME_WAIT_MS) schedule(e, name, Math.max(0, delayMs - late));
    },
    () => {},
  );
}

/** Attente maximale du démarrage de l'audio avant d'abandonner un son. */
const MAX_RESUME_WAIT_MS = 300;

function schedule(e: { ctx: AudioContext; out: GainNode }, name: Sfx, delayMs: number) {
  try {
    RECIPES[name](e.ctx, e.out, e.ctx.currentTime + 0.01 + delayMs / 1000);
  } catch {
    // Un bruitage raté ne doit jamais casser l'interface.
  }
}

/** Programme un bruitage dans n'importe quel contexte (y compris hors ligne, pour l'écouter ou le tester). */
export function scheduleSfx(c: BaseAudioContext, out: AudioNode, name: Sfx, at: number) {
  RECIPES[name](c, out, at);
}

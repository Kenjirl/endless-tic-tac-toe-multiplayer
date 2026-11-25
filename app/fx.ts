import { confetti } from "@tsparticles/confetti";

function sound(src: string, volume = 1): () => void {
  const audio = new Audio(src);
  audio.preload = "auto";
  audio.volume = volume;
  return () => {
    audio.currentTime = 0;
    audio.play().catch(() => {
      // Autoplay can be blocked before the first user gesture; that's fine.
    });
  };
}

export const sounds = {
  pop: sound("/sound/popup.mp3"),
  finish: sound("/sound/finish.wav"),
  start: sound("/sound/start.wav", 0.5),
};

/** Confetti from both top corners, like the original game. */
export function celebrate(): void {
  for (const origin of [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: 0.2 },
    { x: 1, y: 0.2 },
  ]) {
    void confetti({ particleCount: 200, angle: 180, spread: 1000, origin });
  }
}

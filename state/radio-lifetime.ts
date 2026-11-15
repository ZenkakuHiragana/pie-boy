/** Process-shared RADIO lifetime; no audio, network or feature implementation is loaded here. */
export const RADIO = Symbol.for("pie-boy.radio");

export function stopRadio(): void {
  const shared = globalThis as { [RADIO]?: { dispose(): void } };
  shared[RADIO]?.dispose();
  delete shared[RADIO];
}

export const DEFAULT_TAPE_DURATION_SECONDS = 153.808917;

export const TONE_FILTER_PROFILES = Object.freeze({
  high: Object.freeze({
    type: "lowpass",
    frequency: 2400,
    q: Math.SQRT1_2,
    enabled: false
  }),
  low: Object.freeze({
    type: "lowpass",
    frequency: 2400,
    q: Math.SQRT1_2,
    enabled: true
  })
});

export function resolveAudioDuration(
  mediaDuration,
  fallbackDuration = DEFAULT_TAPE_DURATION_SECONDS
) {
  const duration = Number(mediaDuration);
  return Number.isFinite(duration) && duration > 0
    ? duration
    : fallbackDuration;
}

export function formatTapeTime(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, "0")}`;
}

export function hasBatteryPower(state) {
  return Boolean(
    state?.batteries?.[0] === "installed" &&
      state?.batteries?.[1] === "installed"
  );
}

export function isTPSL2Powered(state) {
  return Boolean(
    hasBatteryPower(state) ||
      state?.accessories?.contacted?.adapterConnected
  );
}

export function hasEngagedCassette(state) {
  // The cassette door is a cover, not a transport or audio interlock. A tape
  // remains engaged until STOP/EJECT releases it from the seated position, so
  // opening the cover alone must not turn a loaded cassette into an empty
  // mechanism.
  return Boolean(
    state?.cassette === "inserted" &&
      state?.collection?.loadedCassetteId
  );
}

export function isTransportAvailable(state) {
  // The TPS-L2 mechanism can run without a cassette. Power gates the motor;
  // cassette engagement gates tape/audio motion, not the physical controls.
  return isTPSL2Powered(state);
}

export function audioMixForState(state) {
  const left = Math.pow(Number(state?.volumeLeft) || 0, 1.7);
  const right = Math.pow(Number(state?.volumeRight) || 0, 1.7);
  const ducking = state?.hotline ? 0.16 : 1;
  const toneMode = state?.tone === "low" ? "low" : "high";
  const toneFilter = TONE_FILTER_PROFILES[toneMode];
  return {
    left,
    right,
    ducking,
    elementVolume: Math.min(
      1,
      Math.max(0, ((left + right) * 0.5) * ducking)
    ),
    toneMode,
    toneFilter
  };
}

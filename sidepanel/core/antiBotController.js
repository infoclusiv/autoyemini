const AppConfig = globalThis.CONFIG;

export const getFixedDelay = globalThis.SharedUtils.getFixedDelay;

export const waitForConfiguredDelay = globalThis.SharedUtils.waitForDelay;

export function buildAntiBotConfig(settings) {
  const minPauseMs = Math.round(settings.fatigueMinMinutes * 60000);
  const maxPauseMs = Math.round(settings.fatigueMaxMinutes * 60000);

  return {
    humanTyping: settings.humanTyping,
    randomDelays: settings.randomDelays,
    biologicalPauses: settings.biologicalPauses,
    typingSpeed: [...settings.typingSpeed],
    errorProbability: AppConfig.ANTI_BOT.ERROR_PROBABILITY,
    fatigueCount: settings.fatigueCount,
    fatiguePauseMs: [Math.min(minPauseMs, maxPauseMs), Math.max(minPauseMs, maxPauseMs)]
  };
}

export function shouldTakeBiologicalPause(settings, processedSincePause) {
  return settings.biologicalPauses && processedSincePause >= settings.fatigueCount;
}

export function getBiologicalPauseDuration(settings) {
  return buildAntiBotConfig(settings).fatiguePauseMs;
}

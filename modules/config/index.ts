export function loadConfig() {
  return {
    engineHost: process.env.ENGINE_HOST ?? '127.0.0.1',
    enginePort: Number(process.env.ENGINE_PORT ?? 8000),
    aiProvider: process.env.ACTIVE_AI_PROVIDER ?? 'local',
    visionEnabled: process.env.VISION_ENABLED ?? 'true',
  }
}

import type {
  AudioCodec,
  EncoderPreset,
  FitMode,
  JobSettingsSnapshot,
  QualityPreset,
  VideoCodec,
} from '../../types/conversion'

const buildDenoiseFilter = (settings: JobSettingsSnapshot): string => {
  const { advanced, advancedEnabled } = settings
  if (!advancedEnabled || !advanced.denoiseEnabled) return ''
  const { denoiseLumaSpatial, denoiseChromaSpatial, denoiseLumaTmp, denoiseChromaTmp, denoisePreset } = advanced
  const main = `hqdn3d=${denoiseLumaSpatial}:${denoiseChromaSpatial}:${denoiseLumaTmp}:${denoiseChromaTmp}`
  // Heavy preset adds a chroma-only pre-pass to tackle heavy chroma bleed
  return denoisePreset === 'heavy' ? `hqdn3d=0:4:0:6,${main}` : main
}

const QUALITY_TO_CRF: Record<QualityPreset, number> = {
  archive: 18,
  balanced: 23,
  compact: 30,
}

const VIDEO_CODEC_MAP: Record<VideoCodec, string> = {
  h264: 'libx264',
  h265: 'libx265',
  mpeg4: 'mpeg4',
}

const AUDIO_CODEC_MAP: Record<AudioCodec, string> = {
  aac: 'aac',
  mp3: 'libmp3lame',
  copy: 'copy',
}

const ENCODER_PRESETS: readonly EncoderPreset[] = [
  'ultrafast',
  'superfast',
  'veryfast',
  'faster',
  'fast',
  'medium',
  'slow',
  'slower',
  'veryslow',
]

const MAX_DIMENSION = 7680
const MIN_DIMENSION = 160

const clamp = (value: number, min: number, max: number): number => {
  return Math.min(max, Math.max(min, value))
}

const ensureEven = (value: number): number => {
  const rounded = Math.round(value)
  if (rounded % 2 === 0) {
    return rounded
  }

  return rounded - 1
}

const sanitizeDimension = (value: number, fallback: number): number => {
  if (!Number.isFinite(value)) {
    return fallback
  }

  return ensureEven(clamp(Math.round(value), MIN_DIMENSION, MAX_DIMENSION))
}

const sanitizePositiveInt = (value: number, fallback: number): number => {
  if (!Number.isFinite(value) || value <= 0) {
    return fallback
  }

  return Math.round(value)
}

const sanitizeCrf = (value: number, fallback: number): number => {
  if (!Number.isFinite(value)) {
    return fallback
  }

  return clamp(Math.round(value), 0, 51)
}

const normalizeTimestamp = (rawValue: string): string => {
  const value = rawValue.trim()
  if (!value) {
    return ''
  }

  const timestampPattern = /^((\d{2}:)?\d{2}:\d{2})(\.\d+)?$/
  return timestampPattern.test(value) ? value : ''
}

const sanitizeStem = (filename: string): string => {
  const stem = filename.replace(/\.[^.]+$/, '')
  const safeStem = stem.replace(/[^a-zA-Z0-9-_]+/g, '_')

  return safeStem || 'stretchdvr_output'
}

const buildOutputName = (inputName: string, settings: JobSettingsSnapshot): string => {
  const modeSuffix = settings.simple.aspectMode === 'stretch169' ? '16x9' : '4x3'
  const audioSuffix = settings.simple.removeAudio ? '_mute' : ''

  return `${sanitizeStem(inputName)}_${modeSuffix}${audioSuffix}.mp4`
}

const buildPreserveFilter = (fitMode: FitMode, width: number, height: number): string => {
  if (fitMode === 'crop') {
    return `scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${width}:${height},setsar=1`
  }

  if (fitMode === 'pad') {
    return `scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1`
  }

  return `scale=${width}:${height}:flags=lanczos,setsar=1`
}

const buildScaleFilter = (settings: JobSettingsSnapshot): string => {
  const { advanced, simple } = settings

  if (simple.aspectMode === 'stretch169') {
    const width = sanitizeDimension(
      advanced.customResolution ? advanced.width : 1280,
      1280,
    )
    const height = sanitizeDimension(
      advanced.customResolution ? advanced.height : 720,
      720,
    )

    return `scale=${width}:${height}:flags=lanczos,setsar=1`
  }

  if (!advanced.customResolution) {
    return 'setsar=1'
  }

  const width = sanitizeDimension(advanced.width, 960)
  const height = sanitizeDimension(advanced.height, 720)

  return buildPreserveFilter(advanced.fitMode, width, height)
}

interface BuiltCommand {
  args: string[]
  outputName: string
}

export const buildFfmpegCommand = (
  inputName: string,
  settings: JobSettingsSnapshot,
): BuiltCommand => {
  const { advanced, simple, advancedEnabled } = settings
  const args: string[] = []

  const trimStart = normalizeTimestamp(advanced.trimStart)
  const trimEnd = normalizeTimestamp(advanced.trimEnd)

  if (advancedEnabled && trimStart) {
    args.push('-ss', trimStart)
  }

  args.push('-i', inputName)

  if (advancedEnabled && trimEnd) {
    args.push('-to', trimEnd)
  }

  const videoCodec = advancedEnabled ? VIDEO_CODEC_MAP[advanced.videoCodec] : 'libx264'
  args.push('-c:v', videoCodec)

  const scaleFilter = buildScaleFilter(settings)
  const denoiseFilter = buildDenoiseFilter(settings)
  const videoFilter = denoiseFilter ? `${denoiseFilter},${scaleFilter}` : scaleFilter
  args.push('-vf', videoFilter)

  if (advancedEnabled && advanced.fps > 0) {
    args.push('-r', String(sanitizePositiveInt(advanced.fps, 30)))
  }

  if (advancedEnabled && advanced.keyframeInterval > 0) {
    args.push('-g', String(sanitizePositiveInt(advanced.keyframeInterval, 120)))
  }

  if (advancedEnabled && advanced.useCustomVideoBitrate) {
    const bitrate = sanitizePositiveInt(advanced.videoBitrateKbps, 6000)
    args.push('-b:v', `${bitrate}k`)
  } else {
    const fallbackCrf = QUALITY_TO_CRF[simple.qualityPreset]
    const crf = advancedEnabled
      ? sanitizeCrf(advanced.crf, fallbackCrf)
      : fallbackCrf
    args.push('-crf', String(crf))
  }

  const encoderPreset = advancedEnabled ? advanced.preset : 'veryfast'
  const validatedPreset = ENCODER_PRESETS.includes(encoderPreset)
    ? encoderPreset
    : 'medium'
  args.push('-preset', validatedPreset)
  args.push('-pix_fmt', 'yuv420p')

  if (simple.removeAudio) {
    args.push('-an')
  } else {
    const audioCodec = advancedEnabled ? advanced.audioCodec : 'aac'
    args.push('-c:a', AUDIO_CODEC_MAP[audioCodec])

    if (audioCodec !== 'copy') {
      const bitrate = advancedEnabled
        ? sanitizePositiveInt(advanced.audioBitrateKbps, 192)
        : 192
      args.push('-b:a', `${bitrate}k`)

      if (advancedEnabled) {
        args.push('-ac', String(advanced.audioChannels))
        args.push('-ar', String(advanced.audioSampleRate))
      }
    }

    if (advancedEnabled && advanced.volumePercent !== 100) {
      const volume = clamp(advanced.volumePercent, 0, 400) / 100
      args.push('-af', `volume=${volume.toFixed(2)}`)
    }
  }

  args.push('-movflags', '+faststart')

  const outputName = buildOutputName(inputName, settings)
  args.push('-y', outputName)

  return {
    args,
    outputName,
  }
}
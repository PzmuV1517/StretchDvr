export type AspectMode = 'preserve43' | 'stretch169'

export type DenoisePreset = 'light' | 'medium' | 'heavy' | 'custom'

export interface DenoiseParams {
  lumaSpatial: number
  chromaSpatial: number
  lumaTmp: number
  chromaTmp: number
}

export const DENOISE_PRESETS: Record<Exclude<DenoisePreset, 'custom'>, DenoiseParams> = {
  light:  { lumaSpatial: 2, chromaSpatial: 2, lumaTmp: 3,  chromaTmp: 2 },
  medium: { lumaSpatial: 4, chromaSpatial: 3, lumaTmp: 6,  chromaTmp: 4 },
  heavy:  { lumaSpatial: 6, chromaSpatial: 5, lumaTmp: 10, chromaTmp: 7 },
}

export type QualityPreset = 'archive' | 'balanced' | 'compact'

export type VideoCodec = 'h264' | 'h265' | 'mpeg4'

export type AudioCodec = 'aac' | 'mp3' | 'copy'

export type FitMode = 'scale' | 'pad' | 'crop'

export type EncoderPreset =
  | 'ultrafast'
  | 'superfast'
  | 'veryfast'
  | 'faster'
  | 'fast'
  | 'medium'
  | 'slow'
  | 'slower'
  | 'veryslow'

export interface SimpleSettings {
  aspectMode: AspectMode
  removeAudio: boolean
  qualityPreset: QualityPreset
}

export interface AdvancedSettings {
  videoCodec: VideoCodec
  useCustomVideoBitrate: boolean
  videoBitrateKbps: number
  crf: number
  preset: EncoderPreset
  fps: number
  keyframeInterval: number
  customResolution: boolean
  width: number
  height: number
  fitMode: FitMode
  audioCodec: AudioCodec
  audioBitrateKbps: number
  audioChannels: 1 | 2
  audioSampleRate: 32000 | 44100 | 48000
  volumePercent: number
  trimStart: string
  trimEnd: string
  denoiseEnabled: boolean
  denoisePreset: DenoisePreset
  denoiseLumaSpatial: number
  denoiseChromaSpatial: number
  denoiseLumaTmp: number
  denoiseChromaTmp: number
}

export interface JobSettingsSnapshot {
  simple: SimpleSettings
  advanced: AdvancedSettings
  advancedEnabled: boolean
}

export const DEFAULT_SIMPLE_SETTINGS: SimpleSettings = {
  aspectMode: 'stretch169',
  removeAudio: true,
  qualityPreset: 'balanced',
}

export const DEFAULT_ADVANCED_SETTINGS: AdvancedSettings = {
  videoCodec: 'h264',
  useCustomVideoBitrate: false,
  videoBitrateKbps: 6000,
  crf: 23,
  preset: 'ultrafast',
  fps: 0,
  keyframeInterval: 0,
  customResolution: false,
  width: 1280,
  height: 720,
  fitMode: 'scale',
  audioCodec: 'aac',
  audioBitrateKbps: 192,
  audioChannels: 2,
  audioSampleRate: 48000,
  volumePercent: 100,
  trimStart: '',
  trimEnd: '',
  denoiseEnabled: false,
  denoisePreset: 'medium',
  denoiseLumaSpatial: DENOISE_PRESETS.medium.lumaSpatial,
  denoiseChromaSpatial: DENOISE_PRESETS.medium.chromaSpatial,
  denoiseLumaTmp: DENOISE_PRESETS.medium.lumaTmp,
  denoiseChromaTmp: DENOISE_PRESETS.medium.chromaTmp,
}
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from 'react'
import { createTranscodeTask, type TranscodeTask } from './lib/ffmpeg/transcodeClient'
import { ffmpegPool } from './lib/ffmpeg/workerPool'
import {
  DEFAULT_ADVANCED_SETTINGS,
  DEFAULT_SIMPLE_SETTINGS,
  type AdvancedSettings,
  type JobSettingsSnapshot,
  type QualityPreset,
  type SimpleSettings,
} from './types/conversion'
import type { QueueJob, QueueJobStatus } from './types/job'
import './App.css'

const MIN_CONCURRENCY = 1

const qualityHints: Record<QualityPreset, string> = {
  archive: 'Best quality, larger output file size.',
  balanced: 'Recommended quality for DVR exports.',
  compact: 'Smaller files with more compression.',
}

const statusLabelMap: Record<QueueJobStatus, string> = {
  queued: 'Queued',
  preparing: 'Preparing',
  converting: 'Converting',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
}

const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }

  return 'Unexpected conversion error.'
}

const isActiveStatus = (status: QueueJobStatus): boolean => {
  return status === 'preparing' || status === 'converting'
}

const createJobId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

const fileFingerprint = (file: File): string => {
  return `${file.name}-${file.size}-${file.lastModified}`
}

const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '0 B'
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  return `${value.toFixed(value < 10 && unitIndex > 0 ? 1 : 0)} ${units[unitIndex]}`
}

const stripExtension = (filename: string): string => {
  return filename.replace(/\.[^.]+$/, '')
}

const clampProgressPercent = (progress: number): number => {
  if (!Number.isFinite(progress)) {
    return 0
  }

  return Math.round(Math.min(1, Math.max(0, progress)) * 100)
}

function App() {
  const [simpleSettings, setSimpleSettings] = useState(DEFAULT_SIMPLE_SETTINGS)
  const [advancedSettings, setAdvancedSettings] = useState(DEFAULT_ADVANCED_SETTINGS)
  const [advancedEnabled, setAdvancedEnabled] = useState(false)
  const [stagedFiles, setStagedFiles] = useState<File[]>([])
  const [jobs, setJobs] = useState<QueueJob[]>([])
  const [concurrencyRaw, setConcurrencyRaw] = useState('2')
  const concurrency = parseInt(concurrencyRaw, 10)
  const concurrencyValid = Number.isFinite(concurrency) && concurrency >= MIN_CONCURRENCY
  const [notice, setNotice] = useState(
    'Everything runs client-side. Files never leave your device.',
  )
  const [isDraggingOver, setIsDraggingOver] = useState(false)

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const activeTasksRef = useRef<Map<string, TranscodeTask>>(new Map())

  useEffect(() => {
    if (concurrencyValid) ffmpegPool.setSize(concurrency)
  }, [concurrency, concurrencyValid])

  const updateSimple = useCallback(
    <K extends keyof SimpleSettings,>(key: K, value: SimpleSettings[K]) => {
      setSimpleSettings((current) => ({
        ...current,
        [key]: value,
      }))
    },
    [],
  )

  const updateAdvanced = useCallback(
    <K extends keyof AdvancedSettings,>(key: K, value: AdvancedSettings[K]) => {
      setAdvancedSettings((current) => ({
        ...current,
        [key]: value,
      }))
    },
    [],
  )

  const addFilesToStaging = useCallback((incomingFiles: File[]) => {
    if (incomingFiles.length === 0) {
      return
    }

    const aviFiles = incomingFiles.filter((file) =>
      file.name.toLowerCase().endsWith('.avi'),
    )
    const skipped = incomingFiles.length - aviFiles.length

    if (aviFiles.length === 0) {
      setNotice('Only AVI files are accepted for conversion.')
      return
    }

    setStagedFiles((current) => {
      const seen = new Set(current.map(fileFingerprint))
      const merged = [...current]

      aviFiles.forEach((file) => {
        const fingerprint = fileFingerprint(file)
        if (!seen.has(fingerprint)) {
          merged.push(file)
          seen.add(fingerprint)
        }
      })

      return merged
    })

    if (skipped > 0) {
      setNotice(`${aviFiles.length} AVI file(s) added. ${skipped} non-AVI file(s) skipped.`)
      return
    }

    setNotice(`${aviFiles.length} AVI file(s) ready to queue.`)
  }, [])

  const onFileInputChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const selectedFiles = Array.from(event.target.files ?? [])
    addFilesToStaging(selectedFiles)
    event.target.value = ''
  }

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault()
    setIsDraggingOver(false)
    addFilesToStaging(Array.from(event.dataTransfer.files))
  }

  const queueStagedFiles = (): void => {
    if (stagedFiles.length === 0) {
      setNotice('Select at least one AVI file before adding to the queue.')
      return
    }

    const settingsSnapshot: JobSettingsSnapshot = {
      simple: { ...simpleSettings },
      advanced: { ...advancedSettings },
      advancedEnabled: advancedEnabled,
    }

    const queuedJobs: QueueJob[] = stagedFiles.map((sourceFile) => ({
      id: createJobId(),
      sourceFile,
      sourceName: sourceFile.name,
      sourceSize: sourceFile.size,
      settings: settingsSnapshot,
      status: 'queued',
      statusMessage: 'Waiting for an open conversion slot.',
      progress: 0,
    }))

    setJobs((current) => [...current, ...queuedJobs])
    setStagedFiles([])
    setNotice(`${queuedJobs.length} file(s) added to the batch queue.`)
  }

  const runJob = useCallback((job: QueueJob): void => {
    if (activeTasksRef.current.has(job.id)) {
      return
    }

    const task = createTranscodeTask()
    activeTasksRef.current.set(job.id, task)

    setJobs((current) =>
      current.map((item) => {
        if (item.id !== job.id) {
          return item
        }

        return {
          ...item,
          status: 'preparing',
          progress: 0,
          errorMessage: undefined,
          outputBlob: undefined,
          outputName: undefined,
          statusMessage: 'Initializing browser encoder...',
        }
      }),
    )

    void task
      .start(job.sourceFile, job.settings, {
        onStatus: (statusMessage) => {
          setJobs((current) =>
            current.map((item) => {
              if (item.id !== job.id || item.status === 'cancelled') {
                return item
              }

              return {
                ...item,
                status: item.status === 'converting' ? 'converting' : 'preparing',
                statusMessage,
              }
            }),
          )
        },
        onProgress: ({ progress }) => {
          setJobs((current) =>
            current.map((item) => {
              if (item.id !== job.id || item.status === 'cancelled') {
                return item
              }

              return {
                ...item,
                status: 'converting',
                statusMessage: 'Encoding MP4 output...',
                progress: clampProgressPercent(progress),
              }
            }),
          )
        },
      })
      .then((result) => {
        setJobs((current) =>
          current.map((item) => {
            if (item.id !== job.id) {
              return item
            }

            return {
              ...item,
              status: 'completed',
              progress: 100,
              statusMessage: 'Conversion finished and ready to download.',
              outputBlob: result.outputBlob,
              outputName: result.outputName,
            }
          }),
        )
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return
        }

        setJobs((current) =>
          current.map((item) => {
            if (item.id !== job.id) {
              return item
            }

            return {
              ...item,
              status: 'failed',
              statusMessage: 'Conversion failed.',
              errorMessage: toErrorMessage(error),
            }
          }),
        )
      })
      .finally(() => {
        activeTasksRef.current.delete(job.id)
      })
  }, [])

  useEffect(() => {
    if (!concurrencyValid) return

    const activeJobs = jobs.filter((job) => isActiveStatus(job.status)).length
    if (activeJobs >= concurrency) return

    const availableSlots = concurrency - activeJobs
    jobs
      .filter((job) => job.status === 'queued')
      .slice(0, availableSlots)
      .forEach((job) => runJob(job))
  }, [concurrency, concurrencyValid, jobs, runJob])

  const cancelJob = (jobId: string): void => {
    const task = activeTasksRef.current.get(jobId)
    if (task) {
      task.cancel()
      activeTasksRef.current.delete(jobId)
    }

    setJobs((current) =>
      current.map((job) => {
        if (job.id !== jobId) {
          return job
        }

        return {
          ...job,
          status: 'cancelled',
          statusMessage: 'Cancelled by user.',
        }
      }),
    )
  }

  const retryJob = (jobId: string): void => {
    setJobs((current) =>
      current.map((job) => {
        if (job.id !== jobId) {
          return job
        }

        return {
          ...job,
          status: 'queued',
          progress: 0,
          errorMessage: undefined,
          outputBlob: undefined,
          outputName: undefined,
          statusMessage: 'Queued again for conversion.',
        }
      }),
    )
  }

  const removeJob = (jobId: string): void => {
    const task = activeTasksRef.current.get(jobId)
    if (task) {
      task.cancel()
      activeTasksRef.current.delete(jobId)
    }

    setJobs((current) => current.filter((job) => job.id !== jobId))
  }

  const removeStagedFile = (fp: string): void => {
    setStagedFiles((current) => current.filter((f) => fileFingerprint(f) !== fp))
  }

  const clearInactiveJobs = (): void => {
    setJobs((current) =>
      current.filter((job) => job.status === 'queued' || isActiveStatus(job.status)),
    )
  }

  const downloadJob = (job: QueueJob): void => {
    if (!job.outputBlob) {
      return
    }

    const downloadUrl = URL.createObjectURL(job.outputBlob)
    const anchor = document.createElement('a')
    anchor.href = downloadUrl
    anchor.download = job.outputName ?? `${stripExtension(job.sourceName)}.mp4`
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(downloadUrl)
  }

  useEffect(() => {
    const activeTasks = activeTasksRef.current

    return () => {
      activeTasks.forEach((task) => task.cancel())
      activeTasks.clear()
    }
  }, [])

  const queueStats = useMemo(() => {
    const total = jobs.length
    const active = jobs.filter((job) => isActiveStatus(job.status)).length
    const completed = jobs.filter((job) => job.status === 'completed').length
    const failed = jobs.filter((job) => job.status === 'failed').length
    const cancelled = jobs.filter((job) => job.status === 'cancelled').length
    const queued = jobs.filter((job) => job.status === 'queued').length

    const aggregateProgress =
      total === 0
        ? 0
        : Math.round(
            jobs.reduce((sum, job) => {
              if (job.status === 'completed') {
                return sum + 100
              }

              return sum + job.progress
            }, 0) / total,
          )

    return {
      total,
      active,
      completed,
      failed,
      cancelled,
      queued,
      aggregateProgress,
    }
  }, [jobs])

  return (
    <div className="app-root">
      <header className="hero-panel reveal">
        <div className="brand-row">
          <p className="wordmark">StretchDvr</p>
          <p className="eyebrow">AVI → MP4 · Batch · Client-side</p>
        </div>
        <h1>DVR footage converter — fully in your browser.</h1>
        <p className="hero-subcopy">
          Convert 4:3 AVI recordings to MP4. Keep or remove audio, preserve 4:3 or
          stretch to 16:9. Queue multiple files and run them in parallel.
        </p>
        <p className="privacy-pill">
          Files never leave your device — all processing runs client-side.
        </p>
      </header>

      <main className="workspace-grid">
        <section className="panel reveal reveal-delay-1" aria-label="Conversion controls">
          <div className="panel-title-row">
            <h2>Input and Mode</h2>
          </div>

          <div
            className={`dropzone ${isDraggingOver ? 'is-dragging' : ''}`}
            onDragEnter={(event) => {
              event.preventDefault()
              setIsDraggingOver(true)
            }}
            onDragOver={(event) => {
              event.preventDefault()
            }}
            onDragLeave={(event) => {
              event.preventDefault()
              setIsDraggingOver(false)
            }}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                fileInputRef.current?.click()
              }
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".avi,video/x-msvideo"
              multiple
              onChange={onFileInputChange}
              className="sr-only"
            />
            <p className="dropzone-title">Drop AVI files here</p>
            <p className="dropzone-subtitle">or click to browse your DVR exports</p>
          </div>

          <div className="staged-header">
            <div className="staged-header-left">
              <h3>Staged ({stagedFiles.length})</h3>
              {stagedFiles.length > 0 && (
                <small className="staged-total">
                  {formatBytes(stagedFiles.reduce((sum, f) => sum + f.size, 0))} total
                </small>
              )}
            </div>
            <button
              type="button"
              className="ghost-button"
              onClick={() => setStagedFiles([])}
              disabled={stagedFiles.length === 0}
            >
              Clear all
            </button>
          </div>

          {stagedFiles.length === 0 ? (
            <p className="empty-copy">No AVI files staged yet.</p>
          ) : (
            <ul className="file-list">
              {stagedFiles.map((file) => {
                const fp = fileFingerprint(file)
                return (
                  <li key={fp}>
                    <span>{file.name}</span>
                    <div className="file-item-meta">
                      <small>{formatBytes(file.size)}</small>
                      <button
                        type="button"
                        className="ghost-button file-remove-btn"
                        onClick={() => removeStagedFile(fp)}
                        aria-label={`Remove ${file.name}`}
                      >
                        ×
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}

          <div className="simple-grid">
            <div>
              <h3>Output frame</h3>
              <div className="segmented" role="radiogroup" aria-label="Output frame mode">
                <button
                  type="button"
                  className={
                    simpleSettings.aspectMode === 'stretch169' ? 'is-active' : undefined
                  }
                  disabled={advancedEnabled && advancedSettings.customResolution}
                  onClick={() => updateSimple('aspectMode', 'stretch169')}
                >
                  Stretch to 16:9
                </button>
                <button
                  type="button"
                  className={
                    simpleSettings.aspectMode === 'preserve43' ? 'is-active' : undefined
                  }
                  disabled={advancedEnabled && advancedSettings.customResolution}
                  onClick={() => updateSimple('aspectMode', 'preserve43')}
                >
                  Keep 4:3
                </button>
              </div>
              {advancedEnabled && advancedSettings.customResolution && (
                <p className="control-note">Custom resolution overrides this.</p>
              )}
            </div>

            <div>
              <h3>Audio</h3>
              <div className="segmented" role="radiogroup" aria-label="Audio mode">
                <button
                  type="button"
                  className={simpleSettings.removeAudio ? 'is-active' : undefined}
                  onClick={() => updateSimple('removeAudio', true)}
                >
                  Remove sound
                </button>
                <button
                  type="button"
                  className={!simpleSettings.removeAudio ? 'is-active' : undefined}
                  onClick={() => updateSimple('removeAudio', false)}
                >
                  Keep sound
                </button>
              </div>
            </div>
          </div>

          <div className="field-grid">
            <label className="field">
              <span>Quality preset</span>
              <select
                value={simpleSettings.qualityPreset}
                disabled={advancedEnabled}
                onChange={(event) =>
                  updateSimple('qualityPreset', event.target.value as QualityPreset)
                }
              >
                <option value="archive">Archive</option>
                <option value="balanced">Balanced</option>
                <option value="compact">Compact</option>
              </select>
              <small>
                {advancedEnabled
                  ? 'Overridden by advanced settings.'
                  : qualityHints[simpleSettings.qualityPreset]}
              </small>
            </label>

            <label className="field">
              <span>Jobs at a time</span>
              <input
                type="number"
                min={MIN_CONCURRENCY}
                value={concurrencyRaw}
                onChange={(event) => setConcurrencyRaw(event.target.value)}
              />
              {concurrencyValid
                ? <small>Higher numbers use more memory and CPU.</small>
                : <p className="control-note">Enter a number to enable queuing.</p>
              }
            </label>
          </div>

          <div className="advanced-header">
            <button
              type="button"
              className={advancedEnabled ? 'secondary-button' : 'ghost-button'}
              onClick={() => setAdvancedEnabled((v) => !v)}
            >
              {advancedEnabled ? 'Hide advanced' : 'Use advanced options'}
            </button>
          </div>

          {advancedEnabled ? (
            <div className="advanced-grid">
              <label className="field">
                <span>Video codec</span>
                <select
                  value={advancedSettings.videoCodec}
                  onChange={(event) =>
                    updateAdvanced(
                      'videoCodec',
                      event.target.value as AdvancedSettings['videoCodec'],
                    )
                  }
                >
                  <option value="h264">H.264</option>
                  <option value="h265">H.265</option>
                  <option value="mpeg4">MPEG-4</option>
                </select>
              </label>

              <label className="field">
                <span>Encoder preset</span>
                <select
                  value={advancedSettings.preset}
                  onChange={(event) =>
                    updateAdvanced('preset', event.target.value as AdvancedSettings['preset'])
                  }
                >
                  <option value="ultrafast">Ultrafast</option>
                  <option value="superfast">Superfast</option>
                  <option value="veryfast">Veryfast</option>
                  <option value="faster">Faster</option>
                  <option value="fast">Fast</option>
                  <option value="medium">Medium</option>
                  <option value="slow">Slow</option>
                  <option value="slower">Slower</option>
                  <option value="veryslow">Veryslow</option>
                </select>
              </label>

              <label className="check-row field-row-span">
                <input
                  type="checkbox"
                  checked={advancedSettings.useCustomVideoBitrate}
                  onChange={(event) =>
                    updateAdvanced('useCustomVideoBitrate', event.target.checked)
                  }
                />
                <span>Use explicit video bitrate instead of CRF</span>
              </label>

              {advancedSettings.useCustomVideoBitrate ? (
                <label className="field">
                  <span>Video bitrate (kbps)</span>
                  <input
                    type="number"
                    min={500}
                    max={50000}
                    value={advancedSettings.videoBitrateKbps}
                    onChange={(event) => {
                      const value = Number(event.target.value)
                      if (Number.isFinite(value) && value > 0) {
                        updateAdvanced('videoBitrateKbps', Math.round(value))
                      }
                    }}
                  />
                </label>
              ) : (
                <label className="field">
                  <span>CRF ({advancedSettings.crf})</span>
                  <input
                    type="range"
                    min={0}
                    max={51}
                    step={1}
                    value={advancedSettings.crf}
                    onChange={(event) => updateAdvanced('crf', Number(event.target.value))}
                  />
                </label>
              )}

              <label className="field">
                <span>FPS override (0 = auto)</span>
                <input
                  type="number"
                  min={0}
                  max={120}
                  value={advancedSettings.fps}
                  onChange={(event) => {
                    const value = Number(event.target.value)
                    if (Number.isFinite(value)) {
                      updateAdvanced('fps', Math.max(0, Math.round(value)))
                    }
                  }}
                />
              </label>

              <label className="field">
                <span>Keyframe interval (0 = auto)</span>
                <input
                  type="number"
                  min={0}
                  max={300}
                  value={advancedSettings.keyframeInterval}
                  onChange={(event) => {
                    const value = Number(event.target.value)
                    if (Number.isFinite(value)) {
                      updateAdvanced('keyframeInterval', Math.max(0, Math.round(value)))
                    }
                  }}
                />
              </label>

              <label className="check-row field-row-span">
                <input
                  type="checkbox"
                  checked={advancedSettings.customResolution}
                  onChange={(event) =>
                    updateAdvanced('customResolution', event.target.checked)
                  }
                />
                <span>Set custom output resolution</span>
              </label>

              <label className="field">
                <span>Width</span>
                <input
                  type="number"
                  min={160}
                  max={7680}
                  value={advancedSettings.width}
                  disabled={!advancedSettings.customResolution}
                  onChange={(event) => {
                    const value = Number(event.target.value)
                    if (Number.isFinite(value)) {
                      updateAdvanced('width', Math.max(160, Math.round(value)))
                    }
                  }}
                />
              </label>

              <label className="field">
                <span>Height</span>
                <input
                  type="number"
                  min={160}
                  max={7680}
                  value={advancedSettings.height}
                  disabled={!advancedSettings.customResolution}
                  onChange={(event) => {
                    const value = Number(event.target.value)
                    if (Number.isFinite(value)) {
                      updateAdvanced('height', Math.max(160, Math.round(value)))
                    }
                  }}
                />
              </label>

              <label className="field">
                <span>Fit mode</span>
                <select
                  value={advancedSettings.fitMode}
                  disabled={!advancedSettings.customResolution}
                  onChange={(event) =>
                    updateAdvanced(
                      'fitMode',
                      event.target.value as AdvancedSettings['fitMode'],
                    )
                  }
                >
                  <option value="scale">Scale</option>
                  <option value="pad">Pad</option>
                  <option value="crop">Crop</option>
                </select>
              </label>

              <div className="advanced-section-divider field-row-span">
                <span>Audio</span>
              </div>

              {simpleSettings.removeAudio && (
                <p className="control-note field-row-span">
                  Audio is set to Remove sound.
                </p>
              )}

              <label className="field">
                <span>Codec</span>
                <select
                  value={advancedSettings.audioCodec}
                  disabled={simpleSettings.removeAudio}
                  onChange={(event) =>
                    updateAdvanced(
                      'audioCodec',
                      event.target.value as AdvancedSettings['audioCodec'],
                    )
                  }
                >
                  <option value="aac">AAC</option>
                  <option value="mp3">MP3</option>
                  <option value="copy">Copy stream</option>
                </select>
                {!simpleSettings.removeAudio && advancedSettings.audioCodec === 'copy' && (
                  <small>Bitrate, channels, and sample rate are not re-encoded.</small>
                )}
              </label>

              <label className="field">
                <span>Bitrate (kbps)</span>
                <input
                  type="number"
                  min={64}
                  max={512}
                  value={advancedSettings.audioBitrateKbps}
                  disabled={simpleSettings.removeAudio || advancedSettings.audioCodec === 'copy'}
                  onChange={(event) => {
                    const value = Number(event.target.value)
                    if (Number.isFinite(value) && value > 0) {
                      updateAdvanced('audioBitrateKbps', Math.round(value))
                    }
                  }}
                />
              </label>

              <label className="field">
                <span>Channels</span>
                <select
                  value={advancedSettings.audioChannels}
                  disabled={simpleSettings.removeAudio || advancedSettings.audioCodec === 'copy'}
                  onChange={(event) =>
                    updateAdvanced(
                      'audioChannels',
                      Number(event.target.value) as AdvancedSettings['audioChannels'],
                    )
                  }
                >
                  <option value={1}>Mono</option>
                  <option value={2}>Stereo</option>
                </select>
              </label>

              <label className="field">
                <span>Sample rate</span>
                <select
                  value={advancedSettings.audioSampleRate}
                  disabled={simpleSettings.removeAudio || advancedSettings.audioCodec === 'copy'}
                  onChange={(event) =>
                    updateAdvanced(
                      'audioSampleRate',
                      Number(event.target.value) as AdvancedSettings['audioSampleRate'],
                    )
                  }
                >
                  <option value={32000}>32 000 Hz</option>
                  <option value={44100}>44 100 Hz</option>
                  <option value={48000}>48 000 Hz</option>
                </select>
              </label>

              <label className="field field-row-span">
                <span>Volume ({advancedSettings.volumePercent}%)</span>
                <input
                  type="range"
                  min={0}
                  max={400}
                  step={5}
                  value={advancedSettings.volumePercent}
                  disabled={simpleSettings.removeAudio}
                  onChange={(event) =>
                    updateAdvanced('volumePercent', Number(event.target.value))
                  }
                />
              </label>

              <div className="advanced-section-divider field-row-span">
                <span>Trim</span>
              </div>

              <label className="field">
                <span>Start (HH:MM:SS)</span>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="00:00:00"
                  value={advancedSettings.trimStart}
                  onChange={(event) => updateAdvanced('trimStart', event.target.value)}
                />
              </label>

              <label className="field">
                <span>End (HH:MM:SS)</span>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="00:00:00"
                  value={advancedSettings.trimEnd}
                  onChange={(event) => updateAdvanced('trimEnd', event.target.value)}
                />
              </label>
            </div>
          ) : null}

          <div className="action-row">
            <button
              type="button"
              className="primary-button"
              onClick={queueStagedFiles}
              disabled={stagedFiles.length === 0 || !concurrencyValid}
            >
              Add to batch queue
            </button>
          </div>

          <p className="notice-text">{notice}</p>
        </section>

        <aside className="panel reveal reveal-delay-2" aria-label="Batch queue">
          <div className="panel-title-row">
            <h2>Batch Queue</h2>
            <button
              type="button"
              className="ghost-button"
              onClick={clearInactiveJobs}
              disabled={queueStats.total === 0}
            >
              Clear done
            </button>
          </div>

          <div className="stat-grid">
            <div>
              <small>Total</small>
              <strong>{queueStats.total}</strong>
            </div>
            <div>
              <small>Active</small>
              <strong>{queueStats.active}</strong>
            </div>
            <div>
              <small>Queued</small>
              <strong>{queueStats.queued}</strong>
            </div>
            <div>
              <small>Done</small>
              <strong>{queueStats.completed}</strong>
            </div>
          </div>

          <div
            className="queue-progress-track"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={queueStats.aggregateProgress}
          >
            <div
              className="queue-progress-fill"
              style={{ width: `${queueStats.aggregateProgress}%` }}
            ></div>
          </div>
          <p className="queue-progress-copy">
            Overall progress: {queueStats.aggregateProgress}%
            {queueStats.failed > 0 ? ` • ${queueStats.failed} failed` : ''}
            {queueStats.cancelled > 0 ? ` • ${queueStats.cancelled} cancelled` : ''}
          </p>

          {jobs.length === 0 ? (
            <p className="empty-copy">Queue is empty. Stage files and add them to begin.</p>
          ) : (
            <ul className="queue-list">
              {jobs.map((job) => {
                const canCancel = job.status === 'queued' || isActiveStatus(job.status)
                const canRetry = job.status === 'failed' || job.status === 'cancelled'
                const canDownload = job.status === 'completed' && Boolean(job.outputBlob)

                return (
                  <li key={job.id} className={`queue-item status-${job.status}`}>
                    <div className="queue-item-top">
                      <strong title={job.sourceName}>{job.sourceName}</strong>
                      <span>{statusLabelMap[job.status]}</span>
                    </div>

                    <div className="queue-item-meta">
                      <small>{formatBytes(job.sourceSize)}</small>
                      <small>
                        {job.settings.simple.aspectMode === 'stretch169'
                          ? '16:9 stretch'
                          : '4:3 preserve'}
                      </small>
                    </div>

                    <div className="job-progress-track">
                      <div style={{ width: `${job.progress}%` }}></div>
                    </div>

                    <p className="job-message">{job.errorMessage ?? job.statusMessage}</p>

                    <div className="job-actions">
                      {canDownload ? (
                        <button
                          type="button"
                          className="success-button"
                          onClick={() => downloadJob(job)}
                        >
                          Download MP4
                        </button>
                      ) : null}

                      {canRetry ? (
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={() => retryJob(job.id)}
                        >
                          Retry
                        </button>
                      ) : null}

                      {canCancel ? (
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={() => cancelJob(job.id)}
                        >
                          Cancel
                        </button>
                      ) : null}

                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => removeJob(job.id)}
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </aside>
      </main>
    </div>
  )
}

export default App
import type { JobSettingsSnapshot } from '../../types/conversion'
import type { WorkerOutboundMessage } from '../../types/job'
import { ffmpegPool } from './workerPool'

export interface TranscodeCallbacks {
  onStatus?: (statusMessage: string) => void
  onProgress?: (progress: { progress: number; time: number }) => void
}

export interface TranscodeResult {
  outputName: string
  outputBlob: Blob
}

export interface TranscodeTask {
  start: (
    file: File,
    settings: JobSettingsSnapshot,
    callbacks?: TranscodeCallbacks,
  ) => Promise<TranscodeResult>
  cancel: () => void
}

const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message
  return 'Unknown worker error'
}

export const createTranscodeTask = (): TranscodeTask => {
  let worker: Worker | null = null
  let settled = false
  let cancelRequested = false
  let rejectPending: ((reason?: unknown) => void) | null = null

  const detachWorker = (): Worker | null => {
    const w = worker
    worker = null
    if (w) {
      w.onmessage = null
      w.onerror = null
    }
    return w
  }

  const cancel = (): void => {
    if (settled) return
    cancelRequested = true
    settled = true
    rejectPending?.(new DOMException('Conversion cancelled', 'AbortError'))
    rejectPending = null
    const w = detachWorker()
    if (w) ffmpegPool.discard(w)
  }

  const start = (
    file: File,
    settings: JobSettingsSnapshot,
    callbacks: TranscodeCallbacks = {},
  ): Promise<TranscodeResult> => {
    return new Promise<TranscodeResult>((resolve, reject) => {
      if (settled) {
        reject(new Error('This transcode task has already completed.'))
        return
      }

      rejectPending = reject
      worker = ffmpegPool.acquire()

      worker.onmessage = (event: MessageEvent<WorkerOutboundMessage>) => {
        const message = event.data
        if (cancelRequested || settled) return

        if (message.type === 'status') {
          callbacks.onStatus?.(message.payload.statusMessage)
          return
        }

        if (message.type === 'progress') {
          callbacks.onProgress?.({
            progress: message.payload.progress,
            time: message.payload.time,
          })
          return
        }

        if (message.type === 'done') {
          settled = true
          rejectPending = null
          const w = detachWorker()!
          ffmpegPool.release(w)
          resolve({
            outputName: message.payload.outputName,
            outputBlob: new Blob([message.payload.outputBuffer], { type: 'video/mp4' }),
          })
          return
        }

        if (message.type === 'error') {
          settled = true
          rejectPending = null
          const w = detachWorker()!
          ffmpegPool.release(w)
          reject(new Error(message.payload.errorMessage))
        }
      }

      worker.onerror = (event: ErrorEvent) => {
        if (cancelRequested || settled) return
        settled = true
        rejectPending = null
        const w = detachWorker()!
        ffmpegPool.release(w)
        reject(new Error(event.message || 'Worker crashed during conversion.'))
      }

      void (async () => {
        try {
          const inputBuffer = await file.arrayBuffer()
          if (cancelRequested || settled) return
          worker!.postMessage(
            { type: 'transcode', payload: { inputName: file.name, inputBuffer, settings } },
            [inputBuffer],
          )
        } catch (error) {
          if (cancelRequested || settled) return
          settled = true
          rejectPending = null
          const w = detachWorker()!
          ffmpegPool.release(w)
          reject(new Error(toErrorMessage(error)))
        }
      })()
    })
  }

  return { start, cancel }
}

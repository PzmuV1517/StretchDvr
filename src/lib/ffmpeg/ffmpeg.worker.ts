/// <reference lib="webworker" />

import { FFmpeg } from '@ffmpeg/ffmpeg'
import { toBlobURL } from '@ffmpeg/util'
import { buildFfmpegCommand } from './commandBuilder'
import type {
  WorkerInboundMessage,
  WorkerOutboundMessage,
  WorkerTranscodePayload,
} from '../../types/job'

const workerScope: DedicatedWorkerGlobalScope =
  self as DedicatedWorkerGlobalScope

let ffmpeg: FFmpeg | null = null
let progressHooked = false
/** Set to the thread count to pass to the encoder once the core is loaded. */
let resolvedThreads: number | undefined

// A single in-flight promise prevents double-initialisation when a warmup
// message and a transcode message arrive before loading completes.
let loadPromise: Promise<FFmpeg> | null = null

const postToMain = (
  message: WorkerOutboundMessage,
  transfer: Transferable[] = [],
): void => {
  workerScope.postMessage(message, transfer)
}

const sendStatus = (statusMessage: string): void => {
  postToMain({ type: 'status', payload: { statusMessage } })
}

const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message
  return 'Unexpected conversion error.'
}

/**
 * Returns true when SharedArrayBuffer is usable in this context.
 * Requires Cross-Origin-Opener-Policy: same-origin
 *       + Cross-Origin-Embedder-Policy: require-corp
 * to be sent by the server (already set in vite.config.ts for dev/preview).
 * On production the hosting server must also send these two headers.
 */
const isCrossOriginIsolated = (): boolean => {
  try {
    return (
      typeof SharedArrayBuffer !== 'undefined' &&
      // crossOriginIsolated is true only when both COOP + COEP are in effect
      (self as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated === true
    )
  } catch {
    return false
  }
}

const loadFfmpeg = (): Promise<FFmpeg> => {
  if (loadPromise) return loadPromise

  loadPromise = (async () => {
    if (!ffmpeg) {
      ffmpeg = new FFmpeg()
    }

    if (!progressHooked) {
      ffmpeg.on('progress', ({ progress, time }) => {
        postToMain({
          type: 'progress',
          payload: {
            progress: Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0,
            time: Number.isFinite(time) ? time : 0,
          },
        })
      })
      progressHooked = true
    }

    const useMT = isCrossOriginIsolated()

    if (useMT) {
      sendStatus('Loading multi-threaded FFmpeg core...')
      const base = '/ffmpeg-core-mt'
      const [coreURL, wasmURL, workerURL] = await Promise.all([
        toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'),
        toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm'),
        toBlobURL(`${base}/ffmpeg-core.worker.js`, 'text/javascript'),
      ])
      await ffmpeg.load({ coreURL, wasmURL, workerURL })
      // Use all logical cores for the encoder. If two workers are running
      // concurrently the OS scheduler divides the cores fairly between them.
      resolvedThreads = 0 // 0 = FFmpeg auto-detect
    } else {
      sendStatus('Loading FFmpeg core in your browser...')
      const base = '/ffmpeg-core'
      const [coreURL, wasmURL] = await Promise.all([
        toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'),
        toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm'),
      ])
      await ffmpeg.load({ coreURL, wasmURL })
      // Single-threaded WASM — threads flag is not useful.
      resolvedThreads = undefined
    }

    return ffmpeg
  })()

  return loadPromise
}

const transcode = async (payload: WorkerTranscodePayload): Promise<void> => {
  const ffmpegClient = await loadFfmpeg()
  const { args, outputName } = buildFfmpegCommand(
    payload.inputName,
    payload.settings,
    { threads: resolvedThreads },
  )
  const inputData = new Uint8Array(payload.inputBuffer)

  sendStatus('Writing source file...')
  await ffmpegClient.writeFile(payload.inputName, inputData)

  try {
    sendStatus('Converting video to MP4...')
    await ffmpegClient.exec(args)

    sendStatus('Collecting converted file...')
    const outputData = await ffmpegClient.readFile(outputName)
    if (!(outputData instanceof Uint8Array)) {
      throw new Error('FFmpeg returned an unexpected output type.')
    }

    const transferableBytes = new Uint8Array(outputData)

    postToMain(
      {
        type: 'done',
        payload: {
          outputName,
          outputBuffer: transferableBytes.buffer,
        },
      },
      [transferableBytes.buffer],
    )
  } finally {
    await ffmpegClient.deleteFile(payload.inputName).catch(() => undefined)
    await ffmpegClient.deleteFile(outputName).catch(() => undefined)
  }
}

workerScope.onmessage = (event: MessageEvent<WorkerInboundMessage | { type: 'warmup' }>): void => {
  const message = event.data

  if (message.type === 'warmup') {
    void loadFfmpeg()
    return
  }

  if (message.type !== 'transcode') {
    return
  }

  void (async () => {
    try {
      await transcode(message.payload)
    } catch (error) {
      postToMain({
        type: 'error',
        payload: { errorMessage: toErrorMessage(error) },
      })
    }
  })()
}

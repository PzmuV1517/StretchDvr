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

    sendStatus('Loading FFmpeg core in your browser...')

    // toBlobURL fetches via plain HTTP (not Vite's module system) and wraps
    // the response in a blob: URL, bypassing Vite's public/ import guard.
    const base = '/ffmpeg-core'
    const [coreURL, wasmURL] = await Promise.all([
      toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'),
      toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm'),
    ])

    await ffmpeg.load({ coreURL, wasmURL })

    return ffmpeg
  })()

  return loadPromise
}

const transcode = async (payload: WorkerTranscodePayload): Promise<void> => {
  const ffmpegClient = await loadFfmpeg()
  const { args, outputName } = buildFfmpegCommand(payload.inputName, payload.settings)
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

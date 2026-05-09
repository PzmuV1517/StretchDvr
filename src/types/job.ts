import type { JobSettingsSnapshot } from './conversion'

export type QueueJobStatus =
  | 'queued'
  | 'preparing'
  | 'converting'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface QueueJob {
  id: string
  sourceFile: File
  sourceName: string
  sourceSize: number
  settings: JobSettingsSnapshot
  status: QueueJobStatus
  statusMessage: string
  progress: number
  outputName?: string
  outputBlob?: Blob
  errorMessage?: string
}

export interface WorkerTranscodePayload {
  inputName: string
  inputBuffer: ArrayBuffer
  settings: JobSettingsSnapshot
}

export type WorkerInboundMessage = {
  type: 'transcode'
  payload: WorkerTranscodePayload
}

export type WorkerOutboundMessage =
  | {
      type: 'status'
      payload: {
        statusMessage: string
      }
    }
  | {
      type: 'progress'
      payload: {
        progress: number
        time: number
      }
    }
  | {
      type: 'done'
      payload: {
        outputName: string
        outputBuffer: ArrayBuffer
      }
    }
  | {
      type: 'error'
      payload: {
        errorMessage: string
      }
    }
// Singleton pool of persistent FFmpeg workers.
//
// Each worker pre-loads the FFmpeg WASM core immediately on creation so that
// by the time a job is dispatched, initialization is already complete (or
// well underway). Workers are never terminated after a job — they are
// released back to the idle list and reused. Only a cancelled job discards
// its worker, and the pool immediately spawns a replacement.

const WORKER_URL = new URL('./ffmpeg.worker.ts', import.meta.url)

function spawnWorker(): Worker {
  const worker = new Worker(WORKER_URL, { type: 'module' })
  worker.postMessage({ type: 'warmup' })
  return worker
}

class FFmpegWorkerPool {
  private idle: Worker[] = []
  private totalAlive = 0
  private target = 0

  setSize(n: number): void {
    this.target = n
    while (this.totalAlive < n) {
      this.idle.push(spawnWorker())
      this.totalAlive++
    }
  }

  acquire(): Worker {
    const worker = this.idle.shift()
    if (worker) {
      return worker
    }
    // Concurrency control in the caller should prevent this path, but fall
    // back to a fresh worker rather than deadlocking.
    this.totalAlive++
    return spawnWorker()
  }

  release(worker: Worker): void {
    this.idle.push(worker)
  }

  // Called when a job is cancelled. The worker must be terminated because
  // there is no way to interrupt FFmpeg mid-exec. A warm replacement is
  // spawned immediately so the pool never falls below its target size.
  discard(worker: Worker): void {
    worker.terminate()
    this.totalAlive--
    if (this.totalAlive < this.target) {
      this.idle.push(spawnWorker())
      this.totalAlive++
    }
  }
}

export const ffmpegPool = new FFmpegWorkerPool()

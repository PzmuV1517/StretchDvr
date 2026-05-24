import { useEffect } from 'react'

const STORAGE_KEY = 'stretchdvr_welcome_seen'

interface Props {
  onClose: () => void
}

export function WelcomeModal({ onClose }: Props) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  const handleClose = () => {
    localStorage.setItem(STORAGE_KEY, '1')
    onClose()
  }

  return (
    <div
      className="help-modal-overlay"
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-title"
    >
      <div
        className="help-modal welcome-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="help-modal-header">
          <h2 id="welcome-title">Hey, welcome!</h2>
          <button
            type="button"
            className="help-modal-close"
            onClick={handleClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="help-modal-body welcome-modal-body">
          <p>
            Thank you <strong>so so so so so soooo somuch</strong> for using StretchDvr... It genuinely means the world!
          </p>
          <p>
            To keep the lights on I've added a couple of small ads on the sides of the page.
            I've kept them as minimal and unobtrusive as possible, this tool and the rest of my stuff is open source so it helps :3
          </p>
          <p className="welcome-modal-thanks">
            <strong>Seriously, THANK YOU</strong> &lt;3
          </p>
        </div>

        <div className="welcome-modal-footer">
          <button
            type="button"
            className="primary-button"
            onClick={handleClose}
          >
            You're welcome, Andrei !
          </button>
        </div>
      </div>
    </div>
  )
}

/** Returns true if the welcome modal has not been shown before. */
export function shouldShowWelcome(): boolean {
  try {
    return !localStorage.getItem(STORAGE_KEY)
  } catch {
    return false
  }
}

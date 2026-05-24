import { useEffect } from 'react'

interface Props {
  onClose: () => void
}

export function DenoiseHelpModal({ onClose }: Props) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  return (
    <div
      className="help-modal-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      role="dialog"
      aria-modal="true"
      aria-label="Analogue denoising reference"
    >
      <div className="help-modal">
        <div className="help-modal-header">
          <h2>Analogue Denoising</h2>
          <button type="button" className="help-modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="help-modal-body">
          <p>
            Analogue FPV DVR footage is affected by three types of noise: <strong>Gaussian grain</strong> (static
            within each frame), <strong>temporal flicker</strong> (brightness/colour variation between frames),
            and <strong>chroma bleed</strong> (colour smearing between adjacent pixels). The <code>hqdn3d</code> filter
            in FFmpeg tackles all three in a single lightweight pass.
          </p>

          <h3>Parameters</h3>
          <dl className="help-params">
            <dt>Luma Spatial <span className="param-range">(0–10)</span></dt>
            <dd>
              Blurs grain <em>within</em> a single frame on the brightness channel. Think of it as a
              per-frame noise reduction. Keep this below 6 — pushing it higher produces a watercolour or
              painterly look where detail is lost.
            </dd>

            <dt>Chroma Spatial <span className="param-range">(0–8)</span></dt>
            <dd>
              The same as Luma Spatial but applied to colour channels. Reduces chroma bleed between
              pixels. Analogue video typically has heavy colour noise, so this often needs to be higher
              than you'd expect.
            </dd>

            <dt>Luma Temporal <span className="param-range">(0–12)</span></dt>
            <dd>
              Compares brightness across consecutive frames and averages out differences that look like
              flicker. This is the most effective parameter for eliminating the shimmer in analogue
              footage — but pushing it too high causes <strong>ghosting</strong> on fast-moving objects
              like spinning props. <strong>Reducing this first</strong> is the quickest way to speed up
              processing.
            </dd>

            <dt>Chroma Temporal <span className="param-range">(0–10)</span></dt>
            <dd>
              Same as Luma Temporal but for colour. Eliminates colour flicker between frames. Subject to
              the same ghosting trade-off at high values.
            </dd>
          </dl>

          <h3>Presets</h3>
          <dl className="help-params">
            <dt>Light <code>hqdn3d=2:2:3:2</code></dt>
            <dd>Safe starting point. Barely noticeable quality change, minimal processing overhead.</dd>

            <dt>Medium <code>hqdn3d=4:3:6:4</code></dt>
            <dd>Recommended for typical DVR footage. Good balance of noise reduction vs. sharpness.</dd>

            <dt>Heavy <code>hqdn3d=0:4:0:6,hqdn3d=6:5:10:7</code></dt>
            <dd>
              Adds a chroma-only pre-pass before the main filter to aggressively tackle colour bleed.
              Use for severely noisy footage. Watch for ghosting on props.
            </dd>

            <dt>Custom</dt>
            <dd>Edit any number box to enter Custom mode and dial in exactly what you need.</dd>
          </dl>

          <h3>What to avoid</h3>
          <ul className="help-cautions">
            <li><strong>High Luma / Chroma Spatial</strong> → watercolour / painterly look, detail is smeared</li>
            <li><strong>High Luma / Chroma Temporal</strong> → ghosting trails on fast props and camera shake</li>
            <li>Higher values always mean longer processing time — temporal parameters have the biggest impact</li>
          </ul>
        </div>
      </div>
    </div>
  )
}

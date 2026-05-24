import { useEffect, useRef, useState } from 'react'

interface Props {
  label: string
  min: number
  max: number
  value: number
  disabled: boolean
  onChange: (value: number) => void
}

export function DenoiseNumberInput({ label, min, max, value, disabled, onChange }: Props) {
  const [raw, setRaw] = useState(String(value))
  const [hasError, setHasError] = useState(false)
  const prevValue = useRef(value)

  // Sync display when an external change arrives (e.g. preset button pressed)
  // but don't overwrite while the user is in the middle of typing an invalid value
  useEffect(() => {
    if (prevValue.current !== value) {
      setRaw(String(value))
      setHasError(false)
      prevValue.current = value
    }
  }, [value])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const str = e.target.value
    setRaw(str)
    const num = parseInt(str, 10)
    if (Number.isFinite(num) && num >= min && num <= max) {
      setHasError(false)
      prevValue.current = num
      onChange(num)
    } else {
      setHasError(true)
    }
  }

  return (
    <label className={`field${hasError ? ' is-error' : ''}`}>
      <span>{label} <span className="param-range">({min}–{max})</span></span>
      <input
        type="number"
        min={min}
        max={max}
        step={1}
        value={raw}
        disabled={disabled}
        onChange={handleChange}
      />
      {hasError && (
        <small className="error-text">Value must be {min}–{max}</small>
      )}
    </label>
  )
}

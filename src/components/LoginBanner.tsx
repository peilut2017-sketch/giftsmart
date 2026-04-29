import { useState, useEffect, useCallback } from 'react'

interface Props {
  imageUrl: string
  duration: number
  skipAllowed: boolean
  onDismiss: () => void
}

export default function LoginBanner({ imageUrl, duration, skipAllowed, onDismiss }: Props) {
  const [timeLeft, setTimeLeft] = useState(duration)

  const dismiss = useCallback(() => onDismiss(), [onDismiss])

  useEffect(() => {
    setTimeLeft(duration)
  }, [imageUrl, duration])

  useEffect(() => {
    if (timeLeft <= 0) { dismiss(); return }
    const t = setTimeout(() => setTimeLeft(s => s - 1), 1000)
    return () => clearTimeout(t)
  }, [timeLeft, dismiss])

  const R = 11
  const circumference = 2 * Math.PI * R
  const offset = circumference * (timeLeft / duration)

  return (
    <div className="fixed inset-0 z-[300] bg-black flex items-center justify-center" dir="rtl">
      <img
        src={imageUrl}
        alt="באנר כניסה"
        className="w-full h-full object-contain select-none"
        draggable={false}
      />

      {/* Countdown / skip — top-left corner, compact, semi-transparent */}
      {skipAllowed ? (
        <button
          onClick={dismiss}
          className="absolute top-4 left-4 flex items-center gap-1.5 bg-black/40 backdrop-blur-md text-white px-3 py-1.5 rounded-full text-xs font-semibold border border-white/20 opacity-70 hover:opacity-100 transition-opacity shadow-md"
        >
          <span className="relative flex items-center justify-center w-6 h-6 flex-shrink-0">
            <svg width="24" height="24" className="-rotate-90 absolute inset-0">
              <circle cx="12" cy="12" r={R} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="2" />
              <circle
                cx="12" cy="12" r={R}
                fill="none"
                stroke="white"
                strokeWidth="2"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={circumference - offset}
                style={{ transition: 'stroke-dashoffset 1s linear' }}
              />
            </svg>
            <span className="relative text-white text-[9px] font-bold leading-none">{timeLeft}</span>
          </span>
          דלג
        </button>
      ) : (
        <div className="absolute top-4 left-4 flex items-center justify-center w-8 h-8 opacity-70">
          <svg width="32" height="32" className="-rotate-90 absolute inset-0">
            <circle cx="16" cy="16" r={R} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="2" />
            <circle
              cx="16" cy="16" r={R}
              fill="none"
              stroke="white"
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - timeLeft / duration)}
              style={{ transition: 'stroke-dashoffset 1s linear' }}
            />
          </svg>
          <span className="relative text-white text-[9px] font-bold leading-none">{timeLeft}</span>
        </div>
      )}
    </div>
  )
}

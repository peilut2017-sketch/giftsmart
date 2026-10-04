import { BRAND, CAPTIONS } from './config'
import type { CaptionLine } from './config'
import { ease, ep, lerp } from './timeline'

/**
 * Splits a caption into words, but keeps runs of Latin words together
 * ("Gift Smart") — each word is an inline-block, which the bidi algorithm
 * treats as a neutral character, so two separate Latin words inside an RTL
 * line would be visually swapped.
 */
function tokenize(text: string): string[] {
  const words = text.split(' ')
  const out: string[] = []
  const isLatin = (w: string) => /^[A-Za-z0-9&.@-]+$/.test(w)
  for (const w of words) {
    const prev = out[out.length - 1]
    if (prev && isLatin(w) && isLatin(prev.split(' ').pop()!)) out[out.length - 1] = prev + ' ' + w
    else out.push(w)
  }
  return out
}

const WORD_STAGGER = 0.055
const WORD_DUR = 0.6

function Line({ line, t }: { line: CaptionLine; t: number }) {
  const words = tokenize(line.text)
  const size = line.sub ? 46 : 84
  return (
    <div
      style={{
        fontSize: size,
        fontWeight: line.sub ? 500 : 800,
        lineHeight: line.sub ? 1.3 : 1.12,
        letterSpacing: line.sub ? '0' : '-0.025em',
        color: line.sub ? BRAND.text2 : line.accent ? BRAND.greenDeep : BRAND.text,
        marginTop: line.sub ? 22 : 0,
        textWrap: 'balance',
      }}
    >
      {words.map((w, i) => {
        const p = ep(t, line.at + i * WORD_STAGGER, line.at + i * WORD_STAGGER + WORD_DUR)
        const hl = line.highlightWords?.find(([idx]) => idx === i)
        const h = hl ? ep(t, hl[1], hl[1] + 0.35) : 0
        const baseColor = line.sub ? BRAND.text2 : line.accent ? BRAND.greenDeep : BRAND.text
        return (
          <span key={i}>
            <span
              style={{
                display: 'inline-block',
                opacity: p,
                transform: `translateY(${lerp(0.55, 0, p) * size}px) scale(${lerp(0.96, 1, p) + h * 0.04})`,
                filter: p < 1 ? `blur(${lerp(10, 0, p)}px)` : undefined,
                color: h > 0 ? mix(baseColor, BRAND.greenDeep, h) : undefined,
                whiteSpace: 'nowrap',
              }}
            >
              {w}
            </span>
            {i < words.length - 1 ? ' ' : null}
          </span>
        )
      })}
    </div>
  )
}

/** Linear hex color mix. */
function mix(a: string, b: string, p: number) {
  const pa = [1, 3, 5].map(i => parseInt(a.slice(i, i + 2), 16))
  const pb = [1, 3, 5].map(i => parseInt(b.slice(i, i + 2), 16))
  return `rgb(${pa.map((v, i) => Math.round(lerp(v, pb[i], p))).join(',')})`
}

/** The headline zone at the top of the frame (inside the social-safe area). */
export default function Captions({ t }: { t: number }) {
  return (
    <>
      {CAPTIONS.map((block, bi) => {
        const first = block.lines[0].at
        if (t < first - 0.05 || t > block.out + 0.5) return null
        const o = ep(t, block.out, block.out + 0.4, ease.inOut)
        return (
          <div
            key={bi}
            style={{
              position: 'absolute', top: 250, left: 90, right: 90,
              textAlign: 'center',
              opacity: 1 - o,
              transform: `translateY(${-40 * o}px)`,
              filter: o > 0 ? `blur(${o * 8}px)` : undefined,
            }}
          >
            {block.lines.map((line, li) => <Line key={li} line={line} t={t} />)}
          </div>
        )
      })}
    </>
  )
}

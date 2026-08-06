import { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import './LandingPage.css'
import AccessibilityWidget from '../components/AccessibilityWidget'

// ── Types ─────────────────────────────────────────────────────────
interface DemoCard {
  id: number
  store: string
  amount: number
  color: string
  letter: string
  expiry: string
}

type DemoScreen = 'wallet' | 'add' | 'alerts' | 'share' | 'stats'

interface Preset {
  store: string
  color: string
  letter: string
}

const PRESETS: Preset[] = [
  { store: 'סופר-פארם', color: '#e11d48', letter: 'ס' },
  { store: 'זארה',       color: '#7c3aed', letter: 'ז' },
  { store: 'אמזון',      color: '#2563eb', letter: 'A' },
  { store: 'נייקי',      color: '#ea580c', letter: 'נ' },
  { store: 'איקאה',      color: '#16a34a', letter: 'א' },
  { store: 'H&M',        color: '#0f172a', letter: 'H' },
]

const MEMBERS = ['דנה', 'יוסי', 'שרה']
const MEMBER_COLORS = ['#9333ea', '#c8880f', '#2563eb']

function defaultExpiry(): string {
  const d = new Date()
  d.setMonth(d.getMonth() + 6)
  return d.toISOString().split('T')[0]
}

function daysLeft(expiry: string): number | null {
  if (!expiry) return null
  return Math.ceil((new Date(expiry).getTime() - Date.now()) / 86400000)
}

// ── Interactive Demo ───────────────────────────────────────────────
function InteractiveDemo() {
  const [cards, setCards] = useState<DemoCard[]>([])
  const [screen, setScreen] = useState<DemoScreen>('wallet')
  const [selectedPreset, setSelectedPreset] = useState<Preset | null>(null)
  const [storeVal, setStoreVal] = useState('')
  const [amountVal, setAmountVal] = useState('')
  const [expiryVal, setExpiryVal] = useState(defaultExpiry())
  const [toast, setToast] = useState({ msg: '', show: false, error: false })
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [clock, setClock] = useState(() => {
    const n = new Date()
    return `${String(n.getHours()).padStart(2,'0')}:${String(n.getMinutes()).padStart(2,'0')}`
  })

  useEffect(() => {
    const t = setInterval(() => {
      const n = new Date()
      setClock(`${String(n.getHours()).padStart(2,'0')}:${String(n.getMinutes()).padStart(2,'0')}`)
    }, 10000)
    return () => clearInterval(t)
  }, [])

  const showToast = useCallback((msg: string, error = false) => {
    setToast({ msg, show: true, error })
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(t => ({ ...t, show: false })), 2200)
  }, [])

  const addCard = () => {
    const store = storeVal.trim()
    const amount = parseFloat(amountVal)
    if (!store) { showToast('🏪 הכנס שם חנות', true); return }
    if (!amount || amount <= 0) { showToast('💰 הכנס סכום תקין', true); return }
    const preset = selectedPreset || PRESETS.find(p => p.store === store) || null
    const hue = Math.floor(Math.random() * 360)
    const color = preset ? preset.color : `hsl(${hue},70%,45%)`
    const letter = preset ? preset.letter : store.charAt(0).toUpperCase()
    setCards(prev => [...prev, { id: Date.now(), store, amount, color, letter, expiry: expiryVal }])
    setStoreVal(''); setAmountVal(''); setSelectedPreset(null); setExpiryVal(defaultExpiry())
    setScreen('wallet')
    showToast('✅ שובר נוסף לארנק!')
  }

  const deleteCard = (id: number, e: React.MouseEvent) => {
    e.stopPropagation()
    setCards(prev => prev.filter(c => c.id !== id))
    showToast('🗑 שובר הוסר')
  }

  const total = cards.reduce((s, c) => s + c.amount, 0)
  const expiringSoon = cards.filter(c => { const d = daysLeft(c.expiry); return d !== null && d >= 0 && d <= 30 })

  const NavBar = ({ active }: { active: DemoScreen }) => (
    <div className="lp-dpf-nav">
      <button className={`lp-dpf-nb ${active==='wallet'?'lp-active':''}`} onClick={() => setScreen('wallet')}>
        <ph-icon name="wallet" weight="duotone" size="18"></ph-icon>
        <span>ארנק</span>
      </button>
      <button className="lp-dpf-nb" onClick={() => setScreen('add')}>
        <div className="lp-dpf-add-btn">
          <ph-icon name="plus" weight="bold" size="20" color="white"></ph-icon>
        </div>
      </button>
      <button className={`lp-dpf-nb ${active==='alerts'?'lp-active':''}`} onClick={() => setScreen('alerts')}>
        <ph-icon name="bell" weight="duotone" size="18"></ph-icon>
        <span>התראות</span>
      </button>
      <button className={`lp-dpf-nb ${active==='share'?'lp-active':''}`} onClick={() => setScreen('share')}>
        <ph-icon name="users-three" weight="duotone" size="18"></ph-icon>
        <span>שיתוף</span>
      </button>
      <button className={`lp-dpf-nb ${active==='stats'?'lp-active':''}`} onClick={() => setScreen('stats')}>
        <ph-icon name="chart-bar" weight="duotone" size="18"></ph-icon>
        <span>סטטיסטיקות</span>
      </button>
    </div>
  )

  return (
    <div className="lp-demo-wrap">
      <div className="lp-demo-label">
        <span className="lp-demo-dot" />
        נסה בעצמך — הנתונים נשמרים רק לסשן זה
      </div>
      <div className="lp-demo-phone">
        <div className="lp-phone-halo" />
        <div className="lp-dpf">
          {/* Status bar */}
          <div className="lp-dpf-status">
            <span>{clock}</span>
            <span style={{display:'flex',gap:3,alignItems:'center'}}>
              <span style={{width:3,height:6,background:'rgba(255,255,255,0.5)',borderRadius:1}}/>
              <span style={{width:3,height:9,background:'rgba(255,255,255,0.5)',borderRadius:1}}/>
              <span style={{width:3,height:12,background:'rgba(255,255,255,0.5)',borderRadius:1}}/>
            </span>
          </div>

          {/* Wallet screen */}
          <div className={`lp-dscreen${screen==='wallet'?'':' hidden'}`}>
            <div className="lp-dpf-header">
              <div className="lp-dpf-label">יתרה כוללת</div>
              <div className="lp-dpf-amount">₪{total.toLocaleString('he-IL')}</div>
              <div className="lp-dpf-meta">{cards.length} כרטיסים פעילים</div>
            </div>
            <div className="lp-dpf-list">
              {cards.length === 0 ? (
                <div className="lp-dpf-empty">
                  <div style={{fontSize:28,marginBottom:8}}>🎁</div>
                  <div style={{fontSize:12,color:'rgba(255,255,255,0.4)',textAlign:'center'}}>לחץ על + להוסיף שובר ראשון</div>
                </div>
              ) : (
                [...cards].reverse().map(card => {
                  const dl = daysLeft(card.expiry)
                  let expText = ''
                  let expClass = ''
                  if (dl !== null) {
                    if (dl < 0) { expText = 'פג תוקף!'; expClass = 'lp-expired' }
                    else if (dl <= 30) { expText = `${dl} ימים נותרו ⚠️`; expClass = 'lp-warn' }
                    else { expText = `בתוקף עד ${card.expiry}` }
                  }
                  return (
                    <div key={card.id} className="lp-dcard">
                      <div className="lp-dcard-stripe" style={{background:card.color}} />
                      <div className="lp-dcard-logo" style={{background:`${card.color}22`,color:card.color}}>{card.letter}</div>
                      <div className="lp-dcard-info">
                        <div className="lp-dcard-name">{card.store}</div>
                        {expText && <div className={`lp-dcard-exp ${expClass}`}>{expText}</div>}
                      </div>
                      <div className="lp-dcard-amount">₪{card.amount.toLocaleString('he-IL')}</div>
                      <button className="lp-dcard-del" onClick={e => deleteCard(card.id, e)}>✕</button>
                    </div>
                  )
                })
              )}
            </div>
            <NavBar active="wallet" />
          </div>

          {/* Add screen */}
          <div className={`lp-dscreen${screen==='add'?'':' hidden'}`}>
            <div className="lp-dadd-header">
              <button className="lp-dadd-back" onClick={() => setScreen('wallet')}>
                <ph-icon name="arrow-right" weight="bold" size="16"></ph-icon>
              </button>
              <div className="lp-dadd-title">הוסף שובר</div>
            </div>
            <div className="lp-dadd-body">
              <div className="lp-dadd-field">
                <label className="lp-dadd-lbl">שם החנות</label>
                <div className="lp-dadd-presets">
                  {PRESETS.map(p => (
                    <button
                      key={p.store}
                      className={`lp-preset-btn${selectedPreset?.store===p.store?' lp-selected':''}`}
                      onClick={() => { setSelectedPreset(p); setStoreVal(p.store) }}
                    >{p.store}</button>
                  ))}
                </div>
                <input
                  className="lp-dadd-input"
                  placeholder="או הקלד שם חנות..."
                  value={storeVal}
                  onChange={e => setStoreVal(e.target.value)}
                />
              </div>
              <div className="lp-dadd-field">
                <label className="lp-dadd-lbl">יתרה (₪)</label>
                <input
                  className="lp-dadd-input"
                  placeholder="לדוגמה: 250"
                  type="number"
                  inputMode="decimal"
                  min="1"
                  value={amountVal}
                  onChange={e => setAmountVal(e.target.value)}
                />
              </div>
              <div className="lp-dadd-field">
                <label className="lp-dadd-lbl">תוקף עד</label>
                <input
                  className="lp-dadd-input"
                  type="date"
                  value={expiryVal}
                  onChange={e => setExpiryVal(e.target.value)}
                />
              </div>
              <button className="lp-dadd-submit" onClick={addCard}>
                הוסף לארנק
                <ph-icon name="plus" weight="bold" size="16"></ph-icon>
              </button>
            </div>
            <NavBar active="add" />
          </div>

          {/* Alerts screen */}
          <div className={`lp-dscreen${screen==='alerts'?'':' hidden'}`}>
            <div className="lp-dadd-header">
              <button className="lp-dadd-back" onClick={() => setScreen('wallet')}>
                <ph-icon name="arrow-right" weight="bold" size="16"></ph-icon>
              </button>
              <div className="lp-dadd-title">התראות</div>
            </div>
            <div className="lp-dstats-body">
              {expiringSoon.length === 0 ? (
                <div className="lp-dpf-empty">
                  <div style={{fontSize:28,marginBottom:8}}>🔔</div>
                  <div style={{fontSize:12,color:'rgba(255,255,255,0.4)',textAlign:'center'}}>אין התראות כרגע</div>
                </div>
              ) : expiringSoon.map(c => (
                <div key={c.id} className="lp-dstat-row">
                  <div className="lp-dstat-name" style={{color:'#fbbf24'}}>⚠️ {c.store}</div>
                  <div className="lp-dstat-val" style={{color:'#fbbf24'}}>{daysLeft(c.expiry)} ימים</div>
                </div>
              ))}
            </div>
            <NavBar active="alerts" />
          </div>

          {/* Share screen */}
          <div className={`lp-dscreen${screen==='share'?'':' hidden'}`}>
            <div className="lp-dadd-header">
              <button className="lp-dadd-back" onClick={() => setScreen('wallet')}>
                <ph-icon name="arrow-right" weight="bold" size="16"></ph-icon>
              </button>
              <div className="lp-dadd-title">ארנק משותף</div>
            </div>
            <div className="lp-dstats-body">
              <div style={{background:'rgba(34,197,94,0.08)',border:'1px solid rgba(34,197,94,0.2)',borderRadius:12,padding:'12px 14px',marginBottom:14}}>
                <div style={{fontSize:10,color:'rgba(255,255,255,0.4)',marginBottom:4}}>הארנק שלך</div>
                <div style={{fontSize:13,fontWeight:700,color:'#fff'}}>ישראל ישראלי</div>
                <div style={{fontSize:10,color:'rgba(34,197,94,0.8)',marginTop:2}}>מנהל ✓</div>
              </div>
              <div style={{fontSize:10,fontWeight:700,color:'rgba(255,255,255,0.35)',letterSpacing:'0.06em',textTransform:'uppercase',marginBottom:10}}>בני משפחה</div>
              <div style={{display:'flex',flexDirection:'column',gap:8}}>
                {MEMBERS.map((m, i) => (
                  <div key={m} style={{background:'rgba(255,255,255,0.05)',border:'1px solid rgba(255,255,255,0.07)',borderRadius:10,padding:'10px 12px',display:'flex',alignItems:'center',gap:10}}>
                    <div style={{width:30,height:30,borderRadius:'50%',background:MEMBER_COLORS[i],display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,fontWeight:800,color:'#fff',flexShrink:0}}>{m.charAt(0)}</div>
                    <div style={{fontSize:12,fontWeight:700,color:'rgba(255,255,255,0.8)'}}>{m}</div>
                  </div>
                ))}
              </div>
            </div>
            <NavBar active="share" />
          </div>

          {/* Stats screen */}
          <div className={`lp-dscreen${screen==='stats'?'':' hidden'}`}>
            <div className="lp-dadd-header">
              <button className="lp-dadd-back" onClick={() => setScreen('wallet')}>
                <ph-icon name="arrow-right" weight="bold" size="16"></ph-icon>
              </button>
              <div className="lp-dadd-title">סטטיסטיקות</div>
            </div>
            <div className="lp-dstats-body">
              {cards.length === 0 ? (
                <div className="lp-dpf-empty">
                  <div style={{fontSize:28,marginBottom:8}}>📊</div>
                  <div style={{fontSize:12,color:'rgba(255,255,255,0.4)',textAlign:'center'}}>הוסף שוברים כדי לראות נתונים</div>
                </div>
              ) : (
                <>
                  <div className="lp-dstats-total">
                    <div className="lp-dstats-total-lbl">יתרה כוללת</div>
                    <div className="lp-dstats-total-val">₪{total.toLocaleString('he-IL')}</div>
                  </div>
                  {expiringSoon.length > 0 && (
                    <div style={{background:'rgba(251,191,36,0.1)',border:'1px solid rgba(251,191,36,0.25)',borderRadius:10,padding:'10px 12px',marginBottom:12,fontSize:11,color:'#fbbf24',fontWeight:700}}>
                      ⚠️ {expiringSoon.length} שוברים פגים בקרוב
                    </div>
                  )}
                  <div style={{fontSize:10,fontWeight:700,color:'rgba(255,255,255,0.35)',letterSpacing:'0.06em',textTransform:'uppercase',marginBottom:8}}>פירוט לפי חנות</div>
                  {cards.map(c => {
                    const pct = total > 0 ? Math.round((c.amount / total) * 100) : 0
                    return (
                      <div key={c.id} className="lp-dstat-row">
                        <div className="lp-dstat-name">{c.store}</div>
                        <div className="lp-dstat-bar-wrap">
                          <div className="lp-dstat-bar" style={{width:`${pct}%`,background:`linear-gradient(90deg,${c.color},${c.color}bb)`}} />
                        </div>
                        <div className="lp-dstat-val">₪{c.amount.toLocaleString('he-IL')}</div>
                      </div>
                    )
                  })}
                </>
              )}
            </div>
            <NavBar active="stats" />
          </div>

          {/* Toast */}
          <div
            className={`lp-toast${toast.show?' lp-show':''}`}
            style={{background: toast.error ? 'rgba(239,68,68,0.95)' : 'rgba(34,197,94,0.95)'}}
          >
            {toast.msg}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main Landing Page ──────────────────────────────────────────────
export default function LandingPage() {
  const navigate = useNavigate()
  const navRef = useRef<HTMLElement>(null)
  const probStagesRef = useRef<NodeListOf<Element> | null>(null)
  const probFillRef = useRef<HTMLDivElement | null>(null)
  const fmcRefs = useRef<HTMLDivElement[]>([])
  const marketSectionRef = useRef<HTMLDivElement | null>(null)
  const [probIdx, setProbIdx] = useState(1)

  const goToLogin = () => navigate('/login')

  // Navbar scroll effect
  useEffect(() => {
    const nav = navRef.current
    if (!nav) return
    const onScroll = () => nav.classList.toggle('lp-solid', window.scrollY > 60)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Scroll reveal
  useEffect(() => {
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add('lp-in')
          io.unobserve(e.target)
        }
      })
    }, { threshold: 0.12 })
    document.querySelectorAll('#lp-root .lp-rv').forEach(el => io.observe(el))
    return () => io.disconnect()
  }, [])

  // Problem scrollytelling
  useEffect(() => {
    const stages = document.querySelectorAll('.lp-prob-stage')
    const fill = document.getElementById('lp-prob-fill') as HTMLDivElement | null
    if (!stages.length || !fill) return
    probStagesRef.current = stages
    probFillRef.current = fill

    const pio = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          stages.forEach(s => s.classList.remove('lp-active'))
          e.target.classList.add('lp-active')
          const idx = +(e.target as HTMLElement).dataset.idx!
          setProbIdx(idx)
          fill.style.width = `${idx * 33.33}%`
          fill.style.background = idx === 1 ? '#ef4444' : idx === 2 ? '#f59e0b' : '#9333ea'
        }
      })
    }, { rootMargin: '-40% 0px -40% 0px', threshold: 0 })
    stages.forEach(s => pio.observe(s))
    return () => pio.disconnect()
  }, [])

  // Marketplace parallax
  useEffect(() => {
    const onScroll = () => {
      const section = marketSectionRef.current
      if (!section) return
      const rect = section.getBoundingClientRect()
      const p = -rect.top / (rect.height + window.innerHeight)
      const rotBases = ['-4deg', '2deg', '-1.5deg']
      fmcRefs.current.forEach((card, i) => {
        if (!card) return
        const shift = (p - 0.3) * 60 * [1.1, 0.7, 0.9][i]
        card.style.transform = `translateY(${shift}px) rotate(${rotBases[i]})`
      })
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <>
    <div id="lp-root">
      {/* ── NAVBAR ── */}
      <nav id="lp-nav" ref={navRef}>
        <a className="lp-nav-logo" href="#lp-hero">
          <div className="lp-nl-mark">
            <ph-icon name="check-fat" weight="bold" color="white" size="18"></ph-icon>
          </div>
          <span className="lp-nl-text">GiftSmart</span>
        </a>
        <ul className="lp-nav-links">
          <li><a href="#lp-problem">הבעיה</a></li>
          <li><a href="#lp-feat">פיצ'רים</a></li>
          <li><a href="#lp-how">איך זה עובד</a></li>
          <li><a href="#lp-market">שוק שוברים</a></li>
          <li><a href="#lp-pricing">תמחור</a></li>
        </ul>
        <button className="lp-nav-btn" onClick={goToLogin}>התחבר / הצטרף</button>
      </nav>

      {/* ── HERO ── */}
      <section id="lp-hero" className="lp-grain">
        {/* Orbs must be position:absolute inline — CSS alone can be overridden by cascade */}
        <div className="lp-hero-orb lp-ho1" style={{position:'absolute'}} />
        <div className="lp-hero-orb lp-ho2" style={{position:'absolute'}} />
        <div className="lp-hero-orb lp-ho3" style={{position:'absolute'}} />

        {/* Content wrapper — always above orbs and grain overlay */}
        <div style={{position:'relative', zIndex:2, width:'100%', display:'flex', flexDirection:'column', alignItems:'center', textAlign:'center'}}>
          <div className="lp-hero-eyebrow">✨&nbsp; בקרוב שוק שוברים מובנה</div>

          <h1 className="lp-ht">{'ארנק דיגיטלי חכם\nלכל שוברי המתנה שלך'}</h1>

          <p className="lp-hero-body">
            מעקב יתרה, התראות תוקף, שיתוף משפחתי ושוק קנייה ומכירה - הכל במקום אחד, תמיד עדכני, תמיד בטוח.
          </p>

          <div className="lp-hero-actions">
            <button className="lp-btn-hero-p" onClick={goToLogin}>התחל עכשיו</button>
            <a className="lp-btn-hero-g" href="#lp-feat">
              גלה את הפיצ'רים
              <ph-icon name="caret-down" weight="bold" size="16"></ph-icon>
            </a>
          </div>

          <InteractiveDemo />

          <div className="lp-scroll-cue">
            <span>גלול</span>
            <ph-icon name="caret-down" weight="bold" size="16"></ph-icon>
          </div>
        </div>
      </section>

      {/* ── PROBLEM ── */}
      <section id="lp-problem" style={{background:'#fff',padding:0,position:'relative'}}>
        <div className="lp-prob-wrap">
          <div className="lp-prob-sticky">
            <div className="lp-prob-eyebrow">
              <span className="lp-prob-dot" />
              <span>הבעיה · 0{probIdx} / 03</span>
            </div>
            <h2 className="lp-prob-bigtitle">
              <span className="lp-prob-strike">שובר מתנה</span><br />
              זה כסף.<br />
              <em>למה אנחנו זורקים</em><br />
              <em>אותו לפח?</em>
            </h2>
            <div className="lp-prob-progress">
              <div className="lp-prob-progress-fill" id="lp-prob-fill" />
            </div>
          </div>
          <div className="lp-prob-stages">
            <article className="lp-prob-stage" data-idx="1">
              <div className="lp-prob-num">01</div>
              <div className="lp-prob-meta">פגי תוקף</div>
              <h3>"אני אשתמש בו<br />בהזדמנות הבאה."</h3>
              <p>קיבלת שובר ליום הולדת. שמת אותו במגירה "להזדמנות טובה". נזכרת בו חודש אחרי שהתוקף פג. ₪400 התאדו.</p>
              <div className="lp-prob-stat">
                <span className="lp-prob-stat-n">23%</span>
                <span className="lp-prob-stat-l">משוברי המתנה בישראל לא נצרכים בזמן</span>
              </div>
            </article>
            <article className="lp-prob-stage" data-idx="2">
              <div className="lp-prob-num">02</div>
              <div className="lp-prob-meta">יתרה לא ידועה</div>
              <h3>"חשבתי שיש בו<br />עוד 200 ש״ח..."</h3>
              <p>בן הזוג השתמש בשובר. אתה לא ידעת. עומד בקופה, מנסה לשלם — והקופאית אומרת "היתרה: 12 ש״ח". מבוכה.</p>
              <div className="lp-prob-stat">
                <span className="lp-prob-stat-n">איפה</span>
                <span className="lp-prob-stat-l">היתרה? בכל פעם תצטרך לבדוק במקום אחר</span>
              </div>
            </article>
            <article className="lp-prob-stage" data-idx="3">
              <div className="lp-prob-num">03</div>
              <div className="lp-prob-meta">פיזור</div>
              <h3>"איפה<br />שמתי אותו?"</h3>
              <p>שובר במייל מ-2023. אחר במגירה. שלישי בצילום במכשיר. אין לך מושג מה יש לך, מה הכי שווה להשתמש בו עכשיו, ומה תכף פג.</p>
              <div className="lp-prob-stat">
                <span className="lp-prob-stat-n">∞</span>
                <span className="lp-prob-stat-l">מיילים, מגירות וצילומי מסך — בלי סדר</span>
              </div>
            </article>
          </div>
        </div>
        <div className="lp-prob-handoff">
          <div className="lp-prob-handoff-line" />
          <div className="lp-prob-handoff-pill">
            <ph-icon name="arrow-down" weight="bold" size="16"></ph-icon>
            <span>GiftSmart פותרת את שלושתם</span>
          </div>
          <div className="lp-prob-handoff-line" />
        </div>
      </section>

      {/* ── BENTO FEATURES ── */}
      <section id="lp-feat" className="lp-ed-section" style={{background:'var(--lp-bg)'}}>
        <div className="lp-ed-head lp-rv">
          <div className="lp-ed-rule" />
          <span className="lp-ed-eyebrow">פיצ'רים · 09</span>
        </div>
        <h2 className="lp-ed-bigtitle lp-rv">
          כל מה שצריך —<br />
          <em>בלי כל מה</em><br />
          <em>שלא צריך</em>
        </h2>
        <p className="lp-ed-lead lp-rv" style={{marginBottom:60}}>תשע יכולות שיוצרות את ההבדל בין ארנק שובר חכם לבין עוד אפליקציה שתימחק תוך שבוע.</p>
        <div className="lp-bento" style={{maxWidth:1200,marginInline:'auto'}}>

          {/* Wallet — c7 tall */}
          <div className="lp-bc lp-c7 lp-bc-wallet lp-rv">
            <div className="lp-bc-inner-lg">
              <div style={{display:'flex',alignItems:'center',gap:14,marginBottom:16}}>
                <div className="lp-bico"><ph-icon name="wallet" weight="duotone" size="28" color="#16a34a"></ph-icon></div>
                <div>
                  <div className="lp-btt" style={{marginBottom:2}}>ארנק שוברים</div>
                  <div className="lp-bsd">כל כרטיסי המתנה שלך במקום אחד</div>
                </div>
              </div>
              <div className="lp-wallet-stack">
                <div className="lp-wc lp-wc3"><div><div className="lp-wc-s">איקאה</div></div><div className="lp-wc-b">₪750</div></div>
                <div className="lp-wc lp-wc2"><div><div className="lp-wc-s">זארה</div></div><div className="lp-wc-b">₪280</div></div>
                <div className="lp-wc lp-wc1"><div><div className="lp-wc-s">סופר-פארם</div></div><div className="lp-wc-b">₪450</div></div>
              </div>
            </div>
          </div>

          {/* Expiry — c5 */}
          <div className="lp-bc lp-c5 lp-rv">
            <div className="lp-bc-inner">
              <div className="lp-bico"><ph-icon name="bell-ringing" weight="duotone" size="28" color="#ef4444"></ph-icon></div>
              <div className="lp-btt">תזכורות תוקף</div>
              <div className="lp-bsd">קבל התראה לפני שפג תוקף ואף שובר לא ייעלם.</div>
              <div className="lp-exp-alert">
                <div className="lp-exp-dot" />
                <div>
                  <div className="lp-exp-t">קפה ג'ו — פג בקרוב!</div>
                  <div className="lp-exp-d">9 ימים נותרו · ₪85</div>
                </div>
              </div>
            </div>
          </div>

          {/* Marketplace — c8 */}
          <div className="lp-bc lp-c8 lp-rv">
            <div className="lp-bc-inner">
              <div className="lp-bico"><ph-icon name="storefront" weight="duotone" size="28" color="#9333ea"></ph-icon></div>
              <div className="lp-btt">בקרוב... שוק השוברים</div>
              <div className="lp-bsd">קנה שוברים בהנחה ממשתמשים אחרים, או מכור שוברים שלא תצטרך.</div>
              <div className="lp-m-tiles">
                <div className="lp-m-tile"><div className="lp-m-tile-badge">-15%</div><div className="lp-m-tile-store">זארה</div><div className="lp-m-tile-price">₪255</div><div className="lp-m-tile-orig">₪300</div></div>
                <div className="lp-m-tile"><div className="lp-m-tile-badge">-20%</div><div className="lp-m-tile-store">נייקי</div><div className="lp-m-tile-price">₪415</div><div className="lp-m-tile-orig">₪500</div></div>
                <div className="lp-m-tile"><div className="lp-m-tile-badge">-17%</div><div className="lp-m-tile-store">Zara</div><div className="lp-m-tile-price">₪320</div><div className="lp-m-tile-orig">₪400</div></div>
              </div>
            </div>
          </div>

          {/* Stats — c4 */}
          <div className="lp-bc lp-c4 lp-rv">
            <div className="lp-bc-inner">
              <div className="lp-bico"><ph-icon name="chart-bar" weight="duotone" size="28" color="#2563eb"></ph-icon></div>
              <div className="lp-btt">סטטיסטיקות</div>
              <div className="lp-bsd">תובנות על ההוצאות שלך לפי קטגוריה.</div>
              <div className="lp-chart">
                <div className="lp-cb lp-b1"/><div className="lp-cb lp-b2"/><div className="lp-cb lp-b3"/>
                <div className="lp-cb lp-b4"/><div className="lp-cb lp-b5"/><div className="lp-cb lp-b6"/>
              </div>
            </div>
          </div>

          {/* AI Scan — c4 */}
          <div className="lp-bc lp-c4 lp-rv">
            <div className="lp-bc-inner" style={{alignItems:'flex-start'}}>
              <div className="lp-bico"><ph-icon name="scan" weight="duotone" size="28" color="#16a34a"></ph-icon></div>
              <div className="lp-btt">סריקה חכמה</div>
              <div className="lp-bsd">צלם שובר - הבינה המלאכותית תחלץ את הפרטים.</div>
              <div className="lp-scan">
                <div className="lp-scan-card" />
                <div className="lp-scan-beam" />
                <div className="lp-scan-corners">
                  <div className="lp-sc-tl"/><div className="lp-sc-tr"/><div className="lp-sc-bl"/><div className="lp-sc-br"/>
                </div>
              </div>
            </div>
          </div>

          {/* Shared Wallet — c4 */}
          <div className="lp-bc lp-c4 lp-rv">
            <div className="lp-bc-inner">
              <div className="lp-bico"><ph-icon name="users-three" weight="duotone" size="28" color="#c8880f"></ph-icon></div>
              <div className="lp-btt">ארנק משותף</div>
              <div className="lp-bsd">שתף את הארנק עם בני המשפחה.</div>
              <div className="lp-avs">
                <div className="lp-av" style={{background:'#16a34a'}}>ד</div>
                <div className="lp-av" style={{background:'#9333ea'}}>מ</div>
                <div className="lp-av" style={{background:'#c8880f'}}>ש</div>
                <div className="lp-av" style={{background:'#2563eb'}}>ר</div>
              </div>
            </div>
          </div>

          {/* Encrypted Vault — c4 */}
          <div className="lp-bc lp-c4 lp-rv">
            <div className="lp-bc-inner">
              <div className="lp-bico"><ph-icon name="lock-key" weight="duotone" size="28" color="#dc2626"></ph-icon></div>
              <div className="lp-btt">כספת מוצפנת</div>
              <div className="lp-bsd">הקודים שלך מוצפנים מקצה לקצה — רק אתה רואה אותם, גם אנחנו לא.</div>
              <div style={{marginTop:18,display:'flex',flexDirection:'column',gap:7}}>
                {['הצפנת AES-256','אימות דו-שלבי','גיבוי מאובטח בענן'].map(txt => (
                  <div key={txt} style={{display:'flex',alignItems:'center',gap:8,fontSize:12,fontWeight:600,color:'#4a6260'}}>
                    <div style={{width:18,height:18,borderRadius:5,background:'#fee2e2',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                      <ph-icon name="check" weight="bold" size="11" color="#dc2626"></ph-icon>
                    </div>
                    {txt}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Send Gift — c4 */}
          <div className="lp-bc lp-c4 lp-rv" style={{transitionDelay:'80ms'}}>
            <div className="lp-bc-inner">
              <div className="lp-bico"><ph-icon name="gift" weight="duotone" size="28" color="#ea580c"></ph-icon></div>
              <div className="lp-btt">שליחת מתנות</div>
              <div className="lp-bsd">שלח שובר כמתנה לחבר ישירות מהאפליקציה - בלי לרוץ לחנות.</div>
              <div style={{marginTop:18,background:'linear-gradient(135deg,#fff7ed,#ffedd5)',border:'1px solid #fed7aa',borderRadius:14,padding:'14px 16px',display:'flex',alignItems:'center',gap:12}}>
                <div style={{width:38,height:38,borderRadius:12,background:'linear-gradient(135deg,#ea580c,#f97316)',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,boxShadow:'0 4px 12px rgba(234,88,12,0.25)'}}>
                  <ph-icon name="paper-plane-tilt" weight="bold" size="18" color="white"></ph-icon>
                </div>
                <div>
                  <div style={{fontSize:13,fontWeight:700,color:'#9a3412'}}>שובר נשלח לדנה! 🎉</div>
                  <div style={{fontSize:11,color:'#c2410c',marginTop:2}}>זארה · ₪200 · נמסר</div>
                </div>
              </div>
            </div>
          </div>

          {/* Offline — c4 */}
          <div className="lp-bc lp-c4 lp-rv" style={{transitionDelay:'160ms'}}>
            <div className="lp-bc-inner">
              <div className="lp-bico"><ph-icon name="wifi-slash" weight="duotone" size="28" color="#16a34a"></ph-icon></div>
              <div className="lp-btt">עובד אופליין</div>
              <div className="lp-bsd">התקן כ-PWA והשוברים תמיד זמינים, גם ללא אינטרנט.</div>
              <div className="lp-offline-badge">
                <div className="lp-ob-dot" />
                <span className="lp-ob-text">PWA מותקן</span>
              </div>
            </div>
          </div>

        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section id="lp-how" className="lp-ed-section" style={{background:'#fff'}}>
        <div className="lp-ed-head lp-rv">
          <div className="lp-ed-rule" />
          <span className="lp-ed-eyebrow">איך זה עובד · 03 שלבים</span>
        </div>
        <h2 className="lp-ed-bigtitle lp-rv">
          דקה אחת.<br />
          <em>שלושה צעדים.</em><br />
          אפס סדר עכוב.
        </h2>
        <div className="lp-how-rows">
          <article className="lp-how-row lp-rv">
            <div className="lp-how-num">01</div>
            <div className="lp-how-meta">
              <div className="lp-how-step-label">צילום או הקלדה</div>
              <h3 className="lp-how-step-title">הוסף שובר ראשון תוך 8 שניות</h3>
              <p className="lp-how-step-body">צלם את השובר במצלמה — הבינה המלאכותית מזהה את החנות, היתרה ותאריך התוקף אוטומטית. או הקלד ידנית אם זה יותר נוח.</p>
            </div>
            <div className="lp-how-art" style={{background:'linear-gradient(135deg,#f0fdf4,#dcfce7)'}}>
              <ph-icon name="camera" weight="duotone" size="84" color="#16a34a"></ph-icon>
              <div className="lp-how-art-tag" style={{background:'#16a34a'}}>מזהה אוטומטית</div>
            </div>
          </article>
          <article className="lp-how-row lp-rv">
            <div className="lp-how-num">02</div>
            <div className="lp-how-meta">
              <div className="lp-how-step-label">ניהול יום-יומי</div>
              <h3 className="lp-how-step-title">תמיד תדע כמה נשאר</h3>
              <p className="lp-how-step-body">עדכן את היתרה בלחיצה אחרי כל קנייה. חיפוש מהיר, מיון לפי תוקף, סינון לפי קטגוריה.</p>
            </div>
            <div className="lp-how-art" style={{background:'linear-gradient(135deg,#eff6ff,#dbeafe)'}}>
              <ph-icon name="credit-card" weight="duotone" size="84" color="#2563eb"></ph-icon>
              <div className="lp-how-art-tag" style={{background:'#2563eb'}}>סנכרון חי</div>
            </div>
          </article>
          <article className="lp-how-row lp-rv">
            <div className="lp-how-num">03</div>
            <div className="lp-how-meta">
              <div className="lp-how-step-label">תזכורות חכמות</div>
              <h3 className="lp-how-step-title">לא עוד שובר שנשרף</h3>
              <p className="lp-how-step-body">התראות 30, 14 ו-3 ימים לפני פקיעת תוקף. הצעות "השתמש או מכור" כשנשארה הזדמנות. אף שובר לא נשכח.</p>
            </div>
            <div className="lp-how-art" style={{background:'linear-gradient(135deg,#fef3c7,#fde68a)'}}>
              <ph-icon name="bell-ringing" weight="duotone" size="84" color="#c8880f"></ph-icon>
              <div className="lp-how-art-tag" style={{background:'#c8880f'}}>3 התראות</div>
            </div>
          </article>
        </div>
      </section>

      {/* ── MARKETPLACE ── */}
      <section id="lp-market" className="lp-grain" ref={marketSectionRef}>
        <div className="lp-ms-grid">
          <div>
            <div className="lp-ed-head lp-rv" style={{margin:'0 0 24px'}}>
              <div className="lp-ed-rule" style={{background:'rgba(255,255,255,0.5)'}} />
              <span className="lp-ed-eyebrow" style={{color:'rgba(255,255,255,0.7)'}}>בקרוב · גרסה 2.0</span>
            </div>
            <h2 className="lp-ms-title lp-rv">קנה ומכור שוברים<br /><em style={{color:'#c084fc',fontStyle:'normal'}}>ממשתמשים אחרים</em></h2>
            <p className="lp-ms-body lp-rv">שוק פנימי מאובטח — מצא שוברים במחיר מוזל, מכור שוברים שאינך צריך. תשלום ידני, אימות מוכר, מערכת דירוג.</p>
            <div className="lp-ms-pills lp-rv">
              <div className="lp-ms-pill"><ph-icon name="chat-circle" weight="duotone" size="16" color="#c084fc"></ph-icon> צ'אט מובנה</div>
              <div className="lp-ms-pill"><ph-icon name="star" weight="duotone" size="16" color="#c084fc"></ph-icon> מערכת דירוג</div>
              <div className="lp-ms-pill"><ph-icon name="seal-check" weight="duotone" size="16" color="#c084fc"></ph-icon> מוכרים מאומתים</div>
            </div>
            <button className="lp-btn-ms lp-rv" onClick={goToLogin}>
              גלה את השוק
              <ph-icon name="arrow-left" weight="bold" size="17"></ph-icon>
            </button>
          </div>
          <div className="lp-ms-visual">
            <div className="lp-fmc lp-fmc1" ref={el => { if (el) fmcRefs.current[0] = el }}>
              <div className="lp-fmc-row"><div><div className="lp-fmc-store">זארה</div><div className="lp-fmc-sub">שובר · ₪300</div></div><div className="lp-fmc-disc">-15%</div></div>
              <div><span className="lp-fmc-or">₪300</span><span className="lp-fmc-pr">₪255</span></div>
              <div className="lp-fmc-stars">★★★★★<span className="lp-fmc-ct">(23)</span></div>
            </div>
            <div className="lp-fmc lp-fmc2" ref={el => { if (el) fmcRefs.current[1] = el }}>
              <div className="lp-fmc-row"><div><div className="lp-fmc-store">נייקי</div><div className="lp-fmc-sub">שובר · ₪500</div></div><div className="lp-fmc-disc">-17%</div></div>
              <div><span className="lp-fmc-or">₪500</span><span className="lp-fmc-pr">₪415</span></div>
              <div className="lp-fmc-stars">★★★★★<span className="lp-fmc-ct">(41)</span></div>
            </div>
            <div className="lp-fmc lp-fmc3" ref={el => { if (el) fmcRefs.current[2] = el }}>
              <div className="lp-fmc-row"><div><div className="lp-fmc-store">Body Shop</div><div className="lp-fmc-sub">שובר · ₪400</div></div><div className="lp-fmc-disc">-20%</div></div>
              <div><span className="lp-fmc-or">₪400</span><span className="lp-fmc-pr">₪320</span></div>
              <div className="lp-fmc-stars">★★★★<span style={{color:'#d1d5db'}}>★</span><span className="lp-fmc-ct">(8)</span></div>
            </div>
          </div>
        </div>
      </section>

      {/* ── PRICING ── */}
      <section id="lp-pricing" style={{background:'var(--lp-bg)',paddingBlock:'clamp(4rem,8vw,8rem)',paddingInline:'clamp(1.5rem,6vw,5rem)'}}>
        <div className="lp-ed-head lp-rv">
          <div className="lp-ed-rule" />
          <span className="lp-ed-eyebrow">תמחור · 2 מסלולים</span>
        </div>
        <h2 className="lp-ed-bigtitle lp-rv">
          <em>חינמי</em> זה לא טריק.<br />
          Pro זה <em>תוספת.</em>
        </h2>
        <p className="lp-ed-lead lp-rv" style={{marginBottom:60}}>בלי קופסאות מסומנות בכוכביות, בלי "פרימיום" שצובר אבק. שלם רק כשאתה מנהל יותר ממה שמסלול חינמי מאפשר.</p>

        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'clamp(1rem,2vw,1.5rem)',maxWidth:860,margin:'0 auto'}} className="lp-pricing-grid">

          {/* Free */}
          <div className="lp-rv" style={{background:'var(--lp-surf)',borderRadius:28,padding:'clamp(2rem,3vw,2.6rem)',border:'1px solid rgba(0,0,0,0.06)',boxShadow:'var(--lp-shadow-card)',position:'relative'}}>
            <div style={{fontSize:13,fontWeight:700,color:'var(--lp-text2)',marginBottom:6,textTransform:'uppercase',letterSpacing:'0.06em'}}>חינמי</div>
            <div style={{fontSize:48,fontWeight:900,color:'var(--lp-text)',letterSpacing:'-0.04em',lineHeight:1,marginBottom:6}}>₪0</div>
            <div style={{fontSize:13,color:'var(--lp-text3)',marginBottom:28}}>לצמיתות</div>
            <div style={{display:'flex',flexDirection:'column',gap:0,borderTop:'1px solid rgba(0,0,0,0.05)'}}>
              {[
                {feat:'שוברים',val:'עד 25',ok:true},
                {feat:'שיתוף משפחתי',val:'עד 5 שוברים',ok:true},
                {feat:'סריקות AI',val:'3 לחודש',ok:true},
                {feat:'ייצוא Excel / PDF',val:'לא זמין',ok:false},
                {feat:'היסטוריית פעילות',val:'7 ימים בלבד',ok:false},
                {feat:'התראות פקיעת תוקף',val:'לא זמין',ok:false},
              ].map(row => (
                <div key={row.feat} className={`lp-pr-row${row.ok?'':' lp-pr-dim'}`}>
                  <div className={`lp-pr-icon ${row.ok?'lp-pr-check':'lp-pr-x'}`}>
                    <ph-icon name={row.ok?'check':'x'} weight="bold" size="12" color={row.ok?'#16a34a':'#d1d5db'}></ph-icon>
                  </div>
                  <span className="lp-pr-feat">{row.feat}</span>
                  <span className={`lp-pr-val${row.ok?'':' lp-pr-na'}`}>{row.val}</span>
                </div>
              ))}
            </div>
            <button className="lp-pr-btn-free" onClick={goToLogin}>התחל בחינם</button>
          </div>

          {/* Pro */}
          <div className="lp-rv" style={{background:'linear-gradient(160deg,#0f1c1a 0%,#14532d 60%,#0f1c1a 100%)',borderRadius:28,padding:'clamp(2rem,3vw,2.6rem)',position:'relative',overflow:'hidden',boxShadow:'0 4px 24px rgba(22,163,74,0.2),0 24px 56px rgba(0,0,0,0.3)',transitionDelay:'80ms'}}>
            <div style={{position:'absolute',top:-60,left:-60,width:200,height:200,borderRadius:'50%',background:'radial-gradient(circle,rgba(34,197,94,0.2),transparent)',pointerEvents:'none'}} />
            <div style={{position:'absolute',top:20,left:20,background:'linear-gradient(135deg,#c8880f,#f59e0b)',color:'#fff',borderRadius:100,padding:'4px 12px',fontSize:11,fontWeight:800,boxShadow:'0 2px 8px rgba(200,136,15,0.4)'}}>מחיר השקה 🔥</div>
            <div style={{fontSize:13,fontWeight:700,color:'rgba(255,255,255,0.5)',marginBottom:6,textTransform:'uppercase',letterSpacing:'0.06em'}}>פרו</div>
            <div style={{display:'flex',alignItems:'flex-end',gap:8,marginBottom:6}}>
              <div style={{fontSize:48,fontWeight:900,color:'#fff',letterSpacing:'-0.04em',lineHeight:1}}>₪9</div>
              <div style={{fontSize:13,color:'rgba(255,255,255,0.4)',marginBottom:8,textDecoration:'line-through'}}>₪29</div>
            </div>
            <div style={{fontSize:13,color:'rgba(255,255,255,0.4)',marginBottom:28}}>לחודש · מחיר השקה</div>
            <div style={{display:'flex',flexDirection:'column',gap:0,borderTop:'1px solid rgba(255,255,255,0.08)'}}>
              {[
                {feat:'שוברים',val:'ללא הגבלה'},
                {feat:'שיתוף משפחתי',val:'ללא הגבלה'},
                {feat:'סריקות AI',val:'ללא הגבלה'},
                {feat:'ייצוא Excel / PDF',val:'כלול'},
                {feat:'היסטוריית פעילות',val:'מלאה'},
                {feat:'התראות פקיעת תוקף',val:'כלול'},
              ].map(row => (
                <div key={row.feat} className="lp-pr-row lp-pr-dark">
                  <div className="lp-pr-icon lp-pr-check-d">
                    <ph-icon name="check" weight="bold" size="12" color="#22c55e"></ph-icon>
                  </div>
                  <span className="lp-pr-feat-d">{row.feat}</span>
                  <span className="lp-pr-val-d">{row.val}</span>
                </div>
              ))}
            </div>
            <button className="lp-pr-btn-pro" onClick={goToLogin}>שדרג לפרו — ₪9 לחודש</button>
          </div>

        </div>
      </section>

      {/* ── AUDIENCE ── */}
      <section id="lp-audience" style={{background:'#fff',paddingBlock:'clamp(4rem,8vw,8rem)',paddingInline:'clamp(1.5rem,6vw,5rem)',position:'relative'}}>
        <div className="lp-ed-head lp-rv">
          <div className="lp-ed-rule" />
          <span className="lp-ed-eyebrow">למי זה מתאים</span>
        </div>
        <h2 className="lp-aud-bigtitle lp-rv">
          שלוש דרכים<br />
          <em>שאתה בתוך</em><br />
          <em>הסיפור הזה</em>
        </h2>
        <div className="lp-aud-rows">
          <article className="lp-aud-row lp-rv">
            <div className="lp-aud-row-num">01</div>
            <div className="lp-aud-row-side">
              <div className="lp-aud-row-label" style={{color:'var(--lp-g)'}}>מקבל שוברים</div>
              <h3 className="lp-aud-row-title">"כל החגים אני מקבל שוברים — והם הולכים לאיבוד."</h3>
              <p className="lp-aud-row-body">שובר זארה מיום ההולדת, שובר אמזון מהבוס, שובר מסעדה מההורים. כולם פתוחים בלשוניות נפרדות בטלפון שלך, וברגע שתסגור אותם — נעלמים.</p>
              <ul className="lp-aud-row-list">
                <li>אוטומציה: כל שובר נכנס לארנק בסריקה אחת</li>
                <li>אזהרה לפני שתוקף פג</li>
                <li>חיפוש מהיר לפי שם החנות</li>
              </ul>
            </div>
            <div className="lp-aud-row-art">
              <div className="lp-aud-art-bg" style={{background:'linear-gradient(135deg,#dcfce7 0%,#bbf7d0 100%)'}} />
              <ph-icon name="gift" weight="duotone" size="120" color="#16a34a" style={{position:'relative',opacity:0.55}}></ph-icon>
              <div className="lp-aud-art-tag" style={{background:'#16a34a'}}>+₪450 חדש</div>
            </div>
          </article>
          <article className="lp-aud-row lp-rv">
            <div className="lp-aud-row-num" style={{color:'#c8880f'}}>02</div>
            <div className="lp-aud-row-art">
              <div className="lp-aud-art-bg" style={{background:'linear-gradient(135deg,#fef3c7 0%,#fde68a 100%)'}} />
              <ph-icon name="house-line" weight="duotone" size="120" color="#c8880f" style={{position:'relative',opacity:0.55}}></ph-icon>
              <div className="lp-aud-art-tag" style={{background:'#c8880f'}}>משותף · 4</div>
            </div>
            <div className="lp-aud-row-side">
              <div className="lp-aud-row-label" style={{color:'#c8880f'}}>משפחה</div>
              <h3 className="lp-aud-row-title">"אני זה שמנהל את כל השוברים של הבית."</h3>
              <p className="lp-aud-row-body">בני המשפחה כולם מקבלים שוברים. בלי ארנק משותף — אף אחד לא יודע מה יש בבית. עם ארנק משותף — כולם רואים, כולם משתמשים.</p>
              <ul className="lp-aud-row-list lp-aud-list-gold">
                <li>ארנק משפחתי לכל בני הבית</li>
                <li>הרשאות נפרדות לכל חבר</li>
                <li>שליחת מתנות פנים-משפחתיות</li>
              </ul>
            </div>
          </article>
          <article className="lp-aud-row lp-rv">
            <div className="lp-aud-row-num" style={{color:'var(--lp-purple)'}}>03</div>
            <div className="lp-aud-row-side">
              <div className="lp-aud-row-label" style={{color:'var(--lp-purple)'}}>צייד עסקאות</div>
              <h3 className="lp-aud-row-title">"אני קונה שוברים בהנחה ומשלם פחות על הכל."</h3>
              <p className="lp-aud-row-body">שובר ב-₪500 שנמכר ב-₪420. הנחה של 16% על כל קנייה. שוק השוברים פותח גישה למאות שוברים פעילים שמשתמשים אחרים מוכרים.</p>
              <ul className="lp-aud-row-list lp-aud-list-purple">
                <li>הנחות של 8%–25% על שוברים פעילים</li>
                <li>מוכרים מאומתים עם דירוג</li>
                <li>למכור גם אתה — הפוך שוברים מיותרים לכסף</li>
              </ul>
            </div>
            <div className="lp-aud-row-art">
              <div className="lp-aud-art-bg" style={{background:'linear-gradient(135deg,#f3e8ff 0%,#e9d5ff 100%)'}} />
              <ph-icon name="storefront" weight="duotone" size="120" color="#9333ea" style={{position:'relative',opacity:0.55}}></ph-icon>
              <div className="lp-aud-art-tag" style={{background:'#9333ea'}}>−18% הנחה</div>
            </div>
          </article>
        </div>
      </section>

      {/* ── CTA ── */}
      <section id="lp-cta" className="lp-grain">
        <div className="lp-cta-box">
          <div className="lp-rv" style={{display:'flex',justifyContent:'center',gap:'clamp(1.5rem,4vw,3.5rem)',marginBottom:52,flexWrap:'wrap'}}>
            {[
              {n:'₪890K+',l:'יתרה מנוהלת'},
              {n:'2,400+',l:'שוברים פעילים'},
              {n:'98%',l:'שוברים שנצלו בזמן'},
            ].map((s, i) => (
              <>
                {i > 0 && <div key={`sep-${i}`} style={{width:1,background:'rgba(255,255,255,0.1)',alignSelf:'stretch'}} />}
                <div key={s.n} style={{textAlign:'center'}}>
                  <div style={{fontSize:'clamp(2rem,3.5vw,2.8rem)',fontWeight:900,color:'#fff',letterSpacing:'-0.04em',lineHeight:1}}>{s.n}</div>
                  <div style={{fontSize:13,color:'rgba(255,255,255,0.5)',marginTop:6,fontWeight:500}}>{s.l}</div>
                </div>
              </>
            ))}
          </div>
          <h2 className="lp-cta-title lp-rv">לא עוד שובר<br />שנזרק לפח</h2>
          <p className="lp-cta-sub lp-rv">הצטרף לאלפי משתמשים שכבר חוסכים עם GiftSmart.<br />חינם. ללא כרטיס אשראי. מתחילים תוך דקה.</p>
          <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:14}} className="lp-rv">
            <button className="lp-btn-cta" onClick={goToLogin}>התחל עכשיו</button>
            <div style={{display:'flex',alignItems:'center',gap:16,flexWrap:'wrap',justifyContent:'center'}}>
              {[
                {icon:'shield-check',text:'מוצפן ומאובטח'},
                {icon:'device-mobile',text:'iOS ו-Android'},
              ].map((item, i) => (
                <>
                  {i > 0 && <div key={`dot-${i}`} style={{width:3,height:3,borderRadius:'50%',background:'rgba(255,255,255,0.2)'}} />}
                  <div key={item.text} style={{display:'flex',alignItems:'center',gap:6,fontSize:13,color:'rgba(255,255,255,0.45)'}}>
                    <ph-icon name={item.icon} weight="fill" size="14" color="rgba(255,255,255,0.35)"></ph-icon>
                    {item.text}
                  </div>
                </>
              ))}
            </div>
          </div>
          <p className="lp-cta-fine lp-rv" style={{marginTop:24}}>גרסת Pro עם פיצ'רים מתקדמים זמינה למשתמשים כבדים</p>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer id="lp-footer">
        <a className="lp-fl" href="#lp-hero">
          <div className="lp-fl-m"><ph-icon name="check-fat" weight="bold" color="white" size="15"></ph-icon></div>
          <span className="lp-fl-t">GiftSmart</span>
        </a>
        <div className="lp-flinks">
          <a href="/privacy">פרטיות</a>
          <a href="/terms">תנאי שימוש</a>
          <a href="/accessibility">הצהרת נגישות</a>
        </div>
      </footer>
    </div>
    <AccessibilityWidget />
    </>
  )
}

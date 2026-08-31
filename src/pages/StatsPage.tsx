import { useMemo, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { Link } from 'react-router-dom'
import { useVouchers } from '../contexts/VoucherContext'
import { useSubscription } from '../contexts/SubscriptionContext'
import { useE2EE } from '../contexts/E2EEContext'
import { isEncryptedField } from '../lib/e2ee'
import { formatCurrency, getExpiryStatus, csvCell } from '../utils/helpers'
import Icon from '../components/ui/Icon'
import ConfirmDialog from '../components/ConfirmDialog'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import toast from 'react-hot-toast'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { useT } from '../lib/i18n'
import { usePageView } from '../hooks/usePageView'

export default function StatsPage() {
  const { vouchers, archivedVouchers, loading } = useVouchers()
  const { limits, openUpgradeSheet } = useSubscription()
  const { isVaultUnlocked, decryptedMap } = useE2EE()
  const { t } = useT()
  usePageView('stats')
  const [showSavingsInfo, setShowSavingsInfo] = useState(false)
  const [showCsvConfirm, setShowCsvConfirm] = useState(false)

  const stats = useMemo(() => {
    const active = vouchers.filter(v => !v.is_archived)
    const totalBalance = active.reduce((s, v) => s + v.balance, 0)
    const totalOriginal = active.reduce((s, v) => s + (v.amount || v.balance), 0)
    const avgBalance = active.length > 0 ? totalBalance / active.length : 0

    // Utilization includes archived so depleted vouchers count toward progress
    const allForUtil = [...active, ...archivedVouchers]
    const allOriginal = allForUtil.reduce((s, v) => s + (v.amount || v.balance), 0)
    const allBalance  = allForUtil.reduce((s, v) => s + v.balance, 0)
    const utilized = allOriginal > 0 ? Math.round(((allOriginal - allBalance) / allOriginal) * 100) : 0

    const expiringSoon = active.filter(v => {
      const s = getExpiryStatus(v.expiry_date)
      return s === 'warning' || s === 'critical'
    }).length
    const expired = active.filter(v => getExpiryStatus(v.expiry_date) === 'expired').length
    const shared = active.filter(v => v.is_shared).length

    // Near-zero vouchers (less than 10% of original value remaining)
    const nearZero = active.filter(v => {
      const orig = v.amount || v.balance
      return orig > 0 && v.balance > 0 && v.balance / orig < 0.1
    }).length

    // Gift vouchers
    const giftVouchers = active.filter(v => v.is_gift).length

    // Category breakdown — each category gets the FULL balance of vouchers assigned to it.
    // Each voucher counts once, under its primary (first) category — full-value
    // duplication across categories made the pie slices sum past 100% of the
    // wallet, which reads as a data bug.
    const catMap: Record<string, { balance: number; count: number }> = {}
    let multiCategoryCount = 0
    active.forEach(v => {
      const primary = v.categories[0] || 'אחר'
      if (v.categories.length > 1) multiCategoryCount++
      if (!catMap[primary]) catMap[primary] = { balance: 0, count: 0 }
      catMap[primary].balance += v.balance
      catMap[primary].count += 1
    })
    const categoryData = Object.entries(catMap)
      .filter(([, v]) => v.balance > 0)
      .map(([name, { balance, count }]) => ({ name, value: Math.round(balance), count }))
      .sort((a, b) => b.value - a.value)

    // Top stores by balance
    const storeMap: Record<string, { balance: number; count: number }> = {}
    active.forEach(v => {
      if (!storeMap[v.store_name]) storeMap[v.store_name] = { balance: 0, count: 0 }
      storeMap[v.store_name].balance += v.balance
      storeMap[v.store_name].count += 1
    })
    const topStores = Object.entries(storeMap)
      .map(([name, { balance, count }]) => ({ name, balance, count }))
      .sort((a, b) => b.balance - a.balance)
      .slice(0, 5)

    // Time-based activity stats
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    // Week starts on Sunday
    const weekStart = new Date(todayStart)
    weekStart.setDate(todayStart.getDate() - todayStart.getDay())
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

    const allVouchers = [...vouchers, ...archivedVouchers]

    const addedTodayList = allVouchers.filter(v => new Date(v.created_at) >= todayStart)
    const addedWeekList = allVouchers.filter(v => new Date(v.created_at) >= weekStart)
    const addedMonthList = allVouchers.filter(v => new Date(v.created_at) >= monthStart)

    const sumAmount = (list: typeof allVouchers) =>
      list.reduce((s, v) => s + (v.amount || v.balance), 0)

    // "Used" = vouchers whose balance was last updated within the period AND balance < original amount
    // Also includes archived vouchers (fully depleted) updated within the period
    const usedActive = active.filter(v => {
      const orig = v.amount || 0
      return orig > 0 && v.balance < orig
    })
    const usedArchived = archivedVouchers.filter(v => v.balance === 0 || (v.amount && v.balance < v.amount))
    const usedCandidates = [...usedActive, ...usedArchived]

    const usedTodayList = usedCandidates.filter(v => new Date(v.updated_at) >= todayStart)
    const usedWeekList = usedCandidates.filter(v => new Date(v.updated_at) >= weekStart)
    const usedMonthList = usedCandidates.filter(v => new Date(v.updated_at) >= monthStart)

    const sumUsed = (list: typeof usedCandidates) =>
      list.reduce((s, v) => s + ((v.amount || 0) - v.balance), 0)

    // Savings: vouchers with both amount > 0 and actual_cost set
    const allVouchersWithCost = [...vouchers, ...archivedVouchers].filter(
      v => v.actual_cost != null && v.actual_cost >= 0 && v.amount > 0
    )
    const totalSavings = allVouchersWithCost.reduce(
      (s, v) => s + (v.amount - (v.actual_cost ?? 0)), 0
    )
    const savingsCount = allVouchersWithCost.length
    const avgSavingsPct = savingsCount > 0
      ? Math.round(
          allVouchersWithCost.reduce((s, v) => s + (1 - (v.actual_cost ?? 0) / v.amount), 0)
          / savingsCount * 100
        )
      : 0

    return {
      totalBalance, totalOriginal, allOriginal, utilized, avgBalance,
      activeCount: active.length, expiringSoon, expired, shared,
      nearZero, giftVouchers, multiCategoryCount,
      categoryData, topStores, archivedCount: archivedVouchers.length,
      addedToday: addedTodayList.length, addedThisWeek: addedWeekList.length, addedThisMonth: addedMonthList.length,
      addedTodayAmount: sumAmount(addedTodayList), addedThisWeekAmount: sumAmount(addedWeekList), addedThisMonthAmount: sumAmount(addedMonthList),
      usedToday: usedTodayList.length, usedThisWeek: usedWeekList.length, usedThisMonth: usedMonthList.length,
      usedTodayAmount: sumUsed(usedTodayList), usedThisWeekAmount: sumUsed(usedWeekList), usedThisMonthAmount: sumUsed(usedMonthList),
      totalSavings, savingsCount, avgSavingsPct,
    }
  }, [vouchers, archivedVouchers])

  const COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4', '#f97316', '#ef4444']

  function exportCSV() {
    try {
      const date = new Date().toLocaleDateString('he-IL')
      const rows: string[][] = []
      const activeVouchers = vouchers.filter(v => !v.is_archived)
      const encryptedCount = activeVouchers.filter(v => v.is_e2ee && isEncryptedField(v.code)).length

      if (encryptedCount > 0 && !isVaultUnlocked) {
        toast(t('stats.export.encrypted.warning'), { icon: '🔒', duration: 4000 })
      }

      rows.push([t('stats.export.summary'), ''])
      rows.push([t('stats.active.vouchers'), stats.activeCount.toString()])
      rows.push([t('stats.available.balance'), formatCurrency(stats.totalBalance)])
      rows.push([t('stats.original'), formatCurrency(stats.totalOriginal)])
      rows.push([t('stats.usage.title'), `${stats.utilized}%`])
      rows.push([t('stats.avg.voucher'), formatCurrency(stats.avgBalance)])
      rows.push([t('stats.expiring.14'), stats.expiringSoon.toString()])
      rows.push([t('stats.archived.count'), stats.archivedCount.toString()])
      if (stats.savingsCount > 0) {
        rows.push([t('stats.savings.total'), formatCurrency(stats.totalSavings)])
        rows.push([t('stats.savings.avg.pct'), `${stats.avgSavingsPct}%`])
      }
      rows.push(['', ''])

      rows.push([t('stats.export.vouchers'), '', '', '', ''])
      rows.push([t('stats.export.col.store'), t('stats.export.col.code'), t('stats.export.col.balance'), t('stats.export.col.amount'), t('stats.export.col.expiry')])
      let omitted = 0
      activeVouchers.forEach(v => {
        const isEncrypted = v.is_e2ee && isEncryptedField(v.code)
        if (isEncrypted && !isVaultUnlocked) { omitted++; return }
        const decrypted = isEncrypted ? decryptedMap.get(v.id) : null
        const code = decrypted ? decrypted.code : v.code
        rows.push([
          v.store_name, code, v.balance.toString(), (v.amount || v.balance).toString(),
          v.expiry_date ? new Date(v.expiry_date).toLocaleDateString('he-IL') : '',
        ])
      })
      // The file must say rows are missing — a silent skip reads as a complete export
      if (omitted > 0) rows.push([t('stats.export.omitted', { count: omitted }), '', '', '', ''])

      const csvContent = '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\n')
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `giftsmart-${date.replace(/\//g, '-')}.csv`
      a.click()
      URL.revokeObjectURL(url)
      toast.success(t('stats.export.success'))
    } catch {
      toast.error(t('stats.export.error'))
    }
  }

  function exportPDF() {
    try {
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
      doc.setFontSize(18)
      doc.setFont('helvetica', 'bold')
      doc.text('GiftSmart - Voucher Report', 105, 20, { align: 'center' })
      doc.setFontSize(10)
      doc.setFont('helvetica', 'normal')
      doc.text(new Date().toLocaleDateString('en-GB'), 105, 28, { align: 'center' })
      doc.setFontSize(13)
      doc.setFont('helvetica', 'bold')
      doc.text('Summary', 20, 40)

      const summaryData: string[][] = [
        ['Active Vouchers', stats.activeCount.toString()],
        ['Total Balance (ILS)', stats.totalBalance.toFixed(2)],
        ['All-time Original (ILS)', stats.allOriginal.toFixed(2)],
        ['Utilized', `${stats.utilized}%`],
        ['Avg Voucher Value (ILS)', stats.avgBalance.toFixed(2)],
        ['Expiring Soon (14d)', stats.expiringSoon.toString()],
        ['Archived', stats.archivedCount.toString()],
        ['Added This Month', stats.addedThisMonth.toString()],
        ['Used This Month', stats.usedThisMonth.toString()],
      ]
      if (stats.savingsCount > 0) {
        summaryData.push(['Total Savings (ILS)', stats.totalSavings.toFixed(2)])
        summaryData.push(['Avg Savings %', `${stats.avgSavingsPct}%`])
        summaryData.push(['Vouchers with cost data', stats.savingsCount.toString()])
      }

      autoTable(doc, {
        startY: 45, head: [['Metric', 'Value']], body: summaryData, theme: 'striped',
        headStyles: { fillColor: [34, 197, 94] }, margin: { left: 20, right: 20 },
      })

      const afterSummary = (doc as any).lastAutoTable.finalY + 10
      doc.setFontSize(9)
      doc.setFont('helvetica', 'italic')
      doc.setTextColor(120, 120, 120)
      doc.text('For full voucher list with store names, use the CSV export.', 20, afterSummary)

      doc.save(`giftsmart-${new Date().toISOString().split('T')[0]}.pdf`)
      toast.success(t('stats.export.success'))
    } catch {
      toast.error(t('stats.export.error'))
    }
  }

  const StatCard = ({ icon, label, value, sub, color }: { icon: string; label: string; value: string | number; sub?: string; color?: string }) => (
    <div className="bg-surface rounded-2xl p-4 shadow-card">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-bg">
          <Icon name={icon} size={20} color={color || 'var(--c-text2)'} />
        </div>
        <div>
          <p className="text-sm text-text3">{label}</p>
          <p className="text-xl font-bold" style={{ color: color || 'var(--c-text)' }}>{value}</p>
          {sub && <p className="text-xs text-text3">{sub}</p>}
        </div>
      </div>
    </div>
  )

  const TimeStatRow = ({ label, today, todayAmount, week, weekAmount, month, monthAmount }: {
    label: string; today: number; todayAmount: number; week: number; weekAmount: number; month: number; monthAmount: number
  }) => (
    <div>
      <span className="text-sm font-medium text-text2 mb-2 block">{label}</span>
      <div className="grid grid-cols-3 gap-2">
        {[
          { period: t('stats.today'), count: today, amount: todayAmount },
          { period: t('stats.this.week'), count: week, amount: weekAmount },
          { period: t('stats.this.month'), count: month, amount: monthAmount },
        ].map(({ period, count, amount }) => (
          <div key={period} className="bg-bg rounded-xl px-2 py-2.5 text-center">
            <p className="text-xs text-text3 mb-1">{period}</p>
            <p className="text-lg font-bold text-text leading-none">{count}</p>
            <p className="text-xs text-text2 mt-1">{formatCurrency(amount)}</p>
          </div>
        ))}
      </div>
    </div>
  )

  return (
    <div className="flex-1 bg-bg">
      <div className="bg-surface border-b border-border px-5 pt-5 pb-4">
        <div className="flex justify-between items-center">
          <div>
            <div className="text-[22px] font-extrabold text-text">{t('stats.title')}</div>
            <div className="text-[13px] text-text3 mt-0.5">{t('stats.subtitle')}</div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowCsvConfirm(true)} className="flex items-center gap-1.5 text-sm bg-primary-light text-primary-dark px-3 py-2 rounded-xl font-medium hover:opacity-90">
              <Icon name="download" size={16} /> CSV
            </button>
            {limits.canExport ? (
              <button onClick={exportPDF} className="flex items-center gap-1.5 text-sm bg-blue-50 text-blue-700 px-3 py-2 rounded-xl font-medium hover:bg-blue-100">
                <Icon name="download" size={16} /> PDF
              </button>
            ) : (
              <button onClick={() => openUpgradeSheet(t('stats.export.pro'))} className="flex items-center gap-1.5 text-sm bg-gold-light text-gold px-3 py-2 rounded-xl font-medium hover:opacity-90">
                <Icon name="bolt" size={16} /> PDF · Pro
              </button>
            )}
          </div>
        </div>
      </div>

      {loading && vouchers.length === 0 && archivedVouchers.length === 0 ? (
        // Don't flash the "you have no vouchers" empty state during the initial
        // load — a returning user with 40 vouchers saw "add your first voucher".
        <div className="p-4 pb-28 space-y-4">
          <div className="h-40 rounded-[20px] bg-bg animate-pulse" />
          <div className="grid grid-cols-2 gap-3">
            <div className="h-24 rounded-2xl bg-bg animate-pulse" />
            <div className="h-24 rounded-2xl bg-bg animate-pulse" />
          </div>
          <div className="h-64 rounded-2xl bg-bg animate-pulse" />
        </div>
      ) : vouchers.length === 0 && archivedVouchers.length === 0 ? (
        <div className="text-center py-20 px-6">
          <Icon name="monitoring" size={48} color="var(--c-border)" />
          <p className="text-text font-bold mt-4">{t('stats.empty.title')}</p>
          <p className="text-sm text-text2 mt-1">{t('stats.empty.hint')}</p>
          <Link to="/" className="inline-block mt-5 px-6 py-3 rounded-2xl bg-primary text-white text-sm font-semibold">
            {t('stats.empty.cta')}
          </Link>
        </div>
      ) : (
      <div className="p-4 pb-28 space-y-4">
        {/* Total balance */}
        <div className="rounded-[20px] p-6 text-white" style={{ background: 'linear-gradient(160deg, var(--c-primary-dark) 0%, var(--c-primary) 60%, #1a9e90 100%)' }}>
          <p className="text-sm mb-1" style={{ color: 'rgba(255,255,255,0.85)' }}>{t('stats.available.balance')}</p>
          <p className="text-4xl font-bold mb-1">{formatCurrency(stats.totalBalance)}</p>
          <div className="flex items-center gap-3 text-sm" style={{ color: 'rgba(255,255,255,0.85)' }}>
            <span>{stats.activeCount} {t('stats.active.vouchers')}</span>
            {stats.totalOriginal > stats.totalBalance && <span>• {t('stats.used.label')} {formatCurrency(stats.totalOriginal - stats.totalBalance)}</span>}
          </div>
        </div>

        {/* Utilization bar */}
        {stats.allOriginal > 0 && (
          <div className="bg-surface rounded-card shadow-card p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-text2">{t('stats.usage.title')}</span>
              <span className="text-sm font-bold text-text">{stats.utilized}%</span>
            </div>
            <div className="h-3 bg-bg rounded-full overflow-hidden">
              <div className="h-full w-full bg-gradient-to-r from-blue-400 to-blue-600 rounded-full origin-right" style={{ transform: `scaleX(${Math.min(100, stats.utilized) / 100})`, transition: 'transform 200ms var(--ease-out)' }} />
            </div>
            <div className="flex justify-between text-xs text-text3 mt-1">
              <span>{t('stats.original')} {formatCurrency(stats.allOriginal)}</span>
              <span>{t('stats.remaining')} {formatCurrency(stats.totalBalance)}</span>
            </div>
          </div>
        )}

        {/* Savings section */}
        {stats.savingsCount > 0 && (
          <div className="rounded-[20px] p-5 text-white relative" style={{ background: 'linear-gradient(135deg, #7c3aed 0%, #9333ea 60%, #a855f7 100%)' }}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Icon name="stars" size={20} color="#e9d5ff" />
                <h3 className="font-bold text-white">{t('stats.savings.title')}</h3>
              </div>
              <button onClick={() => setShowSavingsInfo(v => !v)} className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center hover:bg-white/30">
                <Icon name="info" size={16} color="#fff" />
              </button>
            </div>
            {showSavingsInfo && <div className="bg-black/20 rounded-xl p-3 mb-3 text-sm text-white/90 leading-relaxed">{t('stats.savings.info.text')}</div>}
            <p className="text-4xl font-bold text-white mb-3">{formatCurrency(stats.totalSavings)}</p>
            <div className="flex items-center gap-6">
              <div>
                <p className="text-xs mb-0.5" style={{ color: '#e9d5ff' }}>{t('stats.savings.avg.pct')}</p>
                <p className="text-white font-bold text-xl">{stats.avgSavingsPct}%</p>
              </div>
              <div className="w-px h-8 bg-white/20" />
              <div><p className="text-xs mb-0.5" style={{ color: '#e9d5ff' }}>{t('stats.savings.count', { count: stats.savingsCount })}</p></div>
            </div>
          </div>
        )}

        {/* Activity over time */}
        <div className="bg-surface rounded-card shadow-card p-5">
          <h3 className="font-semibold text-text2 mb-4 flex items-center gap-2"><Icon name="schedule" size={16} color="#3b82f6" /> {t('stats.activity.title')}</h3>
          <div className="space-y-4">
            <TimeStatRow label={t('stats.added.count')} today={stats.addedToday} todayAmount={stats.addedTodayAmount} week={stats.addedThisWeek} weekAmount={stats.addedThisWeekAmount} month={stats.addedThisMonth} monthAmount={stats.addedThisMonthAmount} />
            <TimeStatRow label={t('stats.utilized.count')} today={stats.usedToday} todayAmount={stats.usedTodayAmount} week={stats.usedThisWeek} weekAmount={stats.usedThisWeekAmount} month={stats.usedThisMonth} monthAmount={stats.usedThisMonthAmount} />
          </div>
          <p className="text-xs text-text3 mt-3 flex items-start gap-1"><Icon name="info" size={13} color="var(--c-text3)" className="mt-0.5 shrink-0" /> {t('stats.used.footnote')}</p>
        </div>

        {/* Stat grid */}
        <div className="grid grid-cols-2 gap-3">
          <StatCard icon="account_balance_wallet" label={t('stats.avg.voucher')} value={formatCurrency(stats.avgBalance)} color="var(--c-primary)" />
          <StatCard icon="warning" label={t('stats.expiring.14')} value={stats.expiringSoon} color={stats.expiringSoon > 0 ? 'var(--c-warning)' : 'var(--c-text3)'} />
          <StatCard icon="archive" label={t('stats.archived.count')} value={stats.archivedCount} color="var(--c-text3)" />
          <StatCard icon="event_busy" label={t('stats.expired.active')} value={stats.expired} color={stats.expired > 0 ? 'var(--c-error)' : 'var(--c-text3)'} />
          <StatCard icon="group" label={t('stats.shared.count')} value={stats.shared} color="#3b82f6" />
          <StatCard icon="shopping_bag" label={t('stats.near.empty')} value={stats.nearZero} color={stats.nearZero > 0 ? 'var(--c-gold)' : 'var(--c-text3)'} sub={stats.nearZero > 0 ? t('stats.near.empty.hint') : undefined} />
          {stats.giftVouchers > 0 && <StatCard icon="redeem" label={t('stats.gift.count')} value={stats.giftVouchers} color="#ec4899" />}
          <StatCard icon="add_circle" label={t('stats.added.month')} value={stats.addedThisMonth} color="#6366f1" />
        </div>

        {/* Top stores */}
        {stats.topStores.length > 0 && (
          <div className="bg-surface rounded-card shadow-card p-5">
            <h3 className="font-semibold text-text2 mb-4">{t('stats.top.stores')}</h3>
            <div className="space-y-3">
              {stats.topStores.map((store, i) => {
                const maxBalance = stats.topStores[0].balance
                const pct = maxBalance > 0 ? (store.balance / maxBalance) * 100 : 0
                return (
                  <div key={store.name}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-text3 w-4">{i + 1}</span>
                        <span className="text-sm text-text2 truncate max-w-[140px]">{store.name}</span>
                        <span className="text-xs text-text3">({store.count})</span>
                      </div>
                      <span className="text-sm font-semibold text-text">{formatCurrency(store.balance)}</span>
                    </div>
                    <div className="h-2 bg-bg rounded-full overflow-hidden mr-6">
                      <div className="h-full w-full rounded-full bg-gradient-to-r from-primary-mid to-primary-dark origin-right" style={{ transform: `scaleX(${Math.min(100, pct) / 100})`, transition: 'transform 200ms var(--ease-out)' }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Category chart */}
        {stats.categoryData.length > 0 && (
          <div className="bg-surface rounded-card shadow-card p-5">
            <h3 className="font-semibold text-text2 mb-1">{t('stats.by.category')}</h3>
            {stats.multiCategoryCount > 0 && (
              <p className="text-xs text-text3 mb-3 flex items-start gap-1"><Icon name="info" size={13} color="var(--c-text3)" className="mt-0.5 shrink-0" /> {t('stats.multi.cat.note')}</p>
            )}
            {/* Recharts positions tooltips assuming LTR — inside an RTL page the
                tooltip gets clipped at the container edge, so the chart itself
                renders in an LTR island while all labels stay translated */}
            <div dir="ltr">
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={stats.categoryData} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={3} dataKey="value">
                    {stats.categoryData.map((_entry, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v) => formatCurrency(Number(v))} contentStyle={{ direction: 'rtl', fontFamily: 'inherit' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 space-y-2">
              {stats.categoryData.map((cat, i) => (
                <div key={cat.name} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                    <span className="text-sm text-text2">{cat.name}</span>
                    <span className="text-xs text-text3">({cat.count})</span>
                  </div>
                  <span className="text-sm font-semibold text-text">{formatCurrency(cat.value)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      )}

      <AnimatePresence>
        {showCsvConfirm && (
          <ConfirmDialog
            title={t('stats.export.csv.confirm.title')}
            message={t('stats.export.csv.confirm.message')}
            confirmLabel={t('stats.export.csv.confirm.cta')}
            onConfirm={() => { setShowCsvConfirm(false); exportCSV() }}
            onCancel={() => setShowCsvConfirm(false)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

import { useMemo, useState } from 'react'
import { useVouchers } from '../contexts/VoucherContext'
import { useSubscription } from '../contexts/SubscriptionContext'
import { formatCurrency, getExpiryStatus } from '../utils/helpers'
import { TrendingUp, AlertTriangle, Archive, Users, Download, Wallet, Zap, PlusCircle, ShoppingBag, Clock, Gift, Info, Sparkles } from 'lucide-react'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import toast from 'react-hot-toast'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { useT } from '../lib/i18n'

export default function StatsPage() {
  const { vouchers, archivedVouchers } = useVouchers()
  const { limits, openUpgradeSheet } = useSubscription()
  const { t } = useT()
  const [showSavingsInfo, setShowSavingsInfo] = useState(false)

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
    // Vouchers with multiple categories appear in each category at their full value.
    // This means the sum may exceed totalBalance when vouchers span multiple categories.
    const catMap: Record<string, { balance: number; count: number }> = {}
    let multiCategoryCount = 0
    active.forEach(v => {
      if (v.categories.length === 0) {
        if (!catMap['אחר']) catMap['אחר'] = { balance: 0, count: 0 }
        catMap['אחר'].balance += v.balance
        catMap['אחר'].count += 1
      } else {
        if (v.categories.length > 1) multiCategoryCount++
        v.categories.forEach(cat => {
          if (!catMap[cat]) catMap[cat] = { balance: 0, count: 0 }
          catMap[cat].balance += v.balance
          catMap[cat].count += 1
        })
      }
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

      // Summary section
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

      // Voucher list
      rows.push([t('stats.export.vouchers'), '', '', '', ''])
      rows.push([t('stats.export.col.store'), t('stats.export.col.code'), t('stats.export.col.balance'), t('stats.export.col.amount'), t('stats.export.col.expiry')])
      const activeVouchers = vouchers.filter(v => !v.is_archived)
      activeVouchers.forEach(v => {
        rows.push([
          v.store_name,
          v.code,
          v.balance.toString(),
          (v.amount || v.balance).toString(),
          v.expiry_date ? new Date(v.expiry_date).toLocaleDateString('he-IL') : '',
        ])
      })

      // BOM + CSV content (BOM makes Excel open Hebrew correctly)
      const csvContent = '﻿' + rows.map(r => r.map(cell => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n')
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
        startY: 45,
        head: [['Metric', 'Value']],
        body: summaryData,
        theme: 'striped',
        headStyles: { fillColor: [34, 197, 94] },
        margin: { left: 20, right: 20 },
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

  const StatCard = ({ icon: Icon, label, value, sub, color = 'text-gray-700' }: any) => (
    <div style={{ background: 'var(--c-surface)', borderRadius: 16, padding: 16, boxShadow: 'var(--shadow-card)', border: 'none' }}>
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-gray-50">
          <Icon className={`w-5 h-5 ${color}`} />
        </div>
        <div>
          <p className="text-sm text-gray-500">{label}</p>
          <p className={`text-xl font-bold ${color}`}>{value}</p>
          {sub && <p className="text-xs text-gray-400">{sub}</p>}
        </div>
      </div>
    </div>
  )

  const TimeStatRow = ({
    label,
    today, todayAmount,
    week, weekAmount,
    month, monthAmount,
  }: {
    label: string
    today: number; todayAmount: number
    week: number; weekAmount: number
    month: number; monthAmount: number
  }) => (
    <div>
      <span className="text-sm font-medium text-gray-700 mb-2 block">{label}</span>
      <div className="grid grid-cols-3 gap-2">
        {[
          { period: t('stats.today'), count: today, amount: todayAmount },
          { period: t('stats.this.week'), count: week, amount: weekAmount },
          { period: t('stats.this.month'), count: month, amount: monthAmount },
        ].map(({ period, count, amount }) => (
          <div key={period} className="bg-gray-50 rounded-xl px-2 py-2.5 text-center">
            <p className="text-xs text-gray-400 mb-1">{period}</p>
            <p className="text-lg font-bold text-gray-800 leading-none">{count}</p>
            <p className="text-xs text-gray-500 mt-1">{formatCurrency(amount)}</p>
          </div>
        ))}
      </div>
    </div>
  )

  return (
    <div className="flex-1" style={{ background: 'var(--c-bg)' }}>
      <div style={{ background: 'var(--c-surface)', borderBottom: '1px solid var(--c-border)', padding: '20px 20px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--c-text)' }}>{t('stats.title')}</div>
            <div style={{ fontSize: 13, color: 'var(--c-text3)', marginTop: 2 }}>{t('stats.subtitle')}</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={exportCSV}
              className="flex items-center gap-1.5 text-sm bg-green-50 text-green-700 px-3 py-2 rounded-xl font-medium hover:bg-green-100 transition-colors"
            >
              <Download className="w-4 h-4" />
              CSV
            </button>
            {limits.canExport ? (
              <button
                onClick={exportPDF}
                className="flex items-center gap-1.5 text-sm bg-blue-50 text-blue-700 px-3 py-2 rounded-xl font-medium hover:bg-blue-100 transition-colors"
              >
                <Download className="w-4 h-4" />
                PDF
              </button>
            ) : (
              <button
                onClick={() => openUpgradeSheet(t('stats.export.pro'))}
                className="flex items-center gap-1.5 text-sm bg-amber-50 text-amber-600 px-3 py-2 rounded-xl font-medium hover:bg-amber-100 transition-colors"
              >
                <Zap className="w-4 h-4" />
                PDF · Pro
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="p-4 pb-24 space-y-4">
        {/* Total balance */}
        <div style={{ background: 'linear-gradient(160deg, var(--c-primary-dark) 0%, var(--c-primary) 60%, #1a9e90 100%)', borderRadius: 20, padding: 24, color: '#fff' }}>
          <p className="text-green-100 text-sm mb-1">{t('stats.available.balance')}</p>
          <p className="text-4xl font-bold mb-1">{formatCurrency(stats.totalBalance)}</p>
          <div className="flex items-center gap-3 text-green-100 text-sm">
            <span>{stats.activeCount} {t('stats.active.vouchers')}</span>
            {stats.totalOriginal > stats.totalBalance && (
              <span>• {t('stats.used.label')} {formatCurrency(stats.totalOriginal - stats.totalBalance)}</span>
            )}
          </div>
        </div>

        {/* Utilization bar — includes archived so fully-used vouchers count */}
        {stats.allOriginal > 0 && (
          <div style={{ background: 'var(--c-surface)', borderRadius: 'var(--r-card)', boxShadow: 'var(--shadow-card)', padding: 16 }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700">{t('stats.usage.title')}</span>
              <span className="text-sm font-bold text-gray-800">{stats.utilized}%</span>
            </div>
            <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-blue-400 to-blue-600 rounded-full transition-all"
                style={{ width: `${stats.utilized}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-gray-400 mt-1">
              <span>{t('stats.original')} {formatCurrency(stats.allOriginal)}</span>
              <span>{t('stats.remaining')} {formatCurrency(stats.totalBalance)}</span>
            </div>
          </div>
        )}

        {/* Savings section */}
        {stats.savingsCount > 0 && (
          <div style={{ background: 'linear-gradient(135deg, #7c3aed 0%, #9333ea 60%, #a855f7 100%)', borderRadius: 20, padding: 20, color: '#fff', position: 'relative' }}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-purple-200" />
                <h3 className="font-bold text-white">{t('stats.savings.title')}</h3>
              </div>
              <button
                onClick={() => setShowSavingsInfo(v => !v)}
                className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center hover:bg-white/30 transition-colors"
              >
                <Info className="w-4 h-4 text-white" />
              </button>
            </div>
            {showSavingsInfo && (
              <div className="bg-black/20 rounded-xl p-3 mb-3 text-sm text-white/90 leading-relaxed">
                {t('stats.savings.info.text')}
              </div>
            )}
            <p className="text-4xl font-bold text-white mb-3">{formatCurrency(stats.totalSavings)}</p>
            <div className="flex items-center gap-6">
              <div>
                <p className="text-purple-200 text-xs mb-0.5">{t('stats.savings.avg.pct')}</p>
                <p className="text-white font-bold text-xl">{stats.avgSavingsPct}%</p>
              </div>
              <div className="w-px h-8 bg-white/20" />
              <div>
                <p className="text-purple-200 text-xs mb-0.5">{t('stats.savings.count', { count: stats.savingsCount })}</p>
              </div>
            </div>
          </div>
        )}

        {/* Activity over time */}
        <div style={{ background: 'var(--c-surface)', borderRadius: 'var(--r-card)', boxShadow: 'var(--shadow-card)', padding: 20 }}>
          <h3 className="font-semibold text-gray-700 mb-4 flex items-center gap-2">
            <Clock className="w-4 h-4 text-blue-500" />
            {t('stats.activity.title')}
          </h3>
          <div className="space-y-4">
            <TimeStatRow
              label={t('stats.added.count')}
              today={stats.addedToday} todayAmount={stats.addedTodayAmount}
              week={stats.addedThisWeek} weekAmount={stats.addedThisWeekAmount}
              month={stats.addedThisMonth} monthAmount={stats.addedThisMonthAmount}
            />
            <TimeStatRow
              label={t('stats.utilized.count')}
              today={stats.usedToday} todayAmount={stats.usedTodayAmount}
              week={stats.usedThisWeek} weekAmount={stats.usedThisWeekAmount}
              month={stats.usedThisMonth} monthAmount={stats.usedThisMonthAmount}
            />
          </div>
          <p className="text-xs text-gray-400 mt-3 flex items-start gap-1">
            <Info className="w-3 h-3 mt-0.5 shrink-0" />
            "שומשו" מבוסס על שוברים שעודכנו ויש להם יתרה חלקית או שהוארכבו
          </p>
        </div>

        {/* Stat grid */}
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            icon={Wallet}
            label={t('stats.avg.voucher')}
            value={formatCurrency(stats.avgBalance)}
            color="text-green-600"
          />
          <StatCard
            icon={AlertTriangle}
            label={t('stats.expiring.14')}
            value={stats.expiringSoon}
            color={stats.expiringSoon > 0 ? 'text-orange-500' : 'text-gray-400'}
          />
          <StatCard
            icon={Archive}
            label={t('stats.archived.count')}
            value={stats.archivedCount}
            color="text-gray-500"
          />
          <StatCard
            icon={TrendingUp}
            label={t('stats.expired.active')}
            value={stats.expired}
            color={stats.expired > 0 ? 'text-red-500' : 'text-gray-400'}
          />
          <StatCard
            icon={Users}
            label={t('stats.shared.count')}
            value={stats.shared}
            color="text-blue-500"
          />
          <StatCard
            icon={ShoppingBag}
            label={t('stats.near.empty')}
            value={stats.nearZero}
            color={stats.nearZero > 0 ? 'text-amber-500' : 'text-gray-400'}
            sub={stats.nearZero > 0 ? t('stats.near.empty.hint') : undefined}
          />
          {stats.giftVouchers > 0 && (
            <StatCard
              icon={Gift}
              label={t('stats.gift.count')}
              value={stats.giftVouchers}
              color="text-pink-500"
            />
          )}
          <StatCard
            icon={PlusCircle}
            label={t('stats.added.month')}
            value={stats.addedThisMonth}
            color="text-indigo-500"
          />
        </div>

        {/* Top stores */}
        {stats.topStores.length > 0 && (
          <div style={{ background: 'var(--c-surface)', borderRadius: 'var(--r-card)', boxShadow: 'var(--shadow-card)', padding: 20 }}>
            <h3 className="font-semibold text-gray-700 mb-4">{t('stats.top.stores')}</h3>
            <div className="space-y-3">
              {stats.topStores.map((store, i) => {
                const maxBalance = stats.topStores[0].balance
                const pct = maxBalance > 0 ? (store.balance / maxBalance) * 100 : 0
                return (
                  <div key={store.name}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-gray-400 w-4">{i + 1}</span>
                        <span className="text-sm text-gray-700 truncate max-w-[140px]">{store.name}</span>
                        <span className="text-xs text-gray-400">({store.count})</span>
                      </div>
                      <span className="text-sm font-semibold text-gray-800">{formatCurrency(store.balance)}</span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden mr-6">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-green-400 to-emerald-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Category chart */}
        {stats.categoryData.length > 0 && (
          <div style={{ background: 'var(--c-surface)', borderRadius: 'var(--r-card)', boxShadow: 'var(--shadow-card)', padding: 20 }}>
            <div className="flex items-start justify-between mb-1">
              <h3 className="font-semibold text-gray-700">{t('stats.by.category')}</h3>
            </div>
            {stats.multiCategoryCount > 0 && (
              <p className="text-xs text-gray-400 mb-3 flex items-start gap-1">
                <Info className="w-3 h-3 mt-0.5 shrink-0" />
                {t('stats.multi.cat.note')}
              </p>
            )}
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={stats.categoryData}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={85}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {stats.categoryData.map((_entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => formatCurrency(Number(v))} />
                <Legend
                  formatter={(value) => <span className="text-xs">{value}</span>}
                />
              </PieChart>
            </ResponsiveContainer>

            <div className="mt-2 space-y-2">
              {stats.categoryData.map((cat, i) => (
                <div key={cat.name} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                    <span className="text-sm text-gray-700">{cat.name}</span>
                    <span className="text-xs text-gray-400">({cat.count})</span>
                  </div>
                  <span className="text-sm font-semibold text-gray-800">{formatCurrency(cat.value)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

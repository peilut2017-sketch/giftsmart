import { useMemo } from 'react'
import { useVouchers } from '../contexts/VoucherContext'
import { useSubscription } from '../contexts/SubscriptionContext'
import { formatCurrency, getExpiryStatus } from '../utils/helpers'
import { BarChart2, TrendingUp, AlertTriangle, Archive, Users, Download, Wallet, Zap } from 'lucide-react'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import toast from 'react-hot-toast'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

export default function StatsPage() {
  const { vouchers, archivedVouchers } = useVouchers()
  const { limits, openUpgradeSheet } = useSubscription()

  const stats = useMemo(() => {
    const active = vouchers.filter(v => !v.is_archived)
    const totalBalance = active.reduce((s, v) => s + v.balance, 0)
    const totalOriginal = active.reduce((s, v) => s + (v.amount || v.balance), 0)
    const utilized = totalOriginal > 0 ? Math.round(((totalOriginal - totalBalance) / totalOriginal) * 100) : 0
    const avgBalance = active.length > 0 ? totalBalance / active.length : 0

    const expiringSoon = active.filter(v => {
      const s = getExpiryStatus(v.expiry_date)
      return s === 'warning' || s === 'critical'
    }).length
    const expired = active.filter(v => getExpiryStatus(v.expiry_date) === 'expired').length
    const shared = active.filter(v => v.is_shared).length

    // Category breakdown
    const catMap: Record<string, number> = {}
    active.forEach(v => {
      if (v.categories.length === 0) {
        catMap['אחר'] = (catMap['אחר'] || 0) + v.balance
      } else {
        v.categories.forEach(cat => {
          catMap[cat] = (catMap[cat] || 0) + v.balance / v.categories.length
        })
      }
    })
    const categoryData = Object.entries(catMap)
      .filter(([, v]) => v > 0)
      .map(([name, value]) => ({ name, value: Math.round(value) }))
      .sort((a, b) => b.value - a.value)

    // Top stores by balance
    const storeMap: Record<string, number> = {}
    active.forEach(v => {
      storeMap[v.store_name] = (storeMap[v.store_name] || 0) + v.balance
    })
    const topStores = Object.entries(storeMap)
      .map(([name, balance]) => ({ name, balance }))
      .sort((a, b) => b.balance - a.balance)
      .slice(0, 5)

    return {
      totalBalance, totalOriginal, utilized, avgBalance,
      activeCount: active.length, expiringSoon, expired, shared,
      categoryData, topStores, archivedCount: archivedVouchers.length,
    }
  }, [vouchers, archivedVouchers])

  const COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4', '#f97316', '#ef4444']

  function exportPDF() {
    try {
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })

      // Title
      doc.setFontSize(18)
      doc.setFont('helvetica', 'bold')
      doc.text('Voucher Wallet - Report', 105, 20, { align: 'center' })

      doc.setFontSize(10)
      doc.setFont('helvetica', 'normal')
      doc.text(new Date().toLocaleDateString('he-IL'), 105, 28, { align: 'center' })

      // Summary section
      doc.setFontSize(13)
      doc.setFont('helvetica', 'bold')
      doc.text('Summary', 20, 40)

      const summaryData = [
        ['Active Vouchers', stats.activeCount.toString()],
        ['Total Balance', formatCurrency(stats.totalBalance)],
        ['Original Amount', formatCurrency(stats.totalOriginal)],
        ['Utilized', `${stats.utilized}%`],
        ['Avg Voucher Value', formatCurrency(stats.avgBalance)],
        ['Expiring Soon (14d)', stats.expiringSoon.toString()],
        ['Archived', stats.archivedCount.toString()],
      ]

      autoTable(doc, {
        startY: 45,
        head: [['Metric', 'Value']],
        body: summaryData,
        theme: 'striped',
        headStyles: { fillColor: [34, 197, 94] },
        margin: { left: 20, right: 20 },
      })

      const afterSummary = (doc as any).lastAutoTable.finalY + 10

      // Category breakdown
      if (stats.categoryData.length > 0) {
        doc.setFontSize(13)
        doc.setFont('helvetica', 'bold')
        doc.text('Balance by Category', 20, afterSummary)

        autoTable(doc, {
          startY: afterSummary + 5,
          head: [['Category', 'Balance']],
          body: stats.categoryData.map(c => [c.name, formatCurrency(c.value)]),
          theme: 'striped',
          headStyles: { fillColor: [59, 130, 246] },
          margin: { left: 20, right: 20 },
        })
      }

      const afterCats = (doc as any).lastAutoTable.finalY + 10

      // Top stores
      if (stats.topStores.length > 0) {
        doc.setFontSize(13)
        doc.setFont('helvetica', 'bold')
        doc.text('Top Stores by Balance', 20, afterCats)

        autoTable(doc, {
          startY: afterCats + 5,
          head: [['Store', 'Balance']],
          body: stats.topStores.map(s => [s.name, formatCurrency(s.balance)]),
          theme: 'striped',
          headStyles: { fillColor: [245, 158, 11] },
          margin: { left: 20, right: 20 },
        })
      }

      // Active vouchers list
      const activeVouchers = vouchers.filter(v => !v.is_archived)
      if (activeVouchers.length > 0) {
        doc.addPage()
        doc.setFontSize(13)
        doc.setFont('helvetica', 'bold')
        doc.text('Active Vouchers', 20, 20)

        autoTable(doc, {
          startY: 25,
          head: [['Store', 'Code', 'Balance', 'Expiry']],
          body: activeVouchers.map(v => [
            v.store_name,
            v.code,
            formatCurrency(v.balance),
            v.expiry_date ? new Date(v.expiry_date).toLocaleDateString('he-IL') : '-',
          ]),
          theme: 'striped',
          headStyles: { fillColor: [34, 197, 94] },
          margin: { left: 20, right: 20 },
          styles: { fontSize: 9 },
        })
      }

      doc.save(`vouchers-${new Date().toISOString().split('T')[0]}.pdf`)
      toast.success('PDF יוצא בהצלחה!')
    } catch {
      toast.error('שגיאה בייצוא PDF')
    }
  }

  const StatCard = ({ icon: Icon, label, value, sub, color = 'text-gray-700' }: any) => (
    <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
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

  return (
    <div className="flex-1 bg-gray-50">
      <div className="bg-white border-b px-4 py-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <BarChart2 className="w-5 h-5" />
            סטטיסטיקות
          </h1>
          {limits.canExport ? (
            <button
              onClick={exportPDF}
              className="flex items-center gap-1.5 text-sm bg-green-50 text-green-700 px-3 py-2 rounded-xl font-medium hover:bg-green-100 transition-colors"
            >
              <Download className="w-4 h-4" />
              PDF
            </button>
          ) : (
            <button
              onClick={() => openUpgradeSheet('ייצוא PDF זמין במנוי Pro')}
              className="flex items-center gap-1.5 text-sm bg-amber-50 text-amber-600 px-3 py-2 rounded-xl font-medium hover:bg-amber-100 transition-colors"
            >
              <Zap className="w-4 h-4" />
              PDF · Pro
            </button>
          )}
        </div>
      </div>

      <div className="p-4 pb-24 space-y-4">
        {/* Total balance */}
        <div className="bg-gradient-to-br from-green-500 to-emerald-600 rounded-3xl p-6 text-white shadow-lg">
          <p className="text-green-100 text-sm mb-1">יתרה פנויה כוללת</p>
          <p className="text-4xl font-bold mb-1">{formatCurrency(stats.totalBalance)}</p>
          <div className="flex items-center gap-3 text-green-100 text-sm">
            <span>{stats.activeCount} שוברים פעילים</span>
            {stats.totalOriginal > stats.totalBalance && (
              <span>• נוצל: {formatCurrency(stats.totalOriginal - stats.totalBalance)}</span>
            )}
          </div>
        </div>

        {/* Utilization bar */}
        {stats.totalOriginal > 0 && (
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700">ניצול שוברים</span>
              <span className="text-sm font-bold text-gray-800">{stats.utilized}%</span>
            </div>
            <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-blue-400 to-blue-600 rounded-full transition-all"
                style={{ width: `${stats.utilized}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-gray-400 mt-1">
              <span>מקורי: {formatCurrency(stats.totalOriginal)}</span>
              <span>נותר: {formatCurrency(stats.totalBalance)}</span>
            </div>
          </div>
        )}

        {/* Stat grid */}
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            icon={Wallet}
            label="ממוצע לשובר"
            value={formatCurrency(stats.avgBalance)}
            color="text-green-600"
          />
          <StatCard
            icon={AlertTriangle}
            label="פגים תוך 14 יום"
            value={stats.expiringSoon}
            color={stats.expiringSoon > 0 ? 'text-orange-500' : 'text-gray-400'}
          />
          <StatCard
            icon={Archive}
            label="בארכיון"
            value={stats.archivedCount}
            color="text-gray-500"
          />
          <StatCard
            icon={TrendingUp}
            label="פגי תוקף (פעילים)"
            value={stats.expired}
            color={stats.expired > 0 ? 'text-red-500' : 'text-gray-400'}
          />
          <StatCard
            icon={Users}
            label="שוברים משותפים"
            value={stats.shared}
            color="text-blue-500"
          />
        </div>

        {/* Top stores */}
        {stats.topStores.length > 0 && (
          <div className="bg-white rounded-3xl shadow-sm p-5">
            <h3 className="font-semibold text-gray-700 mb-4">חנויות מובילות לפי יתרה</h3>
            <div className="space-y-3">
              {stats.topStores.map((store, i) => {
                const maxBalance = stats.topStores[0].balance
                const pct = maxBalance > 0 ? (store.balance / maxBalance) * 100 : 0
                return (
                  <div key={store.name}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-gray-400 w-4">{i + 1}</span>
                        <span className="text-sm text-gray-700 truncate max-w-[160px]">{store.name}</span>
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
          <div className="bg-white rounded-3xl shadow-sm p-5">
            <h3 className="font-semibold text-gray-700 mb-4">התפלגות לפי קטגוריה</h3>
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
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                    <span className="text-sm text-gray-700">{cat.name}</span>
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

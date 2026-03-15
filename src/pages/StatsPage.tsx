import { useMemo } from 'react'
import { useVouchers } from '../contexts/VoucherContext'
import { formatCurrency, getExpiryStatus } from '../utils/helpers'
import { BarChart2, TrendingUp, AlertTriangle, Archive, Users } from 'lucide-react'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts'

export default function StatsPage() {
  const { vouchers, archivedVouchers } = useVouchers()

  const stats = useMemo(() => {
    const active = vouchers.filter(v => !v.is_archived)
    const totalBalance = active.reduce((s, v) => s + v.balance, 0)
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

    return { totalBalance, activeCount: active.length, expiringSoon, expired, shared, categoryData, archivedCount: archivedVouchers.length }
  }, [vouchers, archivedVouchers])

  const COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4', '#f97316', '#ef4444']

  const StatCard = ({ icon: Icon, label, value, color = 'text-gray-700', bg = 'bg-white' }: any) => (
    <div className={`${bg} rounded-2xl p-4 shadow-sm border border-gray-100`}>
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center bg-gray-50`}>
          <Icon className={`w-5 h-5 ${color}`} />
        </div>
        <div>
          <p className="text-sm text-gray-500">{label}</p>
          <p className={`text-xl font-bold ${color}`}>{value}</p>
        </div>
      </div>
    </div>
  )

  return (
    <div className="flex-1 bg-gray-50">
      <div className="bg-white border-b px-4 py-4">
        <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          <BarChart2 className="w-5 h-5" />
          סטטיסטיקות
        </h1>
      </div>

      <div className="p-4 pb-24 space-y-4">
        {/* Total */}
        <div className="bg-gradient-to-br from-green-500 to-emerald-600 rounded-3xl p-6 text-white shadow-lg">
          <p className="text-green-100 text-sm mb-1">יתרה פנויה כוללת</p>
          <p className="text-4xl font-bold mb-1">{formatCurrency(stats.totalBalance)}</p>
          <p className="text-green-100 text-sm">{stats.activeCount} שוברים פעילים</p>
        </div>

        {/* Stat grid */}
        <div className="grid grid-cols-2 gap-3">
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

            {/* Category list */}
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

// 업체 입력 페이지 (/input?key=비밀키)
// 업체가 매일 품목별 입고가/판매가/재고/수급을 입력하는 화면
import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Send, Building2, AlertCircle, CheckCircle2, Loader2, Info, ExternalLink } from 'lucide-react'

function formatDateLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  return `${d.getMonth() + 1}월 ${d.getDate()}일 기준`
}

function getLocalDateStr(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// 가장 최근 지난 금요일 날짜 반환 (오늘이 금요일이면 7일 전)
function getPreviousFriday(todayStr) {
  const d = new Date(todayStr + 'T00:00:00')
  const daysBack = ((d.getDay() - 5 + 7) % 7) || 7
  d.setDate(d.getDate() - daysBack)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export default function InputPage() {
  const [searchParams] = useSearchParams()
  const secretKey = searchParams.get('key')

  const [vendor, setVendor] = useState(null)
  const [items, setItems] = useState([])
  const [formData, setFormData] = useState({})
  const [latestFixedValues, setLatestFixedValues] = useState({})
  const [historicalWeeklyPrices, setHistoricalWeeklyPrices] = useState({})
  const [catchupDate, setCatchupDate] = useState(null)   // 최초 업체용 이전 주 날짜
  const [catchupData, setCatchupData] = useState({})     // { [itemId]: string }
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState(null)
  const [hasTodayData, setHasTodayData] = useState(false)
  const [isFinished, setIsFinished] = useState(false)

  useEffect(() => {
    if (!secretKey) {
      setLoading(false)
      return
    }
    fetchVendorData()
  }, [secretKey])

  async function fetchVendorData() {
    try {
      setLoading(true)

      const { data: vendorData, error: vendorError } = await supabase
        .from('survey_vendors')
        .select('*')
        .eq('secret_key', secretKey)
        .single()

      if (vendorError || !vendorData) {
        setMessage({ type: 'error', text: '잘못된 접근입니다' })
        setLoading(false)
        return
      }

      setVendor(vendorData)

      const { data: itemsData, error: itemsError } = await supabase
        .from('survey_items')
        .select('*')
        .eq('vendor_id', vendorData.id)
        .eq('is_active', true)
        .order('priority', { ascending: true })

      if (itemsError) throw itemsError
      setItems(itemsData || [])

      const today = getLocalDateStr()

      // 이 업체의 전체 리포트를 날짜 오름차순으로 가져옴
      const { data: allReports, error: reportsError } = await supabase
        .from('survey_daily_reports')
        .select('*')
        .eq('vendor_id', vendorData.id)
        .order('report_date', { ascending: true })

      if (reportsError) throw reportsError

      const newLatestFixed = {}
      const newHistoricalWeekly = {}
      const initialData = {}
      let loadedToday = false

      for (const item of itemsData || []) {
        const itemReports = (allReports || []).filter(r => r.item_id === item.id)
        const pastReports = itemReports.filter(r => r.report_date !== today)
        const todayReport = itemReports.find(r => r.report_date === today)
        const latestPastReport = pastReports[pastReports.length - 1] ?? null

        // 과거 리포트가 있으면 고정 4개 값은 최신 과거에서 읽기 전용으로 표시
        newLatestFixed[item.id] = latestPastReport
          ? {
              price_pre_war: latestPastReport.price_pre_war,
              price_post_war: latestPastReport.price_post_war,
              price_mid_april: latestPastReport.price_mid_april,
              price_end_april: latestPastReport.price_end_april,
            }
          : null

        // 과거 주별 price_today 목록 (날짜 라벨 포함)
        newHistoricalWeekly[item.id] = pastReports.map(r => ({
          date: r.report_date,
          label: formatDateLabel(r.report_date),
          value: r.price_today,
        }))

        if (latestPastReport) {
          // 과거 데이터 존재 → 오늘 price_today만 입력
          initialData[item.id] = {
            price_today: todayReport?.price_today ?? '',
          }
        } else {
          // 최초 입력 → 5개 모두 입력 가능
          initialData[item.id] = {
            price_pre_war: todayReport?.price_pre_war ?? '',
            price_post_war: todayReport?.price_post_war ?? '',
            price_mid_april: todayReport?.price_mid_april ?? '',
            price_end_april: todayReport?.price_end_april ?? '',
            price_today: todayReport?.price_today ?? '',
          }
        }

        if (todayReport) loadedToday = true
      }

      // 과거 데이터가 전혀 없는 업체(최초) → 이전 주 금요일 catchup 슬롯 추가
      const isFirstTimeVendor = (allReports || []).filter(r => r.report_date !== today).length === 0
      if (isFirstTimeVendor) {
        const prevFriday = getPreviousFriday(today)
        setCatchupDate(prevFriday)
        const initCatchup = {}
        ;(itemsData || []).forEach(item => { initCatchup[item.id] = '' })
        setCatchupData(initCatchup)
      } else {
        setCatchupDate(null)
        setCatchupData({})
      }

      setLatestFixedValues(newLatestFixed)
      setHistoricalWeeklyPrices(newHistoricalWeekly)
      setFormData(initialData)
      setHasTodayData(loadedToday)

    } catch (err) {
      setMessage({ type: 'error', text: '데이터를 불러오는 중 오류가 발생했습니다.' })
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!vendor) return
    setSubmitting(true)
    setMessage(null)

    try {
      const today = getLocalDateStr()

      const records = items.map(item => {
        const fixed = latestFixedValues[item.id]
        return {
          vendor_id: vendor.id,
          item_id: item.id,
          report_date: today,
          // 과거 데이터가 있으면 고정값 복사, 없으면(최초) 폼에서 읽음
          price_pre_war: fixed?.price_pre_war ?? formData[item.id]?.price_pre_war ?? '',
          price_post_war: fixed?.price_post_war ?? formData[item.id]?.price_post_war ?? '',
          price_mid_april: fixed?.price_mid_april ?? formData[item.id]?.price_mid_april ?? '',
          price_end_april: fixed?.price_end_april ?? formData[item.id]?.price_end_april ?? '',
          price_today: formData[item.id]?.price_today ?? '',
        }
      })

      const { error } = await supabase
        .from('survey_daily_reports')
        .upsert(records, { onConflict: 'vendor_id,item_id,report_date' })

      if (error) throw error

      // 최초 업체: 이전 주 catchup 레코드도 함께 저장
      if (catchupDate) {
        const catchupRecords = items.map(item => ({
          vendor_id: vendor.id,
          item_id: item.id,
          report_date: catchupDate,
          price_pre_war: formData[item.id]?.price_pre_war ?? '',
          price_post_war: formData[item.id]?.price_post_war ?? '',
          price_mid_april: formData[item.id]?.price_mid_april ?? '',
          price_end_april: formData[item.id]?.price_end_april ?? '',
          price_today: catchupData[item.id] ?? '',
        }))
        const { error: catchupError } = await supabase
          .from('survey_daily_reports')
          .upsert(catchupRecords, { onConflict: 'vendor_id,item_id,report_date' })
        if (catchupError) throw catchupError
      }

      setHasTodayData(true)
      setMessage({ type: 'success', text: '보고가 정상적으로 완료되었습니다. 감사합니다.' })
      window.scrollTo({ top: 0, behavior: 'smooth' })

      setTimeout(() => {
        setIsFinished(true)
        if (/KAKAOTALK/i.test(navigator.userAgent)) {
          setTimeout(() => { window.location.href = 'kakaotalk://inappbrowser/close' }, 100)
        }
      }, 3000)
    } catch (err) {
      setMessage({ type: 'error', text: '제출 중 오류가 발생했습니다. 다시 시도해주세요.' })
      console.error(err)
    } finally {
      setSubmitting(false)
      setTimeout(() => setMessage(null), 5000)
    }
  }

  function handleInputChange(itemId, field, value) {
    setFormData(prev => ({
      ...prev,
      [itemId]: {
        ...prev[itemId],
        [field]: value,
      },
    }))
  }

  function handleCatchupChange(itemId, value) {
    setCatchupData(prev => ({ ...prev, [itemId]: value }))
  }

  function handleForceClose() {
    if (/KAKAOTALK/i.test(navigator.userAgent)) {
      window.location.href = 'kakaotalk://inappbrowser/close'
    }
  }

  // --- 화면 렌더링 ---

  if (isFinished) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-center">
        <div className="bg-white rounded-3xl shadow-xl border border-slate-200 p-10 max-w-sm w-full">
          <div className="w-20 h-20 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 className="w-12 h-12 text-blue-500" />
          </div>
          <h2 className="text-2xl font-extrabold text-slate-800 mb-3">보고가 완료되었습니다</h2>
          <p className="text-slate-500 leading-relaxed mb-10">
            귀하의 노고에 진심으로 감사드립니다.<br/>
            이 창을 닫아주시면 됩니다.
          </p>
          {/KAKAOTALK/i.test(navigator.userAgent) && (
            <button
              onClick={handleForceClose}
              className="w-full bg-slate-800 text-white rounded-2xl py-4 font-bold text-xl shadow-md hover:bg-slate-900 transition-colors"
            >
              화면 닫기
            </button>
          )}
        </div>
      </div>
    )
  }

  if (!secretKey) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
          <AlertCircle className="w-16 h-16 text-red-400 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-slate-800 mb-2">잘못된 접근입니다</h2>
          <p className="text-slate-500">접근 키가 누락되었거나 올바르지 않은 주소입니다.</p>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-blue-500 animate-spin mx-auto mb-4" />
          <p className="text-slate-500 text-lg">데이터를 불러오는 중...</p>
        </div>
      </div>
    )
  }

  if (!vendor) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
          <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-slate-800 mb-2">잘못된 접근입니다</h2>
          <p className="text-slate-500">유효하지 않은 링크이오니 다시 확인해주세요.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* 상단 헤더: 업체 정보 */}
      <header className="bg-gradient-to-r from-blue-700 to-blue-900 text-white shadow-lg">
        <div className="max-w-2xl mx-auto px-4 pt-4 pb-2">
          <div className="flex items-center gap-3 mb-4">
            <Building2 className="w-8 h-8 text-blue-200" />
            <h1 className="text-2xl font-bold">국토부 물가동향 조사</h1>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-xl p-5 space-y-2">
            <p className="text-xl font-semibold">{vendor.vendor_name}</p>
            {vendor.memo && <p className="text-blue-100">{vendor.memo}</p>}
            <p className="text-blue-100">담당자: {vendor.manager_name}</p>
          </div>
          <div className="mt-2 mb-0 text-right">
            <span className="text-blue-200 text-sm">AI 시대를 이끌어가는 </span>
            <a
              href="https://www.aicamp.club"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-bold text-white underline hover:text-blue-100 text-lg"
            >
              AI CAMP
              <ExternalLink className="w-6 h-6" />
            </a>
          </div>
        </div>
      </header>

      {/* 날짜 표시 */}
      <div className="max-w-2xl mx-auto px-4 pt-6">
        <div className="bg-blue-50 border-2 border-blue-200 rounded-2xl px-4 py-4 text-center">
          <p className="text-blue-800 font-bold text-lg">
            📅 {new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}
          </p>
        </div>
      </div>

      {hasTodayData && message?.type !== 'success' && (
        <div className="max-w-2xl mx-auto px-4 pt-4">
          <div className="bg-slate-100 border border-slate-300 rounded-xl px-5 py-3 flex items-center gap-2 text-slate-700">
            <Info className="w-5 h-5 flex-shrink-0 text-blue-500" />
            <p className="font-medium text-sm">
              오늘 입력하신 내용이 자동으로 불러와졌습니다. 내용을 수정하고 접수하실 수 있습니다.
            </p>
          </div>
        </div>
      )}

      {message && (
        <div className="max-w-2xl mx-auto px-4 pt-4">
          <div className={`rounded-xl px-5 py-4 flex items-center gap-3 shadow-md ${
            message.type === 'success'
              ? 'bg-green-50 border-2 border-green-500 text-green-800'
              : 'bg-red-50 border-2 border-red-500 text-red-800'
          }`}>
            {message.type === 'success'
              ? <CheckCircle2 className="w-7 h-7 flex-shrink-0 text-green-600" />
              : <AlertCircle className="w-7 h-7 flex-shrink-0 text-red-600" />
            }
            <p className="font-bold text-lg">{message.text}</p>
          </div>
        </div>
      )}

      {/* 입력 폼 */}
      <form onSubmit={handleSubmit} className="max-w-2xl mx-auto px-4 py-6 space-y-6">

        {items.map((item, index) => {
          const fixed = latestFixedValues[item.id]
          const isFirstTime = fixed === null
          const weeklyHistory = historicalWeeklyPrices[item.id] ?? []

          return (
            <div
              key={item.id}
              className="bg-white rounded-2xl shadow-md border border-slate-200 overflow-hidden"
            >
              {/* 품목 헤더 */}
              <div className="bg-slate-800 text-white px-5 py-4">
                <span className="font-bold text-xl">
                  품목{index + 1}. <span className="text-yellow-300">{item.item_name}</span>
                </span>
                {item.item_spec && (
                  <span className="ml-2 text-slate-300 text-sm">({item.item_spec})</span>
                )}
              </div>

              <div className="p-5 flex flex-col gap-5">

                {/* 고정 4개 슬롯 */}
                {[
                  { label: '전쟁 전 (26.2월)', field: 'price_pre_war',  placeholder: '가격 또는 기준 지수 100 입력' },
                  { label: '전쟁 후 (26.3월)', field: 'price_post_war', placeholder: '전쟁 전 대비 15% 상승' },
                  { label: '4월 중순 기준',    field: 'price_mid_april', placeholder: '전쟁 전 대비 15% 상승' },
                  { label: '4월 말 기준',      field: 'price_end_april', placeholder: '전쟁 전 대비 15% 상승' },
                ].map(({ label, field, placeholder }) => {
                  if (!isFirstTime) {
                    return (
                      <div key={field} className="flex items-center justify-between">
                        <span className="text-base font-bold text-slate-500">{label}</span>
                        <span className="text-base text-slate-600">{fixed[field] || '-'}</span>
                      </div>
                    )
                  }
                  return (
                    <div key={field}>
                      <label className="block text-base font-bold text-slate-700 mb-2">{label}</label>
                      <input
                        type="text"
                        placeholder={placeholder}
                        value={formData[item.id]?.[field] ?? ''}
                        onChange={(e) => handleInputChange(item.id, field, e.target.value)}
                        className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-lg
                                   focus:border-blue-500 focus:ring-2 focus:ring-blue-100
                                   outline-none transition-all placeholder:text-slate-400"
                      />
                    </div>
                  )
                })}

                {/* 과거 주별 슬롯 (텍스트 표시) */}
                {weeklyHistory.map(entry => (
                  <div key={entry.date} className="flex items-center justify-between">
                    <span className="text-base font-bold text-slate-500">{entry.label}</span>
                    <span className="text-base text-slate-600">{entry.value || '-'}</span>
                  </div>
                ))}

                {/* 최초 업체: 이전 주 금요일 catchup 입력 슬롯 */}
                {isFirstTime && catchupDate && (
                  <div>
                    <label className="block text-base font-bold text-slate-700 mb-2">
                      {formatDateLabel(catchupDate)}
                    </label>
                    <input
                      type="text"
                      placeholder="전쟁 전 대비 15% 상승"
                      value={catchupData[item.id] ?? ''}
                      onChange={(e) => handleCatchupChange(item.id, e.target.value)}
                      className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-lg
                                 focus:border-blue-500 focus:ring-2 focus:ring-blue-100
                                 outline-none transition-all placeholder:text-slate-400"
                    />
                  </div>
                )}

                {/* 과거 데이터와 오늘 입력 사이 구분선 */}
                {!isFirstTime && (
                  <hr className="border-slate-200" />
                )}

                {/* 오늘 기준 (입력) */}
                <div>
                  <label className="block text-base font-bold text-blue-700 mb-2">오늘 기준</label>
                  <input
                    type="text"
                    placeholder="전쟁 전 대비 15% 상승"
                    value={formData[item.id]?.price_today ?? ''}
                    onChange={(e) => handleInputChange(item.id, 'price_today', e.target.value)}
                    className="w-full border-2 border-blue-300 rounded-xl px-4 py-3 text-lg
                               focus:border-blue-500 focus:ring-2 focus:ring-blue-100
                               outline-none transition-all placeholder:text-slate-400"
                  />
                </div>

              </div>
            </div>
          )
        })}

        {items.length === 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 text-center">
            <p className="text-slate-400 text-lg">등록된 품목이 없습니다.</p>
            <p className="text-slate-400 text-sm mt-1">관리자에게 문의해주세요.</p>
          </div>
        )}

        {items.length > 0 && (
          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-blue-600 text-white rounded-2xl
                       py-6 px-6 font-bold text-2xl shadow-xl shadow-blue-500/30
                       hover:bg-blue-700 hover:-translate-y-1
                       transition-all duration-200 flex items-center justify-center gap-3
                       disabled:opacity-50 disabled:hover:translate-y-0 disabled:cursor-not-allowed"
          >
            {submitting ? (
              <Loader2 className="w-7 h-7 animate-spin" />
            ) : (
              <Send className="w-7 h-7" />
            )}
            {submitting ? '제출 중...' : '오늘의 동향 보고 완료'}
          </button>
        )}
      </form>

      <div className="h-12" />
    </div>
  )
}

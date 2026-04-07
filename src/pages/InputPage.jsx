// 업체 입력 페이지 (/input?key=비밀키)
// 업체가 매일 품목별 입고가/판매가/재고/수급을 입력하는 화면
import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Send, History, Building2, AlertCircle, CheckCircle2, Loader2, Info, ExternalLink } from 'lucide-react'

export default function InputPage() {
  // URL에서 ?key= 파라미터를 읽음
  const [searchParams] = useSearchParams()
  const secretKey = searchParams.get('key')

  // 상태(state) 관리
  const [vendor, setVendor] = useState(null)       // 업체 정보
  const [items, setItems] = useState([])            // 품목 목록
  const [formData, setFormData] = useState({})       // 입력 데이터
  const [loading, setLoading] = useState(true)       // 로딩 중 여부
  const [submitting, setSubmitting] = useState(false) // 제출 중 여부
  const [message, setMessage] = useState(null)       // 성공/에러 메시지
  const [loadingItems, setLoadingItems] = useState({}) // 품목별 불러오기 로딩 상태
  const [hasTodayData, setHasTodayData] = useState(false) // 오늘 데이터가 이미 있는지 여부
  const [isFinished, setIsFinished] = useState(false) // 제출 완료 후 최종 종료 화면 여부

  // 페이지 로드 시 업체 정보와 품목 불러오기
  useEffect(() => {
    if (!secretKey) {
      setLoading(false)
      return
    }
    fetchVendorData()
  }, [secretKey])

  // Supabase에서 업체 + 품목 데이터 가져오기
  async function fetchVendorData() {
    try {
      setLoading(true)

      // 1) secret_key로 업체 찾기
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

      // 2) 해당 업체의 품목 목록 가져오기 (is_active가 true인 것만)
      const { data: itemsData, error: itemsError } = await supabase
        .from('survey_items')
        .select('*')
        .eq('vendor_id', vendorData.id)
        .eq('is_active', true)
        .order('priority', { ascending: true })

      if (itemsError) throw itemsError
      setItems(itemsData || [])

      // 3) 오늘 데이터가 이미 있는지 확인하여 자동 로드
      const today = new Date().toISOString().split('T')[0] // YYYY-MM-DD
      const { data: todayReports, error: reportsError } = await supabase
        .from('survey_daily_reports')
        .select('*')
        .eq('vendor_id', vendorData.id)
        .eq('report_date', today)

      if (reportsError) throw reportsError

      let loadedToday = false
      const initialData = {}

      ;(itemsData || []).forEach(item => {
        // 이 품목의 오늘 보고 데이터 확인
        const todayReport = todayReports?.find(r => r.item_id === item.id)

        if (todayReport) {
          loadedToday = true
        }

        initialData[item.id] = {
          price_in_trend: todayReport ? todayReport.price_in_trend : '',
          price_out_trend: todayReport ? todayReport.price_out_trend : '',
          stock_status: todayReport ? todayReport.stock_status : '',
          supply_status: todayReport ? todayReport.supply_status : '',
        }
      })

      setFormData(initialData)
      setHasTodayData(loadedToday)

    } catch (err) {
      setMessage({ type: 'error', text: '데이터를 불러오는 중 오류가 발생했습니다.' })
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  // [최근 데이터 불러오기] 단일 품목
  async function handleLoadRecentData(itemId) {
    if (!vendor) return
    setLoadingItems(prev => ({ ...prev, [itemId]: true }))

    try {
      // 가장 최신 데이터 1건을 가져옵니다. (오늘이든 과거든 상관없이 id기준 내림차순 최신)
      const { data, error } = await supabase
        .from('survey_daily_reports')
        .select('*')
        .eq('vendor_id', vendor.id)
        .eq('item_id', itemId)
        .order('report_date', { ascending: false })
        .limit(1)
        .single()

      if (error && error.code === 'PGRST116') {
        // 결과가 없는 경우
        alert('이전 보고 데이터가 없습니다.')
      } else if (data) {
        setFormData(prev => ({
          ...prev,
          [itemId]: {
            ...prev[itemId],
            price_in_trend: data.price_in_trend?.toString() || '',
            price_out_trend: data.price_out_trend?.toString() || '',
            stock_status: data.stock_status || '',
            supply_status: data.supply_status || '',
          }
        }))
      } else if (error) {
        throw error
      }
    } catch (err) {
      console.error(err)
      alert('데이터를 불러오는 중 오류가 발생했습니다.')
    } finally {
      setLoadingItems(prev => ({ ...prev, [itemId]: false }))
    }
  }

  // [제출] 버튼 → 오늘 날짜로 survey_daily_reports에 저장 (이미 있으면 UPDATE)
  async function handleSubmit(e) {
    e.preventDefault()
    if (!vendor) return
    setSubmitting(true)
    setMessage(null)

    try {
      const today = new Date().toISOString().split('T')[0] // YYYY-MM-DD

      // 각 품목별로 레코드 생성
      const records = items.map(item => ({
        vendor_id: vendor.id,
        item_id: item.id,
        report_date: today,
        price_in_trend: formData[item.id]?.price_in_trend || '',
        price_out_trend: formData[item.id]?.price_out_trend || '',
        stock_status: formData[item.id]?.stock_status || '',
        supply_status: formData[item.id]?.supply_status || '',
      }))

      // upsert: vendor_id + item_id + report_date 조건이 겹치면 업데이트 수행
      const { error } = await supabase
        .from('survey_daily_reports')
        .upsert(records, { onConflict: 'vendor_id,item_id,report_date' })

      if (error) throw error

      setHasTodayData(true)
      // 폼과 스크롤을 유지한 채 성공 메시지 표시
      setMessage({ type: 'success', text: '보고가 정상적으로 완료되었습니다. 감사합니다.' })
      window.scrollTo({ top: 0, behavior: 'smooth' })

      // 3초 후 최종 상태로 전환
      setTimeout(() => {
        setIsFinished(true) // 최종 화면(닫기 버튼 있는 화면)으로 렌더링 전환

        // 카카오톡 인앱 브라우저에서만 닫기 시도 (일반 브라우저는 완료 화면 표시)
        if (/KAKAOTALK/i.test(navigator.userAgent)) {
          setTimeout(() => { window.location.href = 'kakaotalk://inappbrowser/close' }, 100)
        }
      }, 3000)
    } catch (err) {
      setMessage({ type: 'error', text: '제출 중 오류가 발생했습니다. 다시 시도해주세요.' })
      console.error(err)
    } finally {
      setSubmitting(false)
      // 5초 후 메시지 자동 제거
      setTimeout(() => setMessage(null), 5000)
    }
  }

  // 입력값 변경 처리 (텍스트 변경 또는 버튼 클릭)
  function handleInputChange(itemId, field, value) {
    setFormData(prev => ({
      ...prev,
      [itemId]: {
        ...prev[itemId],
        [field]: value,
      },
    }))
  }

  // '닫기' 버튼을 눌렀을 때의 종료 함수
  function handleForceClose() {
    if (/KAKAOTALK/i.test(navigator.userAgent)) {
      window.location.href = 'kakaotalk://inappbrowser/close'
    }
    // 일반 브라우저: 브라우저 정책상 스크립트로 탭 닫기 불가 → 사용자가 직접 닫도록 안내
  }

  // --- 화면 렌더링 ---

  // 모든 작업이 끝나고 '확률적으로 창이 안 닫혔을 때' 보여주는 최종 화면
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
        <div className="max-w-2xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <Building2 className="w-8 h-8 text-blue-200" />
              <h1 className="text-2xl font-bold">물가 동향 조사</h1>
            </div>
            <p className="text-blue-200 text-right leading-snug">
              <span className="text-sm">AI 시대를 이끌어가는</span><br />
              <a
                href="https://www.aicamp.club"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-bold text-white underline hover:text-blue-100 text-lg"
              >
                AI CAMP
                <ExternalLink className="w-6 h-6" />
              </a>
            </p>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-xl p-5 space-y-2">
            <p className="text-xl font-semibold">{vendor.vendor_name}</p>
            <p className="text-blue-100">사업자번호: {vendor.biz_number}</p>
            <p className="text-blue-100">담당자: {vendor.manager_name}</p>
          </div>
        </div>
      </header>

      {/* 날짜 표시 공간 */}
      <div className="max-w-2xl mx-auto px-4 pt-6">
        <div className="bg-blue-50 border-2 border-blue-200 rounded-2xl px-4 py-4 text-center">
          <p className="text-blue-800 font-bold text-lg">
            📅 {new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}
          </p>
        </div>
      </div>

      {/* 자동 로드 안내 문구 (제출 완료 후 창이 닫히기 전에는 숨김 처리) */}
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

      {/* 알림 메시지 (성공/에러) */}
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

        {/* 품목별 입력 카드 */}
        {items.map((item, index) => (
          <div
            key={item.id}
            className="bg-white rounded-2xl shadow-md border border-slate-200 overflow-hidden"
          >
            {/* 품목 헤더 + 최근 데이터 불러오기 버튼 */}
            <div className="bg-slate-800 text-white px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <span className="font-bold text-xl">
                  {index + 1}. {item.item_name}
                </span>
                {item.item_spec && (
                  <span className="ml-2 text-slate-300 text-sm">({item.item_spec})</span>
                )}
              </div>
              
              <button
                type="button"
                onClick={() => handleLoadRecentData(item.id)}
                disabled={loadingItems[item.id]}
                className="bg-white/20 hover:bg-white/30 text-white rounded-xl px-4 py-2 
                           text-sm font-semibold flex items-center justify-center gap-2 
                           transition-colors disabled:opacity-50"
              >
                {loadingItems[item.id] ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <History className="w-4 h-4" />
                )}
                최근 데이터 불러오기
              </button>
            </div>

            {/* 입력 필드 (텍스트 4개 + 변동없음 버튼) */}
            <div className="p-5 flex flex-col gap-5">
              
              {/* 입고가 */}
              <div>
                <label className="block text-base font-bold text-slate-700 mb-2">입고가 동향</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="예: 15% 인상"
                    value={formData[item.id]?.price_in_trend || ''}
                    onChange={(e) => handleInputChange(item.id, 'price_in_trend', e.target.value)}
                    className="flex-1 w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-lg
                               focus:border-blue-500 focus:ring-2 focus:ring-blue-100 
                               outline-none transition-all placeholder:text-slate-400"
                  />
                  <button
                    type="button"
                    onClick={() => handleInputChange(item.id, 'price_in_trend', '변동 없음')}
                    className="flex-shrink-0 px-4 py-3 rounded-xl bg-slate-100 text-slate-600 
                               font-semibold hover:bg-slate-200 transition-colors border-2 border-transparent"
                  >
                    변동 없음
                  </button>
                </div>
              </div>

              {/* 판매가 */}
              <div>
                <label className="block text-base font-bold text-slate-700 mb-2">판매가 동향</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="예: 유지, 10% 인상"
                    value={formData[item.id]?.price_out_trend || ''}
                    onChange={(e) => handleInputChange(item.id, 'price_out_trend', e.target.value)}
                    className="flex-1 w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-lg
                               focus:border-blue-500 focus:ring-2 focus:ring-blue-100 
                               outline-none transition-all placeholder:text-slate-400"
                  />
                  <button
                    type="button"
                    onClick={() => handleInputChange(item.id, 'price_out_trend', '변동 없음')}
                    className="flex-shrink-0 px-4 py-3 rounded-xl bg-slate-100 text-slate-600 
                               font-semibold hover:bg-slate-200 transition-colors border-2 border-transparent"
                  >
                    변동 없음
                  </button>
                </div>
              </div>

              {/* 재고 */}
              <div>
                <label className="block text-base font-bold text-slate-700 mb-2">재고 현황</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="예: 약 2주 됨, 충분"
                    value={formData[item.id]?.stock_status || ''}
                    onChange={(e) => handleInputChange(item.id, 'stock_status', e.target.value)}
                    className="flex-1 w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-lg
                               focus:border-blue-500 focus:ring-2 focus:ring-blue-100 
                               outline-none transition-all placeholder:text-slate-400"
                  />
                  <button
                    type="button"
                    onClick={() => handleInputChange(item.id, 'stock_status', '변동 없음')}
                    className="flex-shrink-0 px-4 py-3 rounded-xl bg-slate-100 text-slate-600 
                               font-semibold hover:bg-slate-200 transition-colors border-2 border-transparent"
                  >
                    변동 없음
                  </button>
                </div>
              </div>

              {/* 수급 */}
              <div>
                <label className="block text-base font-bold text-slate-700 mb-2">수급 현황</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="예: 원활, 부족"
                    value={formData[item.id]?.supply_status || ''}
                    onChange={(e) => handleInputChange(item.id, 'supply_status', e.target.value)}
                    className="flex-1 w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-lg
                               focus:border-blue-500 focus:ring-2 focus:ring-blue-100 
                               outline-none transition-all placeholder:text-slate-400"
                  />
                  <button
                    type="button"
                    onClick={() => handleInputChange(item.id, 'supply_status', '변동 없음')}
                    className="flex-shrink-0 px-4 py-3 rounded-xl bg-slate-100 text-slate-600 
                               font-semibold hover:bg-slate-200 transition-colors border-2 border-transparent"
                  >
                    변동 없음
                  </button>
                </div>
              </div>

            </div>
          </div>
        ))}

        {/* 품목이 없는 경우 */}
        {items.length === 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 text-center">
            <p className="text-slate-400 text-lg">등록된 품목이 없습니다.</p>
            <p className="text-slate-400 text-sm mt-1">관리자에게 문의해주세요.</p>
          </div>
        )}

        {/* [제출] 버튼 */}
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

      {/* 하단 여백 */}
      <div className="h-12" />
    </div>
  )
}

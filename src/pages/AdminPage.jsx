// 관리자 대시보드 (/admin)
// 날짜별로 모든 업체의 보고 데이터를 조회하고, 미입력 업체 표시, CSV 다운로드, 요약 복사 기능 포함
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import {
  Download, Search, BarChart3, Loader2, AlertCircle,
  ChevronLeft, ChevronRight, Calendar, ClipboardCopy,
  CheckCircle2, AlertTriangle, Building2, MessageCircle
} from 'lucide-react'
import { sendAlimtalk } from '../lib/solapi'

export default function AdminPage() {
  // 오늘 날짜를 항상 서울(KST, UTC+9) 기준으로 설정
  const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000)
  const today = kstNow.toISOString().split('T')[0]

  const [selectedDate, setSelectedDate] = useState(today)  // 선택한 날짜
  const [reports, setReports] = useState([])                // 보고 데이터
  const [allVendors, setAllVendors] = useState([])          // 전체 업체 목록 (미입력 비교용)
  const [loading, setLoading] = useState(false)             // 로딩 상태
  const [error, setError] = useState(null)                  // 에러 메시지
  const [copiedVendor, setCopiedVendor] = useState(null)    // 복사 완료 표시용
  const [showDatePicker, setShowDatePicker] = useState(false) // 달력 표시 여부
  const [sendingVendorId, setSendingVendorId] = useState(null) // 알림톡 발송 중인 업체 ID
  const [toastMessage, setToastMessage] = useState(null) // Toast 알림 상태
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const d = new Date(Date.now() + 9 * 60 * 60 * 1000) // 서울 기준 시간
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() }
  })

  // 날짜가 바뀔 때마다 데이터 조회
  useEffect(() => {
    if (selectedDate) {
      fetchReports()
      fetchAllVendors()
    }
  }, [selectedDate])

  // 전체 업체 목록 가져오기 (미입력 확인용)
  async function fetchAllVendors() {
    try {
      const { data, error: fetchError } = await supabase
        .from('survey_vendors')
        .select('*, survey_items(id, item_name, item_spec, is_active)')
        .order('vendor_name', { ascending: true })

      if (fetchError) throw fetchError
      setAllVendors(data || [])
    } catch (err) {
      console.error('업체 목록 조회 오류:', err)
    }
  }

  // Supabase에서 해당 날짜의 모든 보고 데이터 가져오기
  async function fetchReports() {
    setLoading(true)
    setError(null)

    try {
      const { data, error: fetchError } = await supabase
        .from('survey_daily_reports')
        .select(`
          *,
          survey_vendors ( id, vendor_name, biz_number, manager_name ),
          survey_items ( item_name, item_spec )
        `)
        .eq('report_date', selectedDate)
        .order('created_at', { ascending: true })

      if (fetchError) throw fetchError
      setReports(data || [])
    } catch (err) {
      setError('데이터를 불러오는 중 오류가 발생했습니다.')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  // CSV 다운로드 (국토부 보고용 양식)
  function handleDownloadCSV() {
    // 보고 데이터가 있는 업체 + 미입력 업체 모두 포함
    const grouped = groupByVendor()
    const missingVendors = getMissingVendors()

    // CSV 헤더 (국토부 양식)
    const headers = [
      '보고일자', '업체명', '사업자번호', '담당자',
      '품목명', '규격', '입고가동향', '판매가동향',
      '재고현황', '수급', '입력상태'
    ]

    const rows = []

    // 입력 완료된 업체 데이터
    Object.entries(grouped).forEach(([vendorName, group]) => {
      group.items.forEach(r => {
        rows.push([
          r.report_date,
          r.survey_vendors?.vendor_name || '',
          r.survey_vendors?.biz_number || '',
          r.survey_vendors?.manager_name || '',
          r.survey_items?.item_name || '',
          r.survey_items?.item_spec || '',
          r.price_in_trend || '',
          r.price_out_trend || '',
          r.stock_status || '',
          r.supply_status || '',
          '입력완료',
        ])
      })
    })

    // 미입력 업체도 CSV에 포함 (빈 값으로)
    missingVendors.forEach(vendor => {
      const activeItems = (vendor.survey_items || []).filter(i => i.is_active)
      if (activeItems.length === 0) {
        rows.push([
          selectedDate, vendor.vendor_name, vendor.biz_number || '',
          vendor.manager_name || '', '', '', '', '', '', '', '미입력',
        ])
      } else {
        activeItems.forEach(item => {
          rows.push([
            selectedDate, vendor.vendor_name, vendor.biz_number || '',
            vendor.manager_name || '', item.item_name || '', item.item_spec || '',
            '', '', '', '', '미입력',
          ])
        })
      }
    })

    // BOM(Byte Order Mark) 추가: 엑셀에서 한글 깨짐 방지
    const BOM = '\uFEFF'
    const csvContent = BOM + [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
    ].join('\n')

    // 파일 다운로드 트리거
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `물가동향조사_${selectedDate}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  // 날짜 이동 (전날/다음날)
  function moveDate(days) {
    const date = new Date(selectedDate)
    date.setDate(date.getDate() + days)
    const newDateStr = date.toISOString().split('T')[0]

    // 2026-04-01 이전은 선택 불가
    if (newDateStr < '2026-04-01') return

    setSelectedDate(newDateStr)
    // 달력 월도 연동
    setCalendarMonth({ year: date.getFullYear(), month: date.getMonth() })
  }

  // [오늘] 버튼
  function goToday() {
    setSelectedDate(today)
    const d = new Date(Date.now() + 9 * 60 * 60 * 1000) // 서울 기준 시간
    setCalendarMonth({ year: d.getUTCFullYear(), month: d.getUTCMonth() })
  }

  // 업체별로 데이터 그룹핑
  function groupByVendor() {
    const groups = {}
    reports.forEach(r => {
      const vendorName = r.survey_vendors?.vendor_name || '알 수 없는 업체'
      if (!groups[vendorName]) {
        groups[vendorName] = {
          vendor: r.survey_vendors,
          items: [],
        }
      }
      groups[vendorName].items.push(r)
    })
    return groups
  }

  // 미입력 업체 찾기: 전체 업체 중 해당 날짜에 보고 데이터가 없는 업체
  function getMissingVendors() {
    const reportedVendorIds = new Set(
      reports.map(r => r.survey_vendors?.id).filter(Boolean)
    )
    return allVendors.filter(v => !reportedVendorIds.has(v.id))
  }

  // 요약 텍스트 생성 (업체별 카드 내용을 텍스트로 정리)
  function generateSummaryText(vendorName, group) {
    const [y, m, d] = selectedDate.split('-');
    const dateStr = `${y}년 ${parseInt(m, 10)}월 ${parseInt(d, 10)}일`;

    let text = `📋 물가 동향 조사 보고\n`
    text += `━━━━━━━━━━━━━━━━━━\n`
    text += `📅 보고일자: ${dateStr}\n`
    text += `🏢 업체명: ${vendorName}\n`
    if (group.vendor?.biz_number) {
      text += `📄 사업자번호: ${group.vendor.biz_number}\n`
    }
    if (group.vendor?.manager_name) {
      text += `👤 담당자: ${group.vendor.manager_name}\n`
    }
    text += `━━━━━━━━━━━━━━━━━━\n\n`

    group.items.forEach((r, i) => {
      const itemName = r.survey_items?.item_name || '-'
      const spec = r.survey_items?.item_spec ? ` (${r.survey_items.item_spec})` : ''
      text += `▶ ${i + 1}. ${itemName}${spec}\n`
      text += `   • 입고가 동향: ${r.price_in_trend || '-'}\n`
      text += `   • 판매가 동향: ${r.price_out_trend || '-'}\n`
      text += `   • 재고 현황: ${r.stock_status || '-'}\n`
      text += `   • 수급: ${r.supply_status || '-'}\n\n`
    })

    return text.trim()
  }

  // 요약 복사 기능
  async function handleCopySummary(vendorName, group) {
    const text = generateSummaryText(vendorName, group)
    try {
      await navigator.clipboard.writeText(text)
      setCopiedVendor(vendorName)
      setTimeout(() => setCopiedVendor(null), 2000) // 2초 후 복사 표시 해제
    } catch (err) {
      console.error('복사 실패:', err)
      // fallback: 구형 브라우저 대응
      const textarea = document.createElement('textarea')
      textarea.value = text
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      setCopiedVendor(vendorName)
      setTimeout(() => setCopiedVendor(null), 2000)
    }
  }

  // 알림톡 발송 처리
  async function handleSendAlimtalk(vendorInfo) {
    // allVendors 목록에서 완전한 데이터(phone_number 등 포함)를 찾음
    const fullVendor = allVendors.find(v => v.id === vendorInfo.id) || vendorInfo;
    const managerName = fullVendor.manager_name || fullVendor.vendor_name;
    const phone = fullVendor.manager_phone;

    // 1. 발송 전 확인 창
    if (!window.confirm(`${managerName} 담당자님께 알림톡을 보내시겠습니까?`)) {
      return;
    }

    if (!phone) {
      showToast(`${fullVendor.vendor_name} 업체의 연락처(phone_number)가 없습니다.`, true);
      return;
    }

    // 2. 발송 로직
    setSendingVendorId(fullVendor.id);
    try {
      // url에 들어갈 고유 key (비밀키)
      const secretKey = fullVendor.secret_key || fullVendor.id;
      // 로컬 테스트 중에도 스마트폰에서 열릴 수 있도록 실제 동작하는 배포 서버 도메인을 강제 적용합니다.
      // 템플릿에 https://가 있으므로 이를 제외한 도메인 주소만 넘깁니다.
      const baseUrl = 'survey-price-trend.pages.dev';
      const finalUrl = baseUrl + '/input?key=' + secretKey;
      
      // 실제 API 호출
      await sendAlimtalk(phone, finalUrl, fullVendor.vendor_name, managerName);
      showToast('알림톡이 전송되었습니다.');
    } catch (err) {
      console.error(err);
      showToast(`발송 실패: ${err.message}`, true);
    } finally {
      setSendingVendorId(null);
    }
  }

  // Toast 띄우기 유틸러티 (3초 후 사라짐)
  function showToast(message, isError = false) {
    setToastMessage({ message, isError });
    setTimeout(() => {
      setToastMessage(null);
    }, 3000);
  }

  // --- 미니 달력 컴포넌트 ---
  function renderCalendar() {
    const { year, month } = calendarMonth
    const firstDay = new Date(year, month, 1).getDay() // 0=일 ~ 6=토
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const monthName = new Date(year, month).toLocaleDateString('ko-KR', {
      year: 'numeric', month: 'long'
    })

    const days = []
    // 빈칸 채우기 (월 시작 전)
    for (let i = 0; i < firstDay; i++) {
      days.push(<div key={`empty-${i}`} className="w-9 h-9" />)
    }
    // 날짜 버튼
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      const isSelected = dateStr === selectedDate
      const isToday = dateStr === today
      const isPastLimit = dateStr < '2026-04-01'

      days.push(
        <button
          key={d}
          type="button"
          disabled={isPastLimit}
          onClick={() => {
            if (isPastLimit) return
            setSelectedDate(dateStr)
            setShowDatePicker(false)
          }}
          className={`w-9 h-9 rounded-lg text-sm font-medium transition-all duration-150
            ${isPastLimit
              ? 'text-slate-300 cursor-not-allowed bg-slate-50'
              : isSelected
                ? 'bg-blue-600 text-white shadow-md shadow-blue-500/30 scale-110'
                : isToday
                  ? 'bg-blue-100 text-blue-700 ring-2 ring-blue-300'
                  : 'text-slate-700 hover:bg-slate-100'
            }`}
        >
          {d}
        </button>
      )
    }

    return (
      <div
        className="absolute top-full left-0 mt-2 bg-white rounded-2xl shadow-2xl border border-slate-200 p-4 z-50"
        style={{ minWidth: '320px' }}
      >
        {/* 달력 헤더 */}
        <div className="flex items-center justify-between mb-3">
          <button
            type="button"
            onClick={() => {
              const newMonth = month === 0 ? 11 : month - 1
              const newYear = month === 0 ? year - 1 : year
              setCalendarMonth({ year: newYear, month: newMonth })
            }}
            className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <ChevronLeft className="w-4 h-4 text-slate-600" />
          </button>
          <span className="font-bold text-slate-800">{monthName}</span>
          <button
            type="button"
            onClick={() => {
              const newMonth = month === 11 ? 0 : month + 1
              const newYear = month === 11 ? year + 1 : year
              setCalendarMonth({ year: newYear, month: newMonth })
            }}
            className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <ChevronRight className="w-4 h-4 text-slate-600" />
          </button>
        </div>

        {/* 요일 헤더 */}
        <div className="grid grid-cols-7 gap-1 mb-1">
          {['일', '월', '화', '수', '목', '금', '토'].map(day => (
            <div key={day} className="w-9 h-8 flex items-center justify-center text-xs font-semibold text-slate-400">
              {day}
            </div>
          ))}
        </div>

        {/* 날짜 그리드 */}
        <div className="grid grid-cols-7 gap-1">
          {days}
        </div>

        {/* 오늘 버튼 */}
        <button
          type="button"
          onClick={() => {
            goToday()
            setShowDatePicker(false)
          }}
          className="mt-3 w-full py-2 text-sm font-semibold text-blue-600 bg-blue-50 
                     rounded-xl hover:bg-blue-100 transition-colors"
        >
          오늘로 이동
        </button>
      </div>
    )
  }

  const grouped = groupByVendor()
  const missingVendors = getMissingVendors()
  const reportedCount = Object.keys(grouped).length
  const totalVendorCount = allVendors.length
  const submissionRate = totalVendorCount > 0
    ? Math.round((reportedCount / totalVendorCount) * 100)
    : 0

  // 선택한 날짜를 보기 좋게 표시 (브라우저 시간대 영향 방지)
  const [y, m, d] = selectedDate.split('-');
  const weekdays = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
  const displayDate = `${y}년 ${parseInt(m, 10)}월 ${parseInt(d, 10)}일 ${weekdays[new Date(y, m - 1, d).getDay()]}`;

  return (
    <div className="min-h-screen bg-slate-50">
      {/* 달력 외부 클릭 시 닫기 */}
      {showDatePicker && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setShowDatePicker(false)}
        />
      )}

      {/* 상단 헤더 */}
      <header className="bg-gradient-to-r from-slate-800 to-slate-900 text-white shadow-lg">
        <div className="max-w-6xl mx-auto px-4 py-5">
          <div className="flex items-center gap-3 mb-1">
            <BarChart3 className="w-7 h-7 text-blue-400" />
            <h1 className="text-xl md:text-2xl font-bold">관리자 대시보드</h1>
          </div>
          <p className="text-slate-400 text-sm">물가 동향 조사 데이터 관리</p>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-5 space-y-4">

        {/* ① 날짜 선택 영역 (DatePicker) */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            {/* 날짜 이동 + 달력 버튼 */}
            <div className="flex items-center gap-2 w-full sm:w-auto relative">
              {/* 이전 날 */}
              <button
                onClick={() => moveDate(-1)}
                disabled={selectedDate <= '2026-04-01'}
                className="p-3 rounded-xl bg-slate-100 hover:bg-slate-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="전날"
              >
                <ChevronLeft className="w-5 h-5 text-slate-600" />
              </button>

              {/* 날짜 표시 + 달력 토글 */}
              <button
                type="button"
                onClick={() => setShowDatePicker(!showDatePicker)}
                className="flex-1 sm:w-64 border-2 border-slate-200 rounded-xl px-4 py-3 
                           text-center font-medium text-slate-800 text-lg
                           hover:border-blue-400 focus:border-blue-500 focus:ring-2 
                           focus:ring-blue-200 outline-none transition-all
                           flex items-center justify-center gap-2 bg-white"
              >
                <Calendar className="w-5 h-5 text-blue-500" />
                <span>{displayDate}</span>
              </button>

              {/* 다음 날 */}
              <button
                onClick={() => moveDate(1)}
                className="p-3 rounded-xl bg-slate-100 hover:bg-slate-200 transition-colors"
                title="다음날"
              >
                <ChevronRight className="w-5 h-5 text-slate-600" />
              </button>

              {/* 미니 달력 드롭다운 */}
              {showDatePicker && renderCalendar()}
            </div>

            {/* 오늘 / 조회 / CSV 다운로드 버튼 */}
            <div className="flex gap-2 w-full sm:w-auto sm:ml-auto">
              {/* 오늘 버튼 */}
              {selectedDate !== today && (
                <button
                  onClick={goToday}
                  className="bg-slate-100 text-slate-700 rounded-xl px-4 py-3 
                             font-semibold hover:bg-slate-200 transition-colors text-sm
                             whitespace-nowrap"
                >
                  오늘
                </button>
              )}

              {/* 조회 버튼 */}
              <button
                onClick={fetchReports}
                disabled={loading}
                className="flex-1 sm:flex-none bg-blue-600 text-white rounded-xl px-5 py-3 
                           font-semibold hover:bg-blue-700 transition-colors flex items-center 
                           justify-center gap-2 disabled:opacity-50"
              >
                {loading
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <Search className="w-4 h-4" />
                }
                조회
              </button>

              {/* CSV 다운로드 버튼 */}
              <button
                onClick={handleDownloadCSV}
                disabled={reports.length === 0 && missingVendors.length === 0}
                className="flex-1 sm:flex-none bg-emerald-600 text-white rounded-xl px-5 py-3 
                           font-semibold hover:bg-emerald-700 transition-colors flex items-center 
                           justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Download className="w-4 h-4" />
                CSV 다운로드
              </button>
            </div>
          </div>
        </div>

        {/* 에러 메시지 */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-center gap-2 text-red-800">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <p className="font-medium">{error}</p>
          </div>
        )}

        {/* 로딩 상태 */}
        {loading && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-12 text-center">
            <Loader2 className="w-10 h-10 text-blue-500 animate-spin mx-auto mb-3" />
            <p className="text-slate-500">데이터를 불러오는 중...</p>
          </div>
        )}

        {/* ② 요약 통계 카드 (입력률 + 미입력 업체 수) */}
        {!loading && totalVendorCount > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* 전체 업체 수 */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center">
                <Building2 className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-slate-500">전체 업체</p>
                <p className="text-2xl font-bold text-slate-800">{totalVendorCount}</p>
              </div>
            </div>

            {/* 입력 완료 */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center">
                <CheckCircle2 className="w-6 h-6 text-emerald-600" />
              </div>
              <div>
                <p className="text-sm text-slate-500">입력 완료</p>
                <p className="text-2xl font-bold text-emerald-700">
                  {reportedCount}
                  <span className="text-sm font-medium text-slate-400 ml-1">
                    ({submissionRate}%)
                  </span>
                </p>
              </div>
            </div>

            {/* 미입력 */}
            <div className={`rounded-2xl shadow-sm border p-4 flex items-center gap-3 ${missingVendors.length > 0
                ? 'bg-red-50 border-red-200'
                : 'bg-white border-slate-200'
              }`}>
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${missingVendors.length > 0 ? 'bg-red-100' : 'bg-slate-100'
                }`}>
                <AlertTriangle className={`w-6 h-6 ${missingVendors.length > 0 ? 'text-red-600' : 'text-slate-400'
                  }`} />
              </div>
              <div>
                <p className="text-sm text-slate-500">미입력</p>
                <p className={`text-2xl font-bold ${missingVendors.length > 0 ? 'text-red-700' : 'text-slate-400'
                  }`}>
                  {missingVendors.length}
                  {missingVendors.length > 0 && (
                    <span className="text-sm font-medium text-red-500 ml-1">⚠️ 확인필요</span>
                  )}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ③ 미입력 업체 목록 (눈에 띄게) */}
        {!loading && missingVendors.length > 0 && (
          <div className="bg-red-50 border-2 border-red-200 rounded-2xl overflow-hidden animate-pulse-slow">
            {/* 미입력 섹션 헤더 */}
            <div className="bg-red-600 text-white px-4 py-3 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5" />
              <span className="font-bold text-lg">미입력 업체</span>
              <span className="ml-auto bg-white/20 backdrop-blur-sm rounded-full px-3 py-0.5 text-sm font-semibold">
                {missingVendors.length}개 업체
              </span>
            </div>
            {/* 미입력 업체 리스트 */}
            <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {missingVendors.map(v => (
                <div
                  key={v.id}
                  className="bg-white rounded-xl border border-red-200 px-4 py-3 
                             flex items-center gap-3 hover:shadow-md transition-shadow"
                >
                  <div className="w-10 h-10 rounded-lg bg-red-100 flex items-center justify-center flex-shrink-0">
                    <Building2 className="w-5 h-5 text-red-500" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-800 truncate">{v.vendor_name}</p>
                    <p className="text-xs text-slate-500">
                      {v.manager_name || '담당자 미등록'}
                    </p>
                  </div>
                  {/* 미입력 배지와 알림톡 버튼 */}
                  <div className="ml-auto flex items-center gap-2">
                    <span className="bg-red-100 text-red-700 text-xs font-bold px-2.5 py-1 
                                     rounded-full whitespace-nowrap animate-pulse">
                      미입력
                    </span>
                    <button
                      onClick={() => handleSendAlimtalk(v)}
                      disabled={sendingVendorId === v.id}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-yellow-400 hover:bg-yellow-500 text-yellow-950 text-sm font-bold rounded-lg transition-colors disabled:opacity-50"
                      title="알림톡 발송"
                    >
                      {sendingVendorId === v.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <MessageCircle className="w-4 h-4" />
                      )}
                      발송
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 데이터 없음 (보고 데이터도, 미입력도 없는 경우 = 업체 자체가 없음) */}
        {!loading && reports.length === 0 && missingVendors.length === 0 && totalVendorCount === 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-12 text-center">
            <Search className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500 text-lg font-medium">등록된 업체가 없습니다.</p>
            <p className="text-slate-400 text-sm mt-1">업체를 먼저 등록해주세요.</p>
          </div>
        )}

        {/* ④ 입력 완료된 업체 카드 (요약 복사 버튼 포함) */}
        {!loading && Object.keys(grouped).length > 0 && (
          <>
            {/* 입력 완료 섹션 안내 */}
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
              <p className="text-emerald-800 font-medium">
                입력 완료: <span className="font-bold">{reportedCount}</span>개 업체,{' '}
                <span className="font-bold">{reports.length}</span>개 품목 데이터
              </p>
            </div>

            {/* 업체별 카드 */}
            {Object.entries(grouped).map(([vendorName, group]) => (
              <div
                key={vendorName}
                className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden
                           hover:shadow-md transition-shadow duration-200"
              >
                {/* 업체 헤더 + 요약 복사 버튼 */}
                <div className="bg-slate-700 text-white px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span className="font-bold text-lg">{vendorName}</span>
                  {group.vendor && (
                    <>
                      <span className="text-slate-300 text-sm">
                        사업자번호: {group.vendor.biz_number}
                      </span>
                      <span className="text-slate-300 text-sm">
                        담당자: {group.vendor.manager_name}
                      </span>
                    </>
                  )}

                  {/* [요약 복사] 버튼과 [알림톡 발송] 버튼 */}
                  <div className="ml-auto flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleCopySummary(vendorName, group)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm 
                                 font-semibold transition-all duration-200 ${copiedVendor === vendorName
                          ? 'bg-green-500 text-white'
                          : 'bg-white/15 hover:bg-white/25 text-white backdrop-blur-sm'
                        }`}
                    >
                      {copiedVendor === vendorName ? (
                        <>
                          <CheckCircle2 className="w-4 h-4" />
                          복사 완료!
                        </>
                      ) : (
                        <>
                          <ClipboardCopy className="w-4 h-4" />
                          요약 복사
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSendAlimtalk(group.vendor)}
                      disabled={sendingVendorId === group.vendor.id}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-yellow-400 hover:bg-yellow-500 text-yellow-950 font-bold rounded-lg text-sm transition-colors disabled:opacity-50"
                    >
                      {sendingVendorId === group.vendor.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <MessageCircle className="w-4 h-4" />
                      )}
                      알림톡 발송
                    </button>
                  </div>
                </div>

                {/* 데이터 테이블 */}
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="px-4 py-3 text-sm font-semibold text-slate-600">품목</th>
                        <th className="px-4 py-3 text-sm font-semibold text-slate-600">입고가 동향</th>
                        <th className="px-4 py-3 text-sm font-semibold text-slate-600">판매가 동향</th>
                        <th className="px-4 py-3 text-sm font-semibold text-slate-600">재고 현황</th>
                        <th className="px-4 py-3 text-sm font-semibold text-slate-600 text-center">수급</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.items.map(r => (
                        <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                          <td className="px-4 py-3 font-medium text-slate-800">
                            {r.survey_items?.item_name || '-'}
                            {r.survey_items?.item_spec && (
                              <span className="text-slate-400 text-sm ml-1">
                                ({r.survey_items.item_spec})
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-slate-700">
                            {r.price_in_trend || '-'}
                          </td>
                          <td className="px-4 py-3 text-slate-700">
                            {r.price_out_trend || '-'}
                          </td>
                          <td className="px-4 py-3 text-slate-700">
                            {r.stock_status || '-'}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={`inline-block px-3 py-1 rounded-full text-sm font-semibold ${r.supply_status === '원활'
                                ? 'bg-green-100 text-green-700'
                                : r.supply_status === '부족'
                                  ? 'bg-red-100 text-red-700'
                                  : 'bg-yellow-100 text-yellow-700'
                              }`}>
                              {r.supply_status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      {/* 하단 여백 */}
      <div className="h-8" />

      {/* Toast 알림 */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 animate-fade-in-up">
          <div className={`flex items-center gap-2 px-5 py-3 rounded-xl shadow-lg border text-sm font-semibold text-white backdrop-blur-sm
            ${toastMessage.isError ? 'bg-red-600/90 border-red-500' : 'bg-slate-800/90 border-slate-700'}`}
          >
            {toastMessage.isError ? (
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
            ) : (
              <CheckCircle2 className="w-5 h-5 flex-shrink-0 text-emerald-400" />
            )}
            <span>{toastMessage.message}</span>
          </div>
        </div>
      )}
    </div>
  )
}

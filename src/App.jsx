// 앱의 메인 라우터 설정
// /input → 업체 입력 페이지, /admin → 관리자 대시보드
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import InputPage from './pages/InputPage'
import AdminPage from './pages/AdminPage'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* 업체 입력 페이지 */}
        <Route path="/input" element={<InputPage />} />

        {/* 관리자 대시보드 */}
        <Route path="/admin" element={<AdminPage />} />

        {/* 기본 경로는 /input으로 이동 */}
        <Route path="*" element={<Navigate to="/input" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App

import CryptoJS from 'crypto-js';

/**
 * 솔라피(Solapi) 알림톡 발송 함수
 * @param {string} to - 수신자 전화번호
 * @param {string} url - 알림톡에 포함될 URL 변수 값
 * @returns {Promise<boolean>} - 발송 성공 여부
 */
export async function sendAlimtalk(phone, url, vendorName, managerName) {
  const apiKey = import.meta.env.VITE_SOLAPI_API_KEY;
  const apiSecret = import.meta.env.VITE_SOLAPI_SECRET;
  const senderNo = import.meta.env.VITE_SOLAPI_SENDER_NO || "0000000000"; // 누락 시 빈 번호 전송으로 에러 유도
  const templateId = import.meta.env.VITE_SOLAPI_TEMPLATE_ID;
  const pfId = import.meta.env.VITE_SOLAPI_PFID || import.meta.env.VITE_SOLAPI_PF_ID;

  // API Key가 없으면 가상 성공 처리 (디자인 테스트용)
  if (!apiKey || apiKey.includes('YOUR_SOLAPI')) {
    console.warn("솔라피 연동 설정이 되지 않아 가상으로 발송 성공 처리합니다.");
    return new Promise(resolve => setTimeout(() => resolve(true), 1500));
  }

  try {
    const date = new Date().toISOString();
    const salt = Math.random().toString(36).substring(2, 11) + new Date().getTime().toString(36);
    const signature = CryptoJS.HmacSHA256(date + salt, apiSecret).toString(CryptoJS.enc.Hex);
    const authHeader = `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;

    const payload = {
      message: {
        to: phone.replace(/[^0-9]/g, ''), 
        from: senderNo.replace(/[^0-9]/g, ''),
        kakaoOptions: {
          pfId: pfId || undefined, // undefined면 필드 생략
          templateId: templateId,
          variables: {
            "#{url}": url,
            "#{vendor_name}": vendorName || '-',
            "#{manager_name}": managerName || '-'
          }
        }
      }
    };

    const response = await fetch("https://api.solapi.com/messages/v4/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": authHeader
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.errorMessage || '알림톡 발송에 실패했습니다.');
    }

    return true;
  } catch (error) {
    console.error("Solapi 알림톡 발송 에러:", error);
    throw error;
  }
}

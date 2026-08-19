/* Firebase 웹 설정.
 *
 * 이 값들은 비밀이 아닙니다. 공개돼도 됩니다 —
 * 실제 보안은 (1) 로그인 계정과 (2) Firestore 규칙이 담당합니다.
 * 계정이 없으면 주소를 알아도 아무 데이터도 못 봅니다.
 *
 * 아직 설정 전이면 null 로 둡니다. 그러면 앱은 '이 기기에만 저장' 모드로 돕니다.
 */
export const FIREBASE_CONFIG = null;

/* 설정 후에는 아래처럼 바뀝니다 (Firebase 콘솔 → 프로젝트 설정 → 내 앱 → 웹):
export const FIREBASE_CONFIG = {
  apiKey: "AIza...",
  authDomain: "bokwang-youth.firebaseapp.com",
  projectId: "bokwang-youth",
  storageBucket: "bokwang-youth.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
};
*/

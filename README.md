# HILFU FC v8.3 — 로그인 없이 공식 팀 보드 열람

## 운영 방식
- **일반 방문자:** 웹주소 접속 시 공식 팀 보드를 자동으로 불러옵니다. Google 로그인이 필요 없으며 열람 전용입니다. Firebase에서 실시간 갱신됩니다.
- **감독:** 기존 Google 계정으로 로그인하면 공식 보드 수정 및 코치 편집 권한 관리가 가능합니다.
- **승인된 코치:** 등록된 Google 계정으로 로그인하면 공식 보드를 수정할 수 있습니다.
- **개인 보드:** 감독/코치의 개인 동기화와 공식↔개인 복사 기능은 기존대로 유지합니다.
- 선수명단 포지션 수정, 동기화 표시, 17개 포메이션, PNG, 참석명단 OCR 등 기존 기능을 유지합니다.

## 배포
- GitHub의 `index.html`, `firebase-sync.js`, `firestore.rules`, `README.md`가 v8.3으로 업데이트되어도 Firebase에는 보안 규칙이 자동 적용되지 않습니다.
- Firebase Console → Firestore Database → 규칙에서 **기존에 게시된 규칙**을 유지하면서 다음 조건만 변경하고 **게시**합니다.
  - 기존: `allow get: if teamId == 'official' && request.auth != null;`
  - 변경: `allow get: if teamId == 'official';`
- **주의:** Firebase 콘솔에 이미 설정된 감독 UID를 변경하거나 `PASTE_OWNER_UID_HERE`로 되돌리지 마세요. GitHub의 `firestore.rules`는 UID를 치환하기 전 템플릿입니다.
- Firebase Authentication Google 로그인 공급자와 GitHub Pages 인증 허용 도메인 설정은 그대로 유지합니다.
- `firebase-config.js` 및 기존 데이터, Firestore 컬렉션 경로는 변경하지 않습니다.

## 보안
- 공식 자료 `hilfuTeams/official`의 단일 문서 조회만 공개됩니다. 이 데이터는 링크를 모르는 외부인도 API를 통해 열람할 수 있습니다.
- `hilfuStates/{uid}` 개인 데이터는 소유자만 읽고 쓸 수 있으며, 공식 보드 쓰기는 감독 또는 편집자로 등록된 코치만 가능합니다.
- `hilfuTeamAccess/official`의 편집자 목록은 여전히 제한적으로 열람됩니다.
- Firebase 실제 서비스에서 익명 브라우저로 열람 및 로그인한 코치 수정 테스트가 필요합니다.

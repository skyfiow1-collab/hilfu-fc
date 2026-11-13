# HILFU FC v7.0 — Firebase 실시간 동기화 설정

힐푸FC 선수·전술 관리 앱을 **GitHub Pages + Google 로그인 + Cloud Firestore**로 구성했습니다. 모바일·태블릿에서 같은 Google 계정으로 로그인하면 데이터가 실시간으로 맞춰집니다. 연결 전에는 기존처럼 브라우저에 저장합니다.

## 1. Firebase 프로젝트에서 필수 작업

1. [Firebase 콘솔](https://console.firebase.google.com/) → **프로젝트 추가** (또는 기존 프로젝트 선택).
2. **프로젝트 설정(톱니바퀴) → 내 앱 → 웹 앱 추가(`</>`)**. 제공되는 `firebaseConfig`에서 `apiKey`, `authDomain`, `projectId`, `appId`를 확인합니다.
3. **Build → Authentication → 시작하기 → Sign-in method → Google 활성화**.
4. **Authentication → Settings → Authorized domains**에서 GitHub Pages 호스트인 `skyfiow1-collab.github.io`를 추가합니다. 사용 중인 다른 도메인이 있으면 그 도메인도 추가합니다.
5. **Build → Firestore Database → 데이터베이스 만들기**. 보안 규칙을 임시 전체허용(`allow read, write: if true`)으로 열지 마세요.
6. **Firestore Database → Rules** 탭에 패키지의 `firestore.rules` 내용을 붙여넣고 **Publish**합니다. 규칙에서 Google 로그인 UID에 해당하는 문서만 접근하도록 제한합니다.

## 2. GitHub 업로드

1. `firebase-config.js`에 이번 Firebase 웹 앱 설정값을 입력해 두었습니다. **별도 수정 없이 사용 가능합니다.** 서비스 계정/비밀키/관리자 인증서는 GitHub에 올리지 마세요.
2. GitHub 저장소 최상위에 `index.html`, `firebase-sync.js`, `firebase-config.js`, `.nojekyll`, `README.md`를 업로드하고 커밋합니다. 기존 `index.html`은 새 것으로 덮어씁니다.
3. Settings → Pages → Deploy from a branch → main / (root)로 설정합니다.
4. `https://skyfiow1-collab.github.io/hilfu-fc/` (저장소 이름이 `hilfu-fc`인 경우)에 접속합니다.

공식 문서: https://firebase.google.com/docs/web/setup · https://firebase.google.com/docs/auth/web/google-signin · https://firebase.google.com/docs/firestore/query-data/listen · https://firebase.google.com/docs/firestore/security/get-started

## 3. 최초 동기화 절차 (매우 중요)

1. **기존 데이터를 가진 휴대폰**의 힐푸FC 앱에서 `↓ 데이터 백업`을 눌러 JSON을 저장합니다. 기존 다른 출처/도메인의 로컬 저장소는 자동 이전되지 않으므로, GitHub Pages 주소에서 `↑ 백업 불러오기`로 복원합니다.
2. 상단 `☁ 동기화 설정 → Google로 로그인`을 누릅니다.
3. 최초에는 **↑ 이 기기 데이터 올리기**를 선택합니다. 현재 휴대폰 데이터가 첫 클라우드 원본이 됩니다.
4. **갤럭시탭**에서 같은 Pages 주소 접속 → 같은 Google 계정으로 로그인 → **☁ 클라우드 데이터 가져오기** 선택. 이후 변경은 자동 전달됩니다.
5. 다른 계정으로 접속하면 다른 개인 데이터로 분리됩니다. 현재 버전은 코치/팀 전체의 공동 데이터 권한 관리 기능은 제공하지 않습니다.

## 주의 사항

- 동기화는 선수·라인업·전술판·화살표·메모 데이터를 포함합니다. 기기별 메뉴/선택 쿼터는 독립입니다.
- 한 사용자 계정 아래 단일 Firestore 문서에 저장하므로 **두 기기에서 동시에 편집하면 충돌할 수 있습니다**. 앱은 발견한 충돌에서 보존할 쪽을 고르게 하지만, 완전한 병합 기능은 아닙니다.
- 인터넷이 끊기면 로컬 편집 내용은 해당 브라우저에 남지만, 이 버전은 전문적인 오프라인 큐가 없습니다. 연결이 끊겼다가 돌아온 경우 저장 상태를 반드시 확인하고 필요 시 JSON 백업으로 복원하세요.
- JSON 백업은 로컬 파일입니다. 실시간 동기화가 켜져 있는 경우 백업 불러오기/초기화도 클라우드에 전파될 수 있으니 작업 전 백업하세요.
- `firebase-config.js`는 정적 사이트에 노출되는 공개 웹 앱 설정입니다. Firestore 보안은 반드시 **보안 규칙 + Google 로그인**으로 설정합니다.
- Firebase 플러그인을 Codex에 연결한 것만으로 Firebase 프로젝트·Firestore·웹 앱 설정이 자동으로 준비되지는 않습니다.

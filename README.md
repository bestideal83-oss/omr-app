# 수능 모의고사 OMR 시스템

학생 태블릿/스마트폰에서 URL만 열면 바로 사용 가능한 온라인 OMR 답안 입력 및 채점 시스템입니다.

**예상 소요 시간**: 약 30~40분 (Firebase 설정 + Vercel 배포)
**비용**: 무료 (Firebase Spark + Vercel Hobby 플랜)

---

## 📋 준비물

배포 전에 다음 계정이 필요합니다 (모두 무료):

1. **Google 계정** — Firebase 사용
2. **GitHub 계정** — 코드 저장 ([github.com](https://github.com)에서 가입)
3. **Vercel 계정** — GitHub로 연동 가입 가능 ([vercel.com](https://vercel.com))

설치는 **컴퓨터(Windows/Mac)**에서 진행합니다. (태블릿 X)

---

## 1단계: Firebase 프로젝트 만들기 (10분)

학생 답안과 정답이 저장될 클라우드 데이터베이스를 만듭니다.

### 1-1. 프로젝트 생성

1. [https://console.firebase.google.com](https://console.firebase.google.com) 접속
2. Google 계정 로그인
3. **[프로젝트 만들기]** 클릭
4. 프로젝트 이름 입력 (예: `omr-app`)
5. **Google 애널리틱스 사용 안 함** 선택 (간단하게)
6. **[프로젝트 만들기]** → 완료될 때까지 대기 (1~2분)

### 1-2. Firestore 데이터베이스 활성화

1. 왼쪽 메뉴에서 **빌드 → Firestore Database** 클릭
2. **[데이터베이스 만들기]** 클릭
3. **테스트 모드에서 시작** 선택 → **[다음]**
4. 위치: `asia-northeast3 (서울)` 선택 → **[사용 설정]**

### 1-3. 보안 규칙 설정

1. Firestore Database 화면에서 상단 **[규칙]** 탭 클릭
2. 기존 내용을 모두 지우고 아래 규칙으로 교체:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /omr/{document} {
      allow read, write: if true;
    }
  }
}
```

3. **[게시]** 클릭

> 💡 이 규칙은 `omr` 컬렉션에만 공개 접근을 허용합니다. 다른 데이터는 보호됩니다.

### 1-4. 웹 앱 등록 및 설정 복사

1. 왼쪽 위 **프로젝트 개요 (⚙️ 아이콘 옆)** 클릭
2. **앱 추가** 영역에서 **웹 아이콘 `</>`** 클릭
3. 앱 닉네임 입력 (예: `omr-web`)
4. **Firebase 호스팅 설정** 체크 해제 → **[앱 등록]**
5. 다음 화면에 `firebaseConfig` 객체가 표시됩니다:

```javascript
const firebaseConfig = {
  apiKey: "AIzaSyA...",
  authDomain: "omr-app-xxxxx.firebaseapp.com",
  projectId: "omr-app-xxxxx",
  storageBucket: "omr-app-xxxxx.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123:web:abc..."
};
```

6. **이 전체 객체를 복사**해서 보관해 두세요. **나중에 사용합니다.**
7. **[콘솔로 이동]** 클릭

---

## 2단계: 코드 준비 (5분)

### 2-1. 이 폴더 전체를 컴퓨터에 다운로드

`omr-app` 폴더를 통째로 본인 컴퓨터에 저장하세요.

### 2-2. Firebase 설정 붙여넣기

1. `omr-app/src/firebase.js` 파일을 **메모장** 또는 **VS Code**로 열기
2. 아래 부분을 1-4에서 복사한 값으로 **모두 교체**:

```javascript
const firebaseConfig = {
  apiKey: "YOUR_API_KEY_HERE",                    // ← 본인 값으로 교체
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",   // ← 본인 값으로 교체
  projectId: "YOUR_PROJECT_ID",                    // ← 본인 값으로 교체
  storageBucket: "YOUR_PROJECT_ID.appspot.com",    // ← 본인 값으로 교체
  messagingSenderId: "YOUR_SENDER_ID",             // ← 본인 값으로 교체
  appId: "YOUR_APP_ID"                             // ← 본인 값으로 교체
};
```

3. 저장

---

## 3단계: GitHub에 코드 업로드 (10분)

### 3-1. 새 리포지토리 만들기

1. [github.com](https://github.com) 로그인
2. 우측 상단 **`+` → New repository**
3. Repository name: `omr-app`
4. **Public** 선택 (Private도 가능)
5. **Create repository** 클릭

### 3-2. 코드 업로드 (Drag & Drop)

1. 방금 만든 빈 리포지토리 페이지에서 **"uploading an existing file"** 링크 클릭
2. `omr-app` 폴더 안의 **모든 파일과 폴더**를 드래그해서 업로드
   - `package.json`, `vite.config.js`, `index.html`, `.gitignore`, `src/` 폴더 전체
3. 페이지 아래 **Commit changes** 클릭

> ⚠️ `node_modules` 폴더는 절대 업로드하지 마세요 (있다면). `.gitignore`가 자동으로 제외시키지만, 수동 업로드 시 주의.

---

## 4단계: Vercel로 배포 (5분)

### 4-1. Vercel 가입 및 GitHub 연동

1. [vercel.com](https://vercel.com) 접속
2. **Sign Up** → **Continue with GitHub** 선택
3. 권한 승인

### 4-2. 프로젝트 import

1. Vercel 대시보드에서 **Add New → Project** 클릭
2. 방금 만든 `omr-app` 리포지토리 옆 **Import** 클릭
3. **Framework Preset**: `Vite` 자동 감지됨 (자동이 아니면 수동 선택)
4. 다른 설정은 그대로 두고 **[Deploy]** 클릭
5. 2~3분 대기

### 4-3. 배포 URL 확인

배포 완료되면 다음과 같은 URL이 발급됩니다:

```
https://omr-app-xxxxx.vercel.app
```

이 URL을 **학생들에게 공유**하면 됩니다!

---

## 5단계: 사용 시작

### 학생 사용법
1. 발급받은 Vercel URL 접속
2. 이름·수험번호 입력 → **시작하기**
3. 과목별 답안 마킹 → **제출하기**
4. 전 과목 제출 완료 후 → **내 점수 확인**

### 교사 사용법
1. 같은 URL 접속 → **🔑 교사 로그인**
2. **비밀번호: `2580`** (대시보드에서 변경 가능)
3. **🔑 정답·배점 입력** 으로 정답과 문항별 점수 입력
4. **⏰ 마감 관리** 로 과목별 마감 시간 설정
5. **📊 학급 전체 점수** 확인 및 엑셀 다운로드

---

## 💻 로컬 테스트 (선택)

배포 전에 본인 컴퓨터에서 먼저 테스트하려면:

### Node.js 설치
- [nodejs.org](https://nodejs.org) 에서 LTS 버전 다운로드 후 설치

### 명령어 실행
```bash
cd omr-app
npm install
npm run dev
```

브라우저에서 `http://localhost:5173` 접속

---

## 🔧 문제 해결

### "Firebase: Error (auth/invalid-api-key)"
→ `firebase.js`의 `firebaseConfig` 값이 잘못 입력됐습니다. 1-4 단계를 다시 확인하세요.

### "Missing or insufficient permissions"
→ Firestore 보안 규칙이 적용되지 않았습니다. 1-3 단계를 다시 확인하세요.

### 학생이 제출했는데 교사 화면에 안 보임
→ 같은 Firebase 프로젝트를 사용 중인지, Firestore 보안 규칙이 올바른지 확인하세요. 새로고침 또는 로그아웃 후 재로그인해보세요.

### Vercel 배포 실패
→ `package.json` 이 정상적으로 업로드됐는지 확인. `node_modules` 폴더가 함께 업로드되지 않았는지 확인.

### 학생들이 너무 많아서 Firestore 무료 한도가 걱정됨
→ Firebase Spark(무료) 플랜은 일일 50,000 읽기, 20,000 쓰기 가능. 한 학급(40명)이 5과목씩 제출해도 200 쓰기 정도라 여유 충분.

---

## 🔒 보안 권고

현재 설정은 **단일 학급/학교용**으로 적합합니다. 

- 학생 답안은 누구나 URL을 알면 접근 가능 (단, 교사 기능은 비밀번호 보호)
- 더 엄격한 보안이 필요하면:
  - 교사 비밀번호를 즉시 변경 (기본 2580)
  - Firebase Authentication 추가
  - Firestore 보안 규칙 강화

---

## 📂 폴더 구조

```
omr-app/
├── package.json          # 의존성 정의
├── vite.config.js        # Vite 빌드 설정
├── index.html            # HTML 진입점
├── .gitignore            # Git 제외 파일
├── README.md             # 이 문서
└── src/
    ├── main.jsx          # React 진입점
    ├── firebase.js       # Firebase 설정 (수정 필요)
    └── App.jsx           # OMR 앱 (수정 불필요)
```

---

문의: 진행 중 막히는 부분이 있으면 단계 번호와 함께 알려주세요.

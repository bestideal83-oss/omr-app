// ============================================================
// Firebase 설정
// ============================================================
// 👇 아래 firebaseConfig 객체에 Firebase 콘솔에서 복사한 값을 붙여넣으세요
// 가이드: https://console.firebase.google.com → 프로젝트 설정 → 일반 → 내 앱 → 웹 앱 → SDK 구성

import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore/lite";

const firebaseConfig = {
  apiKey: "YOUR_API_KEY_HERE",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

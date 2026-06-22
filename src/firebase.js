// ============================================================
// Firebase 설정
// ============================================================
// 👇 아래 firebaseConfig 객체에 Firebase 콘솔에서 복사한 값을 붙여넣으세요
// 가이드: https://console.firebase.google.com → 프로젝트 설정 → 일반 → 내 앱 → 웹 앱 → SDK 구성

import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore/lite";

const firebaseConfig = {
  apiKey: "AIzaSyCDSOrKDFQxCLF4jByt6109988Ralklg4I",
  authDomain: "omr-app-d4c69.firebaseapp.com",
  projectId: "omr-app-d4c69",
  storageBucket: "omr-app-d4c69.firebasestorage.app",
  messagingSenderId: "517256460299",
  appId: "1:517256460299:web:b6580e21191b58479d6f0e"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

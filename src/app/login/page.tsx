import { LoginForm } from "@/features/auth/forms";
import { BRAND } from "@/domain/brand";
import { DEMO_PASSWORD } from "@/domain/catalog";
export const metadata = { title: "로그인" };
export default function Login() { return <section className="auth-panel panel"><p className="eyebrow">GS HALE</p><h1>로그인</h1><p>{BRAND.definition}</p><h2>해외 헬스케어 진출의 모든 일</h2><LoginForm /><details><summary>합성 데모 계정 안내</summary><p>관리자: admin@example.test<br />GSG 운영자: operator@example.test<br />브랜드: luna@example.test · wave@example.test<br />동료: co@example.test · team@example.test</p><p>데모 전용 비밀번호: <code>{DEMO_PASSWORD}</code></p><p>역할 선택으로 인증하지 않으며, 각 계정의 서버 세션으로 접근 범위를 확인합니다.</p></details></section>; }

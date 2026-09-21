"use client";
import { useEffect, useState, useRef, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { api } from "./client";
import {clearSubmissionRecovery} from "@/features/submissions/recovery";
export function LoginForm() { const router = useRouter(); const [error, setError] = useState(""); const [busy, setBusy] = useState(false); async function submit(e: FormEvent<HTMLFormElement>) { e.preventDefault(); const f = new FormData(e.currentTarget); setBusy(true); setError(""); try {
    await api("/api/auth/login", "POST", { email: f.get("email"), password: f.get("password") });
    clearSubmissionRecovery();
    router.replace("/");
    router.refresh();
}
catch (e) {
    setError((e as Error).message);
    setBusy(false);
} } return <form onSubmit={submit} className="identity-form"><label>이메일<input name="email" type="email" autoComplete="username" required/></label><label>비밀번호<input name="password" type="password" autoComplete="current-password" minLength={12} maxLength={128} required/></label>{error && <p role="alert" className="form-error">{error}</p>}<button className="button" disabled={busy}>{busy ? "로그인 중…" : "로그인"}</button></form>; }
export function AccountMenu() { const router = useRouter(); const pathname = usePathname(); const [user, setUser] = useState<{
    name: string;
} | null>(null); const [error, setError] = useState(""); useEffect(() => { api<{
    user: {
        name: string;
    };
}>("/api/auth/me").then(r => setUser(r.user)).catch(() => setUser(null)); }, [pathname]); return <div className="account-menu">{user ? <><span>{user.name}</span><button className="button subtle" onClick={async () => { try {
    await api("/api/auth/logout", "POST");
    clearSubmissionRecovery();
    setUser(null);
    router.replace("/login");
    router.refresh();
}
catch (e) {
    setError((e as Error).message);
} }}>로그아웃</button></> : <Link href="/login">로그인</Link>}{error && <span role="alert">{error}</span>}</div>; }
export function InvitationForm() { const tokenRef = useRef<HTMLInputElement>(null); const [error, setError] = useState(""); const [done, setDone] = useState(false); const [busy, setBusy] = useState(false); useEffect(() => { const raw = window.location.hash.slice(1); if (raw && tokenRef.current) {
    tokenRef.current.value = raw;
    window.history.replaceState(null, "", "/invitations");
} }, []); async function submit(e: FormEvent<HTMLFormElement>) { e.preventDefault(); const f = new FormData(e.currentTarget); setBusy(true); setError(""); try {
    await api("/api/invitations/accept", "POST", { token: f.get("token"), ...(f.get("password") ? { password: f.get("password") } : {}) });
    setDone(true);
}
catch (e) {
    setError((e as Error).message);
}
finally {
    setBusy(false);
} } if (done)
    return <section role="status"><h2>초대 수락 완료</h2><p>계정과 멤버십을 활성화했습니다.</p><Link className="button" href="/login">로그인 화면으로</Link></section>; return <form className="identity-form" onSubmit={submit}><p>새 계정은 비밀번호를 설정해 주세요. 기존 계정은 초대받은 이메일로 먼저 로그인한 뒤 이 링크를 다시 여세요.</p><label>초대 코드<input type="password" name="token" ref={tokenRef} required autoComplete="off"/></label><label>새 계정 비밀번호 (기존 계정은 비워 두세요)<input type="password" name="password" minLength={12} maxLength={128} autoComplete="new-password"/></label>{error && <p role="alert" className="form-error">{error}</p>}<button className="button" disabled={busy}>{busy ? "수락 중…" : "초대 수락"}</button><Link href="/login">기존 계정 로그인</Link><p>만료되거나 재발급된 초대는 사용할 수 없습니다. GSG 관리자에게 새 링크를 요청해 주세요.</p></form>; }

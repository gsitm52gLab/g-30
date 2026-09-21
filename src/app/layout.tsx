import type { Metadata } from "next";
import Link from "next/link";
import { BRAND } from "@/domain/brand";
import { Navigation } from "@/components/navigation";
import "./globals.css";
import { AccountMenu } from "@/features/auth/forms";
export const metadata: Metadata = { title: { default: "GS HALE | 해외 헬스케어 진출의 모든 일", template: "%s | GS HALE" }, description: BRAND.definition };
export default function RootLayout({ children }: {
    children: React.ReactNode;
}) {
    return <html lang="ko"><body><a className="skip-link" href="#main-content">본문으로 이동</a><div className="app-shell"><aside className="sidebar"><Link className="brand-logo" href="/" aria-label="GS HALE 홈"><span className="brand-symbol" aria-hidden="true">H</span><span>GS HALE<span className="brand-caption">LAUNCH ENABLEMENT</span></span></Link><div className="workspace-label">GSG WORKSPACE</div><Navigation /><div className="sidebar-bottom"><span className="status-dot"/>합성 데이터 미리보기<p>계정·컨텍스트 관리가 연결됐습니다. 업무 편집은 후속 단계입니다.</p></div></aside><div className="main-shell"><header className="topbar"><span>Healthcare & Aesthetic Launch Enablement</span><AccountMenu /></header><main id="main-content" tabIndex={-1}>{children}</main><footer>GS HALE <span>해외 헬스케어 진출의 모든 일</span></footer></div></div></body></html>;
}

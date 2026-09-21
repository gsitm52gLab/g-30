"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "@/features/tasks/ui.module.css";
export function Navigation() {
    const pathname = usePathname();
    return <nav aria-label="주 메뉴" className={styles.nav}>{[["/", "홈", "01"], ["/tasks", "업무", "02"], ["/products", "상품정보", "03"], ["/projects", "입점 프로젝트", "04"], ["/contexts", "컨텍스트·회원", "05"], ["/materials", "자료함·제출표", "06"], ["/notices", "공지·가이드", "07"], ["/inquiries", "문의", "08"]].map(([href, label, number]) => {
            const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
            return <Link key={href} href={href} aria-current={active ? "page" : undefined} className={active ? "nav-link active" : "nav-link"}><span className="nav-number">{number}</span>{label}<span aria-hidden="true" className="nav-arrow">↗</span></Link>;
        })}</nav>;
}

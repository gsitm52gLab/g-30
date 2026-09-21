"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
export function Navigation() {
    const pathname = usePathname();
    return <nav aria-label="주 메뉴">{[["/", "홈", "01"], ["/tasks", "업무", "02"], ["/products", "상품정보", "03"], ["/contexts", "컨텍스트·회원", "04"]].map(([href, label, number]) => {
            const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
            return <Link key={href} href={href} aria-current={active ? "page" : undefined} className={active ? "nav-link active" : "nav-link"}><span className="nav-number">{number}</span>{label}<span aria-hidden="true" className="nav-arrow">↗</span></Link>;
        })}</nav>;
}

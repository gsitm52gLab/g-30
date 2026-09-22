import Link from "next/link";
export default function NotFound() { return <section className="empty-state"><h1>자료를 찾을 수 없습니다</h1><p>선택한 컨텍스트와 주소를 확인해 주세요.</p><Link className="button" href="/">홈으로 이동</Link></section>; }

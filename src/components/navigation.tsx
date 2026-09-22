'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { navigationMenus } from '@/features/home/navigation';
import styles from '@/features/tasks/ui.module.css';
import nav from './navigation.module.css';
export function Navigation() {
  const pathname = usePathname();
  const [identity, setIdentity] = useState<{ path: string; role: 'gsg' | 'brand' } | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    void fetch('/api/home/navigation', { cache: 'no-store', signal: abort.signal }).then(async response => {
      if (!response.ok) return;
      const data = await response.json();
      if (data.role === 'gsg' || data.role === 'brand') setIdentity({ path: pathname, role: data.role });
    }).catch(() => { /* Failed or cancelled role reads never reveal operational settings. */ });
    return () => abort.abort();
  }, [pathname]);
  const role = identity?.path === pathname ? identity.role : null;
  return <nav aria-label="주 메뉴" className={`${styles.nav} ${nav.scrollable}`}>{navigationMenus(role).map(([href, label], i) => {
    const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
    return <Link key={href} href={href} prefetch={false} aria-current={active ? 'page' : undefined} className={active ? 'nav-link active' : 'nav-link'}><span className="nav-number">{String(i + 1).padStart(2, '0')}</span>{label}<span aria-hidden="true" className="nav-arrow">↗</span></Link>;
  })}</nav>;
}

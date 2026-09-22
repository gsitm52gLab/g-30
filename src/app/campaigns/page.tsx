import Link from 'next/link';
import type { Metadata } from 'next';
import type { Search } from '@/server/workspace';
import { homePage, homeFailure, HomeFailure } from '@/features/home/server';
import { HomeFilters } from '@/features/home/surface';
import styles from '@/features/home/ui.module.css';
export const metadata: Metadata = { title: 'PR·행사' };
export const dynamic = 'force-dynamic';
export default async function Campaigns({ searchParams }: { searchParams: Search }) {
  const result = await homePage(searchParams).catch(homeFailure);
  if (typeof result === 'string') return <HomeFailure state={result}/>;
  const { data } = result;
  return <div className={styles.stack}><header><h1>PR·행사</h1><p>공개된 행사와 담당 업무의 조건·자료·후속 기록을 확인하세요.</p></header><HomeFilters data={data} action="/campaigns"/>{data.campaigns.length ? <div className={styles.grid}>{data.campaigns.map(c => <article className={styles.card} key={c.id}><h2><Link href={c.url}>{c.title} ↗</Link></h2><Link href={`/tasks/${c.taskId}?context=${c.contextId}`}>연결 업무: {c.taskTitle}</Link></article>)}</div> : <p>이 범위에서 조회할 수 있는 PR·행사가 없습니다.</p>}{data.role === 'gsg' && <section className={styles.panel}><h2>담당 업무에서 행사 작성</h2>{data.tasks.map(t => <p key={t.id}><Link href={`/tasks/${t.id}/campaigns?context=${t.contextId}`}>{t.title} · PR·행사 열기</Link></p>)}</section>}</div>;
}

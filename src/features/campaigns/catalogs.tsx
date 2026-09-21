'use client';
import { useState } from 'react';
import type { CatalogDraft } from '@/domain/campaigns/types';
import type { Controller } from './controller';
import { Field, SourceEditor, blankSource } from './fields';
import { SourceUploads } from './uploads';
import s from './ui.module.css';
interface Editor {
    catalogId: string | null;
    revision: number;
    draft: CatalogDraft;
}
export function Catalogs({ c }: {
    c: Controller;
}) {
    const d = c.state.data!, [added, setAdded] = useState<typeof d.task.files>([]), files = [...d.task.files, ...added.filter(f => !d.task.files.some(x => x.id === f.id))];
    const editor = c.form<Editor>('catalog', { catalogId: null, revision: 0, draft: { title: '', versionLabel: '', source: blankSource() } }), set = (v: Editor) => c.setForm('catalog', v);
    const items = d.catalogs?.items ?? [];
    return <div className={s.stack}><section className={s.panel}><h2>카탈로그 원문·번역</h2><p className={s.notice}>GSG 내부 자료입니다. 원문 금액·번역은 공개 조건으로 자동 복사하지 않습니다. 과거 가격은 현재 견적과 별도입니다.</p><label className={s.field}>편집할 카탈로그<select disabled={c.locked} value={editor.catalogId ?? ''} onChange={e => { const x = items.find(i => i.id === e.target.value), v = x?.versions[0]; set(x && v ? { catalogId: x.id, revision: x.revision, draft: { title: v.title, versionLabel: v.versionLabel, source: v.source } } : { catalogId: null, revision: 0, draft: { title: '', versionLabel: '', source: blankSource() } }); }}><option value="">새 카탈로그</option>{items.map(x => <option key={x.id} value={x.id}>{x.versions[0]?.title} · 저장 버전 {x.revision}</option>)}</select></label><form className={s.stack} onSubmit={e => { e.preventDefault(); void c.execute({ command: 'save_catalog', contextId: d.task.task.contextId!, catalogId: editor.catalogId, expectedRevision: editor.revision, draft: editor.draft, idempotencyKey: crypto.randomUUID() }, 'catalog'); }}><fieldset disabled={c.locked} className={`${s.fieldset} ${s.stack}`}><div className={s.grid}><Field label="카탈로그 제목" required value={editor.draft.title} onChange={title => set({ ...editor, draft: { ...editor.draft, title } })}/><Field label="카탈로그 버전명" required value={editor.draft.versionLabel} onChange={versionLabel => set({ ...editor, draft: { ...editor.draft, versionLabel } })}/></div><SourceEditor value={editor.draft.source} files={files} onChange={source => set({ ...editor, draft: { ...editor.draft, source } })}/><button className="button">카탈로그 새 버전 저장</button></fieldset></form>{editor.catalogId && items.find(x => x.id === editor.catalogId)?.revision !== editor.revision && <div className={s.notice}>현재 저장 버전이 다릅니다. 위 카탈로그 선택에서 최신 내용을 확인한 뒤 명시적으로 다시 편집하세요. 현재 입력은 자동 덮어쓰지 않습니다.</div>}</section><SourceUploads c={c} onUploaded={fs => setAdded(old => [...old, ...fs])}/><section className={s.panel}><h2>카탈로그 변경 이력</h2>{items.length ? items.flatMap(x => x.versions.map(v => <details className={s.details} key={v.id}><summary>{v.title} · {v.versionLabel} · v{v.sequence}</summary><p>{v.recorderLabel} · {v.recordedAt}</p><p>{v.source.source} · {v.source.sourceVersion} · {v.source.locator} · {v.source.language}</p><h4>원문</h4><p className={s.prose}>{v.source.originalText || '원문 없음'}</p><h4>번역</h4><p className={s.prose}>{v.source.translatedText || '번역 없음'}</p>{v.source.fileVersionIds.map(id => <a key={id} href={`/api/files/${id}?taskId=${d.task.task.id}&mode=download`}>{files.find(f => f.id === id)?.name ?? '이전 원문 파일'} 다운로드</a>)}</details>)) : <p>아직 등록된 카탈로그가 없습니다.</p>}</section></div>;
}

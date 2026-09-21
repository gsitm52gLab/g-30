'use client';
import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { InquirySurface } from './surface';
import { inquiryUrl } from './client';
import s from './ui.module.css';
export function InquiryPopup({ id, contextId, onClose }: {
    id: string;
    contextId: string;
    onClose: () => void;
}) { const dialog = useRef<HTMLDialogElement>(null); useEffect(() => { const opener = document.activeElement as HTMLElement | null; dialog.current?.showModal(); return () => { opener?.focus(); }; }, []); return <dialog ref={dialog} className={s.dialog} aria-labelledby="inquiry-popup-title" onCancel={e => { e.preventDefault(); onClose(); }}><div className={s.dialogHeader}><strong id="inquiry-popup-title">문의 1:1 대화</strong><div className={s.actions}><Link href={inquiryUrl(id, contextId)} onClick={onClose}>전체 상세 열기</Link><button className="button subtle" onClick={onClose}>대화 팝업 닫기</button></div></div><div className={s.dialogBody}><InquirySurface id={id} contextId={contextId} popup/></div></dialog>; }

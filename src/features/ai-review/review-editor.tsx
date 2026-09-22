'use client';

import { useId } from 'react';
import type { HumanReviewCommand } from '@/domain/ai-review/types';
import s from './ui.module.css';

export type HumanReviewEditorProps = {
  command: HumanReviewCommand;
  suggestedText: string | null;
  onCommandChange: (command: HumanReviewCommand) => void;
  onSubmit: (command: HumanReviewCommand) => void;
  busy?: boolean;
  disabledReason?: string;
  error?: string;
};

/** Controlled form only. The caller owns current authorization, revision, persistence and recovery. */
export function HumanReviewEditor({ command, suggestedText, onCommandChange, onSubmit, busy = false, disabledReason, error }: HumanReviewEditorProps) {
  const id = useId();
  const blocked = busy || Boolean(disabledReason);
  const incomplete = !command.reason.trim() || (command.decision === 'edit' && !command.editedSuggestion?.trim());
  return <form className={s.review} aria-label={`후보 ${command.findingId} 사람 검토`} aria-busy={busy} onSubmit={event => { event.preventDefault(); if (!blocked && !incomplete) onSubmit(command); }}>
    <h3>사람 검토 기록</h3>
    <p id={`${id}-help`} className={s.meta}>후보의 수락·수정·기각과 사유를 기록합니다. 원문 변경·브랜드 공개·외부 전문가 승인은 별도입니다.</p>
    {disabledReason && <p className={s.notice}>{disabledReason}</p>}
    {error && <p id={`${id}-error`} className={s.error} role="alert">{error}</p>}
    <fieldset disabled={blocked} aria-describedby={`${id}-help${error ? ` ${id}-error` : ''}`}>
      <legend>검토 내용</legend>
      <label className={s.field} htmlFor={`${id}-decision`}>후보에 대한 판단
        <select id={`${id}-decision`} value={command.decision} onChange={event => {
          const decision = event.target.value as HumanReviewCommand['decision'];
          onCommandChange({ ...command, decision, editedSuggestion: decision === 'edit' ? command.editedSuggestion ?? suggestedText ?? '' : null });
        }}><option value="accept">수락 · 후보를 검토 대상으로 인정</option><option value="edit">수정 · 참고 수정안 조정</option><option value="reject">기각 · 사유 기록</option></select>
      </label>
      <label className={s.field} htmlFor={`${id}-reason`}>판단 사유 (필수)
        <textarea id={`${id}-reason`} required maxLength={3000} rows={4} value={command.reason} onChange={event => onCommandChange({ ...command, reason: event.target.value })}/>
      </label>
      {command.decision === 'edit' && <label className={s.field} htmlFor={`${id}-suggestion`}>조정한 참고 수정안 (필수)
        <textarea id={`${id}-suggestion`} required maxLength={4000} rows={5} value={command.editedSuggestion ?? ''} onChange={event => onCommandChange({ ...command, editedSuggestion: event.target.value })}/>
      </label>}
      <p className={s.meta}>검토 기준 리비전 {command.expectedRevision} · 저장 충돌 시 현재 기록을 확인해야 합니다.</p>
      <div className={s.actions}><button type="submit" disabled={incomplete}>{busy ? '기록 중…' : '사람 검토 기록'}</button></div>
    </fieldset>
  </form>;
}

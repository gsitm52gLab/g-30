import Link from 'next/link';
import type { InquiryFileDTO, QuestionCounts, QuestionDTO, PublicMessageDTO, InternalMessageDTO, InquiryHistoryDTO } from '@/server/inquiries/contracts';
import s from './ui.module.css';
export const stateLabel = { gsg_waiting: 'GSG 답변 대기', brand_supplement_waiting: '브랜드 보완 대기', external_waiting: '외부 확인 대기', resolved: '답변 완료' };
export const kindLabel = { question: '질문', comment: '대화', acknowledgement: '확인 회신', answer: '명시 답변', supplement: '추가 자료·보완', internal_note: 'GSG 내부 메모' };
export const time = (v: string | null) => v ? new Date(v).toLocaleString('ko-KR') : '미기록';
export function Counts({ value }: {
    value: QuestionCounts;
}) { return <div className={s.counts} aria-label="질문별 현황"><span>질문 <strong>{value.questions}</strong></span><span>답변 완료 <strong>{value.answered}</strong></span><span>남은 질문 <strong>{value.unresolved}</strong></span><span>외부 확인 대기 <strong>{value.externalWaiting}</strong></span></div>; }
export function Files({ files }: {
    files: InquiryFileDTO[];
}) { return <ul className={s.files}>{files.map(f => <li key={f.id}><strong>{f.name}</strong><p className={s.meta}>{f.bytes.toLocaleString()} bytes · {f.uploaderLabel} · {time(f.uploadedAt)} · {f.visibility === 'internal' ? 'GSG 내부' : '대화 첨부'}</p><div className={s.actions}>{f.previewUrl && <a href={f.previewUrl} target="_blank" rel="noreferrer">미리보기</a>}<a href={f.originalUrl} target="_blank" rel="noreferrer">원본 보기</a><a href={f.downloadUrl}>다운로드</a></div></li>)}</ul>; }
export function Wait({ value }: {
    value: QuestionDTO['externalWait'];
}) { return value && <dl className={s.meta}><dt>확인 상대</dt><dd>{value.counterparty}</dd><dt>확인 요청 시각</dt><dd>{time(value.sentAt)}</dd><dt>확인 책임자</dt><dd>{value.responsibleLabel}</dd><dt>다음 확인일</dt><dd>{value.nextCheckDate} · {value.timezone}</dd><dt>최신 결과</dt><dd className={s.prose}>{value.latestResult || '미기록'}</dd></dl>; }
export function Message({ message }: {
    message: PublicMessageDTO | InternalMessageDTO;
}) { return <article className={s.message} data-message-id={message.id}><div className={s.row}><span className={s.badge}>{kindLabel[message.kind]}</span><strong>{message.authorLabel}</strong><time className={s.meta}>{time(message.createdAt)}</time></div>{message.body && <p className={s.prose}>{message.body}</p>}<Files files={message.files}/></article>; }
export function History({ items, contextId }: {
    items: InquiryHistoryDTO[];
    contextId: string;
}) { return <details className={s.panel}><summary>상태·업무 연결 이력 ({items.length})</summary><ol className={s.history}>{items.map(h => <li key={h.id}>{h.action === 'question_state' ? <><strong>{h.from ? stateLabel[h.from] : '새 질문'} → {stateLabel[h.to]}</strong><p className={s.prose}>{h.reason || '별도 사유 없음'}</p><Wait value={h.externalWait}/></> : <>업무 연결: {h.task ? <Link href={`/tasks/${h.task.id}?context=${contextId}`}>{h.task.title}</Link> : '현재 조회할 수 없는 업무'}</>}<p className={s.meta}>{h.actorLabel} · {time(h.at)}</p></li>)}</ol></details>; }

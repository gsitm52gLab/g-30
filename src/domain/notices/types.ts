export const noticeTypes = ['notice', 'faq', 'guide', 'form'] as const;
export type NoticeType = typeof noticeTypes[number];
export const noticeTypeLabels: Record<NoticeType, string> = { notice: '공지', faq: 'FAQ', guide: '업무 가이드', form: '양식' };
export interface NoticeAudience {
    mode: 'all' | 'selected';
    userIds: string[];
}
export interface NoticeContent {
    title: string;
    body: string;
    type: NoticeType;
    category: string;
    documentVersion: string;
    audience: NoticeAudience;
    fileIds: string[];
    taskIds: string[];
    changeSummary: string;
}
export interface NoticeData {
    createdBy: string;
    draft: NoticeContent;
    currentVersionId: string | null;
}
export interface NoticeVersionData {
    noticeId: string;
    sequence: number;
    previousId: string | null;
    content: NoticeContent;
    publishedBy: string;
    publishedAt: string;
    /** Notification/history snapshot only; never the all-members read authority. */
    publishedRecipientUserIds: string[];
}
export interface NoticeReadData {
    noticeId: string;
    versionId: string;
    userId: string;
    readAt: string;
}
export function blankNotice(): NoticeContent {
    return { title: '', body: '', type: 'notice', category: '', documentVersion: '', audience: { mode: 'all', userIds: [] }, fileIds: [], taskIds: [], changeSummary: '' };
}

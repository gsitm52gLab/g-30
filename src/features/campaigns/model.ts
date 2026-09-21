import type { CampaignDetail, CampaignList, CampaignCatalogs, CampaignPreview, SaveCatalogCommand, SaveCampaignCommand, PublishCampaignCommand, ParticipationCommand, RecordExternalFactCommand, RecordPhysicalFactCommand, RecordFollowupCommand } from '@/server/campaigns/contracts';
import type { TaskCatalog, TaskDetail } from '@/server/tasks/service';
import type { ProductDetail } from '@/server/products/service';
export type { CampaignDetail, CampaignPreview };
export interface Workspace {
    task: TaskDetail;
    catalog: TaskCatalog;
    list: CampaignList;
    catalogs: CampaignCatalogs | null;
    detail: CampaignDetail | null;
    products: ProductDetail[];
}
export type Command = ({
    command: 'save_catalog';
} & SaveCatalogCommand) | ({
    command: 'save';
} & SaveCampaignCommand) | ({
    command: 'publish';
} & PublishCampaignCommand) | ({
    command: 'participate';
} & ParticipationCommand) | ({
    command: 'external';
} & RecordExternalFactCommand) | ({
    command: 'physical';
} & RecordPhysicalFactCommand) | ({
    command: 'followup';
} & RecordFollowupCommand);
export interface Recovery {
    at: number;
    forms: Record<string, unknown>;
    pending: null | {
        command: Command;
        formKey: string;
        ids: string[] | null;
    };
}
export interface State {
    data: Workspace | null;
    recovery: Recovery;
    busy: boolean;
    ready: boolean;
    error: string;
    code: string;
    message: string;
    denied: boolean;
    preview: {
        revision: number;
        value: CampaignPreview;
    } | null;
}
export const freshRecovery = (): Recovery => ({ at: Date.now(), forms: {}, pending: null });
export const statementLabels = { menu_number: '메뉴 번호', menu_name: '메뉴명', date: '일정', price: '가격', discount: '할인', points: '포인트', past_performance: '과거 성과' };
export const axisLabels = { application: '외부 신청', selection: '심사·선정', preparation: '준비', execution: '실제 진행', resultReceipt: '결과 수령', cancellation: '취소 협의' };
export const stateLabels: Record<string, string> = { pending: '미회신·대기', participate: '참여', decline: '불참', discuss: '추가 협의', not_applied: '미신청', applied: '신청 기록', withdrawal_requested: '철회 요청', cancelled: '취소 확인', selected: '선정', not_selected: '미선정', not_started: '시작 전', preparing: '준비 중', ready: '준비 완료', in_progress: '진행 중', finished: '진행 종료', not_received: '미수령', partial: '부분 수령', received: '수령 기록', none: '없음', discussion: '취소 협의 중' };
export const axisValues = { application: ['not_applied', 'applied', 'withdrawal_requested', 'cancelled'], selection: ['pending', 'selected', 'not_selected'], preparation: ['not_started', 'preparing', 'ready'], execution: ['not_started', 'in_progress', 'finished'], resultReceipt: ['not_received', 'partial', 'received'], cancellation: ['none', 'discussion', 'cancelled'] } as const;
export const identityKey = (m: {
    catalogVersionId: string;
    menuKey: string;
}) => JSON.stringify([m.catalogVersionId, m.menuKey]);
export const taskHref = (id: string, context: string) => `/tasks/${encodeURIComponent(id)}?context=${encodeURIComponent(context)}`;

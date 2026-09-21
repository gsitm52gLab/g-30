import type { ScheduleSource, ReminderStage } from '@/domain/scheduling/types';
import type { Deadline } from '@/domain/tasks/types';
export type DeliverySource = { kind: 'event'; eventId: string } | { kind: 'reminder'; logicalKey: string; source: ScheduleSource; localDay: string; stage: ReminderStage };
export interface NotificationData { key: string; semanticKey: string | null; recipientId: string; source: DeliverySource; title: string; message: string; actionUrl: string; occurredAt: string; deliveredAt: string; readAt: string | null; certainty: Deadline['certainty'] | null; email: 'not_connected' }
export interface NotificationReceiptData { key: string; recipientId: string; source: DeliverySource; notificationId: string; deduplicated: boolean; at: string }
export interface NotificationAttemptData { key: string; recipientId: string; source: DeliverySource; state: 'delivered' | 'failed' | 'deduplicated'; at: string; errorCode: 'DELIVERY_FAILED' | null; notificationId: string | null }
export interface NotificationRecords { notification: NotificationData; notificationReceipt: NotificationReceiptData; notificationAttempt: NotificationAttemptData }

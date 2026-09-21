import type { NotificationSource } from '@/domain/notifications/types';
export type EventDisposition = 'eligible' | 'other_recipient' | 'needs_assignment' | 'superseded' | 'invalidation_only' | 'semantic_duplicate' | 'unsupported';
/** Already authorized, explicit minimum. No stored payload or recipient roster crosses this boundary. */
export interface NotificationEventFact {
    source: NotificationSource;
    eventType: string;
    occurredAt: string;
    title: string;
    actionUrl: string;
    actionPrecision: 'related_target' | 'exact_version';
    recipientId: string | null;
    disposition: EventDisposition;
    sourcePrecision: 'exact' | 'activity_unavailable' | 'current_state_only';
    certainty: 'confirmed' | 'requested' | 'expected' | 'needs_confirmation' | null;
}

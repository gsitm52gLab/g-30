export type NotificationList = Awaited<ReturnType<import('./service').NotificationService['list']>>;
export type NotificationSync = Awaited<ReturnType<import('./service').NotificationService['sync']>>;

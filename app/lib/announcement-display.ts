type AnnouncementReadState = {
  id: string;
  isRead: number;
};

type BulkNotificationType = 'exam' | 'assignment';

export function openNotificationHome(
  navigateHome: () => void,
  markRead: (types: BulkNotificationType[]) => void
): void {
  navigateHome();
  markRead(['exam', 'assignment']);
}

export function visibleUnreadAnnouncementIds(
  announcements: AnnouncementReadState[],
  isHomeVisible: boolean,
  visibleLimit = 3
): string[] {
  if (!isHomeVisible) return [];
  return announcements
    .slice(0, visibleLimit)
    .filter((announcement) => !announcement.isRead)
    .map((announcement) => announcement.id);
}

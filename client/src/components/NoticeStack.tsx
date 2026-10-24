import { X } from 'lucide-react';

export interface Notice {
  id: number;
  message: string;
}

interface NoticeStackProps {
  notices: Notice[];
  onDismiss: (id: number) => void;
}

export function NoticeStack({ notices, onDismiss }: Readonly<NoticeStackProps>) {
  return (
    <div className="notice-stack">
      {notices.map((notice) => (
        <div key={notice.id} role="alert" className="notice-card">
          <p>{notice.message}</p>
          <button
            type="button"
            className="notice-dismiss"
            onClick={() => onDismiss(notice.id)}
            aria-label="Dismiss notification"
          >
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}

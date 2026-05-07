import React from 'react';

export interface BottomNavItem {
  key: string;
  label: string;
  icon: React.ReactNode;
  badge?: number;
}

interface BottomNavProps {
  items: BottomNavItem[];
  active: string;
  onChange: (key: string) => void;
}

const BottomNav: React.FC<BottomNavProps> = ({ items, active, onChange }) => {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-tower-200 bg-white/95 backdrop-blur dark:border-tower-700 dark:bg-brand-950/95 safe-area-pb">
      <div className="flex items-stretch">
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => onChange(item.key)}
            className={`admin-focus relative flex min-h-[64px] flex-1 cursor-pointer flex-col items-center justify-center gap-1 px-1 py-3 transition-colors ${
              active === item.key
                ? 'text-brand-600 dark:text-brand-300'
                : 'text-tower-500 hover:text-tower-700 dark:text-tower-400 dark:hover:text-tower-200'
            }`}
            aria-label={item.label}
          >
            <span className="relative">
              {item.icon}
              {item.badge != null && item.badge > 0 && (
                <span className="absolute -right-2 -top-1 flex h-4 min-w-[18px] items-center justify-center rounded-full border border-brand-red-500/30 bg-brand-red-500 px-1 text-[10px] font-bold text-white">
                  {item.badge > 99 ? '99+' : item.badge}
                </span>
              )}
            </span>
            <span className="text-[11px] font-medium leading-none">{item.label}</span>
            {active === item.key && (
              <span className="absolute left-1/2 top-0 h-0.5 w-8 -translate-x-1/2 rounded-full bg-brand-500 dark:bg-brand-300" />
            )}
          </button>
        ))}
      </div>
    </nav>
  );
};

export default BottomNav;

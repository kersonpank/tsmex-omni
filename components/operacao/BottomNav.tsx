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
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-white dark:bg-tower-900 border-t border-tower-200 dark:border-tower-700 safe-area-pb">
      <div className="flex items-stretch">
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => onChange(item.key)}
            className={`flex-1 flex flex-col items-center justify-center gap-1 py-3 px-1 min-h-[60px] relative transition-colors ${
              active === item.key
                ? 'text-brand-600 dark:text-brand-400'
                : 'text-tower-500 dark:text-tower-400 hover:text-tower-700 dark:hover:text-tower-300'
            }`}
          >
            <span className="relative">
              {item.icon}
              {item.badge != null && item.badge > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                  {item.badge > 99 ? '99+' : item.badge}
                </span>
              )}
            </span>
            <span className="text-[11px] font-medium leading-none">{item.label}</span>
            {active === item.key && (
              <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-brand-600 dark:bg-brand-400 rounded-full" />
            )}
          </button>
        ))}
      </div>
    </nav>
  );
};

export default BottomNav;

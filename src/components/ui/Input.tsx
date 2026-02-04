// 输入框组件

import React from 'react';
import { cn } from '@/utils';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  icon?: React.ReactNode;
  wrapperClassName?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, wrapperClassName, label, error, icon, ...props }, ref) => {
    return (
      <div className={cn('w-full', wrapperClassName)}>
        {label && (
          <label className="block text-sm font-medium text-[hsl(var(--text-secondary))] mb-1.5">
            {label}
          </label>
        )}
        <div className="relative">
          {icon && (
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-[hsl(var(--text-muted))]">
              {icon}
            </div>
          )}
          <input
            ref={ref}
            className={cn(
              'w-full h-10 px-3 py-2 bg-[hsl(var(--card-bg))] border border-[hsl(var(--border))] rounded-lg',
              'text-sm text-[hsl(var(--foreground))] placeholder-[hsl(var(--text-muted))]',
              'focus:outline-none focus:border-primary-500',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              'transition-colors',
              // 隐藏数字输入框的调整按钮
              '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none',
              icon && 'pl-10',
              error && 'border-red-500 focus:border-red-500',
              className
            )}
            {...props}
          />
        </div>
        {error && <p className="mt-1 text-sm text-red-500">{error}</p>}
      </div>
    );
  }
);

Input.displayName = 'Input';

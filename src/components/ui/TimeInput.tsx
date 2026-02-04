// 精确时间输入组件

import React, { useState, useEffect, useRef } from 'react';
import { formatPreciseTime, parsePreciseTime, snapToFrame, cn } from '@/utils';

interface TimeInputProps {
  value: number | null;
  onChange: (value: number | null) => void;
  min?: number;
  max?: number;
  fps?: number;
  snapToFrameEnabled?: boolean;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  label?: string;
}

export const TimeInput = React.forwardRef<HTMLInputElement, TimeInputProps>(
  (
    {
      value,
      onChange,
      min = 0,
      max,
      fps,
      snapToFrameEnabled = false,
      placeholder = '00:00:00.000',
      disabled,
      className,
      label,
    },
    ref
  ) => {
    const [inputValue, setInputValue] = useState('');
    const [isEditing, setIsEditing] = useState(false);
    const [hasError, setHasError] = useState(false);
    const internalRef = useRef<HTMLInputElement>(null);

    // 使用 useImperativeHandle 或简单地使用内部 ref
    const inputRef = (ref as React.RefObject<HTMLInputElement>) || internalRef;

    // 同步外部值到输入框
    useEffect(() => {
      if (!isEditing) {
        if (value !== null && value !== undefined) {
          setInputValue(formatPreciseTime(value));
          setHasError(false);
        } else {
          setInputValue('');
          setHasError(false);
        }
      }
    }, [value, isEditing]);

    const handleFocus = () => {
      setIsEditing(true);
    };

    const handleBlur = () => {
      setIsEditing(false);

      if (!inputValue.trim()) {
        onChange(null);
        setHasError(false);
        return;
      }

      let parsed = parsePreciseTime(inputValue);

      if (parsed === null) {
        // 解析失败，恢复原值并显示错误
        setHasError(true);
        if (value !== null) {
          setInputValue(formatPreciseTime(value));
        }
        setTimeout(() => setHasError(false), 1500);
        return;
      }

      // 边界校验
      if (min !== undefined) parsed = Math.max(min, parsed);
      if (max !== undefined) parsed = Math.min(max, parsed);

      // 帧对齐（可选）
      if (snapToFrameEnabled && fps && fps > 0) {
        parsed = snapToFrame(parsed, fps);
      }

      onChange(parsed);
      setInputValue(formatPreciseTime(parsed));
      setHasError(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        inputRef.current?.blur();
      } else if (e.key === 'Escape') {
        // 取消编辑，恢复原值
        setIsEditing(false);
        if (value !== null) {
          setInputValue(formatPreciseTime(value));
        } else {
          setInputValue('');
        }
        setHasError(false);
        inputRef.current?.blur();
      }
    };

    return (
      <div className="w-full">
        {label && (
          <label className="block text-sm font-medium text-[hsl(var(--text-secondary))] mb-1.5">
            {label}
          </label>
        )}
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          className={cn(
            'w-full h-10 px-3 py-2 bg-[hsl(var(--card-bg))] border border-[hsl(var(--border))] rounded-lg',
            'text-sm text-[hsl(var(--foreground))] placeholder-[hsl(var(--text-muted))]',
            'focus:outline-none focus:border-primary-500',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            'transition-colors font-mono',
            hasError && 'border-red-500 focus:border-red-500',
            className
          )}
        />
      </div>
    );
  }
);

TimeInput.displayName = 'TimeInput';

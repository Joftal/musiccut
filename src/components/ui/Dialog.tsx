// 对话框组件

import React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/utils';

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}

export const Dialog: React.FC<DialogProps> = ({
  open,
  onOpenChange,
  children,
}) => {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      {children}
    </DialogPrimitive.Root>
  );
};

export const DialogTrigger = DialogPrimitive.Trigger;

export const DialogContent = React.forwardRef<
  HTMLDivElement,
  DialogPrimitive.DialogContentProps & { className?: string }
>(({ className, children, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 animate-fade-in" />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50',
        'w-full max-w-lg max-h-[85vh] overflow-auto',
        'bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-xl shadow-2xl',
        'animate-dialog-slide-up',
        className
      )}
      {...props}
    >
      {children}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));

DialogContent.displayName = 'DialogContent';

export const DialogHeader: React.FC<{
  children: React.ReactNode;
  className?: string;
}> = ({ children, className }) => (
  <div
    className={cn(
      'flex items-center justify-between p-4 border-b border-[hsl(var(--border))]',
      className
    )}
  >
    {children}
  </div>
);

export const DialogTitle = React.forwardRef<
  HTMLHeadingElement,
  DialogPrimitive.DialogTitleProps
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('text-lg font-semibold text-[hsl(var(--foreground))]', className)}
    {...props}
  />
));

DialogTitle.displayName = 'DialogTitle';

export const DialogDescription = React.forwardRef<
  HTMLParagraphElement,
  DialogPrimitive.DialogDescriptionProps
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-sm text-[hsl(var(--text-secondary))]', className)}
    {...props}
  />
));

DialogDescription.displayName = 'DialogDescription';

export const DialogClose: React.FC<{ className?: string }> = ({ className }) => (
  <DialogPrimitive.Close
    className={cn(
      'p-1 rounded-lg text-[hsl(var(--text-muted))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--secondary))] transition-colors',
      className
    )}
  >
    <X className="w-5 h-5" />
  </DialogPrimitive.Close>
);

export const DialogBody: React.FC<{
  children: React.ReactNode;
  className?: string;
}> = ({ children, className }) => (
  <div className={cn('p-4', className)}>{children}</div>
);

export const DialogFooter: React.FC<{
  children: React.ReactNode;
  className?: string;
}> = ({ children, className }) => (
  <div
    className={cn(
      'flex items-center justify-end gap-3 p-4 border-t border-[hsl(var(--border))]',
      className
    )}
  >
    {children}
  </div>
);

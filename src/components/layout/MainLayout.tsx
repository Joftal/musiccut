// 主布局组件

import React from 'react';
import { Sidebar } from './Sidebar';
import { ToastProvider, Toaster } from '../ui/Toast';

interface MainLayoutProps {
  children: React.ReactNode;
}

const MainLayout: React.FC<MainLayoutProps> = ({ children }) => {
  return (
    <ToastProvider>
      <div className="flex h-screen bg-[hsl(var(--background))] text-[hsl(var(--foreground))] overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-hidden">
          {children}
        </main>
      </div>
      <Toaster />
    </ToastProvider>
  );
};

export default MainLayout;

import { Routes, Route } from 'react-router-dom';
import { useEffect } from 'react';
import MainLayout from './components/layout/MainLayout';
import Library from './pages/Library';
import Editor from './pages/Editor';
import Projects from './pages/Projects';
import Settings from './pages/Settings';
import { useSystemStore } from './stores/systemStore';

function App() {
  const { checkDependencies, loadConfig } = useSystemStore();

  useEffect(() => {
    // 初始化时检查依赖和加载配置
    checkDependencies();
    loadConfig();
  }, []);

  return (
    <MainLayout>
      <Routes>
        <Route path="/" element={<Projects />} />
        <Route path="/library" element={<Library />} />
        <Route path="/editor" element={<Editor />} />
        <Route path="/editor/:projectId" element={<Editor />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </MainLayout>
  );
}

export default App;

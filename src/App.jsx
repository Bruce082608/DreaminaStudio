import React, { useState, useEffect, useRef } from 'react';
import { Sparkles, Play, Award, RotateCcw, Laptop, HardDrive, Cpu, Film } from 'lucide-react';
import ScriptInput from './components/ScriptInput';
import CharacterManager from './components/CharacterManager';
import CookiePoolManager from './components/CookiePoolManager';
import ShotTimeline from './components/ShotTimeline';
import GlobalPreview from './components/GlobalPreview';
import HistoryList from './components/HistoryList';
import VideoTimelineEditor from './components/VideoTimelineEditor';
import { parseScriptToStoryboard, generateFinalPrompt } from './utils/workflowHelpers';
import {
  initialScript,
  initialCharacters,
  initialShots,
  initialHistory,
  mockVideoPool,
  ENGINE_INFO
} from './mockData';

const defaultCookies = [
  {
    id: 'cookie-1',
    alias: '主账号_VIP (即梦)',
    value: 'sessionid_ss=vip_cookie_hash_01_a9f3b...',
    status: 'active',
    activeTasks: 0,
    failCount: 0
  },
  {
    id: 'cookie-2',
    alias: '备用号_01 (即梦)',
    value: 'sessionid_ss=free_cookie_hash_02_bc482...',
    status: 'active',
    activeTasks: 0,
    failCount: 0
  }
];

export default function App() {
  // Global Workflow State
  const [script, setScript] = useState(initialScript);
  const [characters, setCharacters] = useState(initialCharacters);
  const [shots, setShots] = useState(initialShots);
  const [history, setHistory] = useState(initialHistory);
  const [cookies, setCookies] = useState(defaultCookies);

  // Workflow Approval States
  const [isApproved, setIsApproved] = useState(true); // Default loaded demo is pre-approved
  const [targetDuration, setTargetDuration] = useState(60);

  // UI States
  const [isSplitting, setIsSplitting] = useState(false);
  const [isCompiling, setIsCompiling] = useState(false);
  const [compileProgress, setCompileProgress] = useState(0);
  const [compiledVideoUrl, setCompiledVideoUrl] = useState(null);
  
  // Toast notifications
  const [toast, setToast] = useState(null);

  // Keep track of active interval references to prevent leaks and race conditions
  const activeIntervals = useRef({});

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    const timeout = type === 'success' ? 3000 : 4500;
    setTimeout(() => setToast(null), timeout);
  };

  // Cleanup all intervals on component unmount
  useEffect(() => {
    return () => {
      Object.values(activeIntervals.current).forEach(clearInterval);
    };
  }, []);

  // ==========================================
  // Task Queue Scheduler with Cookie Allocation
  // ==========================================
  useEffect(() => {
    // Only schedule if the user has approved the storyboard
    if (!isApproved) return;

    const generating = shots.filter(s => s.status === 'generating');
    const waiting = shots.filter(s => s.status === 'waiting');

    // Check if slots are available (concurrency < 2) and tasks are in queue
    if (generating.length < 2 && waiting.length > 0) {
      const slotsAvailable = 2 - generating.length;
      const toStart = waiting.slice(0, slotsAvailable);

      const shotsStarted = [];
      const shotsFailedNoCookie = [];
      let tempCookies = [...cookies];

      toStart.forEach(shot => {
        if (shot.engine === 'jimeng') {
          const availableCookie = tempCookies.find(c => c.status === 'active' && c.activeTasks < 2);
          if (availableCookie) {
            availableCookie.activeTasks += 1;
            shotsStarted.push({ shot, cookieId: availableCookie.id });
          } else {
            shotsFailedNoCookie.push(shot);
          }
        } else {
          shotsStarted.push({ shot, cookieId: null });
        }
      });

      // Update state for shots
      setShots(prev => prev.map(s => {
        const started = shotsStarted.find(x => x.shot.id === s.id);
        if (started) {
          return { ...s, status: 'generating', progress: 0, error: null };
        }
        if (shotsFailedNoCookie.some(x => x.id === s.id)) {
          return {
            ...s,
            status: 'failed',
            error: '逆向网关异常：即梦 Cookie 账号池无空闲可用节点 (账号占满或已失效)',
            progress: 0
          };
        }
        return s;
      }));

      setCookies(tempCookies);

      // Fire the asynchronous simulated generation tasks
      shotsStarted.forEach(item => {
        runMockGeneration(item.shot.id, item.shot.engine || 'jimeng', item.cookieId);
      });

      if (shotsFailedNoCookie.length > 0) {
        showToast('部分即梦分镜启动失败：所有逆向 Cookie 账号均在忙碌或已失效', 'error');
      }
    }
  }, [shots, cookies, isApproved]);

  // Execute Mock Generation
  const runMockGeneration = (shotId, engineKey, cookieId) => {
    const config = ENGINE_INFO[engineKey] || { name: '即梦-API', delay: 250, errorRate: 0.05 };
    
    if (activeIntervals.current[shotId]) {
      clearInterval(activeIntervals.current[shotId]);
    }

    const targetShot = shots.find(s => s.id === shotId);
    const finalPrompt = generateFinalPrompt(targetShot, characters);
    
    if (engineKey === 'jimeng' && cookieId) {
      const assignedCookie = cookies.find(c => c.id === cookieId);
      console.log(`[Router Gateway] Assigned Cookie: [${assignedCookie?.alias}] for Shot ${shotId}`);
    }
    console.log(`[Payload Router] Engine: ${config.name} | Prompt: "${finalPrompt}"`);

    let progress = 0;
    const interval = setInterval(() => {
      progress += Math.floor(Math.random() * 10) + 4;

      if (progress >= 100) {
        clearInterval(activeIntervals.current[shotId]);
        delete activeIntervals.current[shotId];

        // Determine Success / Failure
        const isFailed = Math.random() < config.errorRate;

        if (isFailed) {
          let errorMsg = '接口响应超时 (Gateway Timeout)';
          if (engineKey === 'hunyuan') errorMsg = 'CUDA Out of Memory: GPU VRAM (Allocated: 24GB)';
          if (engineKey === 'kling') errorMsg = '可灵上游服务器排队溢出，请求被自动熔断';
          if (engineKey === 'jimeng') errorMsg = '即梦API并发超限，请稍后重试';

          setShots(prev => prev.map(s => s.id === shotId ? {
            ...s,
            status: 'failed',
            progress: 0,
            error: errorMsg
          } : s));
          showToast(`分镜渲染失败: ${errorMsg}`, 'error');
          handleTaskEnd(engineKey, cookieId, false);
        } else {
          // Success
          const randomVideo = mockVideoPool[Math.floor(Math.random() * mockVideoPool.length)];
          
          // Generate a preset mock caption based on the scene if empty
          const defaultCaption = targetShot.prompt ? targetShot.prompt.split(',').pop().trim() : '转角时光咖啡馆...';

          setShots(prev => prev.map(s => s.id === shotId ? {
            ...s,
            status: 'completed',
            progress: 100,
            videoUrl: randomVideo,
            caption: s.caption || defaultCaption
          } : s));
          showToast(`分镜已完成渲染 (${config.name})`);
          handleTaskEnd(engineKey, cookieId, true);
        }
      } else {
        setShots(prev => prev.map(s => s.id === shotId ? { ...s, progress } : s));
      }
    }, config.delay);

    activeIntervals.current[shotId] = interval;
  };

  // Release Cookie Slot and update its health
  const handleTaskEnd = (engineKey, cookieId, success) => {
    if (engineKey === 'jimeng' && cookieId) {
      setCookies(prev => prev.map(c => {
        if (c.id === cookieId) {
          const newFailCount = success ? 0 : c.failCount + 1;
          const newStatus = newFailCount >= 3 ? 'expired' : c.status;
          
          if (newStatus === 'expired') {
            setTimeout(() => {
              showToast(`账号 [${c.alias}] 连续生成失败 3 次，已被下线保护！`, 'error');
            }, 200);
          }

          return {
            ...c,
            activeTasks: Math.max(0, c.activeTasks - 1),
            failCount: newFailCount,
            status: newStatus
          };
        }
        return c;
      }));
    }
  };

  // ==========================================
  // Cookie Pool Handlers
  // ==========================================
  const handleAddCookie = (newCookie) => {
    setCookies(prev => [...prev, newCookie]);
    showToast(`Cookie 账号 [${newCookie.alias}] 已载入账号池`);
  };

  const handleUpdateCookie = (id, updates) => {
    setCookies(prev => prev.map(c => c.id === id ? { ...c, ...updates } : c));
  };

  const handleDeleteCookie = (id) => {
    const target = cookies.find(c => c.id === id);
    setCookies(prev => prev.filter(c => c.id !== id));
    showToast(`已删除账号 [${target?.alias || ''}]`);
  };

  const handleValidateCookie = (id, onDone) => {
    setTimeout(() => {
      setCookies(prev => prev.map(c => {
        if (c.id === id) {
          showToast(`账号 [${c.alias}] 握手成功，Cookie 状态健康！`);
          return { ...c, status: 'active', failCount: 0 };
        }
        return c;
      }));
      onDone();
    }, 1200);
  };

  // ==========================================
  // Core Page Event Handlers
  // ==========================================

  // 1. Script selection & parsing logic
  const handleSelectCandidateScript = (scriptText, duration) => {
    setIsSplitting(true);
    setTargetDuration(duration);

    // Cancel any active running generators
    Object.values(activeIntervals.current).forEach(clearInterval);
    activeIntervals.current = {};
    setCookies(prev => prev.map(c => ({ ...c, activeTasks: 0 })));

    setTimeout(() => {
      // Parse chosen script into storyboard with [5, 15]s constraints
      const parsedShots = parseScriptToStoryboard(scriptText, characters, duration);

      if (parsedShots && parsedShots.length > 0) {
        setShots(parsedShots);
        setIsApproved(false); // Move to unapproved draft stage for review
        setCompiledVideoUrl(null);
        showToast(`剧本分镜草稿提取完成，共计 ${parsedShots.length} 个镜头，已进入审核阶段。`);
      } else {
        showToast('提取失败，请重试', 'error');
      }
      setIsSplitting(false);
    }, 1200);
  };

  // 2. Approve Storyboard
  const handleApproveStoryboard = () => {
    setIsApproved(true);
    // Set all draft shots status to idle so they can be processed by the queue scheduler
    setShots(prev => prev.map(s => ({ ...s, status: 'idle', progress: 0 })));
    showToast('分镜脚本批准锁定！已解锁 AI 视频生成排队队列。');
  };

  // 3. Character management handlers
  const handleAddCharacter = (newChar) => {
    setCharacters(prev => [...prev, newChar]);
    showToast(`角色 [${newChar.name}] 创建成功`);
  };

  const handleUpdateCharacter = (charId, updates) => {
    setCharacters(prev => prev.map(c => c.id === charId ? { ...c, ...updates } : c));
  };

  const handleDeleteCharacter = (charId) => {
    const char = characters.find(c => c.id === charId);
    setCharacters(prev => prev.filter(c => c.id !== charId));
    setShots(prev => prev.map(s => ({
      ...s,
      characterIds: s.characterIds.filter(id => id !== charId)
    })));
    showToast(`角色 [${char?.name || ''}] 已删除`);
  };

  // 4. Shot timeline handlers
  const handleAddShot = () => {
    const newShot = {
      id: `shot-${Date.now()}`,
      characterIds: [],
      prompt: '',
      duration: 8, // default in range [5, 15]
      engine: 'jimeng',
      status: 'idle',
      progress: 0,
      videoUrl: null,
      caption: '',
      error: null
    };
    setShots(prev => [...prev, newShot]);
    showToast('已添加空分镜，可自行调整参数');
  };

  const handleUpdateShot = (shotId, updates) => {
    setShots(prev => prev.map(s => s.id === shotId ? { ...s, ...updates } : s));
  };

  const handleDeleteShot = (shotId) => {
    if (activeIntervals.current[shotId]) {
      clearInterval(activeIntervals.current[shotId]);
      delete activeIntervals.current[shotId];
    }
    setShots(prev => prev.filter(s => s.id !== shotId));
    showToast('分镜已从时间轴移除');
  };

  const handleGenerateShot = (shotId) => {
    setShots(prev => prev.map(s => s.id === shotId ? {
      ...s,
      status: 'waiting',
      progress: 0,
      videoUrl: null,
      error: null
    } : s));
    showToast('已加入渲染队列，排队调度中...');
  };

  const handleGenerateAll = () => {
    const idleOrFailedCount = shots.filter(s => s.status === 'idle' || s.status === 'failed').length;
    
    if (idleOrFailedCount === 0) {
      showToast('没有需要生成的分镜（镜头已在排队或渲染完成）', 'warning');
      return;
    }

    setShots(prev => prev.map(s => {
      if (s.status === 'idle' || s.status === 'failed') {
        return { ...s, status: 'waiting', progress: 0, error: null, videoUrl: null };
      }
      return s;
    }));
    showToast(`一键排队：已将 ${idleOrFailedCount} 个分镜推入渲染队列中`);
  };

  const handleReorderShots = (newShots) => {
    setShots(newShots);
  };

  // 5. Global compilation logic from timeline editor
  const handleCompileFinalVideo = (mixingParams) => {
    const completedShots = shots.filter(s => s.status === 'completed');
    if (completedShots.length === 0) {
      showToast('必须有至少一个已生成视频的分镜镜头才能进行压制剪辑', 'error');
      return;
    }

    setIsCompiling(true);
    setCompileProgress(0);

    let progress = 0;
    const timer = setInterval(() => {
      progress += Math.floor(Math.random() * 8) + 3;
      if (progress >= 100) {
        progress = 100;
        clearInterval(timer);

        const finalVideo = completedShots[0].videoUrl || mockVideoPool[0];
        setCompiledVideoUrl(finalVideo);
        setIsCompiling(false);

        // Add to history list
        const newHistoryItem = {
          id: `hist-${Date.now()}`,
          title: `剪辑出品 - BGM:${mixingParams.bgm === 'lofi' ? 'Lofi' : mixingParams.bgm === 'epic' ? '交响' : '吉他'} (#${history.length + 1})`,
          date: new Date().toISOString().replace('T', ' ').substring(0, 16),
          duration: mixingParams.totalDuration,
          videoUrl: finalVideo
        };
        setHistory(prev => [newHistoryItem, ...prev]);
        showToast(`压制成功！BGM音量:${mixingParams.bgmVolume}%, 台词音量:${mixingParams.voiceVolume}%`);
      } else {
        setCompileProgress(progress);
      }
    }, 180);
  };

  // Load Presets / Revert to Demo state
  const handleLoadDemo = () => {
    if (window.confirm('确定要重置所有工作区状态并恢复Demo样例数据吗？这会清空当前队列和Cookie池。')) {
      Object.values(activeIntervals.current).forEach(clearInterval);
      activeIntervals.current = {};

      setScript(initialScript);
      setCharacters(initialCharacters);
      setShots(initialShots);
      setIsApproved(true); // Demo is pre-approved
      setTargetDuration(60);
      setCompiledVideoUrl(null);
      setCookies(defaultCookies);
      showToast('工作区已恢复默认Demo配置');
    }
  };

  return (
    <div className="min-h-screen bg-stone-50 text-stone-800 flex flex-col antialiased selection:bg-amber-100 selection:text-amber-900">
      
      {/* Toast Notifications */}
      {toast && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-50 animate-slide-up">
          <div className={`px-4 py-3 rounded-xl border shadow-lg flex items-center gap-2.5 text-xs font-semibold ${
            toast.type === 'error' ? 'bg-rose-50 border-rose-200 text-rose-800 animate-pulse' :
            toast.type === 'warning' ? 'bg-amber-50 border-amber-200 text-amber-800' :
            'bg-emerald-50 border-emerald-200 text-emerald-800'
          }`}>
            <span className={`w-2 h-2 rounded-full ${
              toast.type === 'error' ? 'bg-rose-500' :
              toast.type === 'warning' ? 'bg-amber-500' :
              'bg-emerald-500'
            }`} />
            <span>{toast.message}</span>
          </div>
        </div>
      )}

      {/* Main Navigation Header */}
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-stone-200/50 px-6 py-4">
        <div className="w-full flex items-center justify-between gap-4">
          {/* Logo & Info */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-amber-600 rounded-xl flex items-center justify-center text-white shadow-sm shadow-amber-600/20">
              <Film size={20} className="animate-pulse" />
            </div>
            <div>
              <h1 className="text-base font-bold tracking-tight text-stone-900 flex items-center gap-1.5">
                AI短剧/小剧场一体化工作流控制台
                <span className="text-[10px] font-medium px-2 py-0.5 bg-amber-100 text-amber-800 rounded-full">v1.5 Studio</span>
              </h1>
              <p className="text-xs text-stone-400">创意想法提案到内置剪辑轨道压制输出</p>
            </div>
          </div>

          {/* Hardware & API Status Panel */}
          <div className="hidden md:flex items-center gap-6 text-[11px] text-stone-500 bg-stone-50 border border-stone-200/60 rounded-xl px-4 py-2">
            <div className="flex items-center gap-1.5">
              <HardDrive size={13} className="text-emerald-500" />
              <span>存储: <b className="font-semibold text-stone-700">84.2 GB 空闲</b></span>
            </div>
            <div className="flex items-center gap-1.5">
              <Cpu size={13} className="text-amber-500" />
              <span>并发调度: <b className="font-semibold text-stone-700">2进程限制</b></span>
            </div>
            <div className="flex items-center gap-1.5">
              <Laptop size={13} className="text-sky-500" />
              <span>后期剪辑器: <b className="font-semibold text-stone-700">FFmpeg内核就绪</b></span>
            </div>
          </div>

          {/* Action Header Button */}
          <button
            onClick={handleLoadDemo}
            className="flex items-center gap-1.5 py-2 px-3 hover:bg-stone-100 text-stone-600 rounded-xl text-xs font-semibold border border-stone-200 transition-all active:scale-[0.97]"
            title="恢复所有Demo配置"
          >
            <RotateCcw size={12} />
            <span className="hidden sm:inline">恢复系统预设</span>
          </button>
        </div>
      </header>

      {/* Main Page Layout (Three-Column Responsive Grid) */}
      <main className="flex-1 w-full p-4 md:p-6 flex flex-col gap-6">
        
        {/* Top Workspace (3-Column Layout) */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {/* Left Column (25% Width): Script, Characters, and Cookie Pool */}
          <div className="md:col-span-1 flex flex-col gap-6">
            <div className="min-h-[360px]">
              <ScriptInput
                onSplitScript={handleSelectCandidateScript}
                isSplitting={isSplitting}
              />
            </div>
            <div>
              <CharacterManager
                characters={characters}
                onAddCharacter={handleAddCharacter}
                onUpdateCharacter={handleUpdateCharacter}
                onDeleteCharacter={handleDeleteCharacter}
              />
            </div>
            <div>
              <CookiePoolManager
                cookies={cookies}
                onAddCookie={handleAddCookie}
                onUpdateCookie={handleUpdateCookie}
                onDeleteCookie={handleDeleteCookie}
                onValidateCookie={handleValidateCookie}
              />
            </div>
          </div>

          {/* Middle Column (50% Width): Shot Timeline Control */}
          <div className="md:col-span-2">
            <ShotTimeline
              shots={shots}
              characters={characters}
              onUpdateShot={handleUpdateShot}
              onDeleteShot={handleDeleteShot}
              onAddShot={handleAddShot}
              onGenerateShot={handleGenerateShot}
              onGenerateAll={handleGenerateAll}
              isApproved={isApproved}
              onApproveStoryboard={handleApproveStoryboard}
            />
          </div>

          {/* Right Column (25% Width): Global Preview & Export & History */}
          <div className="md:col-span-1 flex flex-col gap-6">
            <div>
              <GlobalPreview
                shots={shots}
                isCompiling={isCompiling}
                compileProgress={compileProgress}
                compiledVideoUrl={compiledVideoUrl}
                onCompile={handleCompileFinalVideo}
              />
            </div>
            <div>
              <HistoryList
                history={history}
                activeVideoUrl={compiledVideoUrl}
                onSelectHistory={handleSelectHistory}
                onDeleteHistory={handleDeleteHistory}
              />
            </div>
          </div>
        </div>

        {/* Bottom Workspace: Built-in Video Timeline Editor */}
        {isApproved && shots.length > 0 && (
          <div className="w-full">
            <VideoTimelineEditor
              shots={shots}
              onUpdateShot={handleUpdateShot}
              onReorderShots={handleReorderShots}
              onCompileFinalVideo={handleCompileFinalVideo}
              isCompiling={isCompiling}
              targetDuration={targetDuration}
            />
          </div>
        )}

      </main>

      {/* Footer */}
      <footer className="border-t border-stone-200/50 bg-white py-4 px-6 text-center text-[10px] text-stone-400">
        <p className="w-full flex items-center justify-between">
          <span>© 2026 PlotDream. AI 导演协同创作平台.</span>
          <span className="flex items-center gap-1"><Award size={10} /> 任务队列调度与多引擎路由控制中心</span>
        </p>
      </footer>
    </div>
  );
}

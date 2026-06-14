import React, { useState, useEffect, useRef } from 'react';
import { Film, Play, Download, Sparkles, AlertTriangle, MonitorPlay, HelpCircle } from 'lucide-react';

export default function GlobalPreview({
  shots,
  isCompiling,
  compileProgress,
  compiledVideoUrl,
  onCompile
}) {
  const [compileStage, setCompileStage] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const videoRef = useRef(null);

  // Sync compile stages with progress
  useEffect(() => {
    if (!isCompiling) {
      setCompileStage('');
      return;
    }

    if (compileProgress < 20) {
      setCompileStage('读取分镜画面与音轨资产...');
    } else if (compileProgress < 50) {
      setCompileStage('缝合拼接视频片段，渲染平滑转场...');
    } else if (compileProgress < 75) {
      setCompileStage('混合背景音乐并进行音量均衡调整...');
    } else if (compileProgress < 95) {
      setCompileStage('渲染嵌入式字幕并进行色彩校正...');
    } else {
      setCompileStage('做最后的文件打包与流优化...');
    }
  }, [compileProgress, isCompiling]);

  // Simulated subtitles during video playback
  const handleTimeUpdate = () => {
    if (!videoRef.current) return;
    const time = videoRef.current.currentTime;
    const duration = videoRef.current.duration;

    if (time < 4) {
      setSubtitle('苏菲推开了咖啡馆的木门，暖暖的阳光洒在她的发梢。');
    } else if (time < 8) {
      setSubtitle('柜台后的林德冲她微笑着，用天平称量发光的星尘。');
    } else if (time < 12) {
      setSubtitle('一杯腾着热气、拥有星系拉花的拿铁咖啡滑到了她面前。');
    } else {
      setSubtitle('苏菲轻轻喝了一口，脸上洋溢着温暖治愈的微笑。');
    }
  };

  const handleExport = () => {
    if (!compiledVideoUrl) return;
    // Simulate downloading by creating an anchor element
    const a = document.createElement('a');
    a.href = compiledVideoUrl;
    a.download = 'AI_Drama_Integrated_Video.mp4';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const completedShotsCount = shots.filter(s => s.status === 'completed').length;
  const canCompile = completedShotsCount > 0;

  return (
    <div className="bg-white rounded-2xl border border-stone-200/60 shadow-sm p-5 flex flex-col h-full transition-all hover:shadow-md hover:shadow-stone-100">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <div className="p-2 bg-amber-50 text-amber-700 rounded-lg">
          <MonitorPlay size={18} />
        </div>
        <div>
          <h3 className="font-semibold text-stone-800 text-sm tracking-wide">全局合成预览</h3>
          <p className="text-xs text-stone-400">将已生成的镜头合成完整的微剧场</p>
        </div>
      </div>

      {/* Video Screen Area */}
      <div className="relative aspect-video w-full bg-stone-950 rounded-xl overflow-hidden shadow-inner flex flex-col items-center justify-center border border-stone-200">
        {isCompiling ? (
          // Compiling loading view
          <div className="absolute inset-0 bg-stone-900/90 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center">
            <div className="w-12 h-12 bg-amber-600/10 text-amber-500 rounded-full flex items-center justify-center mb-3 animate-pulse">
              <Sparkles size={24} />
            </div>
            <span className="text-xs font-semibold text-amber-200 block mb-1">正在智能合成短剧全片</span>
            <span className="text-[11px] text-stone-400 mb-4 h-4 block">{compileStage}</span>
            <div className="w-48 bg-stone-700 rounded-full h-2 overflow-hidden mb-1">
              <div
                className="bg-amber-500 h-2 rounded-full transition-all duration-300"
                style={{ width: `${compileProgress}%` }}
              />
            </div>
            <span className="text-xs font-mono font-bold text-amber-500">{compileProgress}%</span>
          </div>
        ) : compiledVideoUrl ? (
          // Video player with mock subtitles overlay
          <div className="w-full h-full relative group">
            <video
              ref={videoRef}
              src={compiledVideoUrl}
              controls
              onTimeUpdate={handleTimeUpdate}
              className="w-full h-full object-cover"
            />
            {/* Custom Subtitle Overlay */}
            <div className="absolute bottom-12 left-0 right-0 px-4 text-center pointer-events-none">
              <span className="bg-black/60 text-stone-100 text-xs px-2.5 py-1 rounded border border-white/10 shadow-sm leading-relaxed">
                {subtitle || '时光咖啡馆：遗失的星尘...'}
              </span>
            </div>
          </div>
        ) : (
          // Empty Preview Screen
          <div className="text-center p-4">
            <div className="w-12 h-12 rounded-full bg-stone-900 flex items-center justify-center text-stone-500 mx-auto mb-2 border border-stone-800">
              <Film size={20} />
            </div>
            <p className="text-xs text-stone-400 font-medium">等待缝合视频流</p>
            <p className="text-[10px] text-stone-500 mt-1 max-w-[200px]">
              生成中部的部分镜头后，点击“一键合成全片”开始缝合。
            </p>
          </div>
        )}
      </div>

      {/* Compile Statistics info */}
      <div className="mt-4 p-3 bg-stone-50 border border-stone-100 rounded-xl space-y-1.5 text-xs text-stone-600">
        <div className="flex justify-between">
          <span>分镜总数:</span>
          <span className="font-semibold text-stone-800">{shots.length} 个</span>
        </div>
        <div className="flex justify-between">
          <span>已渲染分镜:</span>
          <span className={`font-semibold ${completedShotsCount === shots.length ? 'text-emerald-600' : 'text-amber-700'}`}>
            {completedShotsCount} / {shots.length}
          </span>
        </div>
        {shots.length > 0 && completedShotsCount < shots.length && (
          <div className="flex items-center gap-1 text-[10px] text-amber-600 mt-1">
            <AlertTriangle size={12} />
            <span>提示：仍有 {shots.length - completedShotsCount} 个分镜未生成，合成可能跳过未生成片段。</span>
          </div>
        )}
      </div>

      {/* Buttons */}
      <div className="flex gap-2.5 mt-4">
        <button
          onClick={onCompile}
          disabled={isCompiling || !canCompile}
          className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-sm font-semibold shadow-sm transition-all duration-300 active:scale-[0.98] ${
            isCompiling
              ? 'bg-amber-100 text-amber-500 cursor-not-allowed border border-amber-200/20'
              : !canCompile
              ? 'bg-stone-100 text-stone-400 cursor-not-allowed'
              : 'bg-amber-600 hover:bg-amber-700 text-white shadow-amber-600/10'
          }`}
        >
          <Sparkles size={14} className={isCompiling ? 'animate-spin' : ''} />
          <span>{isCompiling ? '正在拼接全片...' : '一键合成全片'}</span>
        </button>

        <button
          onClick={handleExport}
          disabled={!compiledVideoUrl || isCompiling}
          className={`px-4 py-3 rounded-xl border flex items-center justify-center transition-all active:scale-[0.98] ${
            !compiledVideoUrl || isCompiling
              ? 'border-stone-200 text-stone-300 cursor-not-allowed bg-stone-50'
              : 'border-stone-200 bg-white hover:bg-stone-50 text-stone-700'
          }`}
          title="导出视频"
        >
          <Download size={16} />
        </button>
      </div>
    </div>
  );
}

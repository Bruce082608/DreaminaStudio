import React, { useState, useEffect } from 'react';
import { Sliders, Music, Volume2, MoveLeft, MoveRight, HelpCircle, Scissors, Sparkles, RefreshCw, Type, Radio, Film } from 'lucide-react';

export default function VideoTimelineEditor({
  shots,
  onUpdateShot,
  onReorderShots,
  onCompileFinalVideo,
  isCompiling,
  targetDuration
}) {
  const [bgm, setBgm] = useState('lofi');
  const [bgmVolume, setBgmVolume] = useState(30);
  const [voiceVolume, setVoiceVolume] = useState(80);

  // Calculate total duration
  const totalDuration = shots.reduce((acc, curr) => acc + (curr.duration || 0), 0);

  // Calculate cumulative times for the ruler
  let cumulativeTime = 0;
  const timeMarks = [];
  shots.forEach((shot) => {
    timeMarks.push(cumulativeTime);
    cumulativeTime += shot.duration;
  });

  const handleMoveLeft = (index) => {
    if (index === 0) return;
    const newShots = [...shots];
    const temp = newShots[index];
    newShots[index] = newShots[index - 1];
    newShots[index - 1] = temp;
    onReorderShots(newShots);
  };

  const handleMoveRight = (index) => {
    if (index === shots.length - 1) return;
    const newShots = [...shots];
    const temp = newShots[index];
    newShots[index] = newShots[index + 1];
    newShots[index + 1] = temp;
    onReorderShots(newShots);
  };

  const handleTrimChange = (shotId, value) => {
    const val = parseInt(value, 10);
    // Enforce 5s to 15s limit
    if (val < 5 || val > 15) return;
    onUpdateShot(shotId, { duration: val });
  };

  const handleTransitionChange = (shotId, transition) => {
    onUpdateShot(shotId, { transition });
  };

  const handleCaptionChange = (shotId, caption) => {
    onUpdateShot(shotId, { caption });
  };

  const handleCompile = () => {
    onCompileFinalVideo({
      bgm,
      bgmVolume,
      voiceVolume,
      totalDuration
    });
  };

  return (
    <div className="bg-stone-900 text-stone-100 rounded-2xl border border-stone-800 p-6 shadow-2xl mt-6 animate-slide-up w-full">
      {/* Editor Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4 pb-4 border-b border-stone-800">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-amber-600/15 text-amber-500 rounded-lg">
            <Sliders size={18} />
          </div>
          <div>
            <h3 className="font-semibold text-sm tracking-wide text-white">内置内置视频剪辑时间线 (Late-stage Studio)</h3>
            <p className="text-xs text-stone-500">裁剪分镜时长、微调转场与环境配乐，完成终极渲染</p>
          </div>
        </div>

        {/* Ruler total summary */}
        <div className="flex items-center gap-4 text-xs">
          <div className="bg-stone-850 px-3 py-1.5 rounded-lg border border-stone-800">
            <span>总时长: </span>
            <b className="font-mono text-amber-500 text-sm">{totalDuration}s</b>
            <span className="text-stone-500"> / 目标: {targetDuration}s</span>
          </div>
          
          <button
            onClick={handleCompile}
            disabled={isCompiling || shots.length === 0}
            className={`flex items-center gap-1.5 py-2 px-4 rounded-xl text-xs font-semibold shadow-md active:scale-95 transition-all ${
              isCompiling
                ? 'bg-amber-800/20 text-amber-500 cursor-not-allowed border border-amber-900/30'
                : 'bg-amber-600 hover:bg-amber-700 text-white shadow-amber-600/10'
            }`}
          >
            <Sparkles size={13} className={isCompiling ? 'animate-spin' : ''} />
            <span>{isCompiling ? '正在压制成片...' : '编译并导出最终成片'}</span>
          </button>
        </div>
      </div>

      {/* Editor Main body */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
        {/* Left Timeline Tracks (3 cols) */}
        <div className="xl:col-span-3 space-y-4">
          
          {/* Dynamic Timeline Ruler */}
          <div className="relative h-6 bg-stone-950/40 border-b border-stone-800 rounded-lg px-2 flex items-end pb-1 font-mono text-[9px] text-stone-500 overflow-hidden select-none">
            <div className="absolute left-2">0s</div>
            {timeMarks.map((mark, i) => {
              if (i === 0) return null;
              return (
                <div
                  key={i}
                  className="absolute"
                  style={{ left: `${(mark / totalDuration) * 90 + 5}%` }}
                >
                  | {mark}s
                </div>
              );
            })}
            <div className="absolute right-2 font-bold text-amber-500">{totalDuration}s (End)</div>
          </div>

          {/* Clips Track Container */}
          <div className="flex items-stretch gap-3 overflow-x-auto py-2 pr-2 scrollbar-thin scrollbar-thumb-stone-800 select-none">
            {shots.map((shot, idx) => {
              const hasVideo = shot.status === 'completed' && shot.videoUrl;
              return (
                <React.Fragment key={shot.id}>
                  {/* Clip Block Card */}
                  <div className="flex-none w-[200px] bg-stone-850 border border-stone-800 rounded-xl p-3 flex flex-col justify-between gap-3 relative transition-all hover:border-stone-700">
                    
                    {/* Header */}
                    <div className="flex items-center justify-between text-[11px] text-stone-400">
                      <span className="font-semibold text-stone-200">分镜 #{idx + 1}</span>
                      <div className="flex gap-1">
                        <button
                          onClick={() => handleMoveLeft(idx)}
                          disabled={idx === 0}
                          className="p-1 hover:bg-stone-800 hover:text-white rounded disabled:opacity-30 disabled:hover:bg-transparent"
                          title="左移"
                        >
                          <MoveLeft size={10} />
                        </button>
                        <button
                          onClick={() => handleMoveRight(idx)}
                          disabled={idx === shots.length - 1}
                          className="p-1 hover:bg-stone-800 hover:text-white rounded disabled:opacity-30 disabled:hover:bg-transparent"
                          title="右移"
                        >
                          <MoveRight size={10} />
                        </button>
                      </div>
                    </div>

                    {/* Clip preview thumbnail */}
                    <div className="aspect-video bg-stone-900 rounded-lg overflow-hidden border border-stone-800 relative flex items-center justify-center">
                      {hasVideo ? (
                        <video
                          src={shot.videoUrl}
                          muted
                          className="w-full h-full object-cover pointer-events-none"
                        />
                      ) : (
                        <div className="text-center p-2 text-stone-600 text-[10px]">
                          <Film size={14} className="mx-auto mb-1 opacity-40" />
                          <span>未生成素材</span>
                        </div>
                      )}
                      <span className="absolute bottom-1 right-1 bg-black/70 text-amber-500 font-mono text-[9px] px-1 rounded">
                        {shot.duration || 5}s
                      </span>
                    </div>

                    {/* Trim slider (5s - 15s) */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[10px] text-stone-400">
                        <span className="flex items-center gap-0.5"><Scissors size={10} /> 剪辑时长</span>
                        <span className="font-mono text-white font-bold">{shot.duration || 5}s</span>
                      </div>
                      <input
                        type="range"
                        min="5"
                        max="15"
                        step="1"
                        value={shot.duration || 5}
                        onChange={(e) => handleTrimChange(shot.id, e.target.value)}
                        className="w-full h-1 bg-stone-800 rounded-lg appearance-none cursor-pointer accent-amber-600"
                      />
                    </div>

                    {/* Subtitle Caption Editor */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[10px] text-stone-400">
                        <span className="flex items-center gap-0.5"><Type size={10} /> 镜头字幕</span>
                      </div>
                      <input
                        type="text"
                        value={shot.caption || ''}
                        onChange={(e) => handleCaptionChange(shot.id, e.target.value)}
                        placeholder="点击输入本镜台词或字幕..."
                        className="w-full bg-stone-900 border border-stone-800 rounded-md p-1 text-[10px] text-stone-300 focus:outline-none focus:border-amber-600 transition-colors"
                      />
                    </div>
                  </div>

                  {/* Transition connector (rendered between items) */}
                  {idx < shots.length - 1 && (
                    <div className="flex-none flex flex-col justify-center items-center px-1">
                      <span className="text-[9px] text-stone-500 mb-1">转场</span>
                      <select
                        value={shot.transition || 'none'}
                        onChange={(e) => handleTransitionChange(shot.id, e.target.value)}
                        className="text-[9px] bg-stone-850 border border-stone-800 text-stone-400 hover:text-white rounded p-1 cursor-pointer focus:outline-none focus:border-amber-600"
                      >
                        <option value="none">无 (Cut)</option>
                        <option value="fade">淡入 (Fade)</option>
                        <option value="dissolve">溶解 (Dissolve)</option>
                      </select>
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>

        {/* Right BGM mixer panel (1 col) */}
        <div className="bg-stone-850 border border-stone-800 rounded-xl p-4 flex flex-col justify-between gap-4">
          <div className="space-y-4">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-white">
              <Music size={14} className="text-amber-500" />
              <span>智能音轨混音器 (Mixer)</span>
            </div>

            {/* BGM Select */}
            <div className="space-y-1.5">
              <label className="text-[10px] text-stone-400 block">选择背景音乐 (BGM):</label>
              <select
                value={bgm}
                onChange={(e) => setBgm(e.target.value)}
                className="w-full text-xs bg-stone-900 border border-stone-800 text-stone-300 rounded-lg p-2 focus:outline-none focus:border-amber-600 cursor-pointer"
              >
                <option value="lofi">Cozy Lofi (温暖闲静)</option>
                <option value="epic">Epic Cinematic (宏大交响)</option>
                <option value="acoustic">Warm Acoustic (民谣吉他)</option>
                <option value="none">无背景配乐</option>
              </select>
            </div>

            {/* Voice Volume */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[10px] text-stone-400">
                <span>角色配音 (VO) 音量</span>
                <span className="font-mono text-white">{voiceVolume}%</span>
              </div>
              <div className="flex items-center gap-2">
                <Volume2 size={12} className="text-stone-500" />
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={voiceVolume}
                  onChange={(e) => setVoiceVolume(parseInt(e.target.value, 10))}
                  className="flex-1 h-1 bg-stone-900 rounded-lg appearance-none cursor-pointer accent-amber-600"
                />
              </div>
            </div>

            {/* BGM Volume */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[10px] text-stone-400">
                <span>配乐 (BGM) 音量</span>
                <span className="font-mono text-white">{bgmVolume}%</span>
              </div>
              <div className="flex items-center gap-2">
                <Music size={12} className="text-stone-500" />
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={bgmVolume}
                  onChange={(e) => setBgmVolume(parseInt(e.target.value, 10))}
                  className="flex-1 h-1 bg-stone-900 rounded-lg appearance-none cursor-pointer accent-amber-600"
                />
              </div>
            </div>
          </div>

          <div className="p-2.5 bg-stone-900/60 rounded-lg text-[9px] text-stone-500 leading-normal flex items-start gap-1">
            <Radio size={12} className="text-amber-600 shrink-0 mt-0.5" />
            <span>FFmpeg 剪辑核心就绪。点击“编译导出”将应用转场、配乐混音与音视频卡点进行压制。</span>
          </div>
        </div>
      </div>
    </div>
  );
}

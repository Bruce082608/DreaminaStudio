import { useState } from 'react';
import { Film, Play, AlertCircle, Plus, Trash2, Clock, ChevronDown, Sparkles, Copy, Check, RotateCcw, Cpu, CheckCircle } from 'lucide-react';
import { generateFinalPrompt } from '../utils/workflowHelpers';

export default function ShotTimeline({
  shots,
  characters,
  onUpdateShot,
  onDeleteShot,
  onAddShot,
  onGenerateShot,
  onGenerateAll,
  isApproved,
  onApproveStoryboard
}) {
  const [expandedPrompts, setExpandedPrompts] = useState({});
  const [copiedShotId, setCopiedShotId] = useState(null);

  const handleToggleCharacter = (shotId, charId, selectedIds) => {
    if (isApproved) return; // Lock structural changes after approval
    let newIds;
    if (selectedIds.includes(charId)) {
      newIds = selectedIds.filter(id => id !== charId);
    } else {
      newIds = [...selectedIds, charId];
    }
    onUpdateShot(shotId, { characterIds: newIds });
  };

  const toggleAccordion = (shotId) => {
    setExpandedPrompts(prev => ({
      ...prev,
      [shotId]: !prev[shotId]
    }));
  };

  const handleCopyPrompt = (shotId, text) => {
    navigator.clipboard.writeText(text);
    setCopiedShotId(shotId);
    setTimeout(() => setCopiedShotId(null), 2000);
  };

  // Find counts of different statuses for summary indicators
  const waitingCount = shots.filter(s => s.status === 'waiting').length;
  const generatingCount = shots.filter(s => s.status === 'generating').length;
  const completedCount = shots.filter(s => s.status === 'completed').length;
  const failedCount = shots.filter(s => s.status === 'failed').length;

  return (
    <div className="bg-white rounded-2xl border border-stone-200/60 shadow-sm p-6 flex flex-col h-full transition-all hover:shadow-md hover:shadow-stone-100">
      {/* Header */}
      <div className="flex flex-col gap-4 mb-6 pb-4 border-b border-stone-100">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-amber-50 text-amber-700 rounded-lg">
              <Film size={18} />
            </div>
            <div>
              <h3 className="font-semibold text-stone-800 text-base tracking-wide">分镜时间线控制台</h3>
              <p className="text-xs text-stone-400">
                {isApproved ? 'AI视频队列生成中，完成后进入底部剪辑' : '审核调整各个镜头时长与提示词，批准后生成'}
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            {!isApproved ? (
              <>
                <button
                  onClick={onApproveStoryboard}
                  disabled={shots.length === 0}
                  className={`flex items-center gap-1.5 py-2 px-4 rounded-xl text-xs font-semibold shadow-sm transition-all active:scale-[0.98] ${
                    shots.length === 0
                      ? 'bg-stone-100 text-stone-400 cursor-not-allowed'
                      : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-600/10 animate-bounce'
                  }`}
                  style={{ animationDuration: '3s' }}
                >
                  <CheckCircle size={14} />
                  <span>批准并锁定分镜</span>
                </button>
                <button
                  onClick={onAddShot}
                  className="flex items-center gap-1.5 py-2 px-3.5 bg-stone-100 hover:bg-stone-200 text-stone-700 border border-stone-200 rounded-xl text-xs font-semibold active:scale-[0.98] transition-all"
                >
                  <Plus size={14} />
                  <span>加镜头</span>
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={onGenerateAll}
                  disabled={shots.length === 0 || waitingCount > 0 || generatingCount > 0}
                  className={`flex items-center gap-1.5 py-2 px-3.5 rounded-xl text-xs font-semibold shadow-sm transition-all active:scale-[0.98] ${
                    shots.length === 0 || waitingCount > 0 || generatingCount > 0
                      ? 'bg-stone-100 text-stone-400 cursor-not-allowed'
                      : 'bg-amber-600 hover:bg-amber-700 text-white shadow-amber-600/10'
                  }`}
                >
                  <Cpu size={14} className={generatingCount > 0 ? 'animate-spin' : ''} />
                  <span>一键生成全部视频</span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* Workflow State Banner */}
        {!isApproved ? (
          shots.length > 0 && (
            <div className="bg-amber-50/50 border border-amber-200/50 p-3 rounded-xl text-xs text-amber-900 leading-relaxed flex items-start gap-2 animate-fade-in">
              <AlertCircle size={15} className="text-amber-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold block mb-0.5">分镜草稿阶段 (Draft Review):</span>
                <span>请在下方勾选登场角色、修改动作和选择镜头时长（<b>时长限 5s - 15s</b>）。确认无误后点击右上角<b>『批准并锁定分镜』</b>解锁渲染。</span>
              </div>
            </div>
          )
        ) : (
          /* Queue status banner */
          (waitingCount > 0 || generatingCount > 0 || failedCount > 0 || completedCount > 0) && (
            <div className="flex flex-wrap items-center gap-3 bg-stone-50 border border-stone-200/50 p-2.5 rounded-xl text-xs">
              <span className="font-medium text-stone-500">队列调度状态:</span>
              {generatingCount > 0 && (
                <span className="flex items-center gap-1 px-2.5 py-0.5 bg-amber-50 text-amber-700 rounded-full font-medium animate-pulse">
                  渲染中: {generatingCount} (并发并发限制 2)
                </span>
              )}
              {waitingCount > 0 && (
                <span className="flex items-center gap-1 px-2.5 py-0.5 bg-blue-50 text-blue-700 rounded-full font-medium">
                  排队中: {waitingCount}
                </span>
              )}
              {completedCount > 0 && (
                <span className="flex items-center gap-1 px-2.5 py-0.5 bg-emerald-50 text-emerald-700 rounded-full font-medium">
                  渲染成功: {completedCount} / {shots.length}
                </span>
              )}
              {failedCount > 0 && (
                <span className="flex items-center gap-1 px-2.5 py-0.5 bg-rose-50 text-rose-700 rounded-full font-medium">
                  失败: {failedCount} (支持重试)
                </span>
              )}
            </div>
          )
        )}
      </div>

      {/* Cards List */}
      <div className="flex-1 overflow-y-auto space-y-6 pr-1.5 scrollbar-thin">
        {shots.length === 0 ? (
          <div className="text-center py-16 text-stone-400 border-2 border-dashed border-stone-200 rounded-2xl">
            <Film className="mx-auto text-stone-300 mb-3" size={36} />
            <p className="text-sm">暂无分镜卡片，请先在左侧输入创意构思并选定剧本方案。</p>
          </div>
        ) : (
          shots.map((shot, index) => {
            const finalPrompt = generateFinalPrompt(shot, characters);
            const isExpanded = !!expandedPrompts[shot.id];

            return (
              <div
                key={shot.id}
                className={`p-5 rounded-2xl border transition-all duration-300 ${
                  shot.status === 'generating'
                    ? 'border-amber-400 bg-amber-50/10 shadow-md shadow-amber-500/5 glow-amber'
                    : shot.status === 'waiting'
                    ? 'border-blue-300 bg-blue-50/5 shadow-sm animate-pulse'
                    : shot.status === 'failed'
                    ? 'border-rose-300 bg-rose-50/5'
                    : 'border-stone-200/60 bg-white hover:border-stone-300 hover:shadow-sm'
                }`}
              >
                {/* Card Title Bar */}
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-stone-100 text-stone-700 font-bold text-xs">
                      {index + 1}
                    </span>
                    <span className="font-semibold text-stone-800 text-sm">镜头分镜</span>
                  </div>
                  {!isApproved && (
                    <button
                      onClick={() => onDeleteShot(shot.id)}
                      className="p-1 text-stone-400 hover:text-rose-600 rounded-md hover:bg-rose-50 transition-colors"
                      title="删除此分镜"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>

                {/* Grid content */}
                <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
                  {/* Left controls: Prompt, Characters, Duration, Engine Router */}
                  <div className="lg:col-span-3 space-y-4">
                    {/* Character Multi-select */}
                    <div>
                      <span className="text-xs font-semibold text-stone-700 block mb-2">
                        登场角色 {!isApproved && '(多选)'} :
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {characters.map((char) => {
                          const isSelected = shot.characterIds.includes(char.id);
                          return (
                            <button
                              key={char.id}
                              type="button"
                              disabled={isApproved}
                              onClick={() => handleToggleCharacter(shot.id, char.id, shot.characterIds)}
                              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                                isSelected
                                  ? 'bg-amber-50 border-amber-300 text-amber-800 shadow-sm shadow-amber-500/5'
                                  : 'bg-stone-50 border-stone-200 text-stone-500 hover:bg-stone-100'
                              } ${isApproved ? 'cursor-default opacity-85' : 'cursor-pointer'}`}
                            >
                              <img
                                src={char.avatar}
                                alt={char.name}
                                className="w-4 h-4 rounded-full object-cover border border-stone-200"
                              />
                              <span>{char.name.split(' ')[0]}</span>
                            </button>
                          );
                        })}
                        {characters.length === 0 && (
                          <span className="text-xs text-rose-500 font-medium">请先在左侧栏创建角色！</span>
                        )}
                      </div>
                    </div>

                    {/* Scene / Action Prompt */}
                    <div>
                      <span className="text-xs font-semibold text-stone-700 block mb-1.5">画面动作描述 (Motion Prompt):</span>
                      <textarea
                        value={shot.prompt}
                        disabled={isApproved}
                        onChange={(e) => onUpdateShot(shot.id, { prompt: e.target.value })}
                        placeholder="细节越丰富，生成的动作和光影效果越好..."
                        rows={2.5}
                        className={`w-full text-xs bg-stone-50/50 border border-stone-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-500/10 rounded-xl p-2.5 text-stone-700 focus:outline-none resize-none transition-all leading-relaxed ${
                          isApproved ? 'opacity-80 cursor-not-allowed bg-stone-100/50' : ''
                        }`}
                      />
                    </div>

                    {/* Router / Engine and Duration Panel */}
                    <div className="flex flex-wrap gap-4 items-center">
                      {/* Duration Toggle (5s - 15s Pills) */}
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-stone-700">时长:</span>
                        {isApproved ? (
                          <span className="text-xs font-bold font-mono text-stone-800 bg-stone-100 px-2 py-0.5 rounded border border-stone-200">
                            {shot.duration} 秒
                          </span>
                        ) : (
                          <div className="flex items-center bg-stone-100 p-0.5 rounded-lg flex-wrap gap-0.5">
                            {[5, 8, 10, 12, 15].map((sec) => (
                              <button
                                key={sec}
                                type="button"
                                onClick={() => onUpdateShot(shot.id, { duration: sec })}
                                className={`px-2 py-0.5 text-[10px] font-semibold rounded transition-all ${
                                  shot.duration === sec
                                    ? 'bg-white text-stone-800 shadow-sm'
                                    : 'text-stone-400 hover:text-stone-600'
                                }`}
                              >
                                {sec}s
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Generation Engine Gateway Selector */}
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-stone-700">引擎:</span>
                        {isApproved ? (
                          <span className="text-xs text-stone-600 font-medium">
                            {shot.engine === 'jimeng' ? '即梦-API' : shot.engine === 'kling' ? '可灵-API' : 'Hunyuan本地'}
                          </span>
                        ) : (
                          <select
                            value={shot.engine || 'jimeng'}
                            onChange={(e) => onUpdateShot(shot.id, { engine: e.target.value })}
                            className="text-xs bg-stone-50 border border-stone-200 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 rounded-lg p-1 text-stone-600 focus:outline-none cursor-pointer"
                          >
                            <option value="jimeng">即梦-API (Jimeng)</option>
                            <option value="kling">快手可灵-API (Kling)</option>
                            <option value="hunyuan">Hunyuan-开源本地</option>
                          </select>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right control: Video generator & Preview */}
                  <div className="lg:col-span-2 flex flex-col justify-between">
                    <div className="relative aspect-video w-full bg-stone-50 border border-stone-200/80 rounded-xl overflow-hidden shadow-inner flex flex-col items-center justify-center p-3">
                      
                      {!isApproved ? (
                        // Draft state right side placeholder
                        <div className="text-center p-2">
                          <Clock size={20} className="mx-auto text-amber-500/60 mb-1.5 animate-pulse" />
                          <p className="text-[10px] font-semibold text-amber-800">草稿待批准</p>
                          <p className="text-[9px] text-stone-400 mt-0.5 leading-normal">批准后可解锁排队并启动AI渲染</p>
                        </div>
                      ) : (
                        // Standard Rendering UI
                        <>
                          {shot.status === 'idle' && (
                            <div className="text-center">
                              <div className="w-10 h-10 rounded-full bg-stone-100 flex items-center justify-center text-stone-400 mx-auto mb-2">
                                <Film size={18} />
                              </div>
                              <p className="text-[11px] text-stone-400">尚未生成视频帧</p>
                            </div>
                          )}

                          {shot.status === 'waiting' && (
                            <div className="w-full text-center px-4">
                              <div className="w-8 h-8 rounded-full bg-amber-50 border border-amber-200 flex items-center justify-center mx-auto mb-2.5">
                                <Clock size={16} className="text-amber-600 animate-spin" style={{ animationDuration: '3s' }} />
                              </div>
                              <span className="text-xs font-semibold text-amber-700 block mb-1">等待队列调度...</span>
                              <p className="text-[10px] text-stone-400">前置生成中 (并发数 ≤ 2)</p>
                            </div>
                          )}

                          {shot.status === 'generating' && (
                            <div className="w-full text-center px-2">
                              <div className="w-8 h-8 border-3 border-amber-600 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
                              <span className="text-xs font-semibold text-amber-850 block mb-1">
                                正在生成 ({shot.engine === 'jimeng' ? '即梦-API' : shot.engine === 'kling' ? '可灵-API' : 'Hunyuan本地'})...
                              </span>
                              <div className="w-full bg-stone-200/80 rounded-full h-1.5 overflow-hidden">
                                <div
                                  className="bg-amber-600 h-1.5 rounded-full transition-all duration-300"
                                  style={{ width: `${shot.progress}%` }}
                                />
                              </div>
                              <span className="text-[10px] text-stone-500 mt-1 block font-mono">{shot.progress}%</span>
                            </div>
                          )}

                          {shot.status === 'completed' && shot.videoUrl && (
                            <video
                              src={shot.videoUrl}
                              controls
                              muted
                              loop
                              className="w-full h-full object-cover rounded-lg"
                            />
                          )}

                          {shot.status === 'failed' && (
                            <div className="text-center px-4 animate-fade-in">
                              <AlertCircle className="mx-auto text-rose-500 mb-1.5" size={24} />
                              <p className="text-xs text-rose-600 font-semibold">API 调用失败</p>
                              <p className="text-[10px] text-stone-400 leading-normal max-w-[150px] mx-auto mt-0.5">
                                {shot.error || '请求响应超时'}
                              </p>
                            </div>
                          )}
                        </>
                      )}
                    </div>

                    {/* Actions for Generator */}
                    {isApproved && (
                      <div className="mt-3">
                        {shot.status === 'completed' ? (
                          <button
                            onClick={() => onGenerateShot(shot.id)}
                            className="w-full py-2 px-3 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-xl text-xs font-semibold transition-all border border-stone-200 active:scale-[0.98]"
                          >
                            重新生成该镜头
                          </button>
                        ) : shot.status === 'failed' ? (
                          <button
                            onClick={() => onGenerateShot(shot.id)}
                            className="w-full flex items-center justify-center gap-1.5 py-2 px-3 bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 rounded-xl text-xs font-semibold shadow-sm transition-all active:scale-[0.98]"
                          >
                            <RotateCcw size={12} />
                            <span>一键重试</span>
                          </button>
                        ) : (
                          <button
                            onClick={() => onGenerateShot(shot.id)}
                            disabled={shot.status === 'generating' || shot.status === 'waiting'}
                            className={`w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-xs font-semibold shadow-sm transition-all active:scale-[0.98] ${
                              shot.status === 'generating' || shot.status === 'waiting'
                                ? 'bg-amber-100 text-amber-500 cursor-not-allowed border border-amber-200/20'
                                : 'bg-amber-600 hover:bg-amber-700 text-white shadow-amber-600/5'
                            }`}
                          >
                            <Play size={12} />
                            <span>
                              {shot.status === 'generating' ? '生成中...' : shot.status === 'waiting' ? '排队中...' : '单镜生成'}
                            </span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Prompt Inspector Accordion */}
                <div className="mt-4 border-t border-stone-100 pt-3">
                  <button
                    onClick={() => toggleAccordion(shot.id)}
                    className="flex items-center justify-between w-full text-xs font-medium text-stone-500 hover:text-amber-700 transition-colors"
                  >
                    <span className="flex items-center gap-1">
                      <Sparkles size={12} className="text-amber-500 animate-pulse" />
                      查看 AI 融合提示词 (Prompt Inspector)
                    </span>
                    <ChevronDown size={14} className={`transform transition-transform text-stone-400 duration-200 ${isExpanded ? 'rotate-180 text-amber-600' : ''}`} />
                  </button>

                  {isExpanded && (
                    <div className="mt-2.5 p-3 bg-amber-50/20 border border-amber-100/60 rounded-xl animate-fade-in flex items-start justify-between gap-3">
                      <div className="text-[11px] font-mono leading-relaxed text-stone-600 break-words flex-1 select-all select-none">
                        {finalPrompt || <span className="text-stone-400 italic">（无提示词内容，请先输入动作或勾选登场角色）</span>}
                      </div>
                      {finalPrompt && (
                        <button
                          onClick={() => handleCopyPrompt(shot.id, finalPrompt)}
                          className="p-1.5 text-stone-400 hover:text-amber-700 rounded-lg hover:bg-stone-100/80 transition-all active:scale-95"
                          title="复制完整提示词"
                        >
                          {copiedShotId === shot.id ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

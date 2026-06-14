import React, { useState } from 'react';
import { Sparkles, FileText, RefreshCw, AlertCircle } from 'lucide-react';

export default function ScriptInput({ script, onScriptChange, onSplitScript, isSplitting }) {
  const [localScript, setLocalScript] = useState(script);

  const handleSplit = () => {
    onSplitScript(localScript);
  };

  const handleReset = () => {
    if (window.confirm('确定要恢复默认剧本吗？这会覆盖当前输入的文本。')) {
      onScriptChange('');
      setLocalScript('');
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-stone-200/60 shadow-sm p-5 flex flex-col h-full transition-all hover:shadow-md hover:shadow-stone-100">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-amber-50 text-amber-700 rounded-lg">
            <FileText size={18} />
          </div>
          <div>
            <h3 className="font-semibold text-stone-800 text-sm tracking-wide">原始剧本编辑</h3>
            <p className="text-xs text-stone-400">支持Markdown格式与角色场景标注</p>
          </div>
        </div>
        <button
          onClick={handleReset}
          className="p-1.5 text-stone-400 hover:text-rose-600 rounded-md hover:bg-rose-50 transition-colors"
          title="清空剧本"
        >
          <RefreshCw size={14} className={isSplitting ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Script Textarea */}
      <div className="flex-1 relative mb-4">
        <textarea
          value={localScript}
          onChange={(e) => {
            setLocalScript(e.target.value);
            onScriptChange(e.target.value);
          }}
          disabled={isSplitting}
          placeholder="在此粘贴或输入您的原创剧本，例如：&#10;【镜头 1】&#10;苏菲走进咖啡馆...&#10;（角色：苏菲 | 画面动作：推开木门...）"
          className="w-full h-full min-h-[260px] bg-stone-50/50 border border-stone-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-100 rounded-xl p-4 text-stone-700 text-sm leading-relaxed focus:outline-none resize-none transition-all scrollbar-thin"
        />
        {localScript.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none p-6">
            <div className="text-center max-w-xs">
              <AlertCircle className="mx-auto text-stone-300 mb-2" size={24} />
              <p className="text-xs text-stone-400">暂无内容，你可以粘贴自备剧本，或点击右上角重置按钮加载Demo剧本。</p>
            </div>
          </div>
        )}
      </div>

      {/* Action Button */}
      <button
        onClick={handleSplit}
        disabled={isSplitting || !localScript.trim()}
        className={`flex items-center justify-center gap-2 w-full py-3 px-4 rounded-xl font-medium shadow-sm transition-all duration-300 text-sm active:scale-[0.98] ${
          isSplitting
            ? 'bg-amber-100 text-amber-500 cursor-not-allowed'
            : !localScript.trim()
            ? 'bg-stone-100 text-stone-400 cursor-not-allowed'
            : 'bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white shadow-amber-600/10'
        }`}
      >
        <Sparkles size={16} className={`${isSplitting ? 'animate-pulse' : 'group-hover:animate-bounce'}`} />
        {isSplitting ? '正在解析剧本并提取分镜...' : '智能拆解分镜'}
      </button>
    </div>
  );
}

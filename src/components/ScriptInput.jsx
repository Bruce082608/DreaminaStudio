import { useState } from 'react';
import { Sparkles, ArrowRight, Lightbulb, Clock, ArrowLeft, CheckCircle2 } from 'lucide-react';
import { generateCandidateScripts } from '../utils/workflowHelpers';

export default function ScriptInput({
  onSplitScript // Maps to selecting a script and moving to storyboard
}) {
  const [idea, setIdea] = useState('在塞纳河畔的转角，有一家售卖时光的咖啡馆。');
  const [totalDuration, setTotalDuration] = useState(60);
  const [candidates, setCandidates] = useState([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedCandidateId, setSelectedCandidateId] = useState(null);

  const handleGenerateCandidates = (e) => {
    e.preventDefault();
    if (!idea.trim()) return;

    setIsGenerating(true);
    setTimeout(() => {
      const generated = generateCandidateScripts(idea, totalDuration);
      setCandidates(generated);
      setIsGenerating(false);
    }, 1500);
  };

  const handleSelectScript = (candidate) => {
    setSelectedCandidateId(candidate.id);
    // Pass the detailed script text and target duration to start storyboard extraction
    onSplitScript(candidate.scriptText, totalDuration);
  };

  const handleBack = () => {
    setCandidates([]);
    setSelectedCandidateId(null);
  };

  return (
    <div className="bg-white rounded-2xl border border-stone-200/60 shadow-sm p-5 flex flex-col h-full transition-all hover:shadow-md hover:shadow-stone-100">
      {/* If Candidates have not been generated, show Idea Input Form */}
      {candidates.length === 0 ? (
        <form onSubmit={handleGenerateCandidates} className="flex flex-col h-full justify-between">
          <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center gap-2">
              <div className="p-2 bg-amber-50 text-amber-700 rounded-lg">
                <Lightbulb size={18} />
              </div>
              <div>
                <h3 className="font-semibold text-stone-800 text-sm tracking-wide">创意想法采集</h3>
                <p className="text-xs text-stone-400">输入您的短短想法，AI将生成3套视听剧本</p>
              </div>
            </div>

            {/* Input textarea */}
            <div className="space-y-1">
              <label className="text-xs font-semibold text-stone-700 block">短短的创意想法:</label>
              <textarea
                value={idea}
                onChange={(e) => setIdea(e.target.value)}
                placeholder="例如：一个关于时光穿梭的咖啡馆，旅人可以通过喝特调咖啡找回遗忘的记忆..."
                className="w-full h-40 bg-stone-50/50 border border-stone-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-100 rounded-xl p-3 text-stone-700 text-xs leading-relaxed focus:outline-none resize-none transition-all scrollbar-thin"
                required
              />
            </div>

            {/* Target Duration selector */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-stone-700 flex items-center gap-1">
                <Clock size={12} className="text-stone-400" />
                期望视频总时长:
              </label>
              <div className="flex bg-stone-100 p-0.5 rounded-lg">
                {[30, 60, 90].map((sec) => (
                  <button
                    key={sec}
                    type="button"
                    onClick={() => setTotalDuration(sec)}
                    className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all ${
                      totalDuration === sec
                        ? 'bg-white text-stone-850 shadow-sm border-stone-200'
                        : 'text-stone-500 hover:text-stone-700'
                    }`}
                  >
                    {sec}s 时长 {sec === 30 ? '(微短)' : sec === 60 ? '(标准)' : '(剧场)'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Action button */}
          <button
            type="submit"
            disabled={isGenerating || !idea.trim()}
            className={`mt-6 w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-medium shadow-sm transition-all duration-300 text-sm active:scale-[0.98] ${
              isGenerating
                ? 'bg-amber-100 text-amber-500 cursor-not-allowed border border-amber-200/20'
                : 'bg-amber-600 hover:bg-amber-700 text-white shadow-amber-600/10'
            }`}
          >
            <Sparkles size={16} className={isGenerating ? 'animate-pulse' : ''} />
            <span>{isGenerating ? 'AI 正在构思候选剧本...' : '生成候选剧本方案'}</span>
          </button>
        </form>
      ) : (
        // Candidates Selection View
        <div className="flex flex-col h-full justify-between overflow-y-auto pr-1 scrollbar-thin">
          <div className="space-y-4">
            {/* Header & Back Button */}
            <div className="flex items-center justify-between pb-2 border-b border-stone-100">
              <button
                onClick={handleBack}
                className="flex items-center gap-1 text-xs text-stone-500 hover:text-stone-800 transition-colors"
              >
                <ArrowLeft size={12} />
                <span>返回修改创意</span>
              </button>
              <span className="text-[10px] bg-amber-50 text-amber-800 px-2 py-0.5 rounded-full font-medium">
                AI 企划已就绪
              </span>
            </div>

            <span className="text-xs font-semibold text-stone-700 block">请选择一套心仪的视觉剧本:</span>

            {/* Candidates Lists */}
            <div className="space-y-3">
              {candidates.map((cand) => {
                const isSelected = selectedCandidateId === cand.id;
                return (
                  <div
                    key={cand.id}
                    className={`p-3.5 border rounded-xl flex flex-col gap-2 transition-all text-xs cursor-pointer ${
                      isSelected
                        ? 'border-amber-500 bg-amber-50/10 shadow-sm'
                        : 'border-stone-200 bg-stone-50/40 hover:bg-stone-50 hover:border-stone-300'
                    }`}
                    onClick={() => handleSelectScript(cand)}
                  >
                    <div className="flex justify-between items-start gap-2">
                      <h4 className="font-bold text-stone-800 text-xs truncate">{cand.title}</h4>
                      <span className="text-[9px] text-stone-400 font-mono shrink-0">
                        分镜数: {cand.estimatedShots}
                      </span>
                    </div>

                    <span className="inline-block text-[10px] px-1.5 py-0.2 bg-amber-50 border border-amber-200/40 text-amber-800 rounded-md self-start font-medium">
                      {cand.tone}
                    </span>

                    <p className="text-[11px] text-stone-500 leading-normal">
                      {cand.summary}
                    </p>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation(); // Avoid double click trigger
                        handleSelectScript(cand);
                      }}
                      className={`w-full py-1.5 mt-1 rounded-lg text-xs font-semibold flex items-center justify-center gap-1 transition-all ${
                        isSelected
                          ? 'bg-emerald-600 text-white shadow-sm'
                          : 'bg-amber-600 hover:bg-amber-700 text-white'
                      }`}
                    >
                      {isSelected ? <CheckCircle2 size={12} /> : <ArrowRight size={12} />}
                      <span>{isSelected ? '已选定此方案' : '选定此剧本方案'}</span>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

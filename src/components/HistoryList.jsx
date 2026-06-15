import { History, Play, Trash2, Calendar, Clock, Film } from 'lucide-react';

export default function HistoryList({ history, activeVideoUrl, onSelectHistory, onDeleteHistory }) {
  return (
    <div className="bg-white rounded-2xl border border-stone-200/60 shadow-sm p-5 flex flex-col h-full transition-all hover:shadow-md hover:shadow-stone-100">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-stone-100 text-stone-700 rounded-lg">
            <History size={18} />
          </div>
          <div>
            <h3 className="font-semibold text-stone-800 text-sm tracking-wide">历史生成记录</h3>
            <p className="text-xs text-stone-400">已合成的成品短剧存档</p>
          </div>
        </div>
        <span className="text-[10px] bg-stone-100 text-stone-600 px-2 py-0.5 rounded-full font-medium">
          共 {history.length} 部
        </span>
      </div>

      {/* History Items List */}
      <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 scrollbar-thin max-h-[300px]">
        {history.length === 0 ? (
          <div className="text-center py-10 text-stone-400">
            <p className="text-xs">暂无历史合成记录，快去合成你的第一部短剧吧！</p>
          </div>
        ) : (
          history.map((item) => {
            const isActive = activeVideoUrl === item.videoUrl;
            return (
              <div
                key={item.id}
                onClick={() => onSelectHistory(item)}
                className={`p-3 rounded-xl border flex items-center justify-between gap-3 cursor-pointer transition-all ${
                  isActive
                    ? 'border-amber-400 bg-amber-50/10 shadow-sm'
                    : 'border-stone-100 bg-stone-50/40 hover:bg-stone-50/90 hover:border-stone-200'
                }`}
              >
                {/* Left Thumbnail/Icon */}
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center border transition-all ${
                  isActive
                    ? 'bg-amber-600 text-white border-amber-500 shadow-sm shadow-amber-500/20'
                    : 'bg-stone-100 text-stone-500 border-stone-200'
                }`}>
                  {isActive ? <Play size={16} className="fill-current animate-pulse" /> : <Film size={16} />}
                </div>

                {/* Main details */}
                <div className="flex-1 min-w-0">
                  <h4 className={`text-xs font-semibold truncate ${isActive ? 'text-amber-800' : 'text-stone-700'}`}>
                    {item.title}
                  </h4>
                  <div className="flex items-center gap-3 mt-1 text-[10px] text-stone-400">
                    <span className="flex items-center gap-0.5">
                      <Calendar size={10} />
                      <span>{item.date}</span>
                    </span>
                    <span className="flex items-center gap-0.5">
                      <Clock size={10} />
                      <span>{item.duration}s</span>
                    </span>
                  </div>
                </div>

                {/* Actions */}
                <div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation(); // Avoid selecting history when clicking delete
                      if (window.confirm('确定要删除这条历史记录吗？')) {
                        onDeleteHistory(item.id);
                      }
                    }}
                    className="p-1.5 text-stone-400 hover:text-rose-600 hover:bg-rose-50 rounded-md transition-all"
                    title="删除记录"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

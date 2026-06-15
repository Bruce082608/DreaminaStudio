import { useState } from 'react';
import { Key, Plus, Trash2, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';

export default function CookiePoolManager({
  cookies,
  onAddCookie,
  onDeleteCookie,
  onValidateCookie
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [newVal, setNewVal] = useState('');
  const [newAlias, setNewAlias] = useState('');
  const [validatingId, setValidatingId] = useState(null);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!newVal.trim()) return;

    const cookieObj = {
      id: `cookie-${Date.now()}`,
      alias: newAlias.trim() || `账号_${cookies.length + 1}`,
      value: newVal.trim(),
      status: 'active', // 'active' | 'cooldown' | 'expired'
      activeTasks: 0,
      failCount: 0
    };

    onAddCookie(cookieObj);
    setNewVal('');
    setNewAlias('');
  };

  const handleValidate = (id) => {
    setValidatingId(id);
    onValidateCookie(id, () => {
      setValidatingId(null);
    });
  };

  const activeCount = cookies.filter(c => c.status === 'active').length;
  const expiredCount = cookies.filter(c => c.status === 'expired').length;

  return (
    <div className="bg-white rounded-2xl border border-stone-200/60 shadow-sm transition-all hover:shadow-md hover:shadow-stone-100">
      {/* Header Bar (Collapsible Toggle) */}
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        className="p-5 flex items-center justify-between cursor-pointer select-none"
      >
        <div className="flex items-center gap-2">
          <div className="p-2 bg-amber-50 text-amber-700 rounded-lg">
            <Key size={18} />
          </div>
          <div>
            <h3 className="font-semibold text-stone-800 text-sm tracking-wide">逆向 Cookie 账号池</h3>
            <p className="text-xs text-stone-400">
              当前状态: <span className="font-medium text-emerald-600">{activeCount} 个活跃</span>
              {expiredCount > 0 && <span className="text-rose-500 font-medium"> · {expiredCount} 个失效</span>}
            </p>
          </div>
        </div>
        <div>
          {isExpanded ? <ChevronUp size={16} className="text-stone-400" /> : <ChevronDown size={16} className="text-stone-400" />}
        </div>
      </div>

      {/* Expanded Content Panel */}
      {isExpanded && (
        <div className="px-5 pb-5 border-t border-stone-100 pt-4 space-y-4 animate-slide-up">
          {/* Add Cookie Form */}
          <form onSubmit={handleSubmit} className="p-3 bg-stone-50 border border-stone-200/60 rounded-xl space-y-2.5">
            <span className="text-xs font-semibold text-stone-700 block">添加账号 Cookie 凭证:</span>
            <div className="grid grid-cols-3 gap-2">
              <input
                type="text"
                value={newAlias}
                onChange={(e) => setNewAlias(e.target.value)}
                placeholder="账号备注 (如: 主号-VIP)"
                className="col-span-1 text-xs border border-stone-200 focus:border-amber-500 rounded-lg p-2 bg-white text-stone-800 focus:outline-none"
              />
              <input
                type="text"
                required
                value={newVal}
                onChange={(e) => setNewVal(e.target.value)}
                placeholder="粘贴完整 Cookie 字符串..."
                className="col-span-2 text-xs border border-stone-200 focus:border-amber-500 rounded-lg p-2 bg-white text-stone-800 focus:outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={!newVal.trim()}
              className={`w-full flex items-center justify-center gap-1 py-1.5 rounded-lg text-xs font-medium transition-all ${
                !newVal.trim()
                  ? 'bg-stone-100 text-stone-400 cursor-not-allowed'
                  : 'bg-amber-600 hover:bg-amber-700 text-white shadow-sm'
              }`}
            >
              <Plus size={14} />
              <span>载入 Cookie</span>
            </button>
          </form>

          {/* Cookie Table / List */}
          <div className="space-y-2.5">
            <span className="text-xs font-semibold text-stone-700 block">账号运行状态监测:</span>
            {cookies.length === 0 ? (
              <p className="text-xs text-stone-400 text-center py-4">无已配置账号。即梦 API 调用将无法执行！</p>
            ) : (
              <div className="space-y-2 overflow-y-auto max-h-[160px] pr-1 scrollbar-thin">
                {cookies.map((cookie) => (
                  <div
                    key={cookie.id}
                    className={`p-2.5 border rounded-xl flex items-center justify-between gap-3 text-xs ${
                      cookie.status === 'active'
                        ? 'border-stone-200 bg-white'
                        : cookie.status === 'cooldown'
                        ? 'border-amber-200 bg-amber-50/10'
                        : 'border-rose-200 bg-rose-50/10'
                    }`}
                  >
                    {/* Status Badge & Name */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full ${
                          cookie.status === 'active' ? 'bg-emerald-500 animate-pulse' :
                          cookie.status === 'cooldown' ? 'bg-amber-500' : 'bg-rose-500'
                        }`} />
                        <span className="font-semibold text-stone-800 truncate" title={cookie.value}>
                          {cookie.alias}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-[10px] text-stone-400">
                        <span>并发任务: <b className="text-stone-600">{cookie.activeTasks}/2</b></span>
                        <span>·</span>
                        <span>连续失败: <b className="text-stone-600">{cookie.failCount}</b></span>
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleValidate(cookie.id)}
                        disabled={validatingId === cookie.id}
                        className="p-1 text-stone-400 hover:text-amber-700 rounded-md hover:bg-stone-100 transition-all"
                        title="检测有效性 (Validate)"
                      >
                        <RefreshCw size={12} className={validatingId === cookie.id ? 'animate-spin text-amber-600' : ''} />
                      </button>
                      <button
                        onClick={() => onDeleteCookie(cookie.id)}
                        className="p-1 text-stone-400 hover:text-rose-600 rounded-md hover:bg-rose-50 transition-all"
                        title="下线此账号"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="p-3 bg-amber-50/20 border border-amber-100/60 rounded-xl text-[10px] text-stone-500 leading-normal">
            <span className="font-semibold text-amber-800 block mb-1">逆向说明 (Reverse Engineering Disclaimer):</span>
            当前处于本地模拟测试状态。调用“即梦-API”时，系统将分配至状态为<b>活跃</b>的 Cookie 进行加密授权校验。若连续失败 3 次，Cookie 将自动变更为<b>失效</b>并触发警报，以保护账号安全。
          </div>
        </div>
      )}
    </div>
  );
}

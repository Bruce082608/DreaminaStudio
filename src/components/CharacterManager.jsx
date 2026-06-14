import React, { useState } from 'react';
import { Users, Plus, Trash2, Wand2, Check, UserPlus } from 'lucide-react';
import { mockAvatars } from '../mockData';

export default function CharacterManager({ characters, onAddCharacter, onUpdateCharacter, onDeleteCharacter }) {
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPrompt, setNewPrompt] = useState('');
  const [newGender, setNewGender] = useState('female');
  const [generatingAvatarId, setGeneratingAvatarId] = useState(null);

  const handleAdd = (e) => {
    e.preventDefault();
    if (!newName.trim()) return;

    // Pick a random avatar from the mock pool
    const randomAvatar = mockAvatars[Math.floor(Math.random() * mockAvatars.length)];

    const newChar = {
      id: `char-${Date.now()}`,
      name: newName,
      basePrompt: newPrompt || `${newName}, anime style, beautiful portrait`,
      avatar: randomAvatar,
      gender: newGender
    };

    onAddCharacter(newChar);
    setNewName('');
    setNewPrompt('');
    setNewGender('female');
    setIsAdding(false);
  };

  const simulateAvatarGeneration = (charId) => {
    setGeneratingAvatarId(charId);
    setTimeout(() => {
      // Pick a random Unsplash avatar that is different
      const randomIdx = Math.floor(Math.random() * 20) + 10;
      const newAvatarUrl = `https://images.unsplash.com/photo-${1500000000000 + randomIdx * 100000}?auto=format&fit=crop&q=80&w=200&h=200`;
      onUpdateCharacter(charId, { avatar: newAvatarUrl });
      setGeneratingAvatarId(null);
    }, 1500);
  };

  return (
    <div className="bg-white rounded-2xl border border-stone-200/60 shadow-sm p-5 flex flex-col h-full transition-all hover:shadow-md hover:shadow-stone-100">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-emerald-50 text-emerald-700 rounded-lg">
            <Users size={18} />
          </div>
          <div>
            <h3 className="font-semibold text-stone-800 text-sm tracking-wide">角色一致性管理</h3>
            <p className="text-xs text-stone-400">固定角色特征与视觉提示词</p>
          </div>
        </div>
        {!isAdding && (
          <button
            onClick={() => setIsAdding(true)}
            className="flex items-center gap-1 py-1.5 px-3 bg-stone-100 hover:bg-amber-50 hover:text-amber-700 text-stone-600 rounded-lg text-xs font-medium transition-all"
          >
            <Plus size={14} />
            <span>添加</span>
          </button>
        )}
      </div>

      {/* List of Characters */}
      <div className="flex-1 overflow-y-auto space-y-3 pr-1 scrollbar-thin max-h-[360px]">
        {characters.length === 0 ? (
          <div className="text-center py-8 text-stone-400">
            <p className="text-xs">暂无角色资产，请创建。</p>
          </div>
        ) : (
          characters.map((char) => (
            <div
              key={char.id}
              className="p-3 bg-stone-50/50 hover:bg-stone-50 border border-stone-200/50 rounded-xl flex flex-col gap-2 transition-all hover:scale-[1.01]"
            >
              <div className="flex items-center gap-3">
                {/* Avatar area */}
                <div className="relative group/avatar cursor-pointer w-12 h-12 rounded-xl overflow-hidden border border-stone-200 shadow-inner">
                  {generatingAvatarId === char.id ? (
                    <div className="absolute inset-0 bg-stone-900/65 flex items-center justify-center">
                      <div className="w-4 h-4 border-2 border-amber-500 border-t-transparent rounded-full animate-spin"></div>
                    </div>
                  ) : (
                    <>
                      <img src={char.avatar} alt={char.name} className="w-full h-full object-cover transition-transform group-hover/avatar:scale-110" />
                      <button
                        onClick={() => simulateAvatarGeneration(char.id)}
                        className="absolute inset-0 bg-stone-900/40 opacity-0 group-hover/avatar:opacity-100 flex items-center justify-center text-white transition-opacity duration-200"
                        title="AI 生成头像"
                      >
                        <Wand2 size={12} className="animate-pulse" />
                      </button>
                    </>
                  )}
                </div>

                {/* Name and actions */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-stone-800 text-sm truncate">{char.name}</span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => simulateAvatarGeneration(char.id)}
                        className="p-1 text-stone-400 hover:text-amber-600 rounded hover:bg-stone-100 transition-colors"
                        title="重新生成AI形象"
                      >
                        <Wand2 size={12} />
                      </button>
                      <button
                        onClick={() => onDeleteCharacter(char.id)}
                        className="p-1 text-stone-400 hover:text-rose-600 rounded hover:bg-rose-50 transition-colors"
                        title="删除角色"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                  {/* Gender Tag */}
                  <span className={`inline-block text-[10px] px-1.5 py-0.2 rounded-full font-medium ${
                    char.gender === 'female' ? 'bg-rose-50 text-rose-600' :
                    char.gender === 'male' ? 'bg-blue-50 text-blue-600' : 'bg-purple-50 text-purple-600'
                  }`}>
                    {char.gender === 'female' ? '女性' : char.gender === 'male' ? '男性' : '非二元'}
                  </span>
                </div>
              </div>

              {/* Base Prompt */}
              <div>
                <span className="text-[10px] text-stone-400 block mb-0.5">固定提示词 (Base Prompt):</span>
                <textarea
                  value={char.basePrompt}
                  onChange={(e) => onUpdateCharacter(char.id, { basePrompt: e.target.value })}
                  rows={2}
                  className="w-full text-xs bg-white border border-stone-200 focus:border-amber-500 rounded p-1.5 text-stone-600 focus:outline-none resize-none leading-relaxed transition-all"
                />
              </div>
            </div>
          ))
        )}
      </div>

      {/* Add Character Form */}
      {isAdding && (
        <form onSubmit={handleAdd} className="mt-4 p-4 border border-amber-100 bg-amber-50/20 rounded-xl animate-slide-up space-y-3">
          <div>
            <label className="block text-xs font-semibold text-stone-700 mb-1">角色姓名</label>
            <input
              type="text"
              required
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="例如：苏菲 (Sophie)"
              className="w-full text-xs border border-stone-200 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 rounded-lg p-2 bg-white text-stone-800 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-stone-700 mb-1">性别设定</label>
            <div className="flex gap-2">
              {['female', 'male', 'other'].map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setNewGender(g)}
                  className={`flex-1 text-[11px] py-1 border rounded-md transition-all font-medium ${
                    newGender === g
                      ? 'bg-amber-600 border-amber-600 text-white shadow-sm'
                      : 'bg-white border-stone-200 text-stone-600 hover:bg-stone-50'
                  }`}
                >
                  {g === 'female' ? '女' : g === 'male' ? '男' : '其他'}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-stone-700 mb-1">外貌提示词 (Base Prompt)</label>
            <textarea
              value={newPrompt}
              onChange={(e) => setNewPrompt(e.target.value)}
              placeholder="描述角色的外貌、穿着、发色等，例如：soft hazel eyes, vintage brown coat..."
              rows={2.5}
              className="w-full text-xs border border-stone-200 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 rounded-lg p-2 bg-white text-stone-800 focus:outline-none resize-none"
            />
          </div>

          <div className="flex gap-2 justify-end pt-1">
            <button
              type="button"
              onClick={() => setIsAdding(false)}
              className="px-3 py-1.5 border border-stone-200 hover:bg-stone-50 text-stone-600 rounded-lg text-xs font-medium transition-all"
            >
              取消
            </button>
            <button
              type="submit"
              className="flex items-center gap-1 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-medium shadow-sm transition-all"
            >
              <Check size={12} />
              <span>保存角色</span>
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

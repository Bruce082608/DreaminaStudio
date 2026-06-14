// Mock Data for AI Drama/Mini-theater Workflow Console

export const initialScript = `# 《时光咖啡馆：遗失的星尘》

[场景：黄昏，温暖的时光咖啡馆]
[角色：苏菲 (Sophie)，林德 (Lynd)]

【镜头 1】
苏菲轻轻推开咖啡馆的复古木门，风铃发出清脆的响声。夕阳斜射进屋内，照亮空气中微微飘动的微尘。
（角色：苏菲 | 画面动作：推开木门，温暖夕阳，风铃摇曳，极其温馨的咖啡馆背景）

【镜头 2】
林德站在吧台后，微笑着向苏菲点头致意。他手里拿着一个复古的黄铜天平，正在称量着闪烁着金色微光的星尘咖啡豆。
（角色：林德 | 画面动作：站在吧台后微笑，手持黄铜天平称量发光咖啡豆，背景是满墙的时光沙漏）

【镜头 3】
苏菲走到吧台前坐下，林德将一杯热气腾腾的拿铁咖啡轻轻滑到她面前。拿铁的拉花是一个微缩的旋转星系，散发着淡金色光芒。
（角色：苏菲, 林德 | 画面动作：苏菲坐下，林德递上星系拉花咖啡，咖啡杯口冒着热气，温暖治愈）

【镜头 4】
苏菲双手捧起咖啡杯，轻轻啜饮，眼神中充满了释怀的笑意。那一刻，咖啡馆外的喧嚣仿佛彻底静止。
（角色：苏菲 | 画面动作：双手捧起咖啡杯喝咖啡，眼神流露释怀笑意，微距特写）
`;

export const initialCharacters = [
  {
    id: 'char-1',
    name: '苏菲 (Sophie)',
    basePrompt: 'Sophie, a young female traveler, wearing a knitted beige warm scarf, soft hazel eyes, vintage wool coat, chestnut wavy hair, highly detailed, cozy anime cinematic style, warm lighting',
    avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&q=80&w=200&h=200',
    gender: 'female'
  },
  {
    id: 'char-2',
    name: '林德 (Lynd)',
    basePrompt: 'Lynd, a gentle male barista, wearing a dark green canvas apron over a cream shirt, silver-rimmed glasses, messy sandy blond hair, blue eyes, smiling warmly, cozy anime style, soft counter lighting',
    avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=200&h=200',
    gender: 'male'
  }
];

export const initialShots = [
  {
    id: 'shot-1',
    characterIds: ['char-1'],
    prompt: 'Sophie opens the wooden door of the cafe, warm golden sunset light streaming behind her, windchimes swaying, steam rising, high detail, warm tones',
    duration: 4,
    engine: 'jimeng',
    status: 'completed',
    progress: 100,
    videoUrl: 'https://assets.mixkit.co/videos/preview/mixkit-woman-holding-a-warm-cup-of-coffee-41618-large.mp4'
  },
  {
    id: 'shot-2',
    characterIds: ['char-2'],
    prompt: 'Lynd smiles warmly behind the counter, holding a small brass scale weighing glowing golden coffee beans, shelves of hourglasses in background',
    duration: 4,
    engine: 'kling',
    status: 'completed',
    progress: 100,
    videoUrl: 'https://assets.mixkit.co/videos/preview/mixkit-coffee-maker-machine-brewing-espresso-41619-large.mp4'
  },
  {
    id: 'shot-3',
    characterIds: ['char-1', 'char-2'],
    prompt: 'Sophie sits at the counter, Lynd slides a steaming cup of latte with a galaxy latte-art on it, soft dust particles floating in the air',
    duration: 8,
    engine: 'hunyuan',
    status: 'idle',
    progress: 0,
    videoUrl: null
  },
  {
    id: 'shot-4',
    characterIds: ['char-1'],
    prompt: 'Sophie holding the hot cup with both hands, taking a sip, a relaxed and happy smile on her face, cinematic close-up, cozy winter mood',
    duration: 4,
    engine: 'jimeng',
    status: 'idle',
    progress: 0,
    videoUrl: null
  }
];

export const initialHistory = [
  {
    id: 'hist-1',
    title: '时光咖啡馆 - 塞纳河的冬日 (Demo)',
    date: '2026-06-12 14:32',
    duration: 16,
    videoUrl: 'https://assets.mixkit.co/videos/preview/mixkit-barista-pouring-milk-into-a-cup-of-coffee-41617-large.mp4'
  },
  {
    id: 'hist-2',
    title: '青鸟与风铃的小夜曲 (Demo)',
    date: '2026-06-10 18:15',
    duration: 12,
    videoUrl: 'https://assets.mixkit.co/videos/preview/mixkit-pouring-hot-water-into-a-chemex-41712-large.mp4'
  }
];

export const mockVideoPool = [
  'https://assets.mixkit.co/videos/preview/mixkit-barista-pouring-milk-into-a-cup-of-coffee-41617-large.mp4',
  'https://assets.mixkit.co/videos/preview/mixkit-pouring-hot-water-into-a-chemex-41712-large.mp4',
  'https://assets.mixkit.co/videos/preview/mixkit-steaming-cup-of-coffee-close-up-41713-large.mp4',
  'https://assets.mixkit.co/videos/preview/mixkit-freshly-brewed-coffee-dripping-into-a-pot-41714-large.mp4'
];

export const mockAvatars = [
  'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?auto=format&fit=crop&q=80&w=200&h=200',
  'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&q=80&w=200&h=200',
  'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=200&h=200',
  'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&q=80&w=200&h=200'
];

export const ENGINE_INFO = {
  jimeng: { name: '即梦-API (Jimeng)', delay: 250, errorRate: 0.05 },
  kling: { name: '快手可灵-API (Kling)', delay: 400, errorRate: 0.10 },
  hunyuan: { name: 'Hunyuan-开源本地', delay: 150, errorRate: 0.20 }
};

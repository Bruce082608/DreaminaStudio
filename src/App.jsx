import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  Bot,
  Check,
  ChevronRight,
  Clapperboard,
  Clock3,
  Download,
  Film,
  GalleryVerticalEnd,
  ImagePlus,
  Layers3,
  Link2,
  Loader2,
  Lock,
  Play,
  Plus,
  RefreshCw,
  Route,
  Scissors,
  Settings2,
  ShieldCheck,
  Sparkles,
  TimerReset,
  UploadCloud,
  WandSparkles,
  Workflow,
  Zap,
} from 'lucide-react';
import './App.css';

const HOME_ROUTE = '#/';
const CREATE_ROUTE = '#/create';
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '');

const durationOptions = [
  { label: '30秒', value: 30, scenes: 3 },
  { label: '1分钟', value: 60, scenes: 5 },
  { label: '3分钟', value: 180, scenes: 12 },
  { label: '5分钟', value: 300, scenes: 20 },
  { label: '10分钟', value: 600, scenes: 40 },
];

const styleOptions = ['电影感', '写实', '动漫', '商业广告', 'MV', '纪录片'];
const ratioOptions = ['16:9', '9:16', '1:1'];

const visualAssets = {
  heroConsole: new URL('./assets/gallery/hero-console.jpg', import.meta.url).href,
  workspacePreview: new URL('./assets/gallery/workspace-preview.jpg', import.meta.url).href,
  missionInfra: new URL('./assets/gallery/mission-infra.jpg', import.meta.url).href,
  missionTiming: new URL('./assets/gallery/mission-timing.jpg', import.meta.url).href,
  missionBelief: new URL('./assets/gallery/mission-belief.jpg', import.meta.url).href,
  painFragmented: new URL('./assets/gallery/pain-fragmented.jpg', import.meta.url).href,
  painContext: new URL('./assets/gallery/pain-context.jpg', import.meta.url).href,
  painCost: new URL('./assets/gallery/pain-cost.jpg', import.meta.url).href,
  valueStructure: new URL('./assets/gallery/value-structure.jpg', import.meta.url).href,
  valueContinuity: new URL('./assets/gallery/value-continuity.jpg', import.meta.url).href,
  valueAgent: new URL('./assets/gallery/value-agent.jpg', import.meta.url).href,
  valueDelivery: new URL('./assets/gallery/value-delivery.jpg', import.meta.url).href,
};

const teamVisuals = [
  visualAssets.missionInfra,
  visualAssets.missionTiming,
  visualAssets.missionBelief,
];

const painVisuals = [
  visualAssets.painFragmented,
  visualAssets.painContext,
  visualAssets.painCost,
];

const valueVisuals = [
  visualAssets.valueStructure,
  visualAssets.valueContinuity,
  visualAssets.valueAgent,
  visualAssets.valueDelivery,
];

const sceneVisuals = Array.from({ length: 12 }, (_, index) =>
  new URL(`./assets/gallery/scene-${String(index + 1).padStart(2, '0')}.jpg`, import.meta.url).href,
);

const agentStages = [
  '解析创意意图',
  '生成长视频结构',
  '拆分连续分镜',
  '统一角色与场景',
  '提交即梦任务',
  '合成最终成片',
];

const backendStatusToUiStatus = {
  idle: 'locked',
  waiting: 'queued',
  generating: 'active',
  completed: 'done',
  failed: 'failed',
};

const sampleProjects = [
  { title: '雨夜未来城预告片', time: '今天 13:20', duration: '3分钟', status: '已完成' },
  { title: '新品手机发布短片', time: '昨天 21:08', duration: '1分钟', status: '已完成' },
  { title: '森林咖啡馆开业片', time: '6月14日 10:31', duration: '30秒', status: '草稿' },
];

const defaultIdea =
  '一个未来城市里的少女在雨夜寻找失落的机器人伙伴，整体像电影预告片，情绪从孤独到希望。';

const introPainPoints = [
  {
    icon: TimerReset,
    title: '时长被切碎',
    text: '当创意延展到 3 到 10 分钟，用户不得不把完整叙事拆成几十个短片段，再逐段维持衔接。',
  },
  {
    icon: AlertTriangle,
    title: '语境难以承续',
    text: '每次提交任务都像重新开始，角色、场景、情绪与镜头语言很难自然延续。',
  },
  {
    icon: Scissors,
    title: '执行成本外溢',
    text: '分镜、提示词、参考图、重试、下载、拼接分散在不同环节，创作者的时间被流程消耗。',
  },
];

const introAdvantages = [
  {
    icon: Workflow,
    title: '从灵感到篇章',
    text: '把粗略点子扩展成完整结构，再按 15 秒以内的生成边界拆成连续分镜。',
  },
  {
    icon: Link2,
    title: '镜头前后相承',
    text: '自动维护角色、场景、光线、情绪和镜头语言，让每段画面都服务于同一条叙事线。',
  },
  {
    icon: Bot,
    title: '后台编排调度',
    text: '专门 agent 负责调用即梦 API、排队、重试与合成，用户只关注进度与成片。',
  },
  {
    icon: ShieldCheck,
    title: '十分钟长片交付',
    text: '面向故事短片、广告片、MV、课程预告、产品介绍等真正需要长内容的场景。',
  },
];

const compareRows = [
  ['长视频规划', '需要自己写剧本和分镜', '输入点子后自动生成结构和镜头'],
  ['上下文连续', '每段任务之间容易断裂', '自动传递前后镜头关系和提示词'],
  ['片段管理', '手动下载、命名、排序、拼接', '统一时间线查看状态与结果'],
  ['创作门槛', '需要懂提示词、镜头和剪辑', '普通用户也能提交想法生成成片'],
];

const introFlow = [
  { title: '落下灵感', text: '描述主题、情绪、人物与目标时长。' },
  { title: '确立视觉', text: '补充人物、场景、产品或风格参考。' },
  { title: '编排分镜', text: '生成连续镜头与每段即梦提示词。' },
  { title: '交付成片', text: '自动汇总片段，输出完整视频。' },
];

const teamHighlights = [
  {
    icon: Sparkles,
    title: '我们在做什么',
    text: '把 AI 视频生成从单次片段推进到完整成片，让创意、分镜、生成、重试和合成进入同一个工作流。',
  },
  {
    icon: Workflow,
    title: '为什么现在做',
    text: '短视频生成模型已经足够强，但真正的长内容交付仍缺少编排层、上下文层和生产管理层。',
  },
  {
    icon: Bot,
    title: '我们相信什么',
    text: '未来的视频创作不是一个提示词换一个片段，而是人负责判断，Agent 负责执行，系统负责交付。',
  },
];

const partnerNeeds = [
  '前端 / 全栈：继续打磨创作工作台与产品化体验',
  'AI 工程：构建分镜、提示词、任务调度与合成 Agent',
  '增长 / 商业：验证创作者、品牌方、教育机构等真实付费场景',
];

function IntroPage({ onStart }) {
  const [heroFade, setHeroFade] = useState(1);

  useEffect(() => {
    const revealItems = document.querySelectorAll('.reveal');

    if (!('IntersectionObserver' in window)) {
      revealItems.forEach((item) => item.classList.add('is-visible'));
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) entry.target.classList.add('is-visible');
        });
      },
      { threshold: 0.16 },
    );

    revealItems.forEach((item) => observer.observe(item));

    const handleScroll = () => {
      const nextFade = Math.max(0.38, 1 - window.scrollY / 680);
      setHeroFade(nextFade);
    };

    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  return (
    <main className="intro-shell">
      <div className="flow-field" aria-hidden="true">
        <span className="flow-line flow-line-a" />
        <span className="flow-line flow-line-b" />
        <span className="flow-line flow-line-c" />
        <span className="scan-grid" />
      </div>

      <nav className="intro-nav">
        <div className="brand-mark">
          <Film size={20} />
          <span>Dreamina Studio</span>
        </div>
        <div className="intro-nav-links">
          <a href="#mission">使命</a>
          <a href="#product">产品</a>
          <a href="#partners">合伙人</a>
        </div>
        <button className="ghost-button" onClick={onStart}>
          开始创作
          <ChevronRight size={16} />
        </button>
      </nav>

      <section className="intro-hero">
        <div
          className="intro-copy"
          style={{ '--hero-copy-opacity': heroFade, '--hero-copy-y': `${(1 - heroFade) * -30}px` }}
        >
          <div className="eyebrow">
            <Sparkles size={14} />
            AI 长视频创作团队
          </div>
          <h1>
            <span>把 15 秒片段</span>
            <span>编排成完整作品</span>
            <span>Dreamina Studio</span>
          </h1>
          <p>
            我们正在搭建 AI 视频时代的长视频创作中枢：让用户从一个想法出发，获得结构、分镜、提示词、生成队列和最终成片，而不是独自管理一堆割裂的短片段。
          </p>
          <div className="hero-actions">
            <button className="primary-button" onClick={onStart}>
              开始创作
              <ArrowRight size={18} />
            </button>
            <a className="secondary-link-button" href="#partners">
              寻找合伙人
              <ChevronRight size={16} />
            </a>
            <div className="hero-proof">
              <BadgeCheck size={16} />
              <span>从短片段生成走向长视频成片交付</span>
            </div>
          </div>
        </div>

        <div className="hero-console" aria-label="产品流程预览">
          <div className="console-topbar">
            <span />
            <span />
            <span />
            <strong>长片编排台</strong>
          </div>
          <div className="console-video">
            <img className="console-video-image" src={visualAssets.heroConsole} alt="" loading="lazy" />
            <div className="play-ring">
              <Play size={28} fill="currentColor" />
            </div>
            <div className="long-video-badge">
              <Zap size={14} />
              10 分钟长片编排
            </div>
            <div className="timeline-ruler">
              {Array.from({ length: 12 }).map((_, index) => (
                <span key={index} style={{ '--delay': `${index * 0.09}s` }} />
              ))}
            </div>
          </div>
          <div className="console-steps">
            {['创意解析', '分镜规划', '即梦生成', '合成输出'].map((item, index) => (
              <div className="console-step" key={item}>
                <span className={index < 3 ? 'active' : ''}>{index < 3 ? <Check size={13} /> : index + 1}</span>
                <p>{item}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="intro-metrics">
        <div>
          <strong>10分钟</strong>
          <span>从片段走向完整长片</span>
        </div>
        <div>
          <strong>40段</strong>
          <span>连续分镜自动编排</span>
        </div>
        <div>
          <strong>Agent</strong>
          <span>承接上下文与任务调度</span>
        </div>
      </section>

      <section className="intro-section team-section reveal" id="mission">
        <div className="section-kicker">
          <Sparkles size={16} />
          团队使命
        </div>
        <div className="team-layout">
          <div className="intro-section-head">
            <h2>我们想做 AI 视频时代的长视频创作基础设施。</h2>
            <p>
              Dreamina Studio 不是重新造一个视频模型，而是在强大的生成模型之上，补齐从想法到成片之间最难、最琐碎、也最有价值的编排层。
            </p>
          </div>
          <div className="team-card-stack">
            {teamHighlights.map((item, index) => {
              const Icon = item.icon;
              return (
                <article className="motion-card team-card" key={item.title}>
                  <div className="card-media">
                    <img src={teamVisuals[index]} alt="" loading="lazy" />
                  </div>
                  <Icon size={21} />
                  <h3>{item.title}</h3>
                  <p>{item.text}</p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="intro-section pain-section reveal">
        <div className="section-kicker">
          <AlertTriangle size={16} />
          长片创作的断点
        </div>
        <div className="intro-section-head">
          <h2>强大的模型，仍缺一条长片叙事链。</h2>
          <p>用户真正需要的是完整作品，而不是一组等待手动拼接的短素材。</p>
        </div>
        <div className="pain-grid">
          {introPainPoints.map((item, index) => {
            const Icon = item.icon;
            return (
              <article className={`motion-card pain-card pain-card-${index + 1}`} key={item.title}>
                <div className="card-media">
                  <img src={painVisuals[index]} alt="" loading="lazy" />
                </div>
                <Icon size={22} />
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="intro-section value-section reveal" id="product">
        <div className="section-kicker">
          <Route size={16} />
          长片生产线
        </div>
        <div className="intro-section-head">
          <h2>不是替代即梦，而是让即梦进入长片创作秩序。</h2>
          <p>
            Dreamina Studio 负责创意扩写、分镜拆解、上下文传递、任务调度与最终合成，让短片生成能力具备长片交付的工作流。
          </p>
        </div>
        <div className="value-grid">
          {introAdvantages.map((item, index) => {
            const Icon = item.icon;
            return (
              <article className={`motion-card value-card value-card-${index + 1}`} key={item.title}>
                <div className="card-media">
                  <img src={valueVisuals[index]} alt="" loading="lazy" />
                </div>
                <div className="card-icon">
                  <Icon size={21} />
                </div>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="intro-section partner-section reveal" id="partners">
        <div className="section-kicker">
          <Bot size={16} />
          合伙人招募
        </div>
        <div className="partner-layout">
          <div className="intro-section-head">
            <h2>寻找 2-3 位合伙人，一起把原型推到真实产品。</h2>
            <p>
              当前项目已经形成清晰定位、官网雏形和创作工作台原型。下一步需要一起完成 MVP、真实 API 工作流、用户验证和商业化探索。
            </p>
          </div>
          <div className="partner-panel">
            {partnerNeeds.map((item, index) => (
              <div className="partner-need" key={item}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <p>{item}</p>
              </div>
            ))}
            <button className="primary-button partner-cta" onClick={onStart}>
              先体验创作台
              <ArrowRight size={18} />
            </button>
          </div>
        </div>
      </section>

      <section className="intro-section compare-section reveal">
        <div className="section-kicker">
          <BadgeCheck size={16} />
          官网之外的长片能力
        </div>
        <div className="compare-layout">
          <div className="intro-section-head">
            <h2>即梦官网擅长片段生成，Dreamina Studio 面向成片交付。</h2>
            <p>
              当目标从 15 秒片段变成 3 到 10 分钟作品，难点不再只是生成，而是剧本结构、连续性、重试与剪辑管理。
            </p>
          </div>
          <div className="compare-table">
            <div className="compare-header">
              <span>能力</span>
              <span>即梦官网</span>
              <span>Dreamina Studio</span>
            </div>
            {compareRows.map(([feature, official, studio]) => (
              <div className="compare-row" key={feature}>
                <strong>{feature}</strong>
                <p>{official}</p>
                <p>{studio}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="intro-section flow-section reveal">
        <div className="section-kicker">
          <Workflow size={16} />
          创作路径
        </div>
        <div className="intro-section-head centered">
          <h2>保留人的审美判断，把繁琐执行交给系统。</h2>
          <p>从灵感到成片保持清晰链路，适合普通创作者，也适合需要稳定产出视频内容的团队。</p>
        </div>
        <div className="flow-steps">
          {introFlow.map((step, index) => (
            <article className={`flow-step flow-step-${index + 1}`} key={step.title}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="intro-final-cta reveal">
        <h2>让灵感越过 15 秒，抵达完整作品。</h2>
        <p>从下一次创作开始，让用户提交的是想法，收到的是一条结构完整的长视频。</p>
        <button className="primary-button" onClick={onStart}>
          开始创作
          <ArrowRight size={18} />
        </button>
      </section>
    </main>
  );
}

function StatusPill({ status }) {
  const statusMap = {
    done: '已完成',
    active: '生成中',
    queued: '等待中',
    locked: '待提交',
    failed: '失败',
  };

  return <span className={`status-pill ${status}`}>{statusMap[status]}</span>;
}

async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    throw new Error(errorBody?.detail || `API request failed: ${response.status}`);
  }

  return response.json();
}

function createScenes(duration, idea, style, projectId = 'demo') {
  const count = Math.min(Math.ceil(duration / 15), 40);
  const titles = [
    '开场氛围建立',
    '主角动机显现',
    '关键线索出现',
    '空间关系推进',
    '情绪转折',
    '动作段落展开',
    '冲突升级',
    '视觉高潮',
    '尾声与回响',
  ];

  return Array.from({ length: count }).map((_, index) => {
    const start = index * 15;
    const end = Math.min(start + 15, duration);
    const status = index < 2 ? 'done' : index === 2 ? 'active' : 'queued';

    return {
      id: `${projectId}-scene-${index + 1}`,
      number: String(index + 1).padStart(2, '0'),
      time: `${formatTime(start)} - ${formatTime(end)}`,
      title: titles[index % titles.length],
      status,
      progress: status === 'done' ? 100 : status === 'active' ? 64 : 0,
      prompt: `${style}，延续同一角色、场景光线和镜头语言：${idea}`,
    };
  });
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function Workspace({ onShowIntro }) {
  const timers = useRef([]);
  const imageUrls = useRef(new Set());
  const scenesRef = useRef([]);
  const [idea, setIdea] = useState(defaultIdea);
  const [duration, setDuration] = useState(180);
  const [style, setStyle] = useState('电影感');
  const [ratio, setRatio] = useState('16:9');
  const [images, setImages] = useState([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [stageIndex, setStageIndex] = useState(0);
  const [progress, setProgress] = useState(38);
  const [scenes, setScenes] = useState(() => createScenes(180, defaultIdea, '电影感'));
  const [apiStatus, setApiStatus] = useState('正在连接服务器...');
  const [apiError, setApiError] = useState('');
  const [finalVideoUrl, setFinalVideoUrl] = useState('');

  scenesRef.current = scenes;

  const selectedDuration = useMemo(
    () => durationOptions.find((item) => item.value === duration),
    [duration],
  );

  const completeCount = scenes.filter((scene) => scene.status === 'done').length;

  useEffect(() => {
    const activeImageUrls = imageUrls.current;
    let isMounted = true;

    apiRequest('/health')
      .then((health) => {
        if (isMounted) setApiStatus(`Agent Endpoint: ${health.status}`);
      })
      .catch((error) => {
        if (isMounted) {
          setApiStatus('Agent Endpoint: Offline');
          setApiError(error.message);
        }
      });

    return () => {
      isMounted = false;
      timers.current.forEach((timer) => clearInterval(timer));
      activeImageUrls.forEach((url) => URL.revokeObjectURL(url));
      activeImageUrls.clear();
    };
  }, []);

  function handleImageUpload(event) {
    const files = Array.from(event.target.files || []);
    const nextImages = files.slice(0, 6).map((file) => ({
      id: `${file.name}-${file.lastModified}`,
      name: file.name,
      url: URL.createObjectURL(file),
    }));

    nextImages.forEach((image) => imageUrls.current.add(image.url));

    setImages((current) => {
      const allImages = [...current, ...nextImages];
      const visibleImages = allImages.slice(0, 6);
      allImages.slice(6).forEach((image) => {
        URL.revokeObjectURL(image.url);
        imageUrls.current.delete(image.url);
      });
      return visibleImages;
    });

    event.target.value = '';
  }

  async function handleSubmit() {
    timers.current.forEach((timer) => clearInterval(timer));
    timers.current = [];

    const projectId = `project-${Date.now()}`;
    const nextScenes = createScenes(duration, idea, style, projectId).map((scene) => ({
      ...scene,
      status: 'queued',
      progress: 0,
    }));

    scenesRef.current = nextScenes;
    setScenes(nextScenes);
    setIsGenerating(true);
    setStageIndex(0);
    setProgress(6);
    setApiError('');
    setFinalVideoUrl('');

    const stageTimer = setInterval(() => {
      setStageIndex((current) => Math.min(current + 1, agentStages.length - 1));
      setProgress((current) => Math.min(current + 15, 96));
    }, 1400);

    try {
      await Promise.all(
        nextScenes.map((scene) =>
          apiRequest(`/generate/${encodeURIComponent(scene.id)}`, {
            method: 'POST',
            body: JSON.stringify({
              id: scene.id,
              prompt: scene.prompt,
              duration: Math.min(duration, 15),
              engine: 'jimeng',
              status: 'idle',
              progress: 0,
              characterIds: [],
              caption: `${scene.title} / ${ratio}`,
            }),
          }),
        ),
      );

      const pollTimer = setInterval(async () => {
        try {
          const serverShots = await apiRequest('/shots');
          const shotMap = new Map(serverShots.map((shot) => [shot.id, shot]));
          const syncedScenes = scenesRef.current.map((scene) => {
            const shot = shotMap.get(scene.id);
            if (!shot) return scene;

            return {
              ...scene,
              status: backendStatusToUiStatus[shot.status] || scene.status,
              progress: shot.progress ?? scene.progress,
              videoUrl: shot.videoUrl || scene.videoUrl,
              error: shot.error || '',
            };
          });
          const progressSum = syncedScenes.reduce((sum, scene) => sum + scene.progress, 0);
          const nextProgress = Math.round(progressSum / Math.max(syncedScenes.length, 1));
          const isFinished = syncedScenes.every((scene) => ['done', 'failed'].includes(scene.status));

          scenesRef.current = syncedScenes;
          setScenes(syncedScenes);
          setProgress(nextProgress);

          if (isFinished) {
            clearInterval(pollTimer);
            clearInterval(stageTimer);
            setStageIndex(agentStages.length - 1);
            setIsGenerating(false);

            const latestScenes = await apiRequest('/shots');
            const completedShotIds = nextScenes
              .filter((scene) => latestScenes.some((shot) => shot.id === scene.id && shot.status === 'completed'))
              .map((scene) => scene.id);

            if (completedShotIds.length > 0) {
              const compiledVideo = await apiRequest('/compile', {
                method: 'POST',
                body: JSON.stringify({
                  shotIds: completedShotIds,
                  totalDuration: duration,
                  bgm: 'lofi',
                  bgmVolume: 30,
                  voiceVolume: 80,
                }),
              });
              setFinalVideoUrl(compiledVideo.video_url);
              setProgress(100);
            }
          }
        } catch (error) {
          clearInterval(pollTimer);
          clearInterval(stageTimer);
          setApiError(error.message);
          setIsGenerating(false);
        }
      });

      timers.current = [stageTimer, pollTimer];
    } catch (error) {
      clearInterval(stageTimer);
      setApiError(error.message);
      setIsGenerating(false);
      setScenes(nextScenes.map((scene) => ({ ...scene, status: 'failed', error: error.message })));
    }
  }

  return (
    <div className="workspace-shell">
      <header className="app-header">
        <div className="brand-mark">
          <Film size={20} />
          <span>Dreamina Studio</span>
        </div>
        <div className="header-actions">
          <button className="icon-text-button" onClick={onShowIntro}>
            <Sparkles size={16} />
            团队官网
          </button>
          <button className="icon-button" title="新建项目">
            <Plus size={18} />
          </button>
          <button className="icon-button" title="设置">
            <Settings2 size={18} />
          </button>
        </div>
      </header>

      <main className="workspace-grid">
        <aside className="history-rail">
          <div className="rail-section">
            <p className="rail-label">项目</p>
            <button className="rail-primary">
              <WandSparkles size={16} />
              新创作
            </button>
          </div>

          <div className="rail-section">
            <p className="rail-label">历史</p>
            <div className="project-list">
              {sampleProjects.map((project) => (
                <button className="project-item" key={project.title}>
                  <span>
                    <strong>{project.title}</strong>
                    <small>{project.time} / {project.duration}</small>
                  </span>
                  <em>{project.status}</em>
                </button>
              ))}
            </div>
          </div>
        </aside>

        <section className="creation-panel">
          <div className="section-heading">
            <span>
              <Clapperboard size={18} />
              创作台
            </span>
            <small>{apiStatus}</small>
          </div>

          <label className="idea-composer">
            <span>视频想法</span>
            <textarea
              value={idea}
              onChange={(event) => setIdea(event.target.value)}
              placeholder="描述你想制作的视频，可以很粗略。"
            />
          </label>

          <div className="upload-strip">
            <label className="upload-drop">
              <input type="file" accept="image/*" multiple onChange={handleImageUpload} />
              <UploadCloud size={20} />
              <span>上传参考图片</span>
            </label>
            <div className="image-preview-row">
              {images.length === 0 ? (
                <div className="empty-image-slot">
                  <ImagePlus size={19} />
                  <span>人物 / 场景 / 风格</span>
                </div>
              ) : (
                images.map((image) => (
                  <img src={image.url} alt={image.name} key={image.id} />
                ))
              )}
            </div>
          </div>

          <div className="control-group">
            <div className="control-head">
              <Clock3 size={16} />
              <span>目标时长</span>
            </div>
            <div className="segmented-control duration-control">
              {durationOptions.map((option) => (
                <button
                  className={duration === option.value ? 'selected' : ''}
                  key={option.value}
                  onClick={() => setDuration(option.value)}
                >
                  <strong>{option.label}</strong>
                  <small>{option.scenes}段</small>
                </button>
              ))}
            </div>
          </div>

          <div className="control-split">
            <div className="control-group">
              <div className="control-head">
                <GalleryVerticalEnd size={16} />
                <span>视觉风格</span>
              </div>
              <div className="segmented-control wrap">
                {styleOptions.map((option) => (
                  <button
                    className={style === option ? 'selected' : ''}
                    key={option}
                    onClick={() => setStyle(option)}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>

            <div className="control-group">
              <div className="control-head">
                <Layers3 size={16} />
                <span>画幅</span>
              </div>
              <div className="segmented-control wrap">
                {ratioOptions.map((option) => (
                  <button
                    className={ratio === option ? 'selected' : ''}
                    key={option}
                    onClick={() => setRatio(option)}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="advanced-row">
            <div>
              <Lock size={15} />
              <span>角色一致性强</span>
            </div>
            <div>
              <RefreshCw size={15} />
              <span>自动转场</span>
            </div>
            <div>
              <Bot size={15} />
              <span>Agent 规划</span>
            </div>
          </div>

          <button className="submit-button" onClick={handleSubmit} disabled={!idea.trim()}>
            {isGenerating ? <Loader2 className="spin" size={18} /> : <WandSparkles size={18} />}
            {isGenerating ? '生成中' : '开始生成'}
          </button>
          {apiError ? (
            <div className="api-error">
              <AlertTriangle size={15} />
              <span>{apiError}</span>
            </div>
          ) : null}
        </section>

        <section className="director-panel">
          <div className="preview-panel">
            <div className="section-heading">
              <span>
                <Play size={18} />
                成片预览
              </span>
              <small>{ratio} / {selectedDuration?.label}</small>
            </div>
            <div className="video-preview">
              {finalVideoUrl ? (
                <video className="preview-image preview-video" src={finalVideoUrl} controls playsInline />
              ) : (
                <img className="preview-image" src={visualAssets.workspacePreview} alt="" loading="lazy" />
              )}
              <div className="video-shine" />
              <button className="play-ring compact" title="播放预览">
                <Play size={22} fill="currentColor" />
              </button>
              <div className="preview-caption">
                <strong>{finalVideoUrl ? '服务器已合成预览' : isGenerating ? '片段生成中' : '等待最新任务'}</strong>
                <span>{completeCount}/{scenes.length} 段完成</span>
              </div>
            </div>
            <div className="export-row">
              <button onClick={() => finalVideoUrl && window.open(finalVideoUrl, '_blank')} disabled={!finalVideoUrl}>
                <Download size={16} />
                下载 MP4
              </button>
              <button>
                <Clapperboard size={16} />
                分镜脚本
              </button>
            </div>
          </div>

          <div className="progress-panel">
            <div className="section-heading">
              <span>
                <Bot size={18} />
                后台进度
              </span>
              <small>{progress}%</small>
            </div>
            <div className="progress-track">
              <span style={{ width: `${progress}%` }} />
            </div>
            <div className="stage-list">
              {agentStages.map((stage, index) => (
                <div
                  className={`stage-item ${index < stageIndex ? 'done' : ''} ${index === stageIndex ? 'active' : ''}`}
                  key={stage}
                >
                  <span>{index < stageIndex ? <Check size={12} /> : index + 1}</span>
                  <p>{stage}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <section className="timeline-panel">
        <div className="section-heading">
          <span>
            <Film size={18} />
            分镜时间线
          </span>
          <small>每段最长 15 秒，共 {scenes.length} 段</small>
        </div>
        <div className="scene-list">
          {scenes.map((scene, index) => (
            <article className="scene-card" key={scene.id}>
              <img
                className="scene-card-image"
                src={sceneVisuals[index % sceneVisuals.length]}
                alt=""
                loading="lazy"
              />
              <div className="scene-index">{scene.number}</div>
              <div className="scene-main">
                <div className="scene-title-row">
                  <strong>{scene.title}</strong>
                  <StatusPill status={scene.status} />
                </div>
                <p>{scene.prompt}</p>
                {scene.error ? <small className="scene-error">{scene.error}</small> : null}
                <div className="mini-progress">
                  <span style={{ width: `${scene.progress}%` }} />
                </div>
              </div>
              <div className="scene-time">{scene.time}</div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

export default function App() {
  const [page, setPage] = useState(() => {
    if (typeof window === 'undefined') return 'home';
    return window.location.hash === CREATE_ROUTE ? 'create' : 'home';
  });

  useEffect(() => {
    const handleHashChange = () => {
      setPage(window.location.hash === CREATE_ROUTE ? 'create' : 'home');
      window.requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0 }));
    };

    window.addEventListener('hashchange', handleHashChange);
    if (!window.location.hash) window.history.replaceState(null, '', HOME_ROUTE);

    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  function enterWorkspace() {
    window.location.hash = CREATE_ROUTE;
    setPage('create');
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0 }));
  }

  function showIntroAgain() {
    window.location.hash = HOME_ROUTE;
    setPage('home');
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0 }));
  }

  return page === 'create' ? (
    <Workspace onShowIntro={showIntroAgain} />
  ) : (
    <IntroPage onStart={enterWorkspace} />
  );
}

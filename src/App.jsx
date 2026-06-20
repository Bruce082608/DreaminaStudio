import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  BarChart3,
  Bot,
  CalendarClock,
  Check,
  ChevronRight,
  Clapperboard,
  Clock3,
  Coins,
  CreditCard,
  Download,
  Film,
  FileText,
  GalleryVerticalEnd,
  ImagePlus,
  Layers3,
  Link2,
  Loader2,
  Lock,
  LogIn,
  LogOut,
  Mail,
  Play,
  Plus,
  RefreshCw,
  Route,
  Scissors,
  Settings2,
  Shield,
  ShieldCheck,
  Sparkles,
  TimerReset,
  UploadCloud,
  User,
  UserPlus,
  Users,
  WandSparkles,
  Workflow,
  Zap,
} from 'lucide-react';
import CreditConsole from './components/CreditConsole';
import {
  calculateCreditCost,
  durationOptions,
  getJimengModelOption,
  jimengCliDocs,
  jimengModelOptions,
  ratioOptions,
  segmentDurationOptions,
  styleOptions,
} from './config/creation';
import {
  compactSubmitId,
  formatDate,
  formatJimengVip,
  formatNumber,
  getJimengTaskBenefit,
  getJimengTaskCredit,
  getJimengTaskStatusMeta,
  getJimengTaskVideoMeta,
} from './utils/formatters';
import './App.css';

const HOME_ROUTE = '#/';
const CREATE_ROUTE = '#/create';
const LOGIN_ROUTE = '#/login';
const REGISTER_ROUTE = '#/register';
const ADMIN_ROUTE = '#/admin';
const AUTH_STORAGE_KEY = 'dreamina_studio_auth';
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '');

function getPageFromHash() {
  if (typeof window === 'undefined') return 'home';

  const routeMap = {
    [CREATE_ROUTE]: 'create',
    [LOGIN_ROUTE]: 'login',
    [REGISTER_ROUTE]: 'register',
    [ADMIN_ROUTE]: 'admin',
  };

  return routeMap[window.location.hash] || 'home';
}

function goTo(route) {
  window.location.hash = route;
  window.requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0 }));
}

function readStoredAuth() {
  if (typeof window === 'undefined') return null;

  try {
    return JSON.parse(window.localStorage.getItem(AUTH_STORAGE_KEY));
  } catch {
    return null;
  }
}

function BrandLogo() {
  return <img className="brand-logo-image" src="/dreamina-logo.png" alt="" />;
}

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
  '提交创意与参考图',
  '生成分镜剧本',
  '查看并编辑分镜',
  '即梦 CLI 串行生成',
  '返回视频片段结果',
];

const agentStageLabels = {
  queued: '任务已进入队列',
  deepseek_planning: '正在规划分镜',
  storyboard_planning: '正在规划分镜',
  local_planning: '正在规划分镜',
  awaiting_confirmation: '分镜剧本等待确认',
  jimeng_dispatch: '正在提交视频生成任务',
  jimeng_generating: '即梦 CLI 正在逐段生成',
  completed: '视频片段已全部返回',
  failed: '任务处理失败',
};

const agentStageIndexes = {
  queued: 0,
  deepseek_planning: 1,
  storyboard_planning: 1,
  local_planning: 1,
  awaiting_confirmation: 2,
  jimeng_dispatch: 3,
  jimeng_generating: 3,
  completed: 4,
};

const AGENT_POLL_INTERVAL = 1200;

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
          <BrandLogo />
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
  const { authToken, ...fetchOptions } = options;
  const isFormData = fetchOptions.body instanceof FormData;
  const headers = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...fetchOptions.headers,
  };

  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...fetchOptions,
    headers,
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    throw new Error(errorBody?.detail || `API request failed: ${response.status}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

function AuthPage({ mode, onAuthSuccess, onSwitchMode, onShowHome }) {
  const isRegister = mode === 'register';
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(event) {
    event.preventDefault();
    setIsSubmitting(true);
    setError('');

    try {
      const payload = isRegister ? { name, email, password } : { email, password };
      const result = await apiRequest(isRegister ? '/auth/register' : '/auth/login', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      onAuthSuccess(result);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-shell">
      <div className="flow-field" aria-hidden="true">
        <span className="flow-line flow-line-a" />
        <span className="scan-grid" />
      </div>

      <nav className="intro-nav auth-nav">
        <button className="brand-mark brand-button" onClick={onShowHome}>
          <BrandLogo />
          <span>Dreamina Studio</span>
        </button>
        <button className="ghost-button" onClick={onSwitchMode}>
          {isRegister ? <LogIn size={16} /> : <UserPlus size={16} />}
          {isRegister ? '已有账号，去登录' : '注册新账号'}
        </button>
      </nav>

      <section className="auth-layout">
        <div className="auth-copy">
          <div className="eyebrow">
            <ShieldCheck size={14} />
            创作身份系统
          </div>
          <h1>{isRegister ? '加入 Dreamina Studio 创作台' : '欢迎回到创作中枢'}</h1>
          <p>
            登录后即可进入 AI 长视频创作台。新用户注册赠送 15 积分，可用于提交真实视频生成任务。
          </p>
          <div className="auth-proof-grid">
            <div>
              <Coins size={18} />
              <span>注册赠送积分</span>
            </div>
            <div>
              <CreditCard size={18} />
              <span>按需充值创作</span>
            </div>
            <div>
              <Lock size={18} />
              <span>密码哈希存储</span>
            </div>
          </div>
        </div>

        <form className="auth-card" onSubmit={handleSubmit}>
          <div className="auth-card-head">
            <span>{isRegister ? <UserPlus size={20} /> : <LogIn size={20} />}</span>
            <div>
              <h2>{isRegister ? '创建账号' : '登录账号'}</h2>
              <p>{isRegister ? '用于保存后续创作记录与权益' : '进入创作台或管理员后台'}</p>
            </div>
          </div>

          {isRegister ? (
            <label className="auth-field">
              <span>姓名 / 昵称</span>
              <div>
                <User size={17} />
                <input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：Bruce" />
              </div>
            </label>
          ) : null}

          <label className="auth-field">
            <span>邮箱</span>
            <div>
              <Mail size={17} />
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
              />
            </div>
          </label>

          <label className="auth-field">
            <span>密码</span>
            <div>
              <Lock size={17} />
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="至少 8 位"
              />
            </div>
          </label>

          {error ? (
            <div className="api-error">
              <AlertTriangle size={15} />
              <span>{error}</span>
            </div>
          ) : null}

          <button className="submit-button" disabled={isSubmitting || !email.trim() || !password.trim()}>
            {isSubmitting ? <Loader2 className="spin" size={18} /> : isRegister ? <UserPlus size={18} /> : <LogIn size={18} />}
            {isSubmitting ? '处理中...' : isRegister ? '注册并进入创作台' : '登录'}
          </button>

          <button className="auth-switch" type="button" onClick={onSwitchMode}>
            {isRegister ? '已有账号？立即登录' : '还没有账号？现在注册'}
          </button>
        </form>
      </section>
    </main>
  );
}

function AdminPage({ auth, onShowIntro, onShowCreate, onLogout }) {
  const [activeAdminView, setActiveAdminView] = useState('overview');
  const [users, setUsers] = useState([]);
  const [stats, setStats] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [agentConfig, setAgentConfig] = useState(null);
  const [agentStatus, setAgentStatus] = useState(null);
  const [jimengAccount, setJimengAccount] = useState(null);
  const [agentForm, setAgentForm] = useState({
    deepseekBaseUrl: 'https://api.deepseek.com',
    deepseekModel: 'deepseek-v4-flash',
    deepseekApiKey: '',
    jimengMode: 'cli',
    jimengApiUrl: '',
    jimengModel: 'seedance2.0fast',
    jimengRegion: 'cn',
  });
  const [agentMessage, setAgentMessage] = useState('');

  useEffect(() => {
    let isMounted = true;

    async function loadAdminData() {
      try {
        const [nextStats, nextUsers, nextConfig, nextAgentStatus, nextJimengAccount] = await Promise.all([
          apiRequest('/admin/stats', { authToken: auth?.token }),
          apiRequest('/admin/users', { authToken: auth?.token }),
          apiRequest('/admin/agent/config', { authToken: auth?.token }),
          apiRequest('/admin/agent/status', { authToken: auth?.token }),
          apiRequest('/admin/jimeng/account?limit=10', { authToken: auth?.token }),
        ]);

        if (isMounted) {
          setStats(nextStats);
          setUsers(nextUsers);
          setAgentConfig(nextConfig);
          setAgentStatus(nextAgentStatus);
          setJimengAccount(nextJimengAccount);
          setAgentForm({
            deepseekBaseUrl: nextConfig.deepseekBaseUrl,
            deepseekModel: nextConfig.deepseekModel,
            deepseekApiKey: '',
            jimengMode: nextConfig.jimengMode,
            jimengApiUrl: nextConfig.jimengApiUrl || '',
            jimengModel: nextConfig.jimengModel,
            jimengRegion: nextConfig.jimengRegion,
          });
          setError('');
        }
      } catch (requestError) {
        if (isMounted) setError(requestError.message);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    loadAdminData();
    return () => {
      isMounted = false;
    };
  }, [auth?.token]);

  async function handleAgentConfigSubmit(event) {
    event.preventDefault();
    setAgentMessage('正在保存服务配置...');
    setError('');

    try {
      const savedConfig = await apiRequest('/admin/agent/config', {
        method: 'PUT',
        authToken: auth?.token,
        body: JSON.stringify(agentForm),
      });
      const [nextAgentStatus, nextJimengAccount] = await Promise.all([
        apiRequest('/admin/agent/status', { authToken: auth?.token }),
        apiRequest('/admin/jimeng/account?limit=10', { authToken: auth?.token }),
      ]);
      setAgentConfig(savedConfig);
      setAgentStatus(nextAgentStatus);
      setJimengAccount(nextJimengAccount);
      setAgentForm((current) => ({ ...current, deepseekApiKey: '' }));
      setAgentMessage('服务配置已保存');
    } catch (requestError) {
      setAgentMessage('');
      setError(requestError.message);
    }
  }

  function updateAgentForm(field, value) {
    setAgentForm((current) => ({ ...current, [field]: value }));
  }

  function switchAdminView(view) {
    setActiveAdminView(view);
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0 }));
  }

  async function refreshAdminData() {
    setIsLoading(true);
    setError('');

    try {
      const [nextStats, nextUsers, nextConfig, nextAgentStatus, nextJimengAccount] = await Promise.all([
        apiRequest('/admin/stats', { authToken: auth?.token }),
        apiRequest('/admin/users', { authToken: auth?.token }),
        apiRequest('/admin/agent/config', { authToken: auth?.token }),
        apiRequest('/admin/agent/status', { authToken: auth?.token }),
        apiRequest('/admin/jimeng/account?limit=10', { authToken: auth?.token }),
      ]);

      setStats(nextStats);
      setUsers(nextUsers);
      setAgentConfig(nextConfig);
      setAgentStatus(nextAgentStatus);
      setJimengAccount(nextJimengAccount);
      setAgentForm((current) => ({
        ...current,
        deepseekBaseUrl: nextConfig.deepseekBaseUrl,
        deepseekModel: nextConfig.deepseekModel,
        jimengMode: nextConfig.jimengMode,
        jimengApiUrl: nextConfig.jimengApiUrl || '',
        jimengModel: nextConfig.jimengModel,
        jimengRegion: nextConfig.jimengRegion,
      }));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setIsLoading(false);
    }
  }

  if (!auth?.user || auth.user.role !== 'admin') {
    return (
      <main className="admin-shell">
        <div className="empty-admin-state">
          <Shield size={36} />
          <h1>需要管理员权限</h1>
          <p>请使用管理员账号登录后再进入后台管理页面。</p>
          <button className="primary-button" onClick={() => goTo(LOGIN_ROUTE)}>
            去登录
            <ArrowRight size={18} />
          </button>
        </div>
      </main>
    );
  }

  const jimengAccountInfo = jimengAccount?.account || {};
  const jimengSummary = jimengAccount?.summary || {};
  const recentJimengTasks = Array.isArray(jimengAccount?.tasks) ? jimengAccount.tasks : [];

  const statCards = [
    { label: '注册用户', value: stats?.totalUsers ?? '-', icon: Users },
    { label: '活跃账号', value: stats?.activeUsers ?? '-', icon: BadgeCheck },
    { label: '7 日登录', value: stats?.recentLogins ?? '-', icon: CalendarClock },
    { label: '分镜任务', value: stats?.generatedShots ?? '-', icon: Clapperboard },
    { label: '创作任务', value: stats?.agentRuns ?? '-', icon: Bot },
    { label: '用户积分', value: formatNumber(stats?.userCreditBalance ?? 0), icon: Coins },
    { label: '充值收入', value: `${formatNumber(stats?.rechargeRevenueCny ?? 0)}元`, icon: CreditCard },
    { label: '运行中', value: stats?.activeAgentRuns ?? '-', icon: Loader2 },
    { label: '失败任务', value: stats?.failedAgentRuns ?? '-', icon: AlertTriangle },
    { label: '队列长度', value: stats?.queueSize ?? '-', icon: Workflow },
  ];

  const adminInsights = [
    {
      label: '分镜服务状态',
      value: agentConfig?.deepseekApiKeySet ? '已接入' : '待配置',
      text: agentConfig?.deepseekApiKeySet ? '分镜服务密钥已保存，可直接处理创作任务。' : '配置 API Key 后可开启真实创作流程。',
      icon: ShieldCheck,
    },
    {
      label: '当前队列',
      value: `${agentStatus?.queueSize ?? 0}`,
      text: `${agentStatus?.runningRuns ?? 0} 个任务运行中，${agentStatus?.failedRuns ?? 0} 个任务失败。`,
      icon: Workflow,
    },
    {
      label: '即梦账号',
      value: formatNumber(jimengAccountInfo.total_credit, '未登录'),
      text: `${formatJimengVip(jimengAccountInfo.vip_level)}，近期 ${jimengSummary.totalTasks ?? 0} 条调用记录。`,
      icon: Clapperboard,
    },
    {
      label: '用户规模',
      value: `${stats?.activeUsers ?? 0}/${stats?.totalUsers ?? 0}`,
      text: `站内积分余额 ${formatNumber(stats?.userCreditBalance ?? 0)}，累计充值 ${formatNumber(stats?.rechargeRevenueCny ?? 0)} 元。`,
      icon: Users,
    },
  ];

  const adminMenuItems = [
    { id: 'overview', label: '运营概览', icon: BarChart3, description: '用户、创作任务与服务状态' },
    { id: 'agent', label: '服务配置', icon: Bot, description: '分镜服务、即梦模式与最近运行' },
    { id: 'jimeng', label: '即梦账号', icon: Clapperboard, description: '会员、积分与调用明细' },
    { id: 'jimengDocs', label: 'CLI 文档', icon: FileText, description: '官方命令要点与注意事项' },
    { id: 'users', label: '用户管理', icon: Users, description: '账号、角色与登录状态' },
    { id: 'system', label: '系统配置', icon: Settings2, description: '服务状态与后台参数' },
  ];
  const activeAdminMeta = adminMenuItems.find((item) => item.id === activeAdminView) || adminMenuItems[0];

  return (
    <main className="admin-shell admin-dashboard-shell">
      <aside className="admin-sidebar">
        <button className="brand-mark brand-button" onClick={onShowIntro}>
          <BrandLogo />
          <span>Dreamina Studio</span>
        </button>
        <nav className="admin-menu" aria-label="后台功能目录">
          {adminMenuItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                className={activeAdminView === item.id ? 'active' : ''}
                key={item.id}
                type="button"
                onClick={() => switchAdminView(item.id)}
              >
                <Icon size={17} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="header-actions">
          <button className="icon-text-button" onClick={onShowCreate}>
            <WandSparkles size={16} />
            创作台
          </button>
          <button className="icon-text-button danger" onClick={onLogout}>
            <LogOut size={16} />
            退出
          </button>
        </div>
      </aside>

      <section className="admin-main">
        <div className="admin-topbar">
          <div>
            <strong>{activeAdminMeta.label}</strong>
            <span>{activeAdminMeta.description}</span>
          </div>
          <div className="admin-topbar-actions">
            <button className="ghost-button" onClick={refreshAdminData} disabled={isLoading}>
              {isLoading ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />}
              同步数据
            </button>
            <button className="ghost-button" onClick={onShowIntro}>
              <Sparkles size={16} />
              团队官网
            </button>
          </div>
        </div>

        <div className="admin-content">
          {activeAdminView === 'overview' ? (
            <>
              <section className="admin-hero">
                <div>
                  <div className="eyebrow">
                    <ShieldCheck size={14} />
                    管理员后台
                  </div>
                  <h1>用户情况与运营概览</h1>
                  <p>查看注册用户、最近登录、账号角色和当前创作任务情况，后续可继续扩展权限、订单和项目管理。</p>
                  <div className="admin-hero-actions">
                    <button className="primary-button" onClick={onShowCreate}>
                      <WandSparkles size={18} />
                      进入创作台
                    </button>
                    <button className="secondary-link-button" type="button" onClick={() => switchAdminView('agent')}>
                      服务配置
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </div>
                <div className="admin-user-chip">
                  <span>{auth.user.name.slice(0, 1).toUpperCase()}</span>
                  <div>
                    <strong>{auth.user.name}</strong>
                    <small>{auth.user.email}</small>
                  </div>
                </div>
              </section>

              <section className="admin-insight-grid">
                {adminInsights.map((item) => {
                  const Icon = item.icon;
                  return (
                    <article className="admin-insight-card" key={item.label}>
                      <span>
                        <Icon size={17} />
                        {item.label}
                      </span>
                      <strong>{item.value}</strong>
                      <p>{item.text}</p>
                    </article>
                  );
                })}
              </section>

              <section className="admin-stat-grid">
                {statCards.map((card, index) => {
                  const Icon = card.icon;
                  return (
                    <article className={`admin-stat-card admin-stat-card-${index + 1}`} key={card.label}>
                      <Icon size={20} />
                      <strong>{card.value}</strong>
                      <span>{card.label}</span>
                    </article>
                  );
                })}
              </section>
            </>
          ) : null}

          {activeAdminView === 'agent' ? (
            <section className="admin-panel agent-admin-panel">
              <div className="section-heading">
                <span>
                  <Bot size={18} />
                  服务配置
                </span>
                <small>
                  {agentConfig?.deepseekApiKeySet ? '分镜服务已配置' : '等待配置分镜服务 API Key'}
                </small>
              </div>

              <div className="agent-console-grid">
                <form className="agent-config-form" onSubmit={handleAgentConfigSubmit}>
                <label className="auth-field">
                  <span>分镜服务 Base URL</span>
                  <div>
                    <Link2 size={17} />
                    <input
                      type="password"
                      value={agentForm.deepseekBaseUrl}
                      onChange={(event) => updateAgentForm('deepseekBaseUrl', event.target.value)}
                      placeholder="留空则保持当前服务地址"
                    />
                  </div>
                </label>

                <label className="auth-field">
                  <span>分镜服务模型</span>
                  <div>
                    <Bot size={17} />
                    <input
                      type="password"
                      value={agentForm.deepseekModel}
                      onChange={(event) => updateAgentForm('deepseekModel', event.target.value)}
                      placeholder="留空则保持当前模型"
                    />
                  </div>
                </label>

                <label className="auth-field">
                  <span>分镜服务 API Key</span>
                  <div>
                    <Lock size={17} />
                    <input
                      type="password"
                      value={agentForm.deepseekApiKey}
                      onChange={(event) => updateAgentForm('deepseekApiKey', event.target.value)}
                      placeholder={agentConfig?.deepseekApiKeySet ? '留空则保持当前密钥' : '请输入管理员 API Key'}
                    />
                  </div>
                </label>

                <label className="auth-field">
                  <span>即梦接入模式</span>
                  <div>
                    <Clapperboard size={17} />
                    <select
                      value={agentForm.jimengMode}
                      onChange={(event) => updateAgentForm('jimengMode', event.target.value)}
                    >
                      <option value="cli">内置 CLI</option>
                      <option value="mock">本地测试</option>
                    </select>
                  </div>
                </label>

                <label className="auth-field">
                  <span>默认视频模型</span>
                  <div>
                    <Route size={17} />
                    <select
                      value={agentForm.jimengModel}
                      onChange={(event) => updateAgentForm('jimengModel', event.target.value)}
                    >
                      {jimengModelOptions.map((option) => (
                        <option value={option.value} key={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </div>
                </label>

                <label className="auth-field">
                  <span>即梦区域</span>
                  <div>
                    <Route size={17} />
                    <select
                      value={agentForm.jimengRegion}
                      onChange={(event) => updateAgentForm('jimengRegion', event.target.value)}
                    >
                      <option value="cn">中国大陆</option>
                      <option value="sg">新加坡</option>
                      <option value="hk">中国香港</option>
                      <option value="us">美国</option>
                      <option value="jp">日本</option>
                    </select>
                  </div>
                </label>

                <button className="submit-button">
                  <ShieldCheck size={18} />
                  保存服务配置
                </button>
                {agentMessage ? <p className="agent-message">{agentMessage}</p> : null}
              </form>

              <div className="agent-status-panel">
                <div className="agent-status-grid">
                  <div className="agent-status-card">
                    <span>分镜服务</span>
                    <strong>{agentStatus?.config?.deepseekApiKeySet ? '已配置' : '待配置'}</strong>
                    <small>{agentStatus?.config?.deepseekApiKeySet ? 'API Key 已保存' : '未配置 API Key'}</small>
                  </div>
                  <div className="agent-status-card">
                    <span>即梦 CLI</span>
                    <strong>{agentStatus?.config?.jimengCliAvailable ? '已内置' : '不可用'}</strong>
                    <small>默认模型：{getJimengModelOption(agentStatus?.config?.jimengModel).shortLabel}</small>
                  </div>
                  <div className="agent-status-card">
                    <span>运行中任务</span>
                    <strong>{agentStatus?.runningRuns ?? 0}</strong>
                    <small>{agentStatus?.failedRuns ?? 0} 个失败任务</small>
                  </div>
                </div>

                <div className="agent-run-list">
                  <div className="agent-run-list-head">
                    <strong>最近运行</strong>
                    <small>{(agentStatus?.recentRuns || []).length} 条记录</small>
                  </div>
                  {(agentStatus?.recentRuns || []).length === 0 ? (
                    <p>还没有创作运行记录。</p>
                  ) : (
                    agentStatus.recentRuns.map((run) => (
                      <article className="agent-run-item" key={run.id}>
                        <div>
                          <strong>{run.idea}</strong>
                          <small>{run.userEmail} / {getJimengModelOption(run.jimengModel).shortLabel}</small>
                        </div>
                        <span className={`status-pill ${run.status === 'failed' ? 'failed' : run.status === 'completed' ? 'done' : 'active'}`}>
                          {run.status}
                        </span>
                      </article>
                    ))
                  )}
                </div>
              </div>
              </div>
            </section>
          ) : null}

          {activeAdminView === 'jimeng' ? (
            <section className="admin-panel jimeng-admin-panel">
              <div className="section-heading">
                <span>
                  <Clapperboard size={18} />
                  即梦账号
                </span>
                <small>{jimengAccount?.cli?.officialCliAvailable ? '官方 dreamina CLI 已连接' : '等待 CLI 登录'}</small>
              </div>

              {jimengAccount?.error ? (
                <div className="api-error">
                  <AlertTriangle size={15} />
                  <span>{jimengAccount.error}</span>
                </div>
              ) : null}

              <div className="jimeng-account-grid">
                <article className="jimeng-account-tile primary">
                  <span>
                    <Zap size={17} />
                    剩余积分
                  </span>
                  <strong>{formatNumber(jimengAccountInfo.total_credit)}</strong>
                  <small>来自 dreamina user_credit</small>
                </article>
                <article className="jimeng-account-tile">
                  <span>
                    <BadgeCheck size={17} />
                    会员情况
                  </span>
                  <strong>{formatJimengVip(jimengAccountInfo.vip_level)}</strong>
                  <small>账号 ID：{jimengAccountInfo.user_id || '暂无'}</small>
                </article>
                <article className="jimeng-account-tile">
                  <span>
                    <Workflow size={17} />
                    近期调用
                  </span>
                  <strong>{formatNumber(jimengSummary.totalTasks, '0')}</strong>
                  <small>
                    成功 {jimengSummary.successTasks ?? 0} / 失败 {jimengSummary.failedTasks ?? 0}
                  </small>
                </article>
                <article className="jimeng-account-tile">
                  <span>
                    <TimerReset size={17} />
                    近期积分消耗
                  </span>
                  <strong>{formatNumber(jimengSummary.recentCreditUsed, '0')}</strong>
                  <small>按最近 {recentJimengTasks.length} 条调用统计</small>
                </article>
                <article className="jimeng-account-tile wide">
                  <span>
                    <Route size={17} />
                    CLI 状态
                  </span>
                  <strong>{jimengAccount?.cli?.available ? '可用' : '不可用'}</strong>
                  <small>{jimengAccount?.cli?.command || '未找到 dreamina 命令'}</small>
                </article>
                <article className="jimeng-account-tile wide">
                  <span>
                    <Film size={17} />
                    CLI 版本
                  </span>
                  <strong>{jimengAccount?.version?.version || '暂无版本'}</strong>
                  <small>{jimengAccount?.version?.build_time || '暂无构建时间'}</small>
                </article>
              </div>

              <div className="jimeng-task-section">
                <div className="agent-run-list-head">
                  <strong>调用明细</strong>
                  <small>{recentJimengTasks.length} 条最近任务</small>
                </div>
                {recentJimengTasks.length === 0 ? (
                  <p className="jimeng-empty">还没有可展示的即梦调用记录。</p>
                ) : (
                  <div className="jimeng-task-table">
                    <div className="jimeng-task-row jimeng-task-head">
                      <span>任务</span>
                      <span>类型</span>
                      <span>状态</span>
                      <span>积分</span>
                      <span>结果 / 权益</span>
                    </div>
                    {recentJimengTasks.map((task) => {
                      const statusMeta = getJimengTaskStatusMeta(task.gen_status);
                      return (
                        <div className="jimeng-task-row" key={task.submit_id || `${task.gen_task_type}-${task.fail_reason}`}>
                          <span>
                            <strong title={task.submit_id}>{compactSubmitId(task.submit_id)}</strong>
                            <small>{task.fail_reason || 'CLI 已返回任务结果'}</small>
                          </span>
                          <span>{task.gen_task_type || '未知类型'}</span>
                          <span>
                            <em className={`status-pill ${statusMeta.tone}`}>{statusMeta.label}</em>
                          </span>
                          <span>{formatNumber(getJimengTaskCredit(task), '0')}</span>
                          <span>
                            <strong>{getJimengTaskVideoMeta(task)}</strong>
                            <small>{getJimengTaskBenefit(task)}</small>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </section>
          ) : null}

          {activeAdminView === 'jimengDocs' ? (
            <section className="admin-panel jimeng-docs-panel">
              <div className="section-heading">
                <span>
                  <FileText size={18} />
                  即梦 CLI 文档要点
                </span>
                <small>整理自官方 CLI 帮助、安装脚本与随 CLI 分发的 SKILL.md</small>
              </div>

              <div className="jimeng-docs-grid">
                {jimengCliDocs.map((section) => (
                  <article className="jimeng-doc-card" key={section.title}>
                    <span>
                      <FileText size={16} />
                      {section.title}
                    </span>
                    <ul>
                      {section.points.map((point) => (
                        <li key={point}>{point}</li>
                      ))}
                    </ul>
                  </article>
                ))}
              </div>

              <div className="jimeng-model-reference">
                <div className="agent-run-list-head">
                  <strong>模型选择参考</strong>
                  <small>速度、质量和成本为产品侧倾向说明，实际积分消耗以调用明细为准</small>
                </div>
                <div className="jimeng-model-table">
                  <div className="jimeng-model-row jimeng-model-head">
	                    <span>模型</span>
	                    <span>速度</span>
	                    <span>质量</span>
	                    <span>定价</span>
	                    <span>扣费规则</span>
	                  </div>
                  {jimengModelOptions.map((option) => (
                    <div className="jimeng-model-row" key={option.value}>
                      <span>
                        <strong>{option.label}</strong>
                        <small>{option.value}</small>
                      </span>
	                      <span>{option.speed}</span>
	                      <span>{option.quality}</span>
	                      <span>{option.cost}</span>
	                      <span>每 5 秒片段 {option.pricePer5} 积分</span>
	                    </div>
	                  ))}
                </div>
              </div>
            </section>
          ) : null}

          {activeAdminView === 'users' ? (
            <section className="admin-panel">
              <div className="section-heading">
                <span>
                  <Users size={18} />
                  用户列表
                </span>
                <small>{isLoading ? '同步中...' : `${users.length} 位用户`}</small>
              </div>

              {error ? (
                <div className="api-error">
                  <AlertTriangle size={15} />
                  <span>{error}</span>
                </div>
              ) : null}

              <div className="user-table">
                <div className="user-row user-row-head">
                  <span>用户</span>
                  <span>角色</span>
                  <span>状态</span>
                  <span>积分</span>
                  <span>充值</span>
                  <span>登录次数</span>
                  <span>最近登录</span>
                </div>
                {users.map((userItem) => (
                  <div className="user-row" key={userItem.id}>
                    <span className="user-identity">
                      <span className="user-avatar">{userItem.name.slice(0, 1).toUpperCase()}</span>
                      <span>
                        <strong>{userItem.name}</strong>
                        <small>{userItem.email}</small>
                      </span>
                    </span>
                    <em className={`role-badge ${userItem.role === 'admin' ? 'admin' : ''}`}>
                      {userItem.role === 'admin' ? '管理员' : '用户'}
                    </em>
                    <em className={`status-badge ${userItem.status === 'active' ? 'active' : 'locked'}`}>
                      {userItem.status === 'active' ? '正常' : '停用'}
                    </em>
                    <em>{formatNumber(userItem.creditBalance ?? 0)}</em>
                    <em>
                      {formatNumber(userItem.rechargeCount ?? 0)} 次
                      <small>{formatNumber(userItem.lifetimeRechargeCny ?? 0)} 元</small>
                    </em>
                    <em>{userItem.loginCount}</em>
                    <em>{formatDate(userItem.lastLoginAt)}</em>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {activeAdminView === 'system' ? (
            <section className="admin-panel admin-system-panel">
              <div className="section-heading">
                <span>
                  <Settings2 size={18} />
                  系统配置
                </span>
                <small>本地服务与运行参数</small>
              </div>
              <div className="admin-system-grid">
                <article className="admin-system-card">
                  <span>
                    <ShieldCheck size={17} />
                    登录权限
                  </span>
                  <strong>管理员专用</strong>
                  <p>当前后台仅允许 admin 角色访问，未授权用户会被引导到登录页。</p>
                </article>
                <article className="admin-system-card">
                  <span>
                    <Route size={17} />
                    API 网关
                  </span>
                  <strong>{API_BASE_URL}</strong>
                  <p>前端请求统一通过该地址转发，便于部署时切换后端入口。</p>
                </article>
                <article className="admin-system-card">
                  <span>
                    <Bot size={17} />
                    服务模式
                  </span>
                  <strong>{agentConfig?.jimengMode || agentForm.jimengMode}</strong>
                  <p>可在服务配置里调整即梦接入模式、默认视频模型与分镜服务参数。</p>
                </article>
              </div>
              <div className="admin-system-actions">
                <button className="primary-button" type="button" onClick={() => switchAdminView('agent')}>
                  <Bot size={18} />
                  配置服务
                </button>
                <button className="secondary-link-button" type="button" onClick={refreshAdminData} disabled={isLoading}>
                  {isLoading ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />}
                  同步系统状态
                </button>
              </div>
            </section>
          ) : null}
        </div>
      </section>
    </main>
  );
}

function getSceneDurations(duration, segmentDuration) {
  const count = Math.ceil(duration / segmentDuration);
  const durations = Array.from({ length: count }, () => segmentDuration);
  durations[durations.length - 1] = duration - segmentDuration * (count - 1);

  if (durations.length > 1 && durations[durations.length - 1] < 4) {
    const combined = durations[durations.length - 2] + durations[durations.length - 1];
    durations[durations.length - 2] = Math.floor(combined / 2);
    durations[durations.length - 1] = combined - durations[durations.length - 2];
  }
  return durations;
}

function createScenes(duration, idea, style, segmentDuration = 10, projectId = 'demo') {
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

  let start = 0;
  return getSceneDurations(duration, segmentDuration).map((sceneDuration, index) => {
    const end = start + sceneDuration;
    const status = 'locked';
    const scene = {
      id: `${projectId}-scene-${index + 1}`,
      number: String(index + 1).padStart(2, '0'),
      time: `${formatTime(start)} - ${formatTime(end)}`,
      title: titles[index % titles.length],
      status,
      progress: 0,
      prompt: `${style}，延续同一角色、场景光线和镜头语言：${idea}`,
      duration: sceneDuration,
    };
    start = end;
    return scene;
  });
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function Workspace({ auth, onShowIntro, onShowAdmin, onLogout }) {
  const timers = useRef([]);
  const imageUrls = useRef(new Set());
  const scenesRef = useRef([]);
  const [idea, setIdea] = useState(defaultIdea);
  const [duration, setDuration] = useState(180);
  const [segmentDuration, setSegmentDuration] = useState(15);
  const [style, setStyle] = useState('电影感');
  const [ratio, setRatio] = useState('16:9');
  const [jimengModel, setJimengModel] = useState('seedance2.0fast');
  const [images, setImages] = useState([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [stageIndex, setStageIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [scenes, setScenes] = useState(() => createScenes(180, defaultIdea, '电影感', 15));
  const [candidates, setCandidates] = useState([]);
  const [selectedCandidateId, setSelectedCandidateId] = useState('');
  const [activeRunId, setActiveRunId] = useState('');
  const [isConfirming, setIsConfirming] = useState(false);
  const [apiStatus, setApiStatus] = useState('正在连接创作服务...');
  const [apiError, setApiError] = useState('');
  const [finalVideoUrl, setFinalVideoUrl] = useState('');
  const [runStatus, setRunStatus] = useState('idle');
  const [billing, setBilling] = useState(null);
  const [billingError, setBillingError] = useState('');
  const [rechargingPackageId, setRechargingPackageId] = useState('');

  scenesRef.current = scenes;

  const selectedDuration = useMemo(
    () => durationOptions.find((item) => item.value === duration),
    [duration],
  );
  const selectedDurationIndex = Math.max(
    durationOptions.findIndex((item) => item.value === duration),
    0,
  );
  const selectedJimengModel = getJimengModelOption(jimengModel);
  const estimatedCreditCost = useMemo(
    () => calculateCreditCost(jimengModel, [duration]),
    [jimengModel, duration],
  );

  const completeCount = scenes.filter((scene) => scene.status === 'done').length;
  const runLocked = isGenerating || isConfirming || runStatus === 'awaiting_confirmation';
  const controlsLocked = isGenerating || isConfirming;
  const isStoryboardReview = runStatus === 'awaiting_confirmation' && candidates.length > 0;
  const storyboardTotalDuration = scenes.reduce((sum, scene) => sum + Number(scene.duration || 0), 0);
  const storyboardDurationValid = storyboardTotalDuration === duration;
  const storyboardPromptsValid = scenes.every(
    (scene) => scene.title.trim().length > 0 && scene.prompt.trim().length >= 10 && Number(scene.duration) >= 4,
  );
  const storyboardCreditCost = useMemo(
    () => calculateCreditCost(jimengModel, scenes.map((scene) => scene.duration)),
    [jimengModel, scenes],
  );
  const activeCreditCost = isStoryboardReview ? storyboardCreditCost : estimatedCreditCost;
  const creditBalance = billing?.balance ?? auth?.user?.creditBalance ?? 0;
  const hasEnoughCredits = creditBalance >= activeCreditCost;

  useEffect(() => {
    const activeImageUrls = imageUrls.current;
    let isMounted = true;

    apiRequest('/health')
      .then((health) => {
        if (isMounted) setApiStatus(`创作服务：${health.status}`);
      })
      .catch((error) => {
        if (isMounted) {
          setApiStatus('创作服务离线');
          setApiError(error.message);
        }
      });

    return () => {
      isMounted = false;
      timers.current.forEach((timer) => clearTimeout(timer));
      activeImageUrls.forEach((url) => URL.revokeObjectURL(url));
      activeImageUrls.clear();
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    apiRequest('/billing/me', { authToken: auth?.token })
      .then((nextBilling) => {
        if (isMounted) {
          setBilling(nextBilling);
          setBillingError('');
        }
      })
      .catch((error) => {
        if (isMounted) setBillingError(error.message);
      });

    return () => {
      isMounted = false;
    };
  }, [auth?.token]);

  useEffect(() => {
    if (Math.ceil(duration / segmentDuration) > 40) {
      setSegmentDuration(15);
    }
  }, [duration, segmentDuration]);

  useEffect(() => {
    if (runStatus !== 'idle') return;

    const draftScenes = createScenes(duration, idea, style, segmentDuration);
    scenesRef.current = draftScenes;
    setScenes(draftScenes);
  }, [duration, idea, style, segmentDuration, runStatus]);

  function clearTaskTimers() {
    timers.current.forEach((timer) => clearTimeout(timer));
    timers.current = [];
  }

  async function refreshBilling() {
    const nextBilling = await apiRequest('/billing/me', { authToken: auth?.token });
    setBilling(nextBilling);
    setBillingError('');
    return nextBilling;
  }

  async function handleRecharge(packageId) {
    if (rechargingPackageId) return;
    setRechargingPackageId(packageId);
    setBillingError('');

    try {
      const nextBilling = await apiRequest('/billing/recharge', {
        method: 'POST',
        authToken: auth?.token,
        body: JSON.stringify({ packageId }),
      });
      setBilling(nextBilling);
    } catch (error) {
      setBillingError(error.message);
    } finally {
      setRechargingPackageId('');
    }
  }

  function syncAgentRun(latestRun) {
    let syncedScenes = latestRun.scenes.length > 0
      ? latestRun.scenes.map((scene) => ({
          ...scene,
          status: scene.status === 'completed'
            ? 'done'
            : scene.status === 'generating'
              ? 'active'
              : scene.status === 'failed'
                ? 'failed'
                : 'queued',
        }))
      : scenesRef.current;

    if (latestRun.status === 'awaiting_confirmation' && latestRun.candidates?.length > 0) {
      const firstCandidate = latestRun.candidates[0];
      setCandidates(latestRun.candidates);
      setSelectedCandidateId(firstCandidate.id);
      syncedScenes = firstCandidate.scenes.map((scene) => ({ ...scene, status: 'locked', progress: 0 }));
    }

    scenesRef.current = syncedScenes;
    setScenes(syncedScenes);
    setProgress(latestRun.progress ?? 0);
    setRunStatus(latestRun.status);
    setStageIndex(agentStageIndexes[latestRun.stage] ?? 0);
    setApiStatus(`任务状态：${agentStageLabels[latestRun.stage] || latestRun.stage}`);

    if (latestRun.finalVideoUrl) {
      setFinalVideoUrl(latestRun.finalVideoUrl);
    }

    if (latestRun.status === 'failed') {
      setApiError(latestRun.error || '任务未能完成，请稍后重试。');
    }

    return ['awaiting_confirmation', 'completed', 'failed'].includes(latestRun.status);
  }

  async function pollAgentRun(runId) {
    try {
      const latestRun = await apiRequest(`/agent/runs/${encodeURIComponent(runId)}`, {
        authToken: auth?.token,
      });
      const isFinished = syncAgentRun(latestRun);

      if (isFinished) {
        clearTaskTimers();
        setIsGenerating(false);
        return;
      }

      timers.current = [setTimeout(() => pollAgentRun(runId), AGENT_POLL_INTERVAL)];
    } catch (error) {
      clearTaskTimers();
      setApiError(error.message);
      setRunStatus('failed');
      setIsGenerating(false);
    }
  }

  function handleImageUpload(event) {
    const files = Array.from(event.target.files || []);
    const nextImages = files.slice(0, 6).map((file) => ({
      id: `${file.name}-${file.lastModified}`,
      name: file.name,
      url: URL.createObjectURL(file),
      file,
      uploadId: '',
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

  async function handleSubmit({ regenerate = false } = {}) {
    if ((!regenerate && runLocked) || isGenerating || isConfirming || !idea.trim()) return;

    clearTaskTimers();

    const placeholderScenes = createScenes(
      duration,
      idea,
      style,
      segmentDuration,
      `pending-${Date.now()}`,
    ).map((scene) => ({
      ...scene,
      status: 'queued',
      progress: 0,
    }));

    scenesRef.current = placeholderScenes;
    setScenes(placeholderScenes);
    setIsGenerating(true);
    setStageIndex(0);
    setProgress(6);
    setRunStatus('queued');
    setApiError('');
    setFinalVideoUrl('');
    setCandidates([]);
    setSelectedCandidateId('');

    try {
      const uploadedImages = await Promise.all(images.map(async (image) => {
        if (image.uploadId) return image;
        const formData = new FormData();
        formData.append('image', image.file, image.name);
        const uploaded = await apiRequest('/agent/uploads', {
          method: 'POST',
          authToken: auth?.token,
          body: formData,
        });
        return { ...image, uploadId: uploaded.id };
      }));
      setImages(uploadedImages);

      const agentRun = await apiRequest('/agent/runs', {
        method: 'POST',
        authToken: auth?.token,
        body: JSON.stringify({
          idea,
          duration,
          segmentDuration,
          style,
          ratio,
          jimengModel,
          imageNames: uploadedImages.map((image) => image.name),
          imageIds: uploadedImages.map((image) => image.uploadId),
        }),
      });

      setActiveRunId(agentRun.id);
      setApiStatus(`任务已创建：${agentRun.id}`);
      syncAgentRun(agentRun);
      timers.current = [setTimeout(() => pollAgentRun(agentRun.id), 400)];
    } catch (error) {
      clearTaskTimers();
      setApiError(error.message);
      setRunStatus('failed');
      setIsGenerating(false);
      setScenes(placeholderScenes.map((scene) => ({ ...scene, status: 'failed', error: error.message })));
    }
  }

  function handleRegenerateStoryboard() {
    handleSubmit({ regenerate: true });
  }

  function updateDraftScene(index, field, value) {
    const nextValue = field === 'duration' ? Number(value) : value;
    const nextScenes = scenesRef.current.map((scene, sceneIndex) => (
      sceneIndex === index ? { ...scene, [field]: nextValue } : scene
    ));

    scenesRef.current = nextScenes;
    setScenes(nextScenes);
    setCandidates((currentCandidates) => currentCandidates.map((candidate) => (
      candidate.id === selectedCandidateId
        ? { ...candidate, scenes: nextScenes }
        : candidate
    )));
  }

  async function handleConfirmStoryboard() {
    if (!activeRunId || !selectedCandidateId || isConfirming || !storyboardDurationValid) return;
    if (!hasEnoughCredits) {
      setApiError(`积分不足，本次预计需要 ${storyboardCreditCost} 积分，当前余额 ${creditBalance} 积分。`);
      return;
    }
    setIsConfirming(true);
    setIsGenerating(true);
    setApiError('');

    try {
      const confirmedRun = await apiRequest(
        `/agent/runs/${encodeURIComponent(activeRunId)}/confirm`,
        {
          method: 'POST',
          authToken: auth?.token,
          body: JSON.stringify({
            candidateId: selectedCandidateId,
            scenes: scenes.map((scene) => ({
              title: scene.title,
              prompt: scene.prompt,
              duration: scene.duration,
            })),
          }),
        },
      );
      syncAgentRun(confirmedRun);
      await refreshBilling();
      timers.current = [setTimeout(() => pollAgentRun(activeRunId), 400)];
    } catch (error) {
      setApiError(error.message);
      setRunStatus('awaiting_confirmation');
      setIsGenerating(false);
    } finally {
      setIsConfirming(false);
    }
  }

  function resetWorkspace() {
    clearTaskTimers();
    images.forEach((image) => {
      URL.revokeObjectURL(image.url);
      imageUrls.current.delete(image.url);
    });
    const draftScenes = createScenes(180, defaultIdea, '电影感', 15);
    scenesRef.current = draftScenes;
    setIdea(defaultIdea);
    setDuration(180);
    setSegmentDuration(15);
    setStyle('电影感');
    setRatio('16:9');
    setJimengModel('seedance2.0fast');
    setImages([]);
    setScenes(draftScenes);
    setCandidates([]);
    setSelectedCandidateId('');
    setActiveRunId('');
    setIsGenerating(false);
    setIsConfirming(false);
    setStageIndex(0);
    setProgress(0);
    setApiError('');
    setFinalVideoUrl('');
    setRunStatus('idle');
    setApiStatus('创作服务已连接');
  }

  return (
    <div className="workspace-shell">
      <header className="app-header">
        <div className="brand-mark">
          <BrandLogo />
          <span>Dreamina Studio</span>
        </div>
        <div className="header-actions">
          {auth?.user ? (
            <div className="session-chip">
              <User size={15} />
              <span>{auth.user.name}</span>
            </div>
          ) : null}
          <button className="icon-text-button" onClick={onShowIntro}>
            <Sparkles size={16} />
            团队官网
          </button>
          {auth?.user?.role === 'admin' ? (
            <button className="icon-text-button" onClick={onShowAdmin}>
              <Shield size={16} />
              管理后台
            </button>
          ) : null}
          <button className="icon-button" title="新建项目" onClick={resetWorkspace}>
            <Plus size={18} />
          </button>
          <button className="icon-button" title="设置">
            <Settings2 size={18} />
          </button>
          <button className="icon-button" title="退出登录" onClick={onLogout}>
            <LogOut size={18} />
          </button>
        </div>
      </header>

      <main className="workspace-grid">
        <aside className="history-rail">
          <div className="rail-section">
            <p className="rail-label">项目</p>
            <button className="rail-primary" onClick={resetWorkspace}>
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
              disabled={runLocked}
            />
          </label>

          <div className="upload-strip">
            <label className="upload-drop">
              <input type="file" accept="image/*" multiple onChange={handleImageUpload} disabled={runLocked} />
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

          <CreditConsole
            activeCreditCost={activeCreditCost}
            balance={creditBalance}
            billing={billing}
            billingError={billingError}
            hasEnoughCredits={hasEnoughCredits}
            onRecharge={handleRecharge}
            rechargingPackageId={rechargingPackageId}
          />

          <div className="control-group">
            <div className="control-head">
              <Clock3 size={16} />
              <span>目标时长</span>
            </div>
            <div className="duration-slider-control">
              <div className="duration-slider-value">
                <strong>{selectedDuration?.label}</strong>
                <span>预计 {Math.ceil(duration / segmentDuration)} 段</span>
              </div>
              <input
                aria-label="目标时长"
                type="range"
                min="0"
                max={durationOptions.length - 1}
                step="1"
                value={selectedDurationIndex}
                onChange={(event) => setDuration(durationOptions[Number(event.target.value)].value)}
                disabled={runLocked}
              />
              <div className="duration-slider-labels">
                {durationOptions.map((option) => (
                  <button
                    className={duration === option.value ? 'selected' : ''}
                    key={option.value}
                    onClick={() => setDuration(option.value)}
                    disabled={runLocked}
                    type="button"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="control-group">
            <div className="control-head">
              <Scissors size={16} />
              <span>单段时长</span>
            </div>
            <div className="segmented-control segment-duration-control">
              {segmentDurationOptions.map((option) => {
                const exceedsLimit = Math.ceil(duration / option) > 40;
                return (
                  <button
                    className={segmentDuration === option ? 'selected' : ''}
                    key={option}
                    onClick={() => setSegmentDuration(option)}
                    disabled={runLocked || exceedsLimit}
                    title={exceedsLimit ? '该总时长最多支持 40 段，请选择更长的单段时长' : ''}
                  >
                    <strong>{option}秒</strong>
                    <small>{Math.ceil(duration / option)}段</small>
                  </button>
                );
              })}
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
                    disabled={runLocked}
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
                    disabled={runLocked}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="control-group">
            <div className="control-head">
              <Zap size={16} />
              <span>生成模型</span>
            </div>
            <div className="model-choice-grid">
              {jimengModelOptions.map((option) => (
                <button
                  className={jimengModel === option.value ? 'selected' : ''}
                  key={option.value}
                  onClick={() => setJimengModel(option.value)}
                  disabled={runLocked}
                  type="button"
                >
                  <span>
                    <strong>{option.label}</strong>
                    <em>{option.priceLabel}</em>
                  </span>
                  <small>当前时长预计 {calculateCreditCost(option.value, [duration])} 积分</small>
                </button>
              ))}
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
              <span>智能分镜</span>
            </div>
          </div>

          <button className="submit-button" onClick={handleSubmit} disabled={!idea.trim() || runLocked}>
            {isGenerating ? <Loader2 className="spin" size={18} /> : <WandSparkles size={18} />}
            {isGenerating
              ? runStatus === 'generating' ? '即梦生成中' : '正在编写分镜'
              : runStatus === 'awaiting_confirmation' ? '请先确认分镜' : '生成分镜剧本'}
          </button>
          {apiError ? (
            <div className="api-error">
              <AlertTriangle size={15} />
              <span>{apiError}</span>
            </div>
          ) : null}
          {runStatus === 'completed' && finalVideoUrl ? (
            <div className="api-success" aria-live="polite">
              <BadgeCheck size={16} />
              <span>即梦 CLI 已完成所有分镜，视频片段结果已返回。</span>
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
              <small>{ratio} / {selectedDuration?.label} / {selectedJimengModel.shortLabel}</small>
            </div>
            <div className="video-preview">
              {finalVideoUrl ? (
                <video className="preview-image preview-video" src={finalVideoUrl} controls playsInline />
              ) : (
                <img className="preview-image" src={visualAssets.workspacePreview} alt="" loading="lazy" />
              )}
              <div className="video-shine" />
              {!finalVideoUrl ? (
                <button className="play-ring compact" title="等待生成结果" disabled>
                  <Play size={22} fill="currentColor" />
                </button>
              ) : null}
              <div className="preview-caption">
                <strong>
                  {finalVideoUrl
                    ? '首段视频预览'
                    : runStatus === 'awaiting_confirmation'
                      ? '等待确认分镜'
                      : isGenerating ? '任务处理中' : '等待最新任务'}
                </strong>
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

      {isStoryboardReview ? (
        <section className="storyboard-review-panel">
          <div className="section-heading">
            <span>
              <Workflow size={18} />
              分镜剧本
            </span>
            <small>查看生成结果，可逐段修改，也可以重新生成一版</small>
          </div>
          <div className="storyboard-plan-summary">
            <span>
              <strong>{candidates[0]?.title || '分镜剧本'}</strong>
              <small>{candidates[0]?.summary || '已生成一套可编辑分镜'}</small>
            </span>
            <em>{scenes.length} 段 / {storyboardTotalDuration} 秒 / {selectedJimengModel.label}</em>
          </div>
          <div className="storyboard-submit-row">
            <div>
              <strong>当前分镜总长 {storyboardTotalDuration} / {duration} 秒</strong>
              <span>
                {storyboardDurationValid
                  ? `确认提交将扣除 ${storyboardCreditCost} 积分，当前余额 ${creditBalance} 积分。`
                  : '请调整单段时长，让总时长与目标时长一致。'}
              </span>
            </div>
            <button
              className="secondary-link-button"
              onClick={handleRegenerateStoryboard}
              disabled={controlsLocked || !idea.trim()}
              type="button"
            >
              {isGenerating ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />}
              重新生成分镜
            </button>
            <button
              className="primary-button"
              onClick={handleConfirmStoryboard}
              disabled={isConfirming || !storyboardDurationValid || !storyboardPromptsValid || !hasEnoughCredits}
              type="button"
            >
              {isConfirming ? <Loader2 className="spin" size={18} /> : <Check size={18} />}
              {isConfirming ? '正在提交' : hasEnoughCredits ? '确认提交' : '积分不足'}
            </button>
          </div>
        </section>
      ) : null}

      <section className="timeline-panel">
        <div className="section-heading">
          <span>
            <Film size={18} />
            分镜时间线
          </span>
          <small>
            {isStoryboardReview
              ? '当前分镜可编辑，确认后将按顺序生成'
              : `每段最长 15 秒，共 ${scenes.length} 段`}
          </small>
        </div>
        <div className="scene-list">
          {scenes.map((scene, index) => (
            <article className={`scene-card ${isStoryboardReview ? 'editable' : ''}`} key={scene.id}>
              <img
                className="scene-card-image"
                src={sceneVisuals[index % sceneVisuals.length]}
                alt=""
                loading="lazy"
              />
              <div className="scene-index">{scene.number}</div>
              <div className="scene-main">
                <div className="scene-title-row">
                  {isStoryboardReview ? (
                    <input
                      aria-label={`分镜 ${scene.number} 标题`}
                      className="scene-title-input"
                      value={scene.title}
                      onChange={(event) => updateDraftScene(index, 'title', event.target.value)}
                    />
                  ) : (
                    <strong>{scene.title}</strong>
                  )}
                  <StatusPill status={scene.status} />
                </div>
                {isStoryboardReview ? (
                  <textarea
                    aria-label={`分镜 ${scene.number} 提示词`}
                    className="scene-prompt-editor"
                    value={scene.prompt}
                    onChange={(event) => updateDraftScene(index, 'prompt', event.target.value)}
                  />
                ) : (
                  <p>{scene.prompt}</p>
                )}
                {scene.error ? <small className="scene-error">{scene.error}</small> : null}
                <div className="mini-progress">
                  <span style={{ width: `${scene.progress}%` }} />
                </div>
                {scene.videoUrl ? (
                  <a className="scene-result-link" href={scene.videoUrl} target="_blank" rel="noreferrer">
                    <Play size={13} />
                    查看生成片段
                  </a>
                ) : null}
              </div>
              <div className="scene-time">
                {isStoryboardReview ? (
                  <label className="scene-duration-edit">
                    <span>时长</span>
                    <input
                      aria-label={`分镜 ${scene.number} 时长`}
                      min="4"
                      max="15"
                      type="number"
                      value={scene.duration}
                      onChange={(event) => updateDraftScene(index, 'duration', event.target.value)}
                    />
                    <em>秒</em>
                  </label>
                ) : (
                  scene.time
                )}
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

export default function App() {
  const [page, setPage] = useState(() => getPageFromHash());
  const [auth, setAuth] = useState(() => readStoredAuth());

  useEffect(() => {
    const handleHashChange = () => {
      setPage(getPageFromHash());
      window.requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0 }));
    };

    window.addEventListener('hashchange', handleHashChange);
    if (!window.location.hash) window.history.replaceState(null, '', HOME_ROUTE);

    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  function enterWorkspace() {
    goTo(auth?.user ? CREATE_ROUTE : LOGIN_ROUTE);
  }

  function showIntroAgain() {
    goTo(HOME_ROUTE);
  }

  function handleAuthSuccess(nextAuth) {
    setAuth(nextAuth);
    window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(nextAuth));
    goTo(nextAuth.user.role === 'admin' ? ADMIN_ROUTE : CREATE_ROUTE);
  }

  function handleLogout() {
    setAuth(null);
    window.localStorage.removeItem(AUTH_STORAGE_KEY);
    goTo(HOME_ROUTE);
  }

  if (page === 'login') {
    return (
      <AuthPage
        mode="login"
        onAuthSuccess={handleAuthSuccess}
        onSwitchMode={() => goTo(REGISTER_ROUTE)}
        onShowHome={showIntroAgain}
      />
    );
  }

  if (page === 'register') {
    return (
      <AuthPage
        mode="register"
        onAuthSuccess={handleAuthSuccess}
        onSwitchMode={() => goTo(LOGIN_ROUTE)}
        onShowHome={showIntroAgain}
      />
    );
  }

  if (page === 'admin') {
    return (
      <AdminPage
        auth={auth}
        onShowIntro={showIntroAgain}
        onShowCreate={() => goTo(auth?.user ? CREATE_ROUTE : LOGIN_ROUTE)}
        onLogout={handleLogout}
      />
    );
  }

  if (page === 'create') {
    if (!auth?.user) {
      return (
        <AuthPage
          mode="login"
          onAuthSuccess={handleAuthSuccess}
          onSwitchMode={() => goTo(REGISTER_ROUTE)}
          onShowHome={showIntroAgain}
        />
      );
    }

    return (
      <Workspace
        auth={auth}
        onShowIntro={showIntroAgain}
        onShowAdmin={() => goTo(ADMIN_ROUTE)}
        onLogout={handleLogout}
      />
    );
  }

  return <IntroPage onStart={enterWorkspace} />;
}

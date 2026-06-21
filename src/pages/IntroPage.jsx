import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  Bot,
  Check,
  ChevronRight,
  Coins,
  CreditCard,
  Link2,
  Play,
  Route,
  Scissors,
  ShieldCheck,
  Sparkles,
  TimerReset,
  Workflow,
  Zap,
} from 'lucide-react';
import { BrandLogo } from '../components/AppChrome';

const visualAssets = {
  heroConsole: new URL('../assets/gallery/hero-console.jpg', import.meta.url).href,
  missionInfra: new URL('../assets/gallery/mission-infra.jpg', import.meta.url).href,
  missionTiming: new URL('../assets/gallery/mission-timing.jpg', import.meta.url).href,
  missionBelief: new URL('../assets/gallery/mission-belief.jpg', import.meta.url).href,
  painFragmented: new URL('../assets/gallery/pain-fragmented.jpg', import.meta.url).href,
  painContext: new URL('../assets/gallery/pain-context.jpg', import.meta.url).href,
  painCost: new URL('../assets/gallery/pain-cost.jpg', import.meta.url).href,
  valueStructure: new URL('../assets/gallery/value-structure.jpg', import.meta.url).href,
  valueContinuity: new URL('../assets/gallery/value-continuity.jpg', import.meta.url).href,
  valueAgent: new URL('../assets/gallery/value-agent.jpg', import.meta.url).href,
  valueDelivery: new URL('../assets/gallery/value-delivery.jpg', import.meta.url).href,
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

const pricingAdvantages = [
  {
    icon: Zap,
    metric: '会员通道',
    title: '使用高级会员账号提交',
    text: '任务统一进入高级会员权益池，减少普通官网账号排队时间过长带来的创作中断。',
  },
  {
    icon: Coins,
    metric: '3.8折',
    title: '按高级会员权益折算',
    text: '定价按高级会员权益成本的 3.8 折组织，让单次视频生成比直接承担高阶会员更轻。',
  },
  {
    icon: CreditCard,
    metric: '免月费',
    title: '无需先开高价会员',
    text: '不需要为了几次创作先开数百元/月的高阶会员，也能使用会员级生成服务。',
  },
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

export default function IntroPage({ onStart }) {
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
          <a href="#pricing">价格优势</a>
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

      <section className="intro-section pricing-section reveal" id="pricing">
        <div className="section-kicker">
          <Coins size={16} />
          价格与排队优势
        </div>
        <div className="pricing-layout">
          <div className="intro-section-head">
            <h2>用高级会员权益池，换更短等待和更低创作成本。</h2>
            <p>
              不再为官网排队反复中断创作，也不必为了偶尔生成几支视频就先承担数百元/月的高阶会员成本。Dreamina Studio 统一使用即梦高级会员账号提交任务，让普通创作者也能享受更顺畅的会员级生成服务。
            </p>
            <div className="pricing-proof">
              <BadgeCheck size={16} />
              <span>按高级会员权益成本的 3.8 折组织定价，降低单次创作门槛。</span>
            </div>
          </div>

          <div className="pricing-card-grid">
            {pricingAdvantages.map((item) => {
              const Icon = item.icon;
              return (
                <article className="pricing-card" data-mark={item.metric} key={item.title}>
                  <div className="pricing-card-top">
                    <span>
                      <Icon size={19} />
                    </span>
                    <em>{item.metric}</em>
                  </div>
                  <h3>{item.title}</h3>
                  <p>{item.text}</p>
                </article>
              );
            })}
          </div>
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

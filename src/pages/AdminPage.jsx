import { useEffect, useState } from 'react';
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
  FileText,
  Film,
  Link2,
  Loader2,
  Lock,
  LogOut,
  RefreshCw,
  Route,
  Settings2,
  Shield,
  ShieldCheck,
  Sparkles,
  TimerReset,
  Users,
  WandSparkles,
  Workflow,
  Zap,
} from 'lucide-react';
import { API_BASE_URL, apiRequest } from '../api/client';
import { BrandLogo, CreditNavButton, UserIdentityButton } from '../components/AppChrome';
import { getJimengModelOption, jimengCliDocs, jimengModelOptions } from '../config/creation';
import {
  compactSubmitId,
  formatCny,
  formatDate,
  formatJimengVip,
  formatNumber,
  getJimengTaskBenefit,
  getJimengTaskCredit,
  getJimengTaskStatusMeta,
  getJimengTaskVideoMeta,
} from '../utils/formatters';
import { getRechargeRequestStatusMeta } from '../utils/recharge';
import { getUserIdentity } from '../utils/users';

export default function AdminPage({ auth, billingState, onShowCredits, onShowIntro, onShowCreate, onShowLogin, onShowProfile, onLogout }) {
  const [activeAdminView, setActiveAdminView] = useState('overview');
  const [users, setUsers] = useState([]);
  const [stats, setStats] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [agentConfig, setAgentConfig] = useState(null);
  const [agentStatus, setAgentStatus] = useState(null);
  const [jimengAccount, setJimengAccount] = useState(null);
  const [rechargeRequests, setRechargeRequests] = useState([]);
  const [reviewingRequestId, setReviewingRequestId] = useState('');
  const [selectedRechargeCredits, setSelectedRechargeCredits] = useState({});
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
        const [nextStats, nextUsers, nextConfig, nextAgentStatus, nextJimengAccount, nextRechargeRequests] = await Promise.all([
          apiRequest('/admin/stats', { authToken: auth?.token }),
          apiRequest('/admin/users', { authToken: auth?.token }),
          apiRequest('/admin/agent/config', { authToken: auth?.token }),
          apiRequest('/admin/agent/status', { authToken: auth?.token }),
          apiRequest('/admin/jimeng/account?limit=10', { authToken: auth?.token }),
          apiRequest('/admin/recharge-requests?limit=100', { authToken: auth?.token }),
        ]);

        if (isMounted) {
          setStats(nextStats);
          setUsers(nextUsers);
          setAgentConfig(nextConfig);
          setAgentStatus(nextAgentStatus);
          setJimengAccount(nextJimengAccount);
          setRechargeRequests(nextRechargeRequests);
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
      const [nextStats, nextUsers, nextConfig, nextAgentStatus, nextJimengAccount, nextRechargeRequests] = await Promise.all([
        apiRequest('/admin/stats', { authToken: auth?.token }),
        apiRequest('/admin/users', { authToken: auth?.token }),
        apiRequest('/admin/agent/config', { authToken: auth?.token }),
        apiRequest('/admin/agent/status', { authToken: auth?.token }),
        apiRequest('/admin/jimeng/account?limit=10', { authToken: auth?.token }),
        apiRequest('/admin/recharge-requests?limit=100', { authToken: auth?.token }),
      ]);

      setStats(nextStats);
      setUsers(nextUsers);
      setAgentConfig(nextConfig);
      setAgentStatus(nextAgentStatus);
      setJimengAccount(nextJimengAccount);
      setRechargeRequests(nextRechargeRequests);
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

  async function handleApproveRechargeRequest(requestId) {
    const credits = selectedRechargeCredits[requestId];
    if (!credits) {
      setError('请先点击一个快捷加积分按钮，再确认到账。');
      return;
    }
    const actionId = `${requestId}:approve`;
    setReviewingRequestId(actionId);
    setError('');

    try {
      await apiRequest(`/admin/recharge-requests/${requestId}/approve`, {
        method: 'POST',
        authToken: auth?.token,
        body: JSON.stringify({
          credits,
          adminNote: `快捷入账 ${credits} 积分`,
        }),
      });
      setSelectedRechargeCredits((current) => {
        const nextCredits = { ...current };
        delete nextCredits[requestId];
        return nextCredits;
      });
      await refreshAdminData();
      await billingState?.refreshBilling?.();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setReviewingRequestId('');
    }
  }

  async function handleRejectRechargeRequest(requestId) {
    const actionId = `${requestId}:reject`;
    setReviewingRequestId(actionId);
    setError('');

    try {
      await apiRequest(`/admin/recharge-requests/${requestId}/reject`, {
        method: 'POST',
        authToken: auth?.token,
        body: JSON.stringify({ adminNote: '未确认到账，暂不入账' }),
      });
      setSelectedRechargeCredits((current) => {
        const nextCredits = { ...current };
        delete nextCredits[requestId];
        return nextCredits;
      });
      await refreshAdminData();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setReviewingRequestId('');
    }
  }

  if (!auth?.user || auth.user.role !== 'admin') {
    return (
      <main className="admin-shell">
        <div className="empty-admin-state">
          <Shield size={36} />
          <h1>需要管理员权限</h1>
          <p>请使用管理员账号登录后再进入后台管理页面。</p>
          <button className="primary-button" onClick={onShowLogin}>
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
  const creditBalance = billingState?.billing?.balance ?? auth?.user?.creditBalance ?? 0;
  const pendingRechargeCount = rechargeRequests.filter((request) => ['pending', 'processing'].includes(request.status)).length;

  const statCards = [
    { label: '注册用户', value: stats?.totalUsers ?? '-', icon: Users },
    { label: '活跃账号', value: stats?.activeUsers ?? '-', icon: BadgeCheck },
    { label: '7 日登录', value: stats?.recentLogins ?? '-', icon: CalendarClock },
    { label: '分镜任务', value: stats?.generatedShots ?? '-', icon: Clapperboard },
    { label: '创作任务', value: stats?.agentRuns ?? '-', icon: Bot },
    { label: '用户积分', value: formatNumber(stats?.userCreditBalance ?? 0), icon: Coins },
    { label: '充值收入', value: `${formatNumber(stats?.rechargeRevenueCny ?? 0)}元`, icon: CreditCard },
    { label: '待审充值', value: stats?.pendingRechargeRequests ?? pendingRechargeCount, icon: Clock3 },
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
    { id: 'recharge', label: '充值审核', icon: CreditCard, description: `${pendingRechargeCount} 条待确认充值`, badge: pendingRechargeCount },
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
                {item.badge ? <em className="admin-menu-badge">{item.badge}</em> : null}
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
            <UserIdentityButton user={auth.user} onClick={onShowProfile} />
            <CreditNavButton balance={creditBalance} onClick={onShowCredits} />
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
                <button className="admin-user-chip admin-user-chip-button" onClick={onShowProfile} type="button">
                  <span>{auth.user.name.slice(0, 1).toUpperCase()}</span>
                  <div>
                    <strong>{auth.user.name}</strong>
                    <small>{getUserIdentity(auth.user)}</small>
                  </div>
                </button>
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
                          <small>{run.userEmail || '未知账号'} / {getJimengModelOption(run.jimengModel).shortLabel}</small>
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

          {activeAdminView === 'recharge' ? (
            <section className="admin-panel recharge-admin-panel">
              <div className="section-heading">
                <span>
                  <CreditCard size={18} />
                  充值审核
                </span>
                <small>{pendingRechargeCount} 条待确认 / {rechargeRequests.length} 条最近申请</small>
              </div>

              {error ? (
                <div className="api-error">
                  <AlertTriangle size={15} />
                  <span>{error}</span>
                </div>
              ) : null}

              <div className="recharge-admin-table">
                <div className="admin-recharge-row admin-recharge-head">
                  <span>用户</span>
                  <span>申请档位</span>
                  <span>金额</span>
                  <span>积分</span>
                  <span>状态</span>
                  <span>操作</span>
                </div>
                {rechargeRequests.length ? (
                  rechargeRequests.map((request) => {
                    const statusMeta = getRechargeRequestStatusMeta(request.status);
                    const actionLocked = reviewingRequestId.startsWith(request.id);
                    const isPending = ['pending', 'processing'].includes(request.status);
                    const selectedCredits = selectedRechargeCredits[request.id];
                    return (
                      <div className="admin-recharge-row" key={request.id}>
                        <span className="user-identity">
                          <span className="user-avatar">{(request.userName || '?').slice(0, 1).toUpperCase()}</span>
                          <span>
                            <strong>{request.userName}</strong>
                            <small>{request.userEmail}</small>
                          </span>
                        </span>
                        <span>
                          <strong>{request.packageLabel}</strong>
                          <small>{formatDate(request.createdAt)} / {request.id}</small>
                        </span>
                        <em>{formatCny(request.priceCny)}</em>
                        <em>{formatNumber(request.credits)}</em>
                        <span>
                          <i className={`status-pill ${statusMeta.tone}`}>{statusMeta.label}</i>
                          {request.adminNote ? <small>{request.adminNote}</small> : null}
                        </span>
                        <div className="admin-recharge-actions">
                          <div className="recharge-shortcuts">
                            {[50, 100, 500, 1000].map((credits) => (
                              <button
                                className={`tiny-action-button ${selectedCredits === credits ? 'selected' : ''}`}
                                disabled={!isPending || actionLocked}
                                key={credits}
                                type="button"
                                onClick={() => {
                                  setSelectedRechargeCredits((current) => ({ ...current, [request.id]: credits }));
                                  setError('');
                                }}
                              >
                                +{credits}
                              </button>
                            ))}
                          </div>
                          <button
                            className="primary-button compact"
                            disabled={!isPending || actionLocked || !selectedCredits}
                            title={!selectedCredits ? '请先选择快捷积分' : ''}
                            type="button"
                            onClick={() => handleApproveRechargeRequest(request.id)}
                          >
                            {reviewingRequestId === `${request.id}:approve` ? <Loader2 className="spin" size={16} /> : <Check size={16} />}
                            {selectedCredits ? `确认 +${selectedCredits}` : '确认到账'}
                          </button>
                          <button
                            className="ghost-button danger compact"
                            disabled={!isPending || actionLocked}
                            type="button"
                            onClick={() => handleRejectRechargeRequest(request.id)}
                          >
                            <AlertTriangle size={15} />
                            驳回
                          </button>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="admin-recharge-empty">暂无充值申请</div>
                )}
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
                        <small>{getUserIdentity(userItem)}</small>
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

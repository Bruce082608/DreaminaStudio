import { useState } from 'react';
import {
  AlertTriangle,
  Check,
  Coins,
  Loader2,
  Lock,
  LogOut,
  Mail,
  Phone,
  ShieldCheck,
  Sparkles,
  User,
  WandSparkles,
} from 'lucide-react';
import { apiRequest } from '../api/client';
import { BrandLogo } from '../components/AppChrome';
import { getUserIdentity } from '../utils/users';

export default function ProfilePage({ auth, onAuthUpdate, onLogout, onShowCreate, onShowCredits, onShowHome }) {
  const [name, setName] = useState(auth?.user?.name || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isSavingPassword, setIsSavingPassword] = useState(false);

  async function handleProfileSubmit(event) {
    event.preventDefault();
    setIsSavingProfile(true);
    setError('');
    setMessage('');

    try {
      const user = await apiRequest('/auth/me', {
        method: 'PATCH',
        authToken: auth?.token,
        body: JSON.stringify({ name }),
      });
      onAuthUpdate(user);
      setMessage('个人信息已更新');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setIsSavingProfile(false);
    }
  }

  async function handlePasswordSubmit(event) {
    event.preventDefault();
    setIsSavingPassword(true);
    setError('');
    setMessage('');

    try {
      if (newPassword !== confirmPassword) throw new Error('两次输入的新密码不一致');
      const user = await apiRequest('/auth/password', {
        method: 'PUT',
        authToken: auth?.token,
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      onAuthUpdate(user);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setMessage('密码已修改');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setIsSavingPassword(false);
    }
  }

  return (
    <main className="workspace-shell profile-page-shell">
      <header className="app-header">
        <div className="brand-mark">
          <BrandLogo />
          <span>Dreamina Studio</span>
        </div>
        <div className="header-actions">
          <button className="icon-text-button" onClick={onShowCredits}>
            <Coins size={16} />
            积分
          </button>
          <button className="icon-text-button" onClick={onShowCreate}>
            <WandSparkles size={16} />
            创作台
          </button>
          <button className="icon-text-button" onClick={onShowHome}>
            <Sparkles size={16} />
            团队官网
          </button>
          <button className="icon-button" title="退出登录" onClick={onLogout}>
            <LogOut size={18} />
          </button>
        </div>
      </header>

      <section className="profile-dashboard">
        <div className="profile-hero">
          <div>
            <div className="eyebrow">
              <User size={14} />
              个人中心
            </div>
            <h1>{auth?.user?.name || '个人信息'}</h1>
            <p>{getUserIdentity(auth?.user)}</p>
          </div>
          <div className="profile-avatar">{(auth?.user?.name || 'U').slice(0, 1).toUpperCase()}</div>
        </div>

        {message ? <div className="api-success">{message}</div> : null}
        {error ? (
          <div className="api-error">
            <AlertTriangle size={15} />
            <span>{error}</span>
          </div>
        ) : null}

        <div className="profile-grid">
          <form className="profile-panel" onSubmit={handleProfileSubmit}>
            <div className="section-heading">
              <span>
                <User size={18} />
                基本信息
              </span>
              <small>修改用户名</small>
            </div>
            <label className="auth-field">
              <span>用户名</span>
              <div>
                <User size={17} />
                <input value={name} onChange={(event) => setName(event.target.value)} />
              </div>
            </label>
            <label className="auth-field">
              <span>登录账号</span>
              <div>
                {auth?.user?.phone ? <Phone size={17} /> : <Mail size={17} />}
                <input value={getUserIdentity(auth?.user)} readOnly />
              </div>
            </label>
            <button className="submit-button" disabled={isSavingProfile || !name.trim()}>
              {isSavingProfile ? <Loader2 className="spin" size={18} /> : <Check size={18} />}
              保存用户名
            </button>
          </form>

          <form className="profile-panel" onSubmit={handlePasswordSubmit}>
            <div className="section-heading">
              <span>
                <Lock size={18} />
                修改密码
              </span>
              <small>需要验证当前密码</small>
            </div>
            <label className="auth-field">
              <span>当前密码</span>
              <div>
                <Lock size={17} />
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                />
              </div>
            </label>
            <label className="auth-field">
              <span>新密码</span>
              <div>
                <Lock size={17} />
                <input
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  placeholder="至少 8 位"
                />
              </div>
            </label>
            <label className="auth-field">
              <span>确认新密码</span>
              <div>
                <Lock size={17} />
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                />
              </div>
            </label>
            <button
              className="submit-button"
              disabled={isSavingPassword || !currentPassword || !newPassword || !confirmPassword}
            >
              {isSavingPassword ? <Loader2 className="spin" size={18} /> : <ShieldCheck size={18} />}
              修改密码
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}

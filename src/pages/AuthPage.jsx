import { useState } from 'react';
import {
  AlertTriangle,
  Coins,
  CreditCard,
  Loader2,
  Lock,
  LogIn,
  Mail,
  ShieldCheck,
  User,
  UserPlus,
} from 'lucide-react';
import { apiRequest } from '../api/client';
import { BrandLogo } from '../components/AppChrome';

export default function AuthPage({ mode, onAuthSuccess, onSwitchMode, onShowHome }) {
  const isRegister = mode === 'register';
  const [name, setName] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSendingCode, setIsSendingCode] = useState(false);
  const [codeMessage, setCodeMessage] = useState('');
  const [error, setError] = useState('');

  async function handleSendCode() {
    setError('');
    setCodeMessage('');
    setDevCode('');
    setIsSendingCode(true);

    try {
      const result = await apiRequest('/auth/request-code', {
        method: 'POST',
        body: JSON.stringify({
          channel: 'email',
          identifier,
          purpose: 'register',
        }),
      });
      setCodeMessage(`验证码已发送，${Math.round(result.expiresIn / 60)} 分钟内有效。`);
      if (result.devCode) setDevCode(result.devCode);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setIsSendingCode(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setIsSubmitting(true);
    setError('');

    try {
      if (isRegister && password !== confirmPassword) {
        throw new Error('两次输入的密码不一致');
      }
      const payload = isRegister
        ? { name, channel: 'email', identifier, code, password }
        : { identifier, password };
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
              <p>{isRegister ? '使用邮箱验证码完成注册并设置密码' : '使用邮箱登录'}</p>
            </div>
          </div>

          {isRegister ? (
            <>
              <label className="auth-field">
                <span>姓名 / 昵称</span>
                <div>
                  <User size={17} />
                  <input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：Bruce" />
                </div>
              </label>
            </>
          ) : null}

          <label className="auth-field">
            <span>邮箱</span>
            <div>
              <Mail size={17} />
              <input
                type="email"
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                placeholder="you@example.com"
              />
            </div>
          </label>

          {isRegister ? (
            <div className="verification-row">
              <label className="auth-field">
                <span>验证码</span>
                <div>
                  <ShieldCheck size={17} />
                  <input
                    inputMode="numeric"
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    placeholder="6 位验证码"
                  />
                </div>
              </label>
              <button
                className="secondary-link-button"
                disabled={isSendingCode || !identifier.trim()}
                onClick={handleSendCode}
                type="button"
              >
                {isSendingCode ? <Loader2 className="spin" size={16} /> : <Mail size={16} />}
                {isSendingCode ? '发送中' : '获取验证码'}
              </button>
            </div>
          ) : null}

          {codeMessage ? <div className="api-success">{codeMessage}</div> : null}
          {devCode ? <div className="dev-code-hint">本地测试验证码：{devCode}</div> : null}

          <label className="auth-field">
            <span>{isRegister ? '设置密码' : '密码'}</span>
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

          {isRegister ? (
            <label className="auth-field">
              <span>确认密码</span>
              <div>
                <Lock size={17} />
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="再次输入密码"
                />
              </div>
            </label>
          ) : null}

          {error ? (
            <div className="api-error">
              <AlertTriangle size={15} />
              <span>{error}</span>
            </div>
          ) : null}

          <button
            className="submit-button"
            disabled={
              isSubmitting
              || !identifier.trim()
              || !password.trim()
              || (isRegister && (!name.trim() || !code.trim() || !confirmPassword.trim()))
            }
          >
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

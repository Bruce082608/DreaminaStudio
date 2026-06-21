import { Coins, User } from 'lucide-react';
import { formatNumber } from '../utils/formatters';

export function BrandLogo() {
  return <img className="brand-logo-image" src="/dreamina-logo.png" alt="" />;
}

export function CreditNavButton({ balance, onClick }) {
  return (
    <button className="credit-nav-button" onClick={onClick} type="button">
      <Coins size={16} />
      <span>积分</span>
      <strong>{formatNumber(balance, '0')}</strong>
    </button>
  );
}

export function UserIdentityButton({ user, onClick }) {
  return (
    <button className="session-chip session-chip-button" onClick={onClick} type="button">
      <User size={15} />
      <span>{user?.name || '个人信息'}</span>
    </button>
  );
}

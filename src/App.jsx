import { useEffect, useState } from 'react';
import useBilling from './hooks/useBilling';
import AdminPage from './pages/AdminPage';
import AuthPage from './pages/AuthPage';
import CreditPage from './pages/CreditPage';
import IntroPage from './pages/IntroPage';
import ProfilePage from './pages/ProfilePage';
import WorkspacePage from './pages/WorkspacePage';
import './App.css';

const HOME_ROUTE = '#/';
const CREATE_ROUTE = '#/create';
const LOGIN_ROUTE = '#/login';
const REGISTER_ROUTE = '#/register';
const ADMIN_ROUTE = '#/admin';
const CREDIT_ROUTE = '#/credits';
const PROFILE_ROUTE = '#/profile';
const AUTH_STORAGE_KEY = 'dreamina_studio_auth';

function getPageFromHash() {
  if (typeof window === 'undefined') return 'home';

  const routeMap = {
    [CREATE_ROUTE]: 'create',
    [LOGIN_ROUTE]: 'login',
    [REGISTER_ROUTE]: 'register',
    [ADMIN_ROUTE]: 'admin',
    [CREDIT_ROUTE]: 'credits',
    [PROFILE_ROUTE]: 'profile',
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

export default function App() {
  const [page, setPage] = useState(() => getPageFromHash());
  const [auth, setAuth] = useState(() => readStoredAuth());
  const billingState = useBilling(auth?.token, auth?.user);

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

  function handleAuthUpdate(nextUser) {
    setAuth((currentAuth) => {
      if (!currentAuth) return currentAuth;
      const nextAuth = { ...currentAuth, user: nextUser };
      window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(nextAuth));
      return nextAuth;
    });
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
        billingState={billingState}
        onShowCredits={() => goTo(auth?.user ? CREDIT_ROUTE : LOGIN_ROUTE)}
        onShowIntro={showIntroAgain}
        onShowCreate={() => goTo(auth?.user ? CREATE_ROUTE : LOGIN_ROUTE)}
        onShowLogin={() => goTo(LOGIN_ROUTE)}
        onShowProfile={() => goTo(auth?.user ? PROFILE_ROUTE : LOGIN_ROUTE)}
        onLogout={handleLogout}
      />
    );
  }

  if (page === 'profile') {
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
      <ProfilePage
        auth={auth}
        onAuthUpdate={handleAuthUpdate}
        onLogout={handleLogout}
        onShowCreate={() => goTo(CREATE_ROUTE)}
        onShowCredits={() => goTo(CREDIT_ROUTE)}
        onShowHome={showIntroAgain}
      />
    );
  }

  if (page === 'credits') {
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
      <CreditPage
        auth={auth}
        billingState={billingState}
        onLogout={handleLogout}
        onShowCreate={() => goTo(CREATE_ROUTE)}
        onShowHome={showIntroAgain}
        onShowProfile={() => goTo(PROFILE_ROUTE)}
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
      <WorkspacePage
        auth={auth}
        billingState={billingState}
        onShowCredits={() => goTo(CREDIT_ROUTE)}
        onShowIntro={showIntroAgain}
        onShowAdmin={() => goTo(ADMIN_ROUTE)}
        onShowProfile={() => goTo(PROFILE_ROUTE)}
        onLogout={handleLogout}
      />
    );
  }

  return <IntroPage onStart={enterWorkspace} />;
}

export function getUserIdentity(user) {
  return user?.email || user?.phone || '未绑定';
}

export function formatDate(timestamp) {
  if (!timestamp) return '尚未登录';

  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp * 1000));
}

export function formatNumber(value, emptyLabel = '暂无数据') {
  if (value === null || value === undefined || value === '') return emptyLabel;
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  return new Intl.NumberFormat('zh-CN').format(number);
}

export function formatCny(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return `${value}元`;
  return Number.isInteger(number) ? `${number}元` : `${number.toFixed(2)}元`;
}

export function formatJimengVip(level) {
  const vipMap = {
    maestro: '高级会员 Maestro',
    premium: '高级会员',
    pro: 'Pro 会员',
    standard: '标准账号',
  };
  return vipMap[level] || level || '未登录';
}

export function getJimengTaskStatusMeta(status) {
  const statusMap = {
    success: { label: '成功', tone: 'done' },
    fail: { label: '失败', tone: 'failed' },
    failed: { label: '失败', tone: 'failed' },
    running: { label: '生成中', tone: 'active' },
    processing: { label: '生成中', tone: 'active' },
    pending: { label: '等待中', tone: 'queued' },
  };
  return statusMap[status] || { label: status || '未知', tone: 'queued' };
}

export function compactSubmitId(submitId) {
  if (!submitId) return '无任务 ID';
  const value = String(submitId);
  if (value.length <= 18) return value;
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

export function getJimengTaskCredit(task) {
  return task?.commerce_info?.credit_count ?? 0;
}

export function getJimengTaskBenefit(task) {
  const triplets = task?.commerce_info?.triplets;
  if (Array.isArray(triplets) && triplets.length > 0) {
    return triplets.map((item) => item?.benefit_type).filter(Boolean).join(' / ') || '未标记权益';
  }
  return task?.commerce_info?.triplet?.benefit_type || '未标记权益';
}

export function getJimengTaskVideoMeta(task) {
  const video = task?.result_json?.videos?.[0];
  if (!video) return task?.fail_reason || '暂无视频结果';

  const size = video.width && video.height ? `${video.width}x${video.height}` : '未知尺寸';
  const duration = Number.isFinite(Number(video.duration)) ? `${Number(video.duration).toFixed(1)}秒` : '未知时长';
  const fps = video.fps ? `${video.fps}fps` : '未知帧率';
  return `${size} · ${duration} · ${fps} · ${video.format || 'mp4'}`;
}

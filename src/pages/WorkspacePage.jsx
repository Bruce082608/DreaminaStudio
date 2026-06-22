import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BadgeCheck,
  Bot,
  Check,
  Clapperboard,
  Clock3,
  Download,
  Film,
  GalleryVerticalEnd,
  ImagePlus,
  Layers3,
  Loader2,
  Lock,
  LogOut,
  Play,
  Plus,
  RefreshCw,
  Scissors,
  Settings2,
  Shield,
  Sparkles,
  UploadCloud,
  WandSparkles,
  Workflow,
  Zap,
} from 'lucide-react';
import { API_BASE_URL, apiRequest } from '../api/client';
import { BrandLogo, CreditNavButton, UserIdentityButton } from '../components/AppChrome';
import {
  calculateCreditCost,
  durationOptions,
  getJimengModelOption,
  jimengModelOptions,
  ratioOptions,
  segmentDurationOptions,
  styleOptions,
} from '../config/creation';

import StatusPill from '../components/workspace/StatusPill';
import {
  AGENT_FAST_POLL_INTERVAL,
  AGENT_POLL_INTERVAL,
  agentStageIndexes,
  agentStageLabels,
  agentStages,
  initialWorkspace,
} from '../config/workspace';
import { createScenes } from '../utils/workspace';

const MAX_REFERENCE_IMAGES = 9;
const MAX_SCENE_IMAGES = 9;
const POLLABLE_RUN_STATUSES = new Set(['queued', 'planning', 'generating']);

function getReferenceLabel(index) {
  return `图片${index + 1}`;
}

function getSceneImageLabel(index) {
  return `场景${index + 1}`;
}

function createReferenceImageId(file) {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${file.name}-${file.lastModified}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getReferenceMentionState(value, caretPosition) {
  const beforeCaret = value.slice(0, caretPosition);
  const match = /(^|\s)@([^@\s]*)$/.exec(beforeCaret);
  if (!match) return null;
  return {
    start: match.index + match[1].length,
    end: caretPosition,
    query: match[2] || '',
  };
}

function isSegmentDurationAvailable(totalDuration, singleDuration) {
  return totalDuration % singleDuration === 0 && Math.ceil(totalDuration / singleDuration) <= 40;
}

function getPreferredSegmentDuration(totalDuration) {
  return [...segmentDurationOptions]
    .reverse()
    .find((option) => isSegmentDurationAvailable(totalDuration, option)) || segmentDurationOptions[0];
}

function mapAgentSceneStatus(status) {
  return {
    completed: 'done',
    generating: 'active',
    failed: 'failed',
    waiting: 'waiting',
    queued: 'queued',
  }[status] || 'queued';
}

function getNextPollInterval(latestRun) {
  if (latestRun.status === 'generating' || String(latestRun.stage || '').startsWith('jimeng')) {
    return AGENT_POLL_INTERVAL;
  }
  return AGENT_FAST_POLL_INTERVAL;
}

function formatRefreshTime(timestamp) {
  if (!timestamp) return '尚未同步';
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

function formatHistoryTime(timestamp) {
  if (!timestamp) return '未知时间';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp * 1000));
}

function getRunStatusLabel(status) {
  return {
    queued: '排队中',
    planning: '编写分镜',
    awaiting_confirmation: '待确认',
    generating: '生成中',
    completed: '已完成',
    failed: '失败',
  }[status] || '处理中';
}

function getRunHistoryTitle(run) {
  const firstLine = String(run?.idea || '').split('\n').find(Boolean) || '未命名任务';
  return firstLine.length > 24 ? `${firstLine.slice(0, 24)}...` : firstLine;
}

const failureCategoryLabels = {
  upload: '上传',
  audit: '审核',
  platform: '平台',
  account: '账号',
  input: '素材',
  timeout: '超时',
  unknown: '失败',
};

const failureCategoryTitles = {
  upload: '参考素材上传失败',
  audit: '内容审核未通过',
  platform: '即梦平台接口异常',
  account: '即梦账号或额度异常',
  input: '素材或参数不被接受',
  timeout: '即梦生成超时',
  unknown: '即梦生成失败',
};

const failureCategoryDetails = {
  upload: '即梦上传参考素材时没有拿到完整上传结果，通常是平台上传通道或网络瞬时异常；系统会复查任务状态，必要时可稍后重试。',
  audit: '提示词或参考图可能命中了平台审核规则，请调整敏感动作、人物关系、暴力/低俗描述或参考图后重试。',
  platform: '即梦平台返回接口失败，通常不是分镜本身的问题，可稍后重试。',
  account: '即梦账号状态、登录态、额度或并发限制可能异常，请检查后台即梦账号状态。',
  input: '参考图、提示词或生成参数未被即梦接受，请检查图片格式、内容和分镜描述。',
  timeout: '平台长时间没有返回结果，可能仍在排队或服务繁忙，可稍后重试。',
  unknown: '即梦返回失败状态，但没有提供更明确的原因。',
};

function compactFailureText(value, maxLength = 180) {
  if (value === null || value === undefined) return '';
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength).trim()}...` : text;
}

function parseFailurePayload(errorText) {
  const text = String(errorText || '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;

  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function findFailureValue(value, keys) {
  if (!value) return '';
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFailureValue(item, keys);
      if (found) return found;
    }
    return '';
  }
  if (typeof value !== 'object') return '';

  for (const [key, nested] of Object.entries(value)) {
    if (keys.has(key.toLowerCase()) && nested !== null && nested !== undefined && nested !== '') {
      return nested;
    }
  }
  for (const nested of Object.values(value)) {
    const found = findFailureValue(nested, keys);
    if (found) return found;
  }
  return '';
}

function inferFailureCategory(reason, detail) {
  const combined = `${reason || ''} ${detail || ''}`.toLowerCase();
  if (/upload resource|upload image|no file upload|上传素材|上传图片|上传失败/.test(combined)) return 'upload';
  if (/审核|违规|敏感|sensitive|risk|policy|violation|unsafe/.test(combined)) return 'audit';
  if (/timeout|timed out|超时|排队|busy|繁忙/.test(combined)) return 'timeout';
  if (/api|server|internal|service|系统|平台|接口/.test(combined)) return 'platform';
  if (/quota|credit|balance|rate|login|auth|积分|额度|余额|登录|并发/.test(combined)) return 'account';
  if (/image|file|format|prompt|param|图片|素材|格式|参数|提示词/.test(combined)) return 'input';
  return 'unknown';
}

function getSceneFailureInfo(scene) {
  const payload = parseFailurePayload(scene?.error);
  const reason = compactFailureText(
    scene?.failureReason || findFailureValue(payload, new Set(['fail_reason', 'failreason', 'failure_reason', 'reason_code', 'error_code', 'code'])),
    80,
  );
  const payloadDetail = compactFailureText(findFailureValue(payload, new Set([
    'fail_message',
    'fail_msg',
    'failure_message',
    'status_msg',
    'status_message',
    'message',
    'msg',
    'error',
    'error_msg',
    'error_message',
    'detail',
    'reason',
    'description',
  ])));
  const rawError = compactFailureText(String(scene?.error || '').replace(/^即梦\s*CLI\s*(生成)?失败[:：]\s*/, ''));
  const category = scene?.failureCategory || inferFailureCategory(reason, scene?.failureDetail || payloadDetail || rawError);
  const title = scene?.failureTitle || failureCategoryTitles[category] || failureCategoryTitles.unknown;
  let detail = scene?.failureDetail || payloadDetail;

  if (reason.toLowerCase() === 'api') {
    detail = '即梦返回 API 失败，通常是平台接口或服务侧异常；如果同一分镜连续失败，再检查提示词和参考图。';
  } else if (!detail || detail.toLowerCase() === reason.toLowerCase()) {
    detail = failureCategoryDetails[category] || rawError || failureCategoryDetails.unknown;
  }

  const submitId = scene?.failureSubmitId || compactFailureText(findFailureValue(payload, new Set(['submit_id', 'submitid', 'task_id', 'taskid'])), 120);
  const logId = scene?.failureLogId || compactFailureText(findFailureValue(payload, new Set(['logid', 'log_id', 'request_id', 'trace_id'])), 120);
  const metadata = [
    reason ? `原因码：${reason}` : '',
    submitId ? `提交ID：${submitId}` : '',
    logId ? `日志ID：${logId}` : '',
  ].filter(Boolean);

  return {
    category,
    categoryLabel: failureCategoryLabels[category] || failureCategoryLabels.unknown,
    title,
    detail: detail || rawError || failureCategoryDetails.unknown,
    metadata,
  };
}

function getSceneQueueInfo(scene) {
  const position = Number(scene?.queuePosition || 0);
  const total = Number(scene?.queueTotal || 0);
  const queueStatus = String(scene?.queueStatus || '');
  const isAccountPoolQueue = queueStatus === 'account_pool_waiting';

  if (isAccountPoolQueue) {
    const safePosition = Math.max(position || 1, 1);
    const safeTotal = Math.max(total || safePosition, safePosition);
    const ahead = Number.isFinite(Number(scene?.queueAhead)) ? Math.max(Number(scene.queueAhead), 0) : Math.max(safePosition - 1, 0);
    const active = Number(scene?.queueActive || 0);
    const capacity = Number(scene?.queueCapacity || 0);
    const occupancy = capacity > 0 ? `号池 ${Math.min(active, capacity)}/${capacity} 占用` : '';
    const progress = Math.max(0, Math.min(95, Math.round(((safeTotal - safePosition) / safeTotal) * 100)));
    return {
      label: `号池排队第 ${safePosition} 位 / 共 ${safeTotal} 个等待`,
      meta: [`前方 ${ahead} 个`, occupancy].filter(Boolean).join(' · '),
      progress,
      status: queueStatus,
      accountLabel: '',
    };
  }

  if (!position || !total) return null;

  const progress = Math.max(0, Math.min(100, Math.round(((total - position) / total) * 100)));
  return {
    label: `即梦排队 ${position}/${total}`,
    meta: '',
    progress,
    status: queueStatus,
    accountLabel: scene?.jimengAccountAlias || scene?.jimengAccountId || '',
  };
}

function isRunPollable(run) {
  return POLLABLE_RUN_STATUSES.has(run?.status);
}

function buildRestoredReferenceImages(run, { sceneReferences = false } = {}) {
  const ids = sceneReferences ? run.sceneImageIds || [] : run.imageIds || [];
  const names = sceneReferences ? run.sceneImageNames || [] : run.imageNames || [];
  const references = sceneReferences ? run.sceneImageReferences || [] : run.imageReferences || [];
  const fallbackFactory = sceneReferences ? getSceneImageLabel : getReferenceLabel;
  const referenceById = new Map(references.map((reference) => [reference.id, reference]));

  return ids.slice(0, MAX_REFERENCE_IMAGES).map((uploadId, index) => {
    const reference = referenceById.get(uploadId);
    const refName = (reference?.label || '').replace(/^@/, '') || fallbackFactory(index);
    const name = reference?.name || names[index] || refName;
    return {
      id: `restored-${uploadId}`,
      uploadId,
      refName,
      token: `@${refName}`,
      name,
      url: '',
      file: null,
    };
  });
}

export default function WorkspacePage({ auth, billingState, onShowCredits, onShowIntro, onShowAdmin, onShowProfile, onLogout }) {
  const timers = useRef([]);
  const imageUrls = useRef(new Set());
  const ideaTextareaRef = useRef(null);
  const scenesRef = useRef([]);
  const activeRunIdRef = useRef('');
  const runStatusRef = useRef('idle');
  const restoreAgentRunRef = useRef(null);
  const [idea, setIdea] = useState(initialWorkspace.idea);
  const [duration, setDuration] = useState(initialWorkspace.duration);
  const [segmentDuration, setSegmentDuration] = useState(initialWorkspace.segmentDuration);
  const [style, setStyle] = useState(initialWorkspace.style);
  const [ratio, setRatio] = useState(initialWorkspace.ratio);
  const [jimengModel, setJimengModel] = useState(initialWorkspace.jimengModel);
  const [images, setImages] = useState([]);
  const [sceneLimit, setSceneLimit] = useState('');
  const [sceneImages, setSceneImages] = useState([]);
  const [blockSubtitles, setBlockSubtitles] = useState(true);
  const [soundEffectOnly, setSoundEffectOnly] = useState(false);
  const [forceMute, setForceMute] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [stageIndex, setStageIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [scenes, setScenes] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [selectedCandidateId, setSelectedCandidateId] = useState('');
  const [activeRunId, setActiveRunId] = useState('');
  const [isConfirming, setIsConfirming] = useState(false);
  const [apiStatus, setApiStatus] = useState('正在连接创作服务...');
  const [apiError, setApiError] = useState('');
  const [finalVideoUrl, setFinalVideoUrl] = useState('');
  const [previewSceneId, setPreviewSceneId] = useState('');
  const [runStatus, setRunStatus] = useState('idle');
  const [runHistory, setRunHistory] = useState([]);
  const [isRestoringRuns, setIsRestoringRuns] = useState(false);
  const [referenceMenu, setReferenceMenu] = useState({
    open: false,
    start: 0,
    end: 0,
    query: '',
    selectedIndex: 0,
  });
  const [lastProgressRefreshAt, setLastProgressRefreshAt] = useState(null);
  const [retryingSceneId, setRetryingSceneId] = useState('');
  const { billing, refreshBilling } = billingState;

  scenesRef.current = scenes;
  activeRunIdRef.current = activeRunId;
  runStatusRef.current = runStatus;

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
  const referenceImages = useMemo(
    () => images.map((image, index) => ({
      ...image,
      refName: image.refName || getReferenceLabel(index),
      token: `@${image.refName || getReferenceLabel(index)}`,
    })),
    [images],
  );
  const sceneReferenceImages = useMemo(
    () => sceneImages.map((image, index) => ({
      ...image,
      refName: image.refName || getSceneImageLabel(index),
      token: `@${image.refName || getSceneImageLabel(index)}`,
    })),
    [sceneImages],
  );
  const referenceMenuOptions = useMemo(() => {
    if (!referenceMenu.open) return [];
    const query = referenceMenu.query.trim().toLowerCase();
    return referenceImages.filter((image) => {
      if (!query) return true;
      return image.refName.toLowerCase().includes(query) || image.name.toLowerCase().includes(query);
    });
  }, [referenceImages, referenceMenu.open, referenceMenu.query]);
  const queueSummary = useMemo(() => {
    const counts = scenes.reduce(
      (summary, scene) => {
        const status = scene.status || 'queued';
        return { ...summary, [status]: (summary[status] || 0) + 1 };
      },
      { queued: 0, waiting: 0, active: 0, done: 0, failed: 0 },
    );
    const total = scenes.length;
    const outOfQueue = counts.done + counts.active + counts.failed;
    const queueProgress = total > 0 ? Math.round((outOfQueue / total) * 100) : progress;
    const label = counts.failed > 0
      ? '存在失败'
      : runStatus === 'generating'
      ? counts.active > 0 ? '生成中' : counts.waiting > 0 ? '等待中' : '排队中'
      : runStatus === 'awaiting_confirmation'
        ? '等待确认'
        : runStatus === 'completed'
          ? '已完成'
          : runStatus === 'failed'
            ? '处理失败'
            : scenes.length > 0 ? '排队中' : '待提交';

    return {
      ...counts,
      total,
      queueProgress,
      label,
    };
  }, [progress, runStatus, scenes]);
  const failedScenes = useMemo(
    () => scenes.filter((scene) => scene.status === 'failed'),
    [scenes],
  );
  const queuedSceneInfos = useMemo(
    () => scenes
      .map((scene) => ({ scene, queue: getSceneQueueInfo(scene) }))
      .filter(({ scene, queue }) => queue && ['queued', 'waiting', 'active'].includes(scene.status)),
    [scenes],
  );
  const primaryQueueInfo = queuedSceneInfos[0] || null;
  const selectedPreviewScene = useMemo(
    () => scenes.find((scene) => scene.id === previewSceneId && scene.videoUrl),
    [previewSceneId, scenes],
  );
  const previewVideoUrl = selectedPreviewScene?.videoUrl || finalVideoUrl;
  const progressRefreshLabel = formatRefreshTime(lastProgressRefreshAt);

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
    if (!auth?.token) return undefined;

    let isMounted = true;
    setIsRestoringRuns(true);

    apiRequest('/agent/runs?limit=20', { authToken: auth.token })
      .then(async (runs) => {
        if (!isMounted) return;
        setRunHistory(runs);
        const resumableRun = runs.find((run) => ['queued', 'planning', 'generating', 'awaiting_confirmation'].includes(run.status));
        if (resumableRun && runStatusRef.current === 'idle' && !activeRunIdRef.current) {
          await restoreAgentRunRef.current?.(resumableRun, { poll: true });
        }
      })
      .catch((error) => {
        if (isMounted) setApiError(error.message);
      })
      .finally(() => {
        if (isMounted) setIsRestoringRuns(false);
      });

    return () => {
      isMounted = false;
    };
  }, [auth?.token]);

  useEffect(() => {
    if (!isSegmentDurationAvailable(duration, segmentDuration)) {
      setSegmentDuration(getPreferredSegmentDuration(duration));
    }
  }, [duration, segmentDuration]);

  useEffect(() => {
    if (!referenceMenu.open) return;
    if (referenceMenuOptions.length === 0) {
      setReferenceMenu((current) => ({ ...current, selectedIndex: 0 }));
      return;
    }
    if (referenceMenu.selectedIndex >= referenceMenuOptions.length) {
      setReferenceMenu((current) => ({ ...current, selectedIndex: 0 }));
    }
  }, [referenceMenu.open, referenceMenu.selectedIndex, referenceMenuOptions.length]);

  useEffect(() => {
    if (runStatus !== 'idle') return;
    if (!idea.trim()) {
      if (scenesRef.current.length > 0) {
        scenesRef.current = [];
        setScenes([]);
      }
      return;
    }

    const draftScenes = createScenes(duration, idea, style, segmentDuration);
    scenesRef.current = draftScenes;
    setScenes(draftScenes);
  }, [duration, idea, style, segmentDuration, runStatus]);

  function clearTaskTimers() {
    timers.current.forEach((timer) => clearTimeout(timer));
    timers.current = [];
  }

  function closeReferenceMenu() {
    setReferenceMenu((current) => ({ ...current, open: false, selectedIndex: 0 }));
  }

  function updateReferenceMenuForCaret(value, caretPosition) {
    if (runLocked || referenceImages.length === 0) {
      closeReferenceMenu();
      return;
    }

    const mentionState = getReferenceMentionState(value, caretPosition);
    if (!mentionState) {
      closeReferenceMenu();
      return;
    }

    setReferenceMenu({
      open: true,
      start: mentionState.start,
      end: mentionState.end,
      query: mentionState.query,
      selectedIndex: 0,
    });
  }

  function handleIdeaChange(event) {
    const nextIdea = event.target.value;
    setIdea(nextIdea);
    updateReferenceMenuForCaret(nextIdea, event.target.selectionStart);
  }

  function insertReferenceMention(image) {
    const token = image.token || `@${image.refName}`;
    const nextCaretPosition = referenceMenu.start + token.length + 1;
    setIdea((currentIdea) => {
      const before = currentIdea.slice(0, referenceMenu.start);
      const after = currentIdea.slice(referenceMenu.end);
      const suffix = after.startsWith(' ') || after.startsWith('\n') || after.length === 0 ? after : ` ${after}`;
      return `${before}${token} ${suffix}`;
    });
    closeReferenceMenu();
    requestAnimationFrame(() => {
      ideaTextareaRef.current?.focus();
      ideaTextareaRef.current?.setSelectionRange(nextCaretPosition, nextCaretPosition);
    });
  }

  function handleIdeaKeyDown(event) {
    if (!referenceMenu.open || referenceMenuOptions.length === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setReferenceMenu((current) => ({
        ...current,
        selectedIndex: (current.selectedIndex + 1) % referenceMenuOptions.length,
      }));
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setReferenceMenu((current) => ({
        ...current,
        selectedIndex: (current.selectedIndex - 1 + referenceMenuOptions.length) % referenceMenuOptions.length,
      }));
      return;
    }

    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      insertReferenceMention(referenceMenuOptions[referenceMenu.selectedIndex]);
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      closeReferenceMenu();
    }
  }

  function revokeWorkspaceImageUrls() {
    [...images, ...sceneImages].forEach((image) => {
      if (image.url && imageUrls.current.has(image.url)) {
        URL.revokeObjectURL(image.url);
        imageUrls.current.delete(image.url);
      }
    });
  }

  function upsertRunHistory(run) {
    setRunHistory((current) => {
      const merged = [run, ...current.filter((item) => item.id !== run.id)];
      return merged
        .sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0))
        .slice(0, 20);
    });
  }

  async function fetchUploadObjectUrl(uploadId) {
    const response = await fetch(`${API_BASE_URL}/agent/uploads/${encodeURIComponent(uploadId)}/content`, {
      headers: {
        Authorization: `Bearer ${auth?.token}`,
      },
    });
    if (!response.ok) return '';
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    imageUrls.current.add(objectUrl);
    return objectUrl;
  }

  async function hydrateReferenceImageUrls(restoredImages, setter) {
    if (!auth?.token || restoredImages.length === 0) return;
    const hydratedImages = await Promise.all(restoredImages.map(async (image) => {
      if (!image.uploadId || image.url) return image;
      try {
        const url = await fetchUploadObjectUrl(image.uploadId);
        return url ? { ...image, url } : image;
      } catch {
        return image;
      }
    }));
    setter((currentImages) => currentImages.map((image) => {
      const hydrated = hydratedImages.find((item) => item.uploadId === image.uploadId);
      return hydrated || image;
    }));
  }

  async function hydrateRunReferenceImages(restoredImages, restoredSceneImages) {
    await Promise.all([
      hydrateReferenceImageUrls(restoredImages, setImages),
      hydrateReferenceImageUrls(restoredSceneImages, setSceneImages),
    ]);
  }

  function applyRunToWorkspace(latestRun) {
    const restoredImages = buildRestoredReferenceImages(latestRun);
    const restoredSceneImages = buildRestoredReferenceImages(latestRun, { sceneReferences: true });

    revokeWorkspaceImageUrls();
    setActiveRunId(latestRun.id);
    setIdea(latestRun.idea || '');
    setDuration(latestRun.duration || initialWorkspace.duration);
    setSegmentDuration(
      isSegmentDurationAvailable(latestRun.duration, latestRun.segmentDuration)
        ? latestRun.segmentDuration
        : getPreferredSegmentDuration(latestRun.duration || initialWorkspace.duration),
    );
    setStyle(latestRun.style || initialWorkspace.style);
    setRatio(latestRun.ratio || initialWorkspace.ratio);
    setJimengModel(latestRun.jimengModel || initialWorkspace.jimengModel);
    setImages(restoredImages);
    setSceneLimit(latestRun.sceneLimit || '');
    setSceneImages(restoredSceneImages);
    setBlockSubtitles(latestRun.blockSubtitles !== false);
    setSoundEffectOnly(Boolean(latestRun.soundEffectOnly));
    setForceMute(Boolean(latestRun.forceMute));
    setCandidates(latestRun.candidates || []);
    setSelectedCandidateId(latestRun.selectedCandidateId || latestRun.candidates?.[0]?.id || '');
    setFinalVideoUrl(latestRun.finalVideoUrl || '');
    setPreviewSceneId('');
    setIsConfirming(false);
    closeReferenceMenu();
    hydrateRunReferenceImages(restoredImages, restoredSceneImages);
  }

  async function restoreAgentRun(latestRun, { poll = false } = {}) {
    clearTaskTimers();
    applyRunToWorkspace(latestRun);
    const isFinished = syncAgentRun(latestRun);
    setIsGenerating(isRunPollable(latestRun));
    setApiError(latestRun.status === 'failed' ? latestRun.error || '任务未能完成，请稍后重试。' : '');

    if (poll && !isFinished) {
      timers.current = [setTimeout(() => pollAgentRun(latestRun.id), 400)];
    }
  }

  restoreAgentRunRef.current = restoreAgentRun;

  function syncAgentRun(latestRun) {
    let syncedScenes = latestRun.scenes.length > 0
      ? latestRun.scenes.map((scene) => ({
          ...scene,
          status: mapAgentSceneStatus(scene.status),
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
    setActiveRunId(latestRun.id);
    setProgress(latestRun.progress ?? 0);
    setRunStatus(latestRun.status);
    setStageIndex(agentStageIndexes[latestRun.stage] ?? 0);
    setApiStatus(`任务状态：${agentStageLabels[latestRun.stage] || latestRun.stage}`);
    setLastProgressRefreshAt(Date.now());
    upsertRunHistory(latestRun);

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
      if (latestRun.scenes?.some((scene) => scene.creditRefundedAt)) {
        await refreshBilling();
      }

      if (isFinished) {
        clearTaskTimers();
        setIsGenerating(false);
        return;
      }

      timers.current = [setTimeout(() => pollAgentRun(runId), getNextPollInterval(latestRun))];
    } catch (error) {
      clearTaskTimers();
      setApiError(error.message);
      setRunStatus('failed');
      setIsGenerating(false);
    }
  }

  function handleImageUpload(event) {
    const files = Array.from(event.target.files || []);
    const availableSlots = Math.max(MAX_REFERENCE_IMAGES - images.length, 0);
    const acceptedFiles = files.slice(0, availableSlots);

    if (files.length > availableSlots) {
      setApiError(`最多同时上传 ${MAX_REFERENCE_IMAGES} 张参考图片，已保留前 ${MAX_REFERENCE_IMAGES} 张。`);
    }

    const nextImages = acceptedFiles.map((file, fileIndex) => {
      const refName = getReferenceLabel(images.length + fileIndex);
      return {
        id: createReferenceImageId(file),
        refName,
        token: `@${refName}`,
        name: file.name,
        url: URL.createObjectURL(file),
        file,
        uploadId: '',
      };
    });

    if (nextImages.length === 0) {
      event.target.value = '';
      return;
    }

    nextImages.forEach((image) => imageUrls.current.add(image.url));

    setImages((current) => {
      const allImages = [...current, ...nextImages];
      const visibleImages = allImages.slice(0, MAX_REFERENCE_IMAGES);
      allImages.slice(MAX_REFERENCE_IMAGES).forEach((image) => {
        URL.revokeObjectURL(image.url);
        imageUrls.current.delete(image.url);
      });
      return visibleImages;
    });

    event.target.value = '';
  }

  function handleSceneImageUpload(event) {
    const files = Array.from(event.target.files || []);
    const availableSlots = Math.max(MAX_SCENE_IMAGES - sceneImages.length, 0);
    const acceptedFiles = files.slice(0, availableSlots);

    if (files.length > availableSlots) {
      setApiError(`最多同时上传 ${MAX_SCENE_IMAGES} 张场景图片。`);
    }

    const nextImages = acceptedFiles.map((file, fileIndex) => {
      const refName = getSceneImageLabel(sceneImages.length + fileIndex);
      return {
        id: createReferenceImageId(file),
        refName,
        token: `@${refName}`,
        name: file.name,
        url: URL.createObjectURL(file),
        file,
        uploadId: '',
      };
    });

    if (nextImages.length === 0) {
      event.target.value = '';
      return;
    }

    nextImages.forEach((image) => imageUrls.current.add(image.url));

    setSceneImages((current) => {
      const allImages = [...current, ...nextImages];
      const visibleImages = allImages.slice(0, MAX_SCENE_IMAGES);
      allImages.slice(MAX_SCENE_IMAGES).forEach((image) => {
        URL.revokeObjectURL(image.url);
        imageUrls.current.delete(image.url);
      });
      return visibleImages;
    });

    event.target.value = '';
  }

  function toggleSoundEffectOnly(event) {
    const checked = event.target.checked;
    setSoundEffectOnly(checked);
    if (checked) setForceMute(false);
  }

  function toggleForceMute(event) {
    const checked = event.target.checked;
    setForceMute(checked);
    if (checked) setSoundEffectOnly(false);
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
    setLastProgressRefreshAt(Date.now());

    try {
      const uploadedImages = await Promise.all(referenceImages.map(async (image) => {
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

      const uploadedSceneImages = await Promise.all(sceneReferenceImages.map(async (image) => {
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
      setSceneImages(uploadedSceneImages);

      const imageReferences = uploadedImages.map((image, index) => {
        const refName = image.refName || getReferenceLabel(index);
        return {
          id: image.uploadId,
          name: image.name,
          label: refName,
          token: `@${refName}`,
        };
      });
      const sceneImageReferences = uploadedSceneImages.map((image, index) => {
        const refName = image.refName || getSceneImageLabel(index);
        return {
          id: image.uploadId,
          name: image.name,
          label: refName,
          token: `@${refName}`,
        };
      });

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
          imageReferences,
          sceneLimit,
          sceneImageNames: uploadedSceneImages.map((image) => image.name),
          sceneImageIds: uploadedSceneImages.map((image) => image.uploadId),
          sceneImageReferences,
          blockSubtitles,
          soundEffectOnly,
          forceMute,
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

  async function handleRetryScene(scene) {
    if (!activeRunId || !scene?.id || scene.status !== 'failed' || retryingSceneId) return;
    setRetryingSceneId(scene.id);
    setApiError('');
    clearTaskTimers();

    try {
      const retriedRun = await apiRequest(
        `/agent/runs/${encodeURIComponent(activeRunId)}/scenes/${encodeURIComponent(scene.id)}/retry`,
        {
          method: 'POST',
          authToken: auth?.token,
        },
      );
      syncAgentRun(retriedRun);
      await refreshBilling();
      timers.current = [setTimeout(() => pollAgentRun(activeRunId), 400)];
    } catch (error) {
      setApiError(error.message);
    } finally {
      setRetryingSceneId('');
    }
  }

  function handlePreviewScene(scene) {
    if (!scene?.videoUrl) return;
    setPreviewSceneId(scene.id);
    setApiStatus(`正在预览：${scene.number} ${scene.title}`);
  }

  async function handleOpenHistoryRun(runId) {
    if (!runId) return;
    clearTaskTimers();
    setIsRestoringRuns(true);
    setApiError('');

    try {
      const latestRun = await apiRequest(`/agent/runs/${encodeURIComponent(runId)}`, {
        authToken: auth?.token,
      });
      await restoreAgentRun(latestRun, { poll: true });
    } catch (error) {
      setApiError(error.message);
    } finally {
      setIsRestoringRuns(false);
    }
  }

  function resetWorkspace() {
    clearTaskTimers();
    images.forEach((image) => {
      URL.revokeObjectURL(image.url);
      imageUrls.current.delete(image.url);
    });
    sceneImages.forEach((image) => {
      URL.revokeObjectURL(image.url);
      imageUrls.current.delete(image.url);
    });
    scenesRef.current = [];
    setIdea(initialWorkspace.idea);
    setDuration(initialWorkspace.duration);
    setSegmentDuration(initialWorkspace.segmentDuration);
    setStyle(initialWorkspace.style);
    setRatio(initialWorkspace.ratio);
    setJimengModel(initialWorkspace.jimengModel);
    setImages([]);
    setSceneLimit('');
    setSceneImages([]);
    setBlockSubtitles(true);
    setSoundEffectOnly(false);
    setForceMute(false);
    setScenes([]);
    setCandidates([]);
    setSelectedCandidateId('');
    setActiveRunId('');
    setIsGenerating(false);
    setIsConfirming(false);
    setStageIndex(0);
    setProgress(0);
    setApiError('');
    setFinalVideoUrl('');
    setPreviewSceneId('');
    setRunStatus('idle');
    setApiStatus('创作服务已连接');
    setLastProgressRefreshAt(null);
    setRetryingSceneId('');
    closeReferenceMenu();
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
            <UserIdentityButton user={auth.user} onClick={onShowProfile} />
          ) : null}
          <CreditNavButton balance={creditBalance} onClick={onShowCredits} />
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
              {isRestoringRuns && runHistory.length === 0 ? (
                <p className="rail-empty">正在同步历史任务...</p>
              ) : runHistory.length === 0 ? (
                <p className="rail-empty">暂无历史项目</p>
              ) : (
                runHistory.map((run) => (
                  <button
                    className={[
                      'project-history-item',
                      activeRunId === run.id ? 'selected' : '',
                      isRunPollable(run) ? 'live' : '',
                    ].filter(Boolean).join(' ')}
                    key={run.id}
                    onClick={() => handleOpenHistoryRun(run.id)}
                    type="button"
                  >
                    <span className="project-history-title">
                      <strong>{getRunHistoryTitle(run)}</strong>
                      <small>{formatHistoryTime(run.updatedAt)}</small>
                    </span>
                    <span className="project-history-meta">
                      <em>{getRunStatusLabel(run.status)}</em>
                      <b>{run.scenes?.length || Math.ceil((run.duration || 0) / (run.segmentDuration || 1))}段 · {run.creditCost || run.estimatedCreditCost || 0}积分</b>
                    </span>
                  </button>
                ))
              )}
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

          <div className="idea-composer">
            <span>视频想法</span>
            <textarea
              ref={ideaTextareaRef}
              value={idea}
              onChange={handleIdeaChange}
              onKeyDown={handleIdeaKeyDown}
              onSelect={(event) => updateReferenceMenuForCaret(event.target.value, event.target.selectionStart)}
              placeholder="描述你想制作的视频，可以很粗略。"
              disabled={runLocked}
            />
            {referenceMenu.open && referenceMenuOptions.length > 0 ? (
              <div className="reference-mention-menu">
                {referenceMenuOptions.map((image, index) => (
                  <button
                    className={index === referenceMenu.selectedIndex ? 'selected' : ''}
                    key={image.id}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => insertReferenceMention(image)}
                    type="button"
                  >
                    {image.url ? (
                      <img src={image.url} alt="" />
                    ) : (
                      <span className="reference-preview-placeholder">
                        <ImagePlus size={15} />
                      </span>
                    )}
                    <span>
                      <strong>@{image.refName}</strong>
                      <small>{image.name}</small>
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="upload-strip">
            <label className="upload-drop">
              <input type="file" accept="image/*" multiple onChange={handleImageUpload} disabled={runLocked} />
              <UploadCloud size={20} />
              <span>上传参考图片 {images.length}/{MAX_REFERENCE_IMAGES}</span>
            </label>
            <div className="image-preview-row">
              {referenceImages.length === 0 ? (
                <div className="empty-image-slot">
                  <ImagePlus size={19} />
                  <span>人物 / 场景 / 风格</span>
                </div>
              ) : (
                referenceImages.map((image) => (
                  <figure className="reference-preview-card" key={image.id}>
                    {image.url ? (
                      <img src={image.url} alt={image.name} />
                    ) : (
                      <span className="reference-preview-placeholder">
                        <ImagePlus size={16} />
                      </span>
                    )}
                    <figcaption>@{image.refName}</figcaption>
                  </figure>
                ))
              )}
            </div>
          </div>

          <div className="scene-limit-panel">
            <label className="scene-limit-input">
              <span>场景限制</span>
              <textarea
                value={sceneLimit}
                onChange={(event) => setSceneLimit(event.target.value)}
                placeholder="限定整个剧本的固定场景、时代、地点、空间规则。"
                disabled={runLocked}
              />
            </label>
            <div className="scene-limit-upload">
              <label className="upload-drop compact">
                <input type="file" accept="image/*" multiple onChange={handleSceneImageUpload} disabled={runLocked} />
                <UploadCloud size={18} />
                <span>场景图片 {sceneImages.length}/{MAX_SCENE_IMAGES}</span>
              </label>
              <div className="image-preview-row compact">
                {sceneReferenceImages.length === 0 ? (
                  <div className="empty-image-slot compact">
                    <ImagePlus size={18} />
                    <span>场景参考</span>
                  </div>
                ) : (
                  sceneReferenceImages.map((image) => (
                    <figure className="reference-preview-card compact" key={image.id}>
                      {image.url ? (
                        <img src={image.url} alt={image.name} />
                      ) : (
                        <span className="reference-preview-placeholder">
                          <ImagePlus size={15} />
                        </span>
                      )}
                      <figcaption>@{image.refName}</figcaption>
                    </figure>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="prompt-toggle-grid">
            <label>
              <input
                checked={blockSubtitles}
                disabled={runLocked}
                type="checkbox"
                onChange={(event) => setBlockSubtitles(event.target.checked)}
              />
              <span>
                <strong>强制屏蔽字幕</strong>
                <small>不要出现任何字幕</small>
              </span>
            </label>
            <label>
              <input
                checked={soundEffectOnly}
                disabled={runLocked}
                type="checkbox"
                onChange={toggleSoundEffectOnly}
              />
              <span>
                <strong>仅保留音效</strong>
                <small>不要背景音乐</small>
              </span>
            </label>
            <label>
              <input
                checked={forceMute}
                disabled={runLocked}
                type="checkbox"
                onChange={toggleForceMute}
              />
              <span>
                <strong>强制全部静音</strong>
                <small>不要有任何声音</small>
              </span>
            </label>
          </div>

          <div className="control-duo">
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
                  const isDivisible = duration % option === 0;
                  const exceedsLimit = Math.ceil(duration / option) > 40;
                  const optionDisabled = runLocked || !isDivisible || exceedsLimit;
                  const title = !isDivisible
                    ? '目标时长不能被该单段时长整除'
                    : exceedsLimit
                      ? '该总时长最多支持 40 段，请选择更长的单段时长'
                      : '';
                  return (
                    <button
                      className={segmentDuration === option ? 'selected' : ''}
                      key={option}
                      onClick={() => setSegmentDuration(option)}
                      disabled={optionDisabled}
                      title={title}
                      type="button"
                    >
                      <strong>{option}秒</strong>
                      <small>{isDivisible ? `${duration / option}段` : '不可整除'}</small>
                    </button>
                  );
                })}
              </div>
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
              {previewVideoUrl ? (
                <video className="preview-image preview-video" src={previewVideoUrl} controls playsInline />
              ) : (
                <div className="preview-empty-state">
                  <Play size={24} />
                  <strong>暂无预览</strong>
                </div>
              )}
              {previewVideoUrl ? <div className="video-shine" /> : null}
              {previewVideoUrl || scenes.length > 0 || isGenerating || runStatus === 'awaiting_confirmation' ? (
                <div className="preview-caption">
                  <strong>
                    {previewVideoUrl
                      ? selectedPreviewScene ? `${selectedPreviewScene.number} ${selectedPreviewScene.title}` : '首段视频预览'
                      : runStatus === 'awaiting_confirmation'
                        ? '等待确认分镜'
                        : isGenerating ? '任务处理中' : '等待最新任务'}
                  </strong>
                  <span>{completeCount}/{scenes.length} 段完成</span>
                </div>
              ) : null}
            </div>
            <div className="export-row">
              <button onClick={() => previewVideoUrl && window.open(previewVideoUrl, '_blank')} disabled={!previewVideoUrl}>
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
            <div className="queue-overview" aria-live="polite">
              <div className="queue-overview-head">
                <span>
                  <strong>{queueSummary.label}</strong>
                  <small>排队进度 {queueSummary.queueProgress}%</small>
                </span>
                <em>{queueSummary.done}/{queueSummary.total || 0} 段完成</em>
              </div>
              <div className="queue-status-grid">
                <div>
                  <strong>{queueSummary.queued}</strong>
                  <span>排队中</span>
                </div>
                <div>
                  <strong>{queueSummary.active}</strong>
                  <span>生成中</span>
                </div>
                <div>
                  <strong>{queueSummary.waiting}</strong>
                  <span>等待中</span>
                </div>
              </div>
              {primaryQueueInfo ? (
                <div className="queue-position-card">
                  <span>
                    <strong>{primaryQueueInfo.scene.number} {primaryQueueInfo.scene.title}</strong>
                    <small>
                      {primaryQueueInfo.queue.label}
                      {primaryQueueInfo.queue.meta ? ` · ${primaryQueueInfo.queue.meta}` : ''}
                      {primaryQueueInfo.queue.accountLabel ? ` · ${primaryQueueInfo.queue.accountLabel}` : ''}
                    </small>
                  </span>
                  <em>{primaryQueueInfo.queue.progress}%</em>
                </div>
              ) : null}
              <small className="queue-refresh-note">每分钟自动同步 · 上次 {progressRefreshLabel}</small>
            </div>
            {failedScenes.length > 0 ? (
              <div className="queue-failure-list">
                {failedScenes.map((scene) => {
                  const failure = getSceneFailureInfo(scene);
                  const metadata = [
                    ...failure.metadata,
                    scene.refundCredit ? `已返还 ${scene.refundCredit} 积分` : '',
                  ].filter(Boolean);

                  return (
                    <button
                      disabled={Boolean(retryingSceneId)}
                      key={scene.id}
                      type="button"
                      onClick={() => handleRetryScene(scene)}
                    >
                      <AlertTriangle size={14} />
                      <span>
                        <strong>{scene.number} {scene.title}</strong>
                        <small>
                          <b>{failure.title}</b>
                          <span>{failure.detail}</span>
                          {metadata.length > 0 ? <em>{metadata.join(' · ')}</em> : null}
                        </small>
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}
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
              : scenes.length > 0 ? `每段最长 15 秒，共 ${scenes.length} 段` : '暂无分镜'}
          </small>
        </div>
        <div className={`scene-list ${scenes.length === 0 ? 'is-empty' : ''}`}>
          {scenes.length === 0 ? (
            <div className="timeline-empty-state">
              <Film size={22} />
              <strong>暂无分镜</strong>
            </div>
          ) : (
            scenes.map((scene, index) => (
              <article
                className={[
                  'scene-card',
                  isStoryboardReview ? 'editable' : '',
                  scene.status === 'failed' ? 'retryable' : '',
                  scene.videoUrl ? 'has-video' : '',
                  previewSceneId === scene.id ? 'selected-preview' : '',
                ].filter(Boolean).join(' ')}
                key={scene.id}
                role={scene.status === 'failed' || scene.videoUrl ? 'button' : undefined}
                tabIndex={scene.status === 'failed' || scene.videoUrl ? 0 : undefined}
                onClick={() => {
                  if (scene.status === 'failed') handleRetryScene(scene);
                  else handlePreviewScene(scene);
                }}
                onKeyDown={(event) => {
                  if ((scene.status === 'failed' || scene.videoUrl) && (event.key === 'Enter' || event.key === ' ')) {
                    event.preventDefault();
                    if (scene.status === 'failed') handleRetryScene(scene);
                    else handlePreviewScene(scene);
                  }
                }}
              >
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
                  {['queued', 'waiting', 'active'].includes(scene.status) && getSceneQueueInfo(scene) ? (() => {
                    const queue = getSceneQueueInfo(scene);
                    return (
                      <div className="scene-queue-info">
                        <span>
                          <Clock3 size={13} />
                          {queue.label}
                          {queue.meta ? ` · ${queue.meta}` : ''}
                          {queue.accountLabel ? ` · ${queue.accountLabel}` : ''}
                        </span>
                        <em>{queue.progress}%</em>
                      </div>
                    );
                  })() : null}
                  {scene.error || scene.failureTitle || scene.failureDetail ? (() => {
                    const failure = getSceneFailureInfo(scene);
                    const metadata = [
                      ...failure.metadata,
                      scene.refundCredit ? `已返还 ${scene.refundCredit} 积分` : '',
                    ].filter(Boolean);

                    return (
                      <div className="scene-error">
                        <span className="scene-error-head">
                          <AlertTriangle size={13} />
                          <strong>{failure.title}</strong>
                          <em>{failure.categoryLabel}</em>
                        </span>
                        <p>{failure.detail}</p>
                        {metadata.length > 0 ? <small>{metadata.join(' · ')}</small> : null}
                      </div>
                    );
                  })() : null}
                  <div className="mini-progress">
                    <span style={{ width: `${scene.progress}%` }} />
                  </div>
                  {scene.status === 'failed' ? (
                    <button
                      className="scene-retry-button"
                      disabled={Boolean(retryingSceneId)}
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleRetryScene(scene);
                      }}
                    >
                      {retryingSceneId === scene.id ? <Loader2 className="spin" size={13} /> : <RefreshCw size={13} />}
                      重新生成该分镜
                    </button>
                  ) : null}
                  {scene.videoUrl ? (
                    <button
                      className="scene-result-link"
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        handlePreviewScene(scene);
                      }}
                    >
                      <Play size={13} />
                      当前页预览
                    </button>
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
            ))
          )}
        </div>
      </section>
    </div>
  );
}

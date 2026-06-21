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
import { apiRequest } from '../api/client';
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
  sceneVisuals,
} from '../config/workspace';
import { createScenes } from '../utils/workspace';

const MAX_REFERENCE_IMAGES = 9;
const MAX_SCENE_IMAGES = 9;

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

export default function WorkspacePage({ auth, billingState, onShowCredits, onShowIntro, onShowAdmin, onShowProfile, onLogout }) {
  const timers = useRef([]);
  const imageUrls = useRef(new Set());
  const ideaTextareaRef = useRef(null);
  const scenesRef = useRef([]);
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
  const [runStatus, setRunStatus] = useState('idle');
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
    setProgress(latestRun.progress ?? 0);
    setRunStatus(latestRun.status);
    setStageIndex(agentStageIndexes[latestRun.stage] ?? 0);
    setApiStatus(`任务状态：${agentStageLabels[latestRun.stage] || latestRun.stage}`);
    setLastProgressRefreshAt(Date.now());

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
              <p className="rail-empty">暂无历史项目</p>
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
                    <img src={image.url} alt="" />
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
                    <img src={image.url} alt={image.name} />
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
                      <img src={image.url} alt={image.name} />
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
              {finalVideoUrl ? (
                <video className="preview-image preview-video" src={finalVideoUrl} controls playsInline />
              ) : (
                <div className="preview-empty-state">
                  <Play size={24} />
                  <strong>暂无预览</strong>
                </div>
              )}
              {finalVideoUrl ? <div className="video-shine" /> : null}
              {finalVideoUrl || scenes.length > 0 || isGenerating || runStatus === 'awaiting_confirmation' ? (
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
              ) : null}
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
              <small className="queue-refresh-note">每分钟自动同步 · 上次 {progressRefreshLabel}</small>
            </div>
            {failedScenes.length > 0 ? (
              <div className="queue-failure-list">
                {failedScenes.map((scene) => (
                  <button
                    disabled={Boolean(retryingSceneId)}
                    key={scene.id}
                    type="button"
                    onClick={() => handleRetryScene(scene)}
                  >
                    <AlertTriangle size={14} />
                    <span>
                      <strong>{scene.number} {scene.title}</strong>
                      <small>{scene.error || '即梦生成失败'}{scene.refundCredit ? ` · 已返还 ${scene.refundCredit} 积分` : ''}</small>
                    </span>
                  </button>
                ))}
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
                ].filter(Boolean).join(' ')}
                key={scene.id}
                role={scene.status === 'failed' ? 'button' : undefined}
                tabIndex={scene.status === 'failed' ? 0 : undefined}
                onClick={() => scene.status === 'failed' && handleRetryScene(scene)}
                onKeyDown={(event) => {
                  if (scene.status === 'failed' && (event.key === 'Enter' || event.key === ' ')) {
                    event.preventDefault();
                    handleRetryScene(scene);
                  }
                }}
              >
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
                  {scene.error ? (
                    <small className="scene-error">
                      {scene.error}
                      {scene.refundCredit ? ` · 已返还 ${scene.refundCredit} 积分` : ''}
                    </small>
                  ) : null}
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
                    <a className="scene-result-link" href={scene.videoUrl} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
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
            ))
          )}
        </div>
      </section>
    </div>
  );
}

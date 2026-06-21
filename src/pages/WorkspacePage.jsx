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
  AGENT_POLL_INTERVAL,
  agentStageIndexes,
  agentStageLabels,
  agentStages,
  initialWorkspace,
  sceneVisuals,
} from '../config/workspace';
import { createScenes } from '../utils/workspace';

export default function WorkspacePage({ auth, billingState, onShowCredits, onShowIntro, onShowAdmin, onShowProfile, onLogout }) {
  const timers = useRef([]);
  const imageUrls = useRef(new Set());
  const scenesRef = useRef([]);
  const [idea, setIdea] = useState(initialWorkspace.idea);
  const [duration, setDuration] = useState(initialWorkspace.duration);
  const [segmentDuration, setSegmentDuration] = useState(initialWorkspace.segmentDuration);
  const [style, setStyle] = useState(initialWorkspace.style);
  const [ratio, setRatio] = useState(initialWorkspace.ratio);
  const [jimengModel, setJimengModel] = useState(initialWorkspace.jimengModel);
  const [images, setImages] = useState([]);
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
    if (Math.ceil(duration / segmentDuration) > 40) {
      setSegmentDuration(15);
    }
  }, [duration, segmentDuration]);

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

  function syncAgentRun(latestRun) {
    let syncedScenes = latestRun.scenes.length > 0
      ? latestRun.scenes.map((scene) => ({
          ...scene,
          status: scene.status === 'completed'
            ? 'done'
            : scene.status === 'generating'
              ? 'active'
              : scene.status === 'failed'
                ? 'failed'
                : 'queued',
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

      if (isFinished) {
        clearTaskTimers();
        setIsGenerating(false);
        return;
      }

      timers.current = [setTimeout(() => pollAgentRun(runId), AGENT_POLL_INTERVAL)];
    } catch (error) {
      clearTaskTimers();
      setApiError(error.message);
      setRunStatus('failed');
      setIsGenerating(false);
    }
  }

  function handleImageUpload(event) {
    const files = Array.from(event.target.files || []);
    const nextImages = files.slice(0, 6).map((file) => ({
      id: `${file.name}-${file.lastModified}`,
      name: file.name,
      url: URL.createObjectURL(file),
      file,
      uploadId: '',
    }));

    nextImages.forEach((image) => imageUrls.current.add(image.url));

    setImages((current) => {
      const allImages = [...current, ...nextImages];
      const visibleImages = allImages.slice(0, 6);
      allImages.slice(6).forEach((image) => {
        URL.revokeObjectURL(image.url);
        imageUrls.current.delete(image.url);
      });
      return visibleImages;
    });

    event.target.value = '';
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

    try {
      const uploadedImages = await Promise.all(images.map(async (image) => {
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

  function resetWorkspace() {
    clearTaskTimers();
    images.forEach((image) => {
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

          <label className="idea-composer">
            <span>视频想法</span>
            <textarea
              value={idea}
              onChange={(event) => setIdea(event.target.value)}
              placeholder="描述你想制作的视频，可以很粗略。"
              disabled={runLocked}
            />
          </label>

          <div className="upload-strip">
            <label className="upload-drop">
              <input type="file" accept="image/*" multiple onChange={handleImageUpload} disabled={runLocked} />
              <UploadCloud size={20} />
              <span>上传参考图片</span>
            </label>
            <div className="image-preview-row">
              {images.length === 0 ? (
                <div className="empty-image-slot">
                  <ImagePlus size={19} />
                  <span>人物 / 场景 / 风格</span>
                </div>
              ) : (
                images.map((image) => (
                  <img src={image.url} alt={image.name} key={image.id} />
                ))
              )}
            </div>
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
                  const exceedsLimit = Math.ceil(duration / option) > 40;
                  return (
                    <button
                      className={segmentDuration === option ? 'selected' : ''}
                      key={option}
                      onClick={() => setSegmentDuration(option)}
                      disabled={runLocked || exceedsLimit}
                      title={exceedsLimit ? '该总时长最多支持 40 段，请选择更长的单段时长' : ''}
                    >
                      <strong>{option}秒</strong>
                      <small>{Math.ceil(duration / option)}段</small>
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
              <article className={`scene-card ${isStoryboardReview ? 'editable' : ''}`} key={scene.id}>
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
                  {scene.error ? <small className="scene-error">{scene.error}</small> : null}
                  <div className="mini-progress">
                    <span style={{ width: `${scene.progress}%` }} />
                  </div>
                  {scene.videoUrl ? (
                    <a className="scene-result-link" href={scene.videoUrl} target="_blank" rel="noreferrer">
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

"use strict";

const ENGINE_HTTP = `${location.protocol === "https:" ? "https" : "http"}://${location.hostname || "127.0.0.1"}:8080`;
const ENGINE_WS = `${location.protocol === "https:" ? "wss" : "ws"}://${location.hostname || "127.0.0.1"}:8080/v1/realtime`;
const MAX_CAPTIONS = 40;
const INPUT_PROFILES = {
  near: { label: "내 테이블", threshold: 0.009, gain: 1.25, hangoverMs: 650 },
  wide: { label: "넓게 듣기", threshold: 0.0035, gain: 1.6, hangoverMs: 850 }
};
const positions = ["left", "center", "right"];
const provisionalOrder = ["left", "right", "center"];
const speakerPalette = [
  { color: "#78c8ff", soft: "#e2f4ff" },
  { color: "#ff9bca", soft: "#ffe3f0" },
  { color: "#b9ee78", soft: "#edffd8" },
  { color: "#c8a7ff", soft: "#efe5ff" }
];

const state = {
  mode: "idle",
  speakers: new Map(),
  captions: [],
  activeSpeakerId: null,
  partial: "",
  socket: null,
  media: null,
  context: null,
  source: null,
  processor: null,
  silentSink: null,
  stopping: false,
  demoTimer: null,
  sessionStartedAt: null,
  clockTimer: null,
  toastTimer: null,
  engineReady: false,
  engineDevice: "",
  micState: "idle",
  inputProfile: "near",
  noiseFloorRms: 0.0025,
  gateOpenUntil: 0,
  nextSequentialSpeakerId: 0
};

const els = Object.fromEntries([
  "app", "welcomeView", "sessionView", "brandButton", "startButton", "demoButton",
  "engineBadge", "engineText", "speakerBadge", "speakerText", "prototypeButton", "footerScopeButton", "siteFooter",
  "listeningPill", "listeningText", "timer", "speakerCount", "seatGrid", "captionFeed",
  "emptyCaption", "captionStatus", "liveCaptionRow", "liveSpeakerLabel", "liveCaptionText", "dockTitle",
  "dockSubtitle", "hearingRangeButton", "hearingRangeText", "micHealth", "micMeterFill", "micLevelText", "stopButton",
  "scopeDialog", "scopeCloseButton", "toast",
  "toastText", "toastAction", "screenReaderStatus"
].map((id) => [id, document.getElementById(id)]));

const demoScript = [
  { speakerId: 0, text: "우리 발표 몇 시에 시작하지?" },
  { speakerId: 1, text: "네 시에 시작해." },
  { speakerId: 0, text: "그러면 세 시 반에 만나자." },
  { speakerId: 1, text: "좋아, 그때 보자!" }
];

function positionLabel(position) {
  return { left: "← 왼쪽", center: "↑ 맞은편", right: "오른쪽 →" }[position] || "위치 미정";
}

function speakerLabel(speaker) {
  return speaker.name || `사람 ${speaker.id + 1}`;
}

function speakerInitial(speaker) {
  return speaker.name ? Array.from(speaker.name)[0] : String.fromCharCode(65 + (speaker.id % 26));
}

function announce(message) {
  els.screenReaderStatus.textContent = "";
  requestAnimationFrame(() => { els.screenReaderStatus.textContent = message; });
}

function showToast(message, actionLabel = "", action = null) {
  clearTimeout(state.toastTimer);
  els.toastText.textContent = message;
  els.toastAction.hidden = !actionLabel;
  els.toastAction.textContent = actionLabel;
  els.toastAction.onclick = action || null;
  els.toast.hidden = false;
  state.toastTimer = setTimeout(() => { els.toast.hidden = true; }, actionLabel ? 8000 : 4500);
}

function setEngineStatus(ready, device = "") {
  state.engineReady = ready;
  state.engineDevice = device;
  els.engineBadge.dataset.state = ready ? "ready" : "offline";
  els.engineText.textContent = ready ? (device ? `로컬 AI · ${device}` : "로컬 AI 준비됨") : "데모 모드 가능";
}

function setSpeakerStatus(status, label = "") {
  els.speakerBadge.dataset.state = status;
  els.speakerText.textContent = label || "로컬 자막 준비됨";
}

async function checkEngine() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1800);
  try {
    const response = await fetch(`${ENGINE_HTTP}/ready`, { signal: controller.signal });
    if (!response.ok) throw new Error("not ready");
    const data = await response.json();
    const capabilities = data.capabilities || [];
    const hasAsr = capabilities.includes("asr") || capabilities.includes("transcription");
    const ready = Boolean(data.ready) && hasAsr;
    setEngineStatus(ready, data.device || "RTX GPU");
    return ready;
  } catch (_) {
    setEngineStatus(false);
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function ensureSpeaker(id) {
  const normalizedId = Number.isFinite(Number(id)) ? Number(id) : 0;
  if (state.speakers.has(normalizedId)) return state.speakers.get(normalizedId);

  const index = state.speakers.size;
  const palette = speakerPalette[index % speakerPalette.length];
  const speaker = {
    id: normalizedId,
    name: "",
    position: provisionalOrder[index % provisionalOrder.length],
    reviewed: true,
    color: palette.color,
    soft: palette.soft
  };
  state.speakers.set(normalizedId, speaker);
  renderSeats();
  updateSpeakerCount();
  announce(`새로운 목소리, 사람 ${normalizedId + 1}을 발견해 ${positionLabel(speaker.position)}에 자동 배정했습니다.`);
  return speaker;
}

function updateSpeakerCount() {
  els.speakerCount.textContent = String(state.speakers.size);
}

function renderSeats() {
  els.seatGrid.replaceChildren();
  positions.forEach((position) => {
    const slot = document.createElement("div");
    slot.className = `seat-slot seat-${position}`;

    const people = document.createElement("div");
    people.className = "seat-people";
    const speakers = [...state.speakers.values()].filter((speaker) => speaker.position === position);

    if (!speakers.length) {
      const empty = document.createElement("span");
      empty.className = "empty-seat";
      empty.setAttribute("aria-hidden", "true");
      empty.textContent = "?";
      const copy = document.createElement("span");
      copy.className = "empty-seat-copy";
      copy.textContent = "새 목소리를 기다려요";
      people.append(empty, copy);
    } else {
      speakers.forEach((speaker) => {
        const chip = document.createElement("div");
        chip.className = `speaker-chip reviewed${state.activeSpeakerId === speaker.id ? " active" : ""}`;
        chip.style.setProperty("--speaker-color", speaker.color);
        chip.style.setProperty("--speaker-soft", speaker.soft);
        chip.setAttribute("aria-label", `${speakerLabel(speaker)}, ${positionLabel(speaker.position)}에 자동 배정됨`);
        chip.innerHTML = `<span class="speaker-avatar">${escapeHtml(speakerInitial(speaker))}</span><span class="speaker-meta"><strong>${escapeHtml(speakerLabel(speaker))}</strong><small>실시간 자막</small></span>`;
        people.appendChild(chip);
      });
    }

    const direction = document.createElement("span");
    direction.className = "seat-direction";
    direction.textContent = positionLabel(position);
    slot.append(people, direction);
    els.seatGrid.appendChild(slot);
  });
}

function captionClock(timestamp) {
  return new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(timestamp));
}

function renderCaptions() {
  els.captionFeed.querySelectorAll(".caption-row:not(.live-caption-row)").forEach((node) => node.remove());
  const isTranscribing = Boolean(state.partial.trim());
  els.emptyCaption.hidden = state.captions.length > 0 || isTranscribing;
  const fragment = document.createDocumentFragment();
  state.captions.forEach((caption, index) => {
    const speaker = state.speakers.get(caption.speakerId) || ensureSpeaker(caption.speakerId);
    const row = document.createElement("article");
    row.className = `caption-row position-${speaker.position}${index === state.captions.length - 1 ? " latest" : ""}`;
    row.dataset.source = "local";
    row.style.setProperty("--speaker-color", speaker.color);
    row.style.setProperty("--speaker-soft", speaker.soft);
    row.innerHTML = `<div class="caption-speaker"><i aria-hidden="true"></i>${escapeHtml(speakerLabel(speaker))} · ${escapeHtml(positionLabel(speaker.position))}</div><div class="caption-source"><span class="caption-source-badge">LOCAL 확정</span><span class="caption-source-note">한국어</span></div><div class="caption-bubble"><span class="caption-final-text">${escapeHtml(caption.text)}</span></div><time class="caption-time" datetime="${new Date(caption.createdAt).toISOString()}">${captionClock(caption.createdAt)}</time>`;
    fragment.appendChild(row);
  });
  els.captionFeed.insertBefore(fragment, els.liveCaptionRow);
  els.captionStatus.textContent = isTranscribing
    ? "한국어를 실시간으로 받아쓰는 중"
    : (state.captions.length ? `로컬 자막 ${state.captions.length}개 · 계속 듣는 중` : "첫 목소리를 기다리는 중");
  requestAnimationFrame(() => { els.captionFeed.scrollTop = els.captionFeed.scrollHeight; });
}

function addCaption(speakerId, text, options = {}) {
  const cleanText = String(text || "").trim();
  if (!cleanText) return null;
  const normalizedId = Number.isFinite(Number(speakerId)) ? Number(speakerId) : 0;
  const speaker = ensureSpeaker(normalizedId);
  state.activeSpeakerId = speaker.id;
  const createdAt = options.createdAt || Date.now();
  const caption = {
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    speakerId: normalizedId,
    text: cleanText,
    source: "local",
    createdAt,
    audioStartAt: options.audioStartAt || createdAt,
    audioEndAt: options.audioEndAt || createdAt
  };
  state.captions.push(caption);
  state.captions = state.captions.slice(-MAX_CAPTIONS);
  state.partial = "";
  renderPartial();
  renderSeats();
  renderCaptions();
  announce(`${speakerLabel(speaker)}: ${cleanText}`);
  return caption.id;
}

function escapeHtml(value) {
  const node = document.createElement("div");
  node.textContent = String(value ?? "");
  return node.innerHTML;
}

function joinWords(words) {
  return words.reduce((text, item) => {
    const word = String(item.word || "").trim();
    if (!word) return text;
    if (!text || /^[,.;:!?%)}\]]/.test(word)) return text + word;
    return `${text} ${word}`;
  }, "");
}

function queueCompletedTranscript(message) {
  const transcript = String(message.transcript || joinWords(message.words || [])).trim();
  if (!transcript) return;
  const speakerId = state.nextSequentialSpeakerId;
  state.nextSequentialSpeakerId = speakerId === 0 ? 1 : 0;
  addCaption(speakerId, transcript, { source: "local" });
}

function renderPartial() {
  const text = state.partial.trim();
  els.liveCaptionRow.hidden = !text;
  els.liveSpeakerLabel.textContent = "인식 중 · 실시간";
  els.liveCaptionText.textContent = text;
  els.emptyCaption.hidden = state.captions.length > 0 || Boolean(text);
  els.captionStatus.textContent = text
    ? "한국어를 실시간으로 받아쓰는 중"
    : (state.captions.length ? `로컬 자막 ${state.captions.length}개 · 계속 듣는 중` : "첫 목소리를 기다리는 중");
  if (text) requestAnimationFrame(() => { els.captionFeed.scrollTop = els.captionFeed.scrollHeight; });
}

function setSessionStatus(kind, title, subtitle = "") {
  els.listeningPill.dataset.state = kind;
  els.listeningText.textContent = title;
  els.dockTitle.textContent = title;
  els.dockSubtitle.textContent = subtitle || "멈추지 않아도 문장마다 바로 올라와요";
}

function currentInputProfile() {
  return INPUT_PROFILES[state.inputProfile] || INPUT_PROFILES.near;
}

function currentGateThreshold() {
  const profile = currentInputProfile();
  return Math.max(profile.threshold, Math.min(0.035, state.noiseFloorRms * 2.4));
}

function renderInputProfile() {
  const profile = currentInputProfile();
  els.hearingRangeButton.dataset.profile = state.inputProfile;
  els.hearingRangeText.textContent = profile.label;
  els.hearingRangeButton.setAttribute(
    "aria-label",
    `현재 수음 범위 ${profile.label}. 눌러서 ${state.inputProfile === "near" ? "넓게 듣기" : "내 테이블"}로 변경`
  );
}

function toggleInputProfile() {
  state.inputProfile = state.inputProfile === "near" ? "wide" : "near";
  state.gateOpenUntil = 0;
  state.noiseFloorRms = state.inputProfile === "near" ? 0.0025 : 0.0015;
  renderInputProfile();
  const profile = currentInputProfile();
  showToast(state.inputProfile === "near"
    ? "내 테이블 모드: 작은 원거리 목소리를 차단해요."
    : "넓게 듣기: 목소리가 작을 때 사용하세요.");
  announce(`수음 범위를 ${profile.label}로 변경했습니다.`);
}

function updateMicLevel(rms = 0, accepted = false) {
  const db = rms > 0 ? 20 * Math.log10(rms) : -100;
  const amount = Math.max(0, Math.min(100, ((db + 58) / 48) * 100));
  let micState = "silent";
  let label = "입력 없음";
  if (rms > 0.0008 && !accepted) {
    micState = "filtered";
    label = "배경음 차단 중";
  } else if (db > -14) {
    micState = "loud";
    label = "너무 크게 들림";
  } else if (db > -34) {
    micState = "good";
    label = "마이크 입력 좋음";
  } else if (db > -50) {
    micState = "quiet";
    label = "목소리가 작음";
  }
  state.micState = micState;
  els.micHealth.dataset.state = micState;
  els.micMeterFill.style.width = `${amount}%`;
  els.micLevelText.textContent = label;
}

function startClock() {
  state.sessionStartedAt = Date.now();
  clearInterval(state.clockTimer);
  state.clockTimer = setInterval(() => {
    const seconds = Math.max(0, Math.floor((Date.now() - state.sessionStartedAt) / 1000));
    els.timer.textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  }, 250);
}

function resetState() {
  clearInterval(state.demoTimer);
  clearInterval(state.clockTimer);
  state.demoTimer = null;
  state.speakers.clear();
  state.captions = [];
  state.activeSpeakerId = null;
  state.partial = "";
  state.stopping = false;
  state.nextSequentialSpeakerId = 0;
  state.noiseFloorRms = state.inputProfile === "near" ? 0.0025 : 0.0015;
  state.gateOpenUntil = 0;
  updateMicLevel(0);
  els.timer.textContent = "00:00";
  renderSeats();
  renderCaptions();
  renderPartial();
  updateSpeakerCount();
}

function showSession(mode) {
  state.mode = mode;
  els.app.dataset.mode = "session";
  els.welcomeView.hidden = true;
  els.sessionView.hidden = false;
  els.stopButton.disabled = false;
  els.stopButton.innerHTML = '<span aria-hidden="true"></span> 마이크 끄기';
  startClock();
}

async function startLive() {
  if (state.mode === "live" || state.mode === "connecting") return;
  resetState();
  showSession("connecting");
  setSessionStatus("connecting", "로컬 AI 연결 중", "한국어 STT를 확인하고 있어요");

  const ready = state.engineReady || await checkEngine();
  if (!ready) {
    finishSession("엔진 연결 안 됨");
    showToast("로컬 음성 엔진이 꺼져 있어요.", "데모 보기", startDemo);
    return;
  }

  try {
    const media = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: 16000,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: false
      },
      video: false
    });
    const context = new AudioContext({ sampleRate: 16000, latencyHint: "interactive" });
    if (context.state === "suspended") await context.resume();
    const source = context.createMediaStreamSource(media);
    const processor = context.createScriptProcessor(2048, 1, 1);
    const silentSink = context.createGain();
    silentSink.gain.value = 0;
    const socket = new WebSocket(ENGINE_WS);
    socket.binaryType = "arraybuffer";

    Object.assign(state, { media, context, source, processor, silentSink, socket, stopping: false });
    source.connect(processor);
    processor.connect(silentSink);
    silentSink.connect(context.destination);

    processor.onaudioprocess = (event) => {
      if (socket.readyState !== WebSocket.OPEN || state.stopping) return;
      const input = event.inputBuffer.getChannelData(0);
      let sumSquares = 0;
      for (let index = 0; index < input.length; index++) {
        sumSquares += input[index] * input[index];
      }
      const rms = Math.sqrt(sumSquares / Math.max(1, input.length));
      const profile = currentInputProfile();
      const gateThreshold = currentGateThreshold();
      const now = performance.now();
      if (rms >= gateThreshold) state.gateOpenUntil = now + profile.hangoverMs;
      const accepted = rms >= gateThreshold || now < state.gateOpenUntil;
      if (!accepted && rms < gateThreshold * 1.25) {
        state.noiseFloorRms = state.noiseFloorRms * 0.985 + rms * 0.015;
      }

      const pcm = new Int16Array(input.length);
      if (accepted) {
        for (let index = 0; index < input.length; index++) {
          pcm[index] = Math.max(-32768, Math.min(32767, Math.round(input[index] * profile.gain * 32767)));
        }
      }
      updateMicLevel(rms, accepted);
      socket.send(pcm.buffer);
    };

    socket.onopen = () => {
      socket.send(JSON.stringify({
        type: "session.update",
        session: {
          sample_rate: context.sampleRate,
          language: "ko-KR",
          automatic_punctuation: true,
          word_timestamps: true,
          endpointing_ms: 700
        }
      }));
    };

    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type === "session.updated") {
        state.mode = "live";
        setSessionStatus("listening", "계속 듣고 있어요", "한국어 자막을 실시간으로 보여줘요");
        announce("실시간 듣기를 시작했습니다.");
      } else if (message.type.endsWith(".delta")) {
        state.partial += message.delta || "";
        renderPartial();
      } else if (message.type.endsWith(".completed")) {
        state.partial = "";
        renderPartial();
        queueCompletedTranscript(message);
      } else if (message.type === "input_audio_buffer.committed") {
        socket.close(1000, "session complete");
        finishSession("듣기 완료");
      } else if (message.type === "error") {
        const detail = message.error?.message || "음성 엔진 오류";
        showToast(detail);
        if (state.stopping) socket.close();
      }
    };

    socket.onerror = () => showToast("음성 엔진 연결이 끊겼어요. 화면은 그대로 유지할게요.");
    socket.onclose = () => {
      if (!state.stopping && state.mode === "live") finishSession("연결 끊김");
    };
  } catch (error) {
    await stopCapture();
    finishSession("마이크를 열 수 없음");
    const denied = error?.name === "NotAllowedError";
    showToast(denied ? "마이크 권한이 필요해요." : `마이크 시작 실패: ${error.message || error}`, "데모 보기", startDemo);
  }
}

async function stopCapture() {
  try { state.processor?.disconnect(); } catch (_) {}
  try { state.source?.disconnect(); } catch (_) {}
  try { state.silentSink?.disconnect(); } catch (_) {}
  state.media?.getTracks().forEach((track) => track.stop());
  if (state.context && state.context.state !== "closed") await state.context.close();
  state.media = state.context = state.source = state.processor = state.silentSink = null;
  updateMicLevel(0);
}

async function stopSession() {
  if (state.stopping) return;
  if (state.mode === "ended" || state.mode === "error") {
    startLive();
    return;
  }
  state.stopping = true;
  els.stopButton.disabled = true;
  setSessionStatus("connecting", "자막 마무리 중", "마지막 문장을 처리하고 있어요");

  clearInterval(state.demoTimer);
  if (state.mode === "demo") {
    finishSession("데모 끝");
    return;
  }

  await stopCapture();
  if (state.socket?.readyState === WebSocket.OPEN) {
    state.socket.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
    setTimeout(() => {
      if (state.socket?.readyState === WebSocket.OPEN) state.socket.close();
      finishSession("듣기 완료");
    }, 6000);
  } else {
    state.socket?.close();
    finishSession("듣기 완료");
  }
}

function finishSession(label) {
  clearInterval(state.clockTimer);
  clearInterval(state.demoTimer);
  state.mode = "ended";
  state.stopping = false;
  setSessionStatus("ended", label, "자막은 새로고침하면 사라져요");
  els.stopButton.disabled = false;
  els.stopButton.innerHTML = "새로 듣기";
}

function startDemo() {
  if (state.mode === "live" || state.mode === "connecting") stopCapture();
  state.socket?.close();
  resetState();
  showSession("demo");
  setSessionStatus("demo", "데모 재생 중", "A → B → A 흐름을 확인해 보세요");
  let index = 0;
  const next = () => {
    if (index >= demoScript.length) {
      clearInterval(state.demoTimer);
      setTimeout(() => finishSession("데모 끝"), 1000);
      return;
    }
    const line = demoScript[index++];
    addCaption(line.speakerId, line.text, { source: "local" });
  };
  next();
  state.demoTimer = setInterval(next, 1900);
}

function loadPreview() {
  resetState();
  showSession("demo");
  setSessionStatus("demo", "데모 화면", "디자인 검토용 미리보기");
  ensureSpeaker(0);
  ensureSpeaker(1);
  addCaption(0, "우리 발표 몇 시에 시작하지?", { source: "local" });
  addCaption(1, "네 시에 시작해.", { source: "local" });
  addCaption(0, "그러면 세 시 반에 만나자.", { source: "local" });
}

function goHome() {
  if (["live", "connecting"].includes(state.mode)) {
    showToast("먼저 마이크를 꺼 주세요.");
    return;
  }
  resetState();
  state.mode = "idle";
  els.app.dataset.mode = "idle";
  els.welcomeView.hidden = false;
  els.sessionView.hidden = true;
}

function openScope() {
  if (typeof els.scopeDialog.showModal === "function") els.scopeDialog.showModal();
  else els.scopeDialog.setAttribute("open", "");
}

els.startButton.addEventListener("click", startLive);
els.demoButton.addEventListener("click", startDemo);
els.stopButton.addEventListener("click", stopSession);
els.brandButton.addEventListener("click", goHome);
els.prototypeButton.addEventListener("click", openScope);
els.footerScopeButton.addEventListener("click", openScope);
els.scopeCloseButton.addEventListener("click", () => els.scopeDialog.close());
els.hearingRangeButton.addEventListener("click", toggleInputProfile);
window.addEventListener("beforeunload", () => {
  state.media?.getTracks().forEach((track) => track.stop());
  state.socket?.close();
});

renderSeats();
renderInputProfile();
setSpeakerStatus("ready", "로컬 자막 준비됨");
checkEngine();
const query = new URLSearchParams(location.search);
if (query.has("preview")) loadPreview();
else if (query.has("demo")) startDemo();

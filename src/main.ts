import './styles.css';
import './redesign.css';
import {
  ApiError,
  fetchNotes,
  fetchRandomBottle,
  NetworkError,
  rateBottle,
  reportBottle,
  sendBottle,
  sendReply,
  type FoundBottle,
} from './api';
import { SeaAudio } from './audio';
import { LiveFeed } from './live';
import { motion } from './motion';
import { TIME_MODES, type TimeMode } from './scene/daycycle';
import type { Bottle } from './scene/bottle';
import { arriveSequence, openSequence, sendAway, throwBackSequence, throwSequence, killBottleTweens, type SeqContext } from './sequences';
import { excludedIds, loadLowPower, mine, saveLowPower, seen } from './storage';
import { FindBar, Hud } from './ui/hud';
import { Landing } from './ui/landing';
import { Notice } from './ui/notice';
import { ReadPanel, type RateResult } from './ui/read-panel';
import { showToast } from './ui/toast';
import { WritePanel, type SubmitResult, type WriteMode } from './ui/write-panel';
import { World, WebGLUnsupportedError } from './world';

type State = 'idle' | 'writing' | 'throwing' | 'finding' | 'reading';

const TIME_LABEL: Record<TimeMode, string> = {
  auto: 'follows your clock',
  dawn: 'sunrise',
  day: 'midday',
  dusk: 'dusk',
  night: 'night',
};

function showFallback(title: string, message: string): void {
  const box = document.createElement('main');
  box.className = 'fallback';
  box.setAttribute('role', 'alert');
  const h1 = document.createElement('h1');
  h1.textContent = title;
  const p = document.createElement('p');
  p.textContent = message;
  box.append(h1, p);
  document.body.replaceChildren(box);
}

function friendlyError(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof NetworkError) return 'The sea is out of reach right now. Check your connection and try again.';
  return 'Something went wrong out at sea. Please try again.';
}

function boot(): void {
  const canvasEl = document.getElementById('scene');
  const uiRoot = document.getElementById('ui');
  if (!(canvasEl instanceof HTMLCanvasElement) || !uiRoot) return;
  const canvas: HTMLCanvasElement = canvasEl;

  const savedPower = loadLowPower();
  const weak = (navigator.hardwareConcurrency ?? 8) <= 2;
  let world: World;
  try {
    world = new World(canvas, savedPower ?? weak);
  } catch (e) {
    if (e instanceof WebGLUnsupportedError || e instanceof Error) {
      showFallback(
        'Bottle at Sea',
        'The ocean is painted with WebGL 2, which this browser or device cannot provide right now. Try a recent Chrome, Firefox, Safari or Edge, and make sure hardware acceleration is switched on.',
      );
    }
    return;
  }

  const audio = new SeaAudio();
  const ctx: SeqContext = { world, audio };
  world.onSplashSound = (s) => audio.splash(s);

  let state: State = 'idle';
  /** Bumped whenever the visitor changes course, so stale async work can bail out. */
  let flow = 0;
  let current: { bottle: Bottle; data: FoundBottle; ready: boolean } | null = null;
  let timeMode: TimeMode = 'auto';

  const hud = new Hud({
    onToggleSound: () => {
      void audio.setEnabled(!audio.enabled).then((on) => {
        hud.setSound(on);
        hud.announce(on ? 'Ambient sound on' : 'Ambient sound off');
      });
    },
    onToggleLowPower: () => setLowPower(!world.lowPower, true),
    onCycleTime: () => {
      timeMode = TIME_MODES[(TIME_MODES.indexOf(timeMode) + 1) % TIME_MODES.length] ?? 'auto';
      world.setTimeMode(timeMode);
      hud.setTimeMode(TIME_LABEL[timeMode], timeMode === 'night' || (timeMode === 'auto' && world.cycle.tone === 'night'));
      hud.announce(`Time of day: ${TIME_LABEL[timeMode]}`);
    },
  });
  const landing = new Landing({ onWrite: () => void startWrite(), onFind: () => void startFind() });
  const write = new WritePanel({ onSubmit: submit, onCancel: (mode) => void cancelWrite(mode) });
  const read = new ReadPanel({
    onThrowBack: () => void throwBack(),
    onFindAnother: () => void findAnother(),
    onReply: () => void startReply(),
    onReport: () => void report(),
    onRate: rate,
  });
  const findBar = new FindBar({ onOpen: () => void openCurrent(), onCancel: () => void cancelFind() });
  const notice = new Notice();
  uiRoot.append(landing.root, write.root, read.root, findBar.root, notice.root);

  /** Our own bottle also arrives on the live stream; don't show it twice. */
  let ignoreOwnUntil = 0;
  const liveFeed = new LiveFeed({
    onBottle: (tint) => {
      if (Date.now() > ignoreOwnUntil) world.announceBottle(tint);
    },
    onCount: (bottles) => {
      hud.setAdrift(bottles);
      const findable = Math.max(0, bottles - mine.activeCount());
      world.setSeaPopulation(findable);
      landing.setSea(findable);
    },
    onUpdate: (stats) => {
      const c = current;
      if (!c || state !== 'reading') return;
      read.setCounts(stats.up, stats.down);
      if (stats.commentCount !== c.data.commentCount) {
        c.data.commentCount = stats.commentCount;
        void fetchNotes(c.data.id)
          .then((notes) => {
            if (current === c) read.setNotes(notes);
          })
          .catch(() => undefined);
      }
    },
  });
  const initialBottles = hud.initialAdrift();
  if (initialBottles !== null) {
    const findable = Math.max(0, initialBottles - mine.activeCount());
    world.setSeaPopulation(findable);
    landing.setSea(findable);
  }
  liveFeed.start();
  hud.setLowPower(world.lowPower);

  world.onTone = (tone) => {
    document.documentElement.dataset.tone = tone;
    hud.setTimeMode(TIME_LABEL[timeMode], timeMode === 'night' || (timeMode === 'auto' && tone === 'night'));
  };

  function setLowPower(low: boolean, announce: boolean): void {
    world.setLowPower(low);
    hud.setLowPower(low);
    saveLowPower(low);
    if (announce) hud.announce(low ? 'Low power mode on' : 'Low power mode off');
  }

  async function goIdle(): Promise<void> {
    flow++;
    state = 'idle';
    liveFeed.watch(null);
    await Promise.all([write.hide(), read.hide(), findBar.hide(), notice.hide()]);
    world.rig.flyTo('idle', motion.d(2.4));
    await landing.show(14);
    landing.writeButton.focus({ preventScroll: true });
  }

  async function startWrite(): Promise<void> {
    if (state !== 'idle') return;
    state = 'writing';
    flow++;
    void world.rig.enableGyro();
    await landing.hide();
    world.rig.flyTo('write', motion.d(1.8));
    await write.open('write');
  }

  async function cancelWrite(mode: WriteMode): Promise<void> {
    if (mode === 'reply' && current) {
      // Back to the note, which is still open behind the writing panel.
      state = 'reading';
      await write.hide();
      await read.reopen();
      return;
    }
    await goIdle();
  }

  async function submit(mode: WriteMode, text: string, tint: number, email: string): Promise<SubmitResult> {
    if (mode === 'reply') return submitReply(text);
    try {
      const id = await sendBottle(text, tint, email || undefined);
      mine.add(id);
      ignoreOwnUntil = Date.now() + 12_000;
    } catch (e) {
      return { ok: false, message: friendlyError(e) };
    }
    state = 'throwing';
    const my = ++flow;
    hud.announce('Your message is sealed in glass and thrown into the sea.');
    await write.rollUp();
    await write.hide();
    write.clear();
    await throwSequence(ctx, tint);
    if (my !== flow) return { ok: true };
    audio.chime();
    world.rig.flyTo('idle', motion.d(3.2));
    await showToast('Your message is out there somewhere.', 'poem', 3000);
    if (my === flow) await goIdle();
    return { ok: true };
  }

  async function startFind(origin?: { x: number; z: number }): Promise<void> {
    if (state !== 'idle') return;
    state = 'finding';
    const my = ++flow;
    void world.rig.enableGyro();
    await landing.hide();
    findBar.setSearching();
    void findBar.show();

    let data: FoundBottle | null;
    try {
      const [found] = await Promise.all([fetchRandomBottle(excludedIds()), new Promise((r) => window.setTimeout(r, 700))]);
      data = found;
    } catch (e) {
      if (my !== flow) return;
      await findBar.hide();
      await notice.open({
        title: 'The tide is out',
        body: friendlyError(e),
        actions: [
          { label: 'Try again', primary: true, onClick: () => void retryFind() },
          { label: 'Back to shore', onClick: () => void closeNotice() },
        ],
      });
      return;
    }
    if (my !== flow) return;

    if (!data) {
      await findBar.hide();
      hud.announce('The sea is quiet tonight.');
      await notice.open({
        title: 'The sea is quiet tonight.',
        body: 'No bottles have drifted in yet. Perhaps you could be the first to send one.',
        actions: [
          { label: 'Write a message', primary: true, onClick: () => void noticeThenWrite() },
          { label: 'Back to shore', onClick: () => void closeNotice() },
        ],
      });
      return;
    }

    seen.add(data.id);
    findBar.setArriving();
    hud.announce('A bottle is drifting toward you.');
    const { bottle, arrived } = arriveSequence(ctx, data.tint, origin);
    current = { bottle, data, ready: false };
    await arrived;
    if (my !== flow || !current) return;
    current.ready = true;
    findBar.setReady();
    hud.announce('A bottle has arrived. Tap it, or press Open the bottle.');
  }

  async function retryFind(): Promise<void> {
    await notice.hide();
    state = 'idle';
    await startFind();
  }

  async function closeNotice(): Promise<void> {
    await notice.hide();
    await goIdle();
  }

  async function noticeThenWrite(): Promise<void> {
    await notice.hide();
    state = 'idle';
    await startWrite();
  }

  async function cancelFind(): Promise<void> {
    const c = current;
    current = null;
    flow++;
    if (c) sendAway(ctx, c.bottle);
    await goIdle();
  }

  async function openCurrent(): Promise<void> {
    const c = current;
    if (state !== 'finding' || !c || !c.ready) return;
    state = 'reading';
    const my = ++flow;
    canvas.style.cursor = '';
    await findBar.hide();
    hud.announce('Uncorking the bottle.');
    await openSequence(ctx, c.bottle);
    if (my !== flow) return;
    await read.open(c.data);
    liveFeed.watch(c.data.id);
    if (c.data.commentCount > 0) {
      void fetchNotes(c.data.id)
        .then((notes) => {
          if (current === c) read.setNotes(notes);
        })
        .catch(() => undefined);
    }
  }

  async function throwBack(): Promise<void> {
    const c = current;
    if (state !== 'reading' || !c) return;
    const my = ++flow;
    current = null;
    read.setActionsDisabled(true);
    await read.hide();
    await throwBackSequence(ctx, c.bottle);
    if (my !== flow) return;
    void showToast('Back to the sea it goes.', 'quiet', 1800);
    await goIdle();
  }

  async function findAnother(): Promise<void> {
    const c = current;
    if (state !== 'reading' || !c) return;
    current = null;
    liveFeed.watch(null);
    await read.hide();
    sendAway(ctx, c.bottle);
    state = 'idle';
    await startFind();
  }

  async function startReply(): Promise<void> {
    if (state !== 'reading' || !current) return;
    state = 'writing';
    await read.hide();
    await write.open('reply');
  }

  async function submitReply(text: string): Promise<SubmitResult> {
    const c = current;
    if (!c) return { ok: false, message: 'That bottle has drifted away.' };
    try {
      await sendReply(c.data.id, text);
    } catch (e) {
      return { ok: false, message: friendlyError(e) };
    }
    // The answer is the same whether the writer left an email or not, so we never reveal which.
    state = 'reading';
    await write.hide();
    write.clear();
    read.markReplied();
    void showToast('Your reply is on its way.', 'quiet', 2800);
    await read.reopen();
    return { ok: true };
  }

  async function rate(value: 1 | -1, comment: string): Promise<RateResult> {
    const c = current;
    if (!c) return { ok: false, message: 'That bottle has drifted away.' };
    try {
      const totals = await rateBottle(c.data.id, value, comment || undefined);
      return { ok: true, ...totals };
    } catch (e) {
      return { ok: false, message: friendlyError(e) };
    }
  }

  async function report(): Promise<void> {
    const c = current;
    if (state !== 'reading' || !c) return;
    try {
      await reportBottle(c.data.id);
    } catch (e) {
      void showToast(friendlyError(e), 'quiet', 3600);
      return;
    }
    current = null;
    await read.hide();
    sendAway(ctx, c.bottle, 1.6);
    void showToast('Thank you. That bottle has been reported.', 'quiet', 3000);
    await goIdle();
  }

  const tip = document.createElement('div');
  tip.className = 'bottle-tip';
  tip.textContent = 'Open this bottle';
  tip.hidden = true;
  tip.setAttribute('aria-hidden', 'true');
  document.body.append(tip);

  canvas.addEventListener('pointermove', (e) => {
    const c = current;
    if (c && state === 'finding') {
      const over = c.ready && world.hitTest(e.clientX, e.clientY, c.bottle);
      canvas.style.cursor = over ? 'pointer' : '';
      c.bottle.glow = over ? 1.9 : 1;
      return;
    }
    const over = state === 'idle' ? world.pickDecor(e.clientX, e.clientY) : null;
    world.hoveredDecor = over;
    canvas.style.cursor = over ? 'pointer' : '';
    if (over && e.pointerType !== 'touch') {
      tip.hidden = false;
      tip.style.transform = `translate(${e.clientX + 16}px, ${e.clientY + 20}px)`;
    } else {
      tip.hidden = true;
    }
  });
  canvas.addEventListener('pointerleave', () => {
    world.hoveredDecor = null;
    tip.hidden = true;
  });
  canvas.addEventListener('click', (e) => {
    const c = current;
    if (c && c.ready && state === 'finding') {
      if (world.hitTest(e.clientX, e.clientY, c.bottle)) void openCurrent();
      return;
    }
    if (state !== 'idle') return;
    const drifting = world.pickDecor(e.clientX, e.clientY);
    if (!drifting) return;
    canvas.style.cursor = '';
    world.hoveredDecor = null;
    tip.hidden = true;
    void startFind(world.claimDecor(drifting));
  });

  const onResize = (): void => world.resize(window.innerWidth, window.innerHeight);
  window.addEventListener('resize', onResize);

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    showFallback('The sea went dark', 'The graphics context was lost. Reload the page to bring the ocean back.');
  });

  let raf = 0;
  let last = performance.now();
  let fpsFrames = 0;
  let fpsStart = last;
  let slowWindows = 0;
  let skewed = false;
  const startedAt = last;

  const frame = (now: number): void => {
    raf = requestAnimationFrame(frame);
    const raw = (now - last) / 1000;
    last = now;
    if (raw > 0.5) skewed = true; // tab was hidden; don't judge performance on it
    const dt = Math.min(raw, 0.05);
    world.update(dt);
    world.render(dt);

    fpsFrames++;
    if (now - fpsStart >= 2000) {
      const fps = (fpsFrames * 1000) / (now - fpsStart);
      if (!world.lowPower && now - startedAt > 4000 && !skewed) {
        slowWindows = fps < 38 ? slowWindows + 1 : 0;
        if (slowWindows >= 2) {
          setLowPower(true, false);
          void showToast('Switched to low-power mode for smoother motion.', 'quiet', 3600);
          hud.announce('Low power mode on');
        }
      }
      fpsFrames = 0;
      fpsStart = now;
      skewed = false;
    }
  };
  raf = requestAnimationFrame(frame);

  void landing.show(20);

  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      audio.dispose();
      liveFeed.stop();
      world.dispose();
    });
  }

  // Keep stray tweens from outliving a cancelled bottle.
  window.addEventListener('pagehide', () => {
    if (current) killBottleTweens(current.bottle);
  });
}

boot();

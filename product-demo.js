(() => {
  const root = document.querySelector('.demo-ui');
  if (!root) return;
  const product = root.closest('.product');
  const cursor = root.querySelector('.demo-cursor');
  const detail = root.querySelector('.demo-details');
  const title = root.querySelector('[data-demo-title]');
  const path = root.querySelector('[data-demo-path]');
  const patch = root.querySelector('[data-demo-patch]');
  const toggle = root.querySelector('[data-demo-action="toggle"]');
  const fileIcons = {
    ts: root.querySelector('[data-demo-file="app.ts"] svg').cloneNode(true),
    md: root.querySelector('[data-demo-file="新的想法.md"] svg').cloneNode(true),
  };
  const commits = [
    {title:'更新项目的使用说明',path:'README.md',lines:[['remove',1,'','- 查看项目。'],['add','',1,'+ 查看项目的分支、提交与文件变化。']]},
    {title:'合并任务列表功能',path:'tasks.ts',lines:[['add','',1,'+ export const tasks = ["整理想法", "检查 Agent 的修改", "提交可用版本"];']]},
    {title:'调整首页主题和文字层级',path:'app.ts',lines:[['context',1,1,'export const title = "工作流助手";'],['remove',2,'','- export const theme = "light";'],['add','',2,'+ export const theme = "dark";']]},
    {title:'完善任务的筛选与空状态',path:'tasks.ts',lines:[['remove',1,'','- export const tasks = ["整理想法", "检查 Agent 的修改"];'],['add','',1,'+ export const tasks = ["整理想法", "检查 Agent 的修改", "提交可用版本"];']]},
    {title:'增加任务列表与完成状态',path:'tasks.ts',lines:[['add','',1,'+ export const tasks = ["整理想法", "检查 Agent 的修改"];']]},
    {title:'创建项目，建立基础页面',path:'app.ts',lines:[['add','',1,'+ export const title = "工作流助手";'],['add','',2,'+ export const theme = "light";']]},
  ];
  let selected = 3;
  let playing = true;
  let controller = null;
  let detailAnimation = null;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const motionAllowed = () => !reduced.matches && !document.documentElement.classList.contains('reduce-motion');
  const canPlay = () => playing && motionAllowed() && !document.hidden && !product.classList.contains('is-resting') && product.classList.contains('settled');
  function codeRow(kind, old, next, text, split = false) {
    const row = document.createElement('div');
    row.className = 'demo-code-row ' + kind;
    for (const n of split ? [old || next] : [old, next]) {
      const span = document.createElement('span'); span.className = 'demo-line'; span.textContent = n; row.append(span);
    }
    const code = document.createElement('code'); code.textContent = text; row.append(code);
    return row;
  }
  function selectCommit(index) {
    const previous = selected;
    selected = (index + commits.length) % commits.length;
    const item = commits[selected];
    title.textContent = item.title; path.textContent = item.path;
    root.querySelector('.demo-detail-file svg').replaceWith(fileIcons[item.path.endsWith('.md') ? 'md' : 'ts'].cloneNode(true));
    root.querySelector('.demo-detail-file > span:last-child').textContent = [0,2,3].includes(selected) ? '修改' : '新增';
    root.querySelector('.demo-comparison').textContent = selected === 5 ? '首次提交 · 展示 app.ts' : '相对第一个父提交 · 1 个文件';
    root.querySelectorAll('[data-demo-commit]').forEach((button) => {
      const active = Number(button.dataset.demoCommit) === selected;
      button.classList.toggle('is-selected', active); button.setAttribute('aria-pressed', String(active));
    });
    const fragment = document.createDocumentFragment();
    const hunk = document.createElement('div'); hunk.className = 'demo-hunk';
    const range = (position) => { const numbers = item.lines.map((line) => line[position]).filter(Number.isInteger); return numbers.length ? `${Math.min(...numbers)},${Math.max(...numbers) - Math.min(...numbers) + 1}` : '0,0'; };
    hunk.textContent = `@@ -${range(1)} +${range(2)} @@`; fragment.append(hunk);
    item.lines.forEach((line) => fragment.append(codeRow(...line)));
    patch.replaceChildren(fragment);
    detailAnimation?.cancel();
    if (previous !== selected && root.dataset.view === 'history' && motionAllowed()) {
      detailAnimation = detail.animate([{transform:`translateY(${selected < previous ? 9 : -9}px)`,opacity:.9},{transform:'translateY(0)',opacity:1}],{duration:220,easing:'cubic-bezier(.22,.72,.22,1)'});
    }
  }
  function chooseView(view) {
    root.dataset.view = view;
    root.querySelectorAll('[data-demo-view]').forEach((button) => {
      const active = button.dataset.demoView === view;
      button.classList.toggle('is-selected',active); button.setAttribute('aria-pressed',String(active));
    });
  }
  function selectFile(file, staged = false) {
    chooseView('source');
    root.querySelectorAll('[data-demo-file]').forEach((button) => button.classList.toggle('is-selected',button.dataset.demoFile === file && button.hasAttribute('data-staged') === staged));
    root.querySelector('[data-demo-source-path]').textContent = file;
    root.querySelector('[data-demo-source-range]').textContent = staged ? '上次提交 → 暂存区' : '暂存区 → 工作区';
    const before = root.querySelector('[data-demo-before]');
    const after = root.querySelector('[data-demo-after]');
    if (file === '新的想法.md') {
      before.replaceChildren();
      after.replaceChildren(codeRow('add','',1,'# 接下来的想法',true),codeRow('add','',2,'让每一次改动都更容易看清。',true));
    } else {
      before.replaceChildren(codeRow('context',1,1,'export const title = "工作流助手";',true),codeRow(staged ? 'remove' : 'context',2,2,`export const theme = "${staged ? 'dark' : 'system'}";`,true));
      after.replaceChildren(codeRow('context',1,1,'export const title = "工作流助手";',true),codeRow(staged ? 'add' : 'context',2,2,'export const theme = "system";',true));
      if (!staged) after.append(codeRow('add','',3,'export const showCompleted = false;',true));
    }
  }
  function wait(ms, signal) {
    return new Promise((resolve,reject) => {
      const abort = () => { clearTimeout(timer); reject(signal.reason); };
      const timer = setTimeout(() => { signal.removeEventListener('abort',abort); resolve(); },ms);
      signal.addEventListener('abort',abort,{once:true});
      if (signal.aborted) abort();
    });
  }
  function stop() {
    controller?.abort(); controller = null;
    cursor.classList.remove('is-visible','is-clicking');
    detailAnimation?.cancel();
  }
  function updateControl() {
    toggle.setAttribute('aria-label',playing ? '暂停演示' : '播放演示');
    toggle.title = playing ? '暂停演示' : '播放演示';
    toggle.querySelector('use').setAttribute('href',playing ? '#demo-pause' : '#demo-play');
    toggle.querySelector('span').textContent = playing ? '暂停演示' : '播放演示';
  }
  async function clickTarget(target, signal) {
    if (!target || !target.getClientRects().length) return;
    const targetRect = target.getBoundingClientRect(), frame = root.getBoundingClientRect();
    cursor.classList.add('is-visible');
    cursor.style.transform = `translate(${targetRect.left - frame.left + targetRect.width * .65 - 4}px,${targetRect.top - frame.top + targetRect.height * .55 - 4}px)`;
    await wait(580,signal);
    cursor.classList.add('is-clicking');
    target.click();
    await wait(450,signal);
    cursor.classList.remove('is-clicking');
    await wait(1700,signal);
  }
  function sync() {
    if (!canPlay()) { stop(); return; }
    if (controller) return;
    const run = new AbortController(); controller = run;
    (async () => {
      while (!run.signal.aborted) {
        await wait(1100,run.signal);
        await clickTarget(root.querySelector('[data-demo-view="history"]'),run.signal);
        for (const index of [3,2,4]) {
          const target = root.querySelector(`[data-demo-commit="${index}"]`);
          await clickTarget(target.getClientRects().length ? target : root.querySelector('[data-demo-action="next"]'),run.signal);
        }
        await clickTarget(root.querySelector('[data-demo-file="app.ts"]:not([data-staged])')?.getClientRects().length ? root.querySelector('[data-demo-file="app.ts"]:not([data-staged])') : root.querySelector('[data-demo-view="source"]'),run.signal);
        await wait(1800,run.signal);
      }
    })().catch((error) => { if (!run.signal.aborted) { stop(); console.error('Product demo:',error); } });
  }
  root.addEventListener('pointerdown',(event) => {
    if (!event.target.closest('[data-demo-action="toggle"]')) { playing = false; stop(); updateControl(); }
  });
  root.addEventListener('keydown',(event) => {
    if (!event.target.closest('[data-demo-action="toggle"]')) { playing = false; stop(); updateControl(); }
  });
  root.addEventListener('click',(event) => {
    const button = event.target.closest('button'); if (!button) return;
    if (button.dataset.demoAction === 'toggle') { playing = !playing; updateControl(); sync(); }
    else if (button.dataset.demoAction === 'next') selectCommit(selected + 1);
    else if (button.dataset.demoAction === 'previous') selectCommit(selected - 1);
    else if (button.dataset.demoCommit != null) selectCommit(Number(button.dataset.demoCommit));
    else if (button.dataset.demoFile) selectFile(button.dataset.demoFile,button.hasAttribute('data-staged'));
    else if (button.dataset.demoView) {
      chooseView(button.dataset.demoView);
      if (button.dataset.demoView === 'source') selectFile('app.ts');
    }
  });
  const observer = new MutationObserver(sync); observer.observe(product,{attributes:true,attributeFilter:['class']});
  document.addEventListener('visibilitychange',sync);
  reduced.addEventListener('change',sync);
  window.addEventListener('resize',() => { stop(); sync(); });
  window.addEventListener('pagehide',stop);
  window.addEventListener('pageshow',sync);
  selectCommit(selected); selectFile('app.ts'); chooseView('history'); updateControl(); sync();
})();

import type { HandoffMode } from "./build-handoff-input.js";
import {
  prepareReviewRuns,
  type AdvisoryVerdictSet,
  type ReviewFixture
} from "./review-materialization.js";
import type { TargetRunResult } from "./run-target-continuation.js";
import { categoryWeights, type CategoryName } from "./score-assessment.js";

export interface ReviewInputArtifact {
  readonly fixtureId: string;
  readonly mode: HandoffMode;
  readonly contentType: string;
  readonly content: string;
}

const categoryLabels: Readonly<Record<CategoryName, string>> = {
  criticalConstraints: "关键约束",
  objectiveAndState: "目标与状态",
  decisionsAndFailedAttempts: "决策与失败路径",
  completedAndPending: "已完成与待完成",
  workspaceEvidence: "工作区证据",
  nextAction: "唯一下一步"
};

function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function inputKey(input: ReviewInputArtifact): string {
  return `${input.fixtureId}:${input.mode}`;
}

export function renderReviewHtml(
  fixtures: readonly ReviewFixture[],
  inputs: readonly ReviewInputArtifact[],
  results: readonly TargetRunResult[],
  advisory: AdvisoryVerdictSet
): string {
  const prepared = prepareReviewRuns(fixtures, results, advisory);
  const inputByKey = new Map<string, ReviewInputArtifact>();
  for (const input of inputs) {
    const key = inputKey(input);
    if (inputByKey.has(key)) {
      throw new Error(`duplicate review input ${key}`);
    }
    inputByKey.set(key, input);
  }
  if (inputByKey.size !== prepared.length) {
    throw new Error(`review workbench requires ${prepared.length} input artifacts`);
  }

  const categories = Object.keys(categoryWeights) as CategoryName[];
  const runs = prepared.map(({ fixture, result, advisory: run }) => {
    const input = inputByKey.get(`${fixture.id}:${result.mode}`);
    if (input === undefined) {
      throw new Error(`missing review input for ${fixture.id}:${result.mode}`);
    }
    const facts = categories.flatMap((category) => {
      const categoryFacts = category === "nextAction"
        ? [fixture.groundTruth.nextAction]
        : fixture.groundTruth[category];
      return categoryFacts.map((fact) => ({
        category,
        categoryLabel: categoryLabels[category],
        factId: fact.id,
        text: fact.text,
        suggestedVerdict: run.exceptions[fact.id]?.verdict ?? advisory.defaultVerdict,
        advisoryNote: run.exceptions[fact.id]?.note
          ?? "AI 建议此事实已被保留；仍需人工确认。"
      }));
    });
    return {
      runId: result.runId,
      fixtureId: fixture.id,
      mode: result.mode,
      input: input.content,
      output: result.output.text,
      facts
    };
  });
  const target = prepared[0]!.result.target;
  const data = safeJson({
    schemaVersion: "1.0.0",
    benchmarkId: advisory.benchmarkId,
    target: { agent: target.agent, model: target.model, provider: target.provider },
    advisoryReviewer: advisory.reviewer.name,
    runs
  });

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>AgentCarry 人工复核台</title>
  <style>
    :root { color-scheme: dark; --bg:#090b10; --panel:#11151d; --line:#293141; --muted:#929caf; --text:#f3f6fb; --cyan:#6ee7f2; --green:#50d890; --red:#ff737d; --amber:#f4c45e; }
    * { box-sizing:border-box; }
    body { margin:0; min-height:100vh; background:radial-gradient(circle at 50% -20%,#172033 0,var(--bg) 45%); color:var(--text); font:14px/1.6 Inter,"Segoe UI","Microsoft YaHei",sans-serif; }
    button,input,select,textarea { font:inherit; }
    button { cursor:pointer; }
    .topbar { position:sticky; top:0; z-index:10; display:flex; gap:20px; align-items:center; padding:14px 22px; border-bottom:1px solid var(--line); background:rgba(9,11,16,.93); backdrop-filter:blur(16px); }
    .brand { min-width:210px; }
    .brand strong { display:block; font-size:18px; letter-spacing:.02em; }
    .brand span,.meta,.hint { color:var(--muted); font-size:12px; }
    .progress { flex:1; min-width:180px; }
    .progress-row { display:flex; justify-content:space-between; margin-bottom:6px; }
    .track { height:7px; overflow:hidden; border-radius:99px; background:#202633; }
    .track i { display:block; width:0; height:100%; background:linear-gradient(90deg,var(--cyan),var(--green)); transition:width .2s ease; }
    .reviewer { width:170px; padding:9px 11px; color:var(--text); border:1px solid var(--line); border-radius:9px; background:#0d1118; }
    .attest { display:flex; align-items:center; gap:7px; color:var(--muted); font-size:12px; white-space:nowrap; }
    .ghost { padding:8px 12px; color:var(--text); border:1px solid var(--line); border-radius:9px; background:#141a24; }
    .ghost:hover { border-color:#46536a; }
    .workspace { max-width:1680px; margin:0 auto; padding:22px; }
    .runbar { display:grid; grid-template-columns:auto 1fr auto auto; gap:10px; align-items:center; margin-bottom:14px; }
    .runbar select { min-width:0; padding:10px 12px; color:var(--text); border:1px solid var(--line); border-radius:10px; background:#111722; }
    .nav { width:40px; height:40px; color:var(--text); border:1px solid var(--line); border-radius:10px; background:#111722; }
    .pill { padding:6px 10px; border:1px solid #31405a; border-radius:999px; color:var(--cyan); background:#101b29; white-space:nowrap; }
    .comparison { display:grid; grid-template-columns:1fr 1fr; gap:14px; min-height:52vh; }
    .pane { display:flex; min-width:0; flex-direction:column; overflow:hidden; border:1px solid var(--line); border-radius:14px; background:rgba(17,21,29,.9); box-shadow:0 18px 60px rgba(0,0,0,.2); }
    .pane-head { display:flex; align-items:center; justify-content:space-between; padding:12px 16px; border-bottom:1px solid var(--line); }
    .pane-head h2 { margin:0; font-size:14px; }
    pre { flex:1; min-height:360px; max-height:58vh; margin:0; padding:18px; overflow:auto; white-space:pre-wrap; overflow-wrap:anywhere; color:#dce4ef; background:#0c1016; font:13px/1.7 "Cascadia Code","SFMono-Regular",Consolas,monospace; tab-size:2; }
    .decision { margin-top:14px; padding:20px; text-align:center; border:1px solid var(--line); border-radius:14px; background:var(--panel); }
    .decision h2 { margin:0 0 4px; font-size:18px; }
    .decision-actions { display:flex; flex-wrap:wrap; justify-content:center; gap:10px; margin:16px 0 8px; }
    .decision-btn { min-width:230px; padding:13px 18px; color:var(--text); border:1px solid var(--line); border-radius:11px; background:#171d27; font-weight:700; }
    .decision-btn.pass:hover,.decision-btn.pass.active { border-color:var(--green); background:#10271d; color:#a8f3c7; }
    .decision-btn.fail:hover,.decision-btn.fail.active { border-color:var(--red); background:#2a1419; color:#ffb8bd; }
    .status { display:inline-block; margin-top:6px; padding:4px 9px; border-radius:99px; color:var(--muted); background:#0b0f15; }
    .facts { margin-top:14px; padding:18px; border:1px solid var(--line); border-radius:14px; background:var(--panel); }
    .facts summary { cursor:pointer; font-weight:700; font-size:15px; }
    .fact { display:grid; grid-template-columns:130px minmax(0,1fr) 150px; gap:14px; align-items:start; padding:14px 0; border-bottom:1px solid #222a38; }
    .fact:last-child { border-bottom:0; }
    .fact-category { color:var(--cyan); font-size:12px; }
    .fact-text { margin-bottom:4px; }
    .fact-note { color:var(--muted); font-size:12px; }
    .fact select { width:100%; padding:8px; color:var(--text); border:1px solid var(--line); border-radius:8px; background:#0c1118; }
    .note { width:100%; min-height:70px; margin-top:14px; padding:10px 12px; resize:vertical; color:var(--text); border:1px solid var(--line); border-radius:9px; background:#0c1118; }
    .footer-actions { display:flex; justify-content:space-between; gap:12px; margin:18px 0 30px; }
    @media (max-width:900px) { .topbar { flex-wrap:wrap; } .brand { min-width:0; } .progress { order:3; flex-basis:100%; } .comparison { grid-template-columns:1fr; } .runbar { grid-template-columns:auto 1fr auto; } .pill { grid-column:2/4; justify-self:start; } .fact { grid-template-columns:1fr; gap:6px; } pre { max-height:none; } }
  </style>
</head>
<body>
  <header class="topbar">
    <div class="brand"><strong>AgentCarry 人工复核台</strong><span id="targetMeta"></span></div>
    <div class="progress"><div class="progress-row"><span>复核进度</span><strong id="progressText">0 / 36</strong></div><div class="track"><i id="progressBar"></i></div></div>
    <input id="reviewer" class="reviewer" aria-label="复核人名称" placeholder="你的名字 / GitHub ID">
    <label class="attest"><input id="humanConfirmed" type="checkbox">我是人工复核人，本次判断由我本人完成</label>
    <button id="export" class="ghost">导出复核结果</button>
  </header>
  <main class="workspace">
    <div class="runbar">
      <button id="previous" class="nav" aria-label="上一条">←</button>
      <select id="runSelect" aria-label="选择待复核运行"></select>
      <span id="mode" class="pill"></span>
      <button id="next" class="nav" aria-label="下一条">→</button>
    </div>
    <section class="comparison">
      <article class="pane"><div class="pane-head"><h2>输入 · 交接内容</h2><span class="meta">目标 Agent 实际收到的内容</span></div><pre id="input"></pre></article>
      <article class="pane"><div class="pane-head"><h2>输出 · Agent 回答</h2><span class="meta">目标 Agent 返回的续接简报</span></div><pre id="output"></pre></article>
    </section>
    <section class="decision">
      <h2>这个结果能否让另一个 Agent 正确地继续工作？</h2>
      <div class="hint">点击即表示你已核对下方逐项判定；如建议不准确，可直接修改。</div>
      <div class="decision-actions">
        <button id="pass" class="decision-btn pass">通过 · 足以继续工作</button>
        <button id="fail" class="decision-btn fail">不通过 · 可能导致错误续接</button>
      </div>
      <span id="status" class="status">尚未判断</span>
    </section>
    <details class="facts" open>
      <summary>逐项复核依据 <span class="hint">（默认显示 AI 建议，可人工改判）</span></summary>
      <div id="factList"></div>
      <textarea id="note" class="note" placeholder="可选：记录你判定通过或不通过的原因"></textarea>
    </details>
    <div class="footer-actions"><button id="clear" class="ghost">清空本机进度</button><button id="nextPending" class="ghost">跳到下一条未复核 →</button></div>
  </main>
  <script id="review-data" type="application/json">${data}</script>
  <script>
    (function () {
      'use strict';
      var data = JSON.parse(document.getElementById('review-data').textContent);
      var key = 'agentcarry-review-' + data.benchmarkId + '-v1';
      var state = { reviewer: '', humanConfirmed:false, reviews: {} };
      try { state = Object.assign(state, JSON.parse(localStorage.getItem(key) || '{}')); } catch (_) {}
      if (!state.reviews) state.reviews = {};
      var index = 0;
      var verdicts = ['preserved', 'partial', 'missing', 'contradicted'];
      var verdictLabels = { preserved:'保留', partial:'部分保留', missing:'缺失', contradicted:'矛盾' };
      var modeLabels = { 'visible-transcript':'可见对话', 'deterministic-capsule':'确定性 Capsule', 'source-assisted-capsule':'源辅助 Capsule' };
      var byId = function (id) { return document.getElementById(id); };

      function save() {
        state.reviewer = byId('reviewer').value.trim();
        state.humanConfirmed = byId('humanConfirmed').checked;
        localStorage.setItem(key, JSON.stringify(state));
        updateProgress();
      }
      function current() { return data.runs[index]; }
      function suggestedFacts(run) {
        var result = {};
        run.facts.forEach(function (fact) { result[fact.factId] = fact.suggestedVerdict; });
        return result;
      }
      function reviewFor(run) {
        return state.reviews[run.runId] || { outcome:null, factVerdicts:suggestedFacts(run), note:'' };
      }
      function updateProgress() {
        var done = data.runs.filter(function (run) { return state.reviews[run.runId] && state.reviews[run.runId].outcome; }).length;
        byId('progressText').textContent = done + ' / ' + data.runs.length;
        byId('progressBar').style.width = (done / data.runs.length * 100) + '%';
      }
      function renderFacts(run, review) {
        var list = byId('factList');
        list.replaceChildren();
        run.facts.forEach(function (fact) {
          var row = document.createElement('div'); row.className = 'fact';
          var category = document.createElement('div'); category.className = 'fact-category'; category.textContent = fact.categoryLabel + '\\n' + fact.factId;
          var copy = document.createElement('div');
          var text = document.createElement('div'); text.className = 'fact-text'; text.textContent = fact.text;
          var note = document.createElement('div'); note.className = 'fact-note'; note.textContent = 'AI 建议：' + verdictLabels[fact.suggestedVerdict] + ' · ' + fact.advisoryNote;
          copy.append(text, note);
          var select = document.createElement('select'); select.setAttribute('aria-label', fact.factId + ' 的事实判定');
          verdicts.forEach(function (value) { var option = document.createElement('option'); option.value = value; option.textContent = verdictLabels[value]; select.append(option); });
          select.value = review.factVerdicts[fact.factId] || fact.suggestedVerdict;
          select.addEventListener('change', function () { var latest = reviewFor(run); latest.factVerdicts[fact.factId] = select.value; state.reviews[run.runId] = latest; save(); });
          row.append(category, copy, select); list.append(row);
        });
      }
      function render() {
        var run = current(); var review = reviewFor(run);
        byId('runSelect').value = String(index);
        byId('mode').textContent = modeLabels[run.mode] || run.mode;
        byId('input').textContent = run.input;
        byId('output').textContent = run.output;
        byId('note').value = review.note || '';
        byId('pass').classList.toggle('active', review.outcome === 'pass');
        byId('fail').classList.toggle('active', review.outcome === 'fail');
        byId('status').textContent = review.outcome === 'pass' ? '已判定：通过' : review.outcome === 'fail' ? '已判定：不通过' : '尚未判断';
        renderFacts(run, review); updateProgress();
      }
      function decide(outcome) {
        var run = current(); var review = reviewFor(run);
        review.outcome = outcome; review.reviewedAt = new Date().toISOString();
        state.reviews[run.runId] = review; save(); render();
      }
      function move(delta) { index = (index + delta + data.runs.length) % data.runs.length; render(); window.scrollTo({top:0,behavior:'smooth'}); }
      function nextPending() {
        for (var offset = 1; offset <= data.runs.length; offset += 1) {
          var candidate = (index + offset) % data.runs.length;
          var saved = state.reviews[data.runs[candidate].runId];
          if (!saved || !saved.outcome) { index = candidate; render(); window.scrollTo({top:0,behavior:'smooth'}); return; }
        }
        alert('36 条结果已经全部完成复核。');
      }
      function exportReview() {
        save();
        if (!state.reviewer) { alert('请先填写复核人名称或 GitHub ID。'); byId('reviewer').focus(); return; }
        if (!state.humanConfirmed) { alert('最终报告必须由人工复核。请仅在你本人完成判断后勾选人工确认。'); byId('humanConfirmed').focus(); return; }
        var reviews = data.runs.map(function (run) {
          var review = state.reviews[run.runId];
          return review ? Object.assign({runId:run.runId}, review) : {runId:run.runId,outcome:null,factVerdicts:suggestedFacts(run),note:''};
        });
        var complete = reviews.every(function (review) { return review.outcome === 'pass' || review.outcome === 'fail'; });
        var payload = { schemaVersion:'1.0.0', benchmarkId:data.benchmarkId, reviewerKind:'human', humanReviewer:state.reviewer, humanConfirmed:true, exportedAt:new Date().toISOString(), complete:complete, reviews:reviews };
        var blob = new Blob([JSON.stringify(payload, null, 2) + '\\n'], {type:'application/json'});
        var link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'agentcarry-' + data.benchmarkId + '-human-review.json'; link.click(); URL.revokeObjectURL(link.href);
      }

      byId('targetMeta').textContent = data.target.agent + ' / ' + data.target.model + ' · ' + data.target.provider;
      byId('reviewer').value = state.reviewer || '';
      byId('humanConfirmed').checked = state.humanConfirmed === true;
      data.runs.forEach(function (run, runIndex) { var option = document.createElement('option'); option.value = String(runIndex); option.textContent = String(runIndex + 1).padStart(2,'0') + ' · ' + run.fixtureId + ' · ' + (modeLabels[run.mode] || run.mode); byId('runSelect').append(option); });
      byId('runSelect').addEventListener('change', function (event) { index = Number(event.target.value); render(); });
      byId('reviewer').addEventListener('change', save);
      byId('humanConfirmed').addEventListener('change', save);
      byId('note').addEventListener('change', function () { var run = current(); var review = reviewFor(run); review.note = byId('note').value.trim(); state.reviews[run.runId] = review; save(); });
      byId('previous').addEventListener('click', function () { move(-1); });
      byId('next').addEventListener('click', function () { move(1); });
      byId('pass').addEventListener('click', function () { decide('pass'); });
      byId('fail').addEventListener('click', function () { decide('fail'); });
      byId('nextPending').addEventListener('click', nextPending);
      byId('export').addEventListener('click', exportReview);
      byId('clear').addEventListener('click', function () { if (confirm('确定清空本机保存的全部复核进度吗？')) { localStorage.removeItem(key); state = {reviewer:'',humanConfirmed:false,reviews:{}}; byId('reviewer').value = ''; byId('humanConfirmed').checked = false; render(); } });
      render();
    }());
  </script>
</body>
</html>
`;
}

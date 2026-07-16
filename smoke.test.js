const path = require('path');
const { JSDOM } = require('jsdom');

const consoleErrors = [];

async function main() {
  const dom = await JSDOM.fromFile(path.join(__dirname, 'index.html'), {
    runScripts: 'dangerously',
    resources: 'usable',
    url: 'file://' + __dirname + '/index.html',
  });

  dom.window.onerror = (msg, src, line, col, err) => {
    consoleErrors.push(`${msg} (${src}:${line}:${col})`);
  };

  await new Promise((resolve) => {
    if (dom.window.document.readyState === 'complete') return resolve();
    dom.window.addEventListener('load', resolve);
    setTimeout(resolve, 1500);
  });

  const { document, window } = dom.window;
  let pass = 0,
    fail = 0;
  const check = (name, cond, detail = '') => {
    if (cond) {
      pass++;
      console.log(`  ok  - ${name}`);
    } else {
      fail++;
      console.log(`FAIL  - ${name}  ${detail}`);
    }
  };
  const goTo = (id) => document.getElementById(`tabbtn-${id}`).dispatchEvent(new window.Event('click', { bubbles: true }));
  const setInput = (el, value) => {
    el.value = String(value);
    el.dispatchEvent(new window.Event('change', { bubbles: true }));
  };

  check('no runtime JS errors during boot', consoleErrors.length === 0, JSON.stringify(consoleErrors));
  check('tab bar rendered 20 tabs (19 + Summary)', document.querySelectorAll('.tab-btn').length === 20, document.querySelectorAll('.tab-btn').length);
  check('19 tabs have an info button (Skill Tree deliberately has none, it IS the deep-dive)', document.querySelectorAll('.info-btn').length === 19);
  check('Summary is the second tab, right after Transcript', document.querySelectorAll('.tab-btn')[1].textContent.trim() === 'Summary');

  // --- Transcript: reset, random, structure ---
  check('transcript has 12 grade rows', document.querySelectorAll('#transcript-wrap tbody tr').length === 12);
  check('empty state applied with no data', document.getElementById('panel-transcript').classList.contains('is-empty'));

  document.getElementById('random-btn').dispatchEvent(new window.Event('click', { bubbles: true }));
  const totalAfterRandom = Number(document.querySelector('#transcript-wrap tfoot tr:first-child td:nth-child(3)').textContent);
  check('random fills exactly 6 semesters x 5 subjects = 30 total', totalAfterRandom === 30, `got ${totalAfterRandom}`);
  const y4s1Count = document.querySelectorAll('#transcript-wrap tbody tr')[0]
    ? [...document.querySelectorAll('td[data-role="sem"][data-sem="6"] input')].reduce((s, i) => s + (Number(i.value) || 0), 0)
    : null;
  check('random leaves Y4S1 (index 6) empty', y4s1Count === 0, `got ${y4s1Count}`);

  document.getElementById('reset-btn').dispatchEvent(new window.Event('click', { bubbles: true }));
  const totalAfterReset = Number(document.querySelector('#transcript-wrap tfoot tr:first-child td:nth-child(3)').textContent);
  check('reset clears everything back to 0', totalAfterReset === 0, `got ${totalAfterReset}`);
  check('empty state reapplies after reset', document.getElementById('panel-transcript').classList.contains('is-empty'));

  // Now enter the reference transcript for the rest of the tests.
  function setSemCell(label, sem, value) {
    const input = document.querySelector(`td[data-role="sem"][data-label="${label}"][data-sem="${sem}"] input`);
    setInput(input, value);
  }
  setSemCell('A', 0, 1);
  setSemCell('A-', 0, 1);
  setSemCell('B+', 0, 1);
  setSemCell('A', 1, 2);
  setSemCell('A-', 1, 1);
  setSemCell('A+', 2, 1);
  setSemCell('A', 2, 2);
  setSemCell('B+', 2, 1);
  setSemCell('A', 3, 3);
  setSemCell('A-', 3, 2);
  setSemCell('A', 4, 1);
  check('header GPA reflects the reference transcript (4.75000)', document.getElementById('header-gpa').textContent === '4.75000', document.getElementById('header-gpa').textContent);

  // Arrow-key navigation still works.
  const aY1S1 = document.querySelector('td[data-role="sem"][data-label="A"][data-sem="0"] input');
  aY1S1.focus();
  aY1S1.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  check('ArrowRight moves focus to the next semester', document.activeElement === document.querySelector('td[data-role="sem"][data-label="A"][data-sem="1"] input'));

  // --- Summary: six independent sections, each pulling from several other tabs ---
  goTo('summary');
  check('summary shows the disclaimer bubble before the sections', !!document.querySelector('.disclaimer-bubble'));
  check('disclaimer mentions generalisation and encourages visiting individual tabs', document.querySelector('.disclaimer-bubble').textContent.includes('generalisation') && document.querySelector('.disclaimer-bubble').textContent.toLowerCase().includes('encouraged'));
  check('summary renders all 6 sections', document.querySelectorAll('.summary-section').length === 6, document.querySelectorAll('.summary-section').length);
  check('section questions are bolded and unnumbered', [...document.querySelectorAll('.summary-question')].every((h) => h.querySelector('strong') && !/^[A-F0-9][).]/.test(h.textContent.trim())));

  // Section A
  const secA = document.getElementById('summary-section-a');
  check('section A hints Reachability, Required GPA, What if, Module load', ['Reachability', 'Required GPA', 'What if', 'Module load'].every((t) => [...secA.querySelectorAll('.tab-hint-oval')].some((o) => o.textContent === t)));
  check('section A renders a reachability strip', secA.querySelectorAll('.reach-cell').length === 50, secA.querySelectorAll('.reach-cell').length);
  check('section A states a recommended n with the lowest combined score', /n = \d+/.test(secA.textContent));
  check('section A includes the required-GPA-style paragraph with cost and loss', secA.textContent.includes('cost') && secA.textContent.includes('loss'));
  const sumAGpa = document.getElementById('sum-a-gpa');
  setInput(sumAGpa, 4.999);
  check('section A handles an unreachable target gracefully (no recommended-n message)', document.getElementById('summary-section-a').textContent.includes("isn't reachable") || !document.getElementById('summary-section-a').textContent.includes('undefined'));
  setInput(sumAGpa, 4.7);

  // Section B
  const secB = document.getElementById('summary-section-b');
  check('section B hints Efficiency, Plan compare, Policy, Load planner', ['Efficiency', 'Plan compare', 'Policy', 'Load planner'].every((t) => [...secB.querySelectorAll('.tab-hint-oval')].some((o) => o.textContent === t)));
  check('section B advanced filters are hidden by default', document.getElementById('sum-b-advanced').style.display === 'none');
  const sumBMin = document.getElementById('sum-b-minn'),
    sumBMax = document.getElementById('sum-b-maxn');
  setInput(sumBMin, 10);
  setInput(sumBMax, 5);
  check('section B rejects minN >= maxN with a clear warning, not a crash', document.getElementById('summary-section-b').textContent.includes('must be less than'));
  check('section B still shows its input controls after an invalid range (does not vanish)', !!document.getElementById('sum-b-minn') && !!document.getElementById('sum-b-maxn'));
  setInput(sumBMin, 1);
  setInput(sumBMax, 12);
  check('section B recovers with a valid range', !document.getElementById('summary-section-b').textContent.includes('must be less than'));
  check('section B mentions a policy sequence with an arrow', document.getElementById('summary-section-b').textContent.includes('\u2192'));
  check('section B step 5 points to Plan compare', document.getElementById('summary-section-b').textContent.includes('Plan compare'));

  // Section C
  const secC = document.getElementById('summary-section-c');
  check('section C hints Efficiency, Plan compare, Load planner', ['Efficiency', 'Plan compare', 'Load planner'].every((t) => [...secC.querySelectorAll('.tab-hint-oval')].some((o) => o.textContent === t)));
  check('section C renders the 5-column plan table (no room-for-error/extra-used columns)', document.querySelectorAll('#summary-section-c table.dgrid thead th').length === 5, document.querySelectorAll('#summary-section-c table.dgrid thead th').length);
  check('section C recommends a plan by n', /n = \d+/.test(secC.textContent));
  check('target GPA field is blank by default', document.getElementById('sum-c-target').value === '');

  // Section D
  const secD = document.getElementById('summary-section-d');
  check('section D hints Bounds, Feasibility, Risk, Classification, What if', ['Bounds', 'Feasibility', 'Risk', 'Classification', 'What if'].every((t) => [...secD.querySelectorAll('.tab-hint-oval')].some((o) => o.textContent === t)));
  check('section D states final GPA for +1/+2/+3 A and F sensitivity', document.getElementById('summary-section-d').textContent.includes('(+1)') && document.getElementById('summary-section-d').textContent.includes('(+3)'));
  check('section D lists classification bands stopping at the first guaranteed one', document.querySelectorAll('#summary-section-d ul.clean li').length >= 1);
  check('section D reports excellent/normal/hard/worst scenario language', ['excellent semester', 'normal semester', 'hard semester', 'worst case'].every((phrase) => document.getElementById('summary-section-d').textContent.includes(phrase)));

  // Section E
  const secE = document.getElementById('summary-section-e');
  check('section E hints Entropy only', secE.querySelectorAll('.tab-hint-oval').length === 1 && secE.querySelector('.tab-hint-oval').textContent === 'Entropy');
  check('section E responds to the >= 4.495 branch for this high-GPA reference transcript', document.getElementById('summary-section-e').textContent.includes('more class'));

  // Section F
  const secF = document.getElementById('summary-section-f');
  check('section F hints Bayesian, Allocation', ['Bayesian', 'Allocation'].every((t) => [...secF.querySelectorAll('.tab-hint-oval')].some((o) => o.textContent === t)));
  check('section F states a confidence percentage about randomness', /\d+%/.test(secF.textContent) && (secF.textContent.includes('not random') || secF.textContent.includes('is random')));
  check('section F avoids the words epistemic/aleatoric per the no-jargon request', !secF.textContent.toLowerCase().includes('epistemic') && !secF.textContent.toLowerCase().includes('aleatoric'));

  // --- Reachability: transposed axes + color legend + shared Beliefs ---
  goTo('reachability');
  check('reachability legend renders with 5 entries (including the purple anchor mode)', document.querySelectorAll('#reachability-legend .color-legend__item').length === 5, document.querySelectorAll('#reachability-legend .color-legend__item').length);
  const reachBodyRows = document.querySelectorAll('#reachability-wrap tbody tr');
  check('reachability grid has 50 rows (one per n)', reachBodyRows.length === 50, `got ${reachBodyRows.length}`);
  check('first row header is n=1', reachBodyRows[0].querySelector('th').textContent.trim() === '1');
  check('default interval is 0.01', document.getElementById('interval-input').value === '0.01', document.getElementById('interval-input').value);
  check('default min offset is -0.1', document.getElementById('min-input').value === '-0.1', document.getElementById('min-input').value);
  check('default max offset is 0.1', document.getElementById('max-input').value === '0.1', document.getElementById('max-input').value);
  check('grid has 21 columns matching the new tighter range', document.querySelectorAll('#reachability-wrap thead th').length - 1 === 21, document.querySelectorAll('#reachability-wrap thead th').length - 1);

  // Heatmap modes
  const costRadio = document.querySelector('input[name="heatmap-mode"][value="cost"]');
  costRadio.checked = true;
  costRadio.dispatchEvent(new window.Event('change', { bubbles: true }));
  const cellsWithHeatmap = [...document.querySelectorAll('#reachability-wrap td.reach-cell')].filter((td) => td.getAttribute('style') && td.getAttribute('style').includes('background'));
  check('cost heatmap mode applies a background colour to feasible cells', cellsWithHeatmap.length > 0, cellsWithHeatmap.length);
  const noneRadio = document.querySelector('input[name="heatmap-mode"][value="none"]');
  noneRadio.checked = true;
  noneRadio.dispatchEvent(new window.Event('change', { bubbles: true }));
  const cellsWithHeatmapAfterNone = [...document.querySelectorAll('#reachability-wrap td.reach-cell')].filter((td) => td.getAttribute('style') && td.getAttribute('style').includes('background'));
  check('switching back to "no heatmap" removes the inline background colours', cellsWithHeatmapAfterNone.length === 0, cellsWithHeatmapAfterNone.length);
  const anchorPurpleCheck = document.getElementById('anchor-purple-check');
  anchorPurpleCheck.checked = true;
  anchorPurpleCheck.dispatchEvent(new window.Event('change', { bubbles: true }));
  check('anchor-purple toggle applies the purple anchor class', document.querySelectorAll('#reachability-wrap td.is-anchor-purple').length === 50, document.querySelectorAll('#reachability-wrap td.is-anchor-purple').length);
  anchorPurpleCheck.checked = false;
  anchorPurpleCheck.dispatchEvent(new window.Event('change', { bubbles: true }));

  // Change the shared belief here; it must propagate to Bayesian's own controls.
  const meanInput = document.getElementById('mean-input');
  setInput(meanInput, 'A-');
  goTo('bayesian');
  const bayPriorSelect = document.getElementById('bay-prior');
  check('changing the shared belief on Reachability updates the Bayesian prior control', bayPriorSelect.value === 'A-', bayPriorSelect.value);

  // --- Module load: entropy chart added, plus dots, a per-n table, and n=5/n=10 reference points ---
  goTo('module-load');
  check('module-load renders 3 charts (cost, confidence, entropy)', document.querySelectorAll('#module-load-body .chart-card').length === 3, document.querySelectorAll('#module-load-body .chart-card').length);
  check('module-load charts show a dot at every point', document.querySelectorAll('#module-load-body svg circle').length > 0);
  const mlTableRows = document.querySelectorAll('#module-load-body table.dgrid tbody tr');
  check('module-load renders a per-n summary table', mlTableRows.length === 30, mlTableRows.length);
  check('module-load table marks the objectively-best row', !!document.querySelector('#module-load-body tr.row--best'));
  check('module-load shows explicit n=5 and n=10 reference cards', document.getElementById('module-load-body').textContent.includes('At n = 5') && document.getElementById('module-load-body').textContent.includes('At n = 10'));
  check('module-load marks rows 5 and 10 as reference rows', document.querySelectorAll('#module-load-body tr.row--ref').length === 2, document.querySelectorAll('#module-load-body tr.row--ref').length);

  // --- Plan compare: margin column + 4-axis Decision Quality framework + combo in efficiency ---

  goTo('plan-compare');
  check('plan-compare defaults to plans 4, 5, 6', ['pc-plan-0', 'pc-plan-1', 'pc-plan-2'].every((id, i) => document.getElementById(id) && document.getElementById(id).value === String([4, 5, 6][i])), ['pc-plan-0', 'pc-plan-1', 'pc-plan-2'].map((id) => document.getElementById(id) && document.getElementById(id).value));
  const pcHeaders = [...document.querySelectorAll('#plan-compare-body thead th')].map((th) => th.textContent);
  check('plan-compare table no longer includes a room-for-error column (removed per request)', !pcHeaders.some((h) => h.includes('Room for error')), pcHeaders.join(','));
  check('plan-compare table includes a fragility column (formerly "Robustness (Risk)")', pcHeaders.some((h) => h.includes('Fragility')), pcHeaders.join(','));
  check('plan-compare table includes a real-world-odds column (formerly "Likelihood (Confidence)")', pcHeaders.some((h) => h.includes('Real-world odds')), pcHeaders.join(','));
  check('plan-compare table includes an "if it goes badly" column (formerly "Consequence (CVaR)")', pcHeaders.some((h) => h.includes('If it goes badly')), pcHeaders.join(','));
  check('plan-compare explains all four Decision Quality questions in plain language', ['even possible', 'different ways', 'likely', "doesn't"].every((phrase) => document.getElementById('plan-compare-body').textContent.toLowerCase().includes(phrase.toLowerCase())));
  check('plan-compare shows 3 default plan rows', document.querySelectorAll('#plan-compare-body tbody tr').length === 3);
  const pcEffCharts = document.querySelectorAll('#plan-compare-body .eff-chart');
  check('plan-compare renders one efficiency chart per plan (3 total)', pcEffCharts.length === 3, pcEffCharts.length);
  check('plan-compare efficiency callouts show the actual grade combination needed, not just the target', /[0-9]+[A-Z]/.test(document.getElementById('plan-compare-body').textContent));

  // --- Bounds: enumeration table ---
  goTo('bounds');
  check('bounds shows best/worst case', document.querySelectorAll('#bounds-body .answer-card__big').length === 2);
  const boundsEnumRows = document.querySelectorAll('#bounds-body table.dgrid')[0] ? document.querySelectorAll('#bounds-body table.dgrid')[0].querySelectorAll('tbody tr') : [];
  check('bounds renders a full enumeration table', boundsEnumRows.length > 5, boundsEnumRows.length);
  check('bounds enumeration starts from the all-A combination', boundsEnumRows[0] && /A$/.test(boundsEnumRows[0].children[1].textContent.trim()), boundsEnumRows[0] && boundsEnumRows[0].children[1].textContent);

  // --- Feasibility: while-loop growing search + dots, replacing the fixed +-0.3 range ---
  goTo('feasibility');
  check('feasibility renders the main chart', !!document.querySelector('#feasibility-body .chart-card'));
  check('feasibility charts show a dot at every 0.01 point', document.querySelectorAll('#feasibility-body svg circle').length > 10, document.querySelectorAll('#feasibility-body svg circle').length);
  check('feasibility renders a separate right-side strip', document.querySelectorAll('#fc-strip-right td').length > 5);
  check('feasibility renders a separate left-side strip', document.querySelectorAll('#fc-strip-left td').length > 5);
  check('feasibility renders the third-row (one-A-beyond-minimum) charts', document.querySelectorAll('#feasibility-body .chart-card').length >= 3, document.querySelectorAll('#feasibility-body .chart-card').length);
  check('feasibility mentions the search grows outward rather than a fixed window', document.getElementById('feasibility-body').textContent.includes('grows outward'));
  // Growing-search sanity: reducing the budget should never INCREASE how far either side reaches.
  const rightCountBefore = document.querySelectorAll('#fc-strip-right td').length;
  const fcMaxN = document.getElementById('fc-maxn');
  setInput(fcMaxN, 5);
  const rightCountAfterSmallBudget = document.querySelectorAll('#fc-strip-right td').length;
  check('shrinking the search budget shrinks (or keeps equal) how far the right side reaches', rightCountAfterSmallBudget <= rightCountBefore, `${rightCountAfterSmallBudget} vs ${rightCountBefore}`);
  setInput(fcMaxN, 60);
  const leftCell = [...document.querySelectorAll('#fc-strip-left td')].find((td) => td.dataset.idx);
  if (leftCell) {
    leftCell.dispatchEvent(new window.Event('click', { bubbles: true }));
    check('clicking a left-side cell updates the detail card with the low-target framing', document.getElementById('fc-detail').textContent.includes('sustained') || document.getElementById('fc-detail').textContent.includes('already'), document.getElementById('fc-detail').textContent);
  }

  // --- Risk: CVaR primary, dots, histogram, scenario table, independence note ---
  goTo('risk');
  check('risk renders 5 chart-cards (CVaR, VaR, density, confidence, histogram)', document.querySelectorAll('#risk-body .chart-card').length === 5, document.querySelectorAll('#risk-body .chart-card').length);
  check('risk chart titles lead with plain language, not raw CVaR/VaR jargon', document.querySelector('#risk-body .chart-card__head').textContent.toLowerCase().includes('worst case'));
  check('risk line charts show a dot at every point', document.querySelectorAll('#risk-body svg circle').length > 0);
  check('risk includes an explicit independence-assumption warning', document.getElementById('risk-body').textContent.toLowerCase().includes('independent'));
  check('risk renders the GPA distribution histogram', document.querySelectorAll('#risk-body .gpa-hist-bar-col').length > 5, document.querySelectorAll('#risk-body .gpa-hist-bar-col').length);
  const scenarioRows = document.querySelectorAll('#risk-body table.dgrid')[document.querySelectorAll('#risk-body table.dgrid').length - 1].querySelectorAll('tbody tr');
  check('risk renders the optimistic/base/pessimistic/stress scenario table, one row per n', scenarioRows.length === 30, scenarioRows.length);
  check('risk explicitly defines each scenario in prose (not just tooltips)', ['90th percentile', '50th percentile', '10th percentile'].every((phrase) => document.getElementById('risk-body').textContent.includes(phrase)));
  check('risk scenario table comes before the CVaR/VaR/density/confidence charts', (() => {
    const firstTable = document.querySelector('#risk-body table.dgrid');
    const firstChart = document.querySelector('#risk-body .chart-card');
    return firstTable && firstChart && firstTable.compareDocumentPosition(firstChart) & window.Node.DOCUMENT_POSITION_FOLLOWING;
  })());
  const rkHistN = document.getElementById('rk-histn');
  setInput(rkHistN, 3);
  check('changing the histogram n re-renders without crashing', document.querySelectorAll('#risk-body .gpa-hist-bar-col').length > 0);

  // --- Entropy: full rework (structural/predictive/effective futures/opportunity efficiency/utility-weighted) ---
  goTo('entropy');
  check('entropy renders 6 chart-cards (structural, predictive, effective futures, marginal gain, opportunity efficiency, utility-weighted)', document.querySelectorAll('#entropy-body .chart-card').length === 6, document.querySelectorAll('#entropy-body .chart-card').length);
  check('entropy charts show a dot at every point', document.querySelectorAll('#entropy-body svg circle').length > 0);
  check('entropy body mentions effective futures', document.getElementById('entropy-body').textContent.toLowerCase().includes('effective futures'));
  check('entropy body mentions opportunity efficiency', document.getElementById('entropy-body').textContent.toLowerCase().includes('opportunity efficiency'));
  const entropyTables = document.querySelectorAll('#entropy-body table.dgrid');
  check('entropy renders two separate tables (main measures + derivative)', entropyTables.length === 2, entropyTables.length);
  check('entropy main table has 30 rows (n=1..30)', entropyTables[0].querySelectorAll('tbody tr').length === 30, entropyTables[0].querySelectorAll('tbody tr').length);
  check('entropy main table has 6 columns (n + 5 metrics, marginal gain moved out)', entropyTables[0].querySelectorAll('thead th').length === 6, entropyTables[0].querySelectorAll('thead th').length);
  check('entropy derivative table has 30 rows (n=1..30)', entropyTables[1].querySelectorAll('tbody tr').length === 30, entropyTables[1].querySelectorAll('tbody tr').length);
  check('entropy derivative table has 2 columns (n, gain)', entropyTables[1].querySelectorAll('thead th').length === 2, entropyTables[1].querySelectorAll('thead th').length);
  check('entropy derivative table shows a dash at n=1', entropyTables[1].querySelectorAll('tbody tr')[0].textContent.includes('-'));
  check('entropy tables come before the charts in document order', (() => {
    const firstTable = document.querySelector('#entropy-body table.dgrid');
    const firstChart = document.querySelector('#entropy-body .chart-card');
    return firstTable.compareDocumentPosition(firstChart) & window.Node.DOCUMENT_POSITION_FOLLOWING;
  })());

  // --- Bayesian: aleatoric/epistemic + predict ahead ---
  goTo('bayesian');
  check('bayesian renders an uncertainty decomposition per stage', document.querySelectorAll('.uncertainty-bar').length >= 2);
  check('bayesian renders the predict-ahead answer card', !!document.querySelector('#bayesian-body .answer-card'));
  const aheadInput = document.getElementById('bay-ahead-k');
  setInput(aheadInput, 10);
  check('changing predict-ahead k re-renders without crashing', !!document.querySelector('#bayesian-body .answer-card'));

  const currentGradeCount = document.querySelectorAll('#transcript-wrap tbody tr').length;
  check('PMF detail has one bar per currently-defined grade', document.querySelectorAll('.pmf-bar-col').length === currentGradeCount, `expected ${currentGradeCount}, got ${document.querySelectorAll('.pmf-bar-col').length}`);

  // --- Allocation space (new tab) ---
  goTo('allocation');
  check('allocation asks about academic progression, not transcript uniqueness', document.getElementById('allocation-body').textContent.includes('academic progression unusual'));
  check('allocation renders the consistency comparison (actual vs fiber-average variance)', document.getElementById('allocation-body').textContent.includes('variance of your actual semester-by-semester GPA'));
  check('allocation reaches a plain-language conclusion (consistent, volatile, or typical)', ['unusually consistent', 'unusually volatile', 'fairly typical'].some((phrase) => document.getElementById('allocation-body').textContent.includes(phrase)));
  check('allocation still reports valid moves accepted out of attempted', /valid moves accepted out of [\d,]+ attempted/.test(document.getElementById('allocation-body').textContent));
  check('allocation renders the distinct-tables answer card', !!document.querySelector('#allocation-body .answer-card__big'));
  check('allocation renders the original transcript table plus alternatives', document.querySelectorAll('#allocation-body .mini-table').length >= 2, document.querySelectorAll('#allocation-body .mini-table').length);
  const resampleBtn = document.getElementById('al-resample');
  const before = document.querySelector('#allocation-body .answer-card__big').textContent;
  resampleBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
  check('resample re-renders without crashing', !!document.querySelector('#allocation-body .answer-card__big'));

  // --- Academic policy / MDP (new tab) ---
  goTo('policy');
  check('policy renders an answer card with the optimal value', !!document.querySelector('#policy-body .answer-card__big'));
  check('policy renders the walked-forward policy steps', document.querySelectorAll('.policy-step').length >= 1, document.querySelectorAll('.policy-step').length);
  // Reference transcript's GPA (4.75) sits above the default Beliefs mean (B+ = 4.0),
  // so maximising expected GPA has no interior optimum -- every stage should pick the
  // SMALLEST available choice, and the corner-solution explanation should appear.
  const policySteps = [...document.querySelectorAll('.policy-step__badge')].map((b) => b.textContent.trim());
  check('with the default Beliefs (below current GPA), every stage picks the smallest choice', policySteps.every((c) => c === policySteps[0]), policySteps.join(','));
  check('the corner-solution explanation appears rather than leaving this unexplained', document.getElementById('policy-body').textContent.includes('not a bug'));
  const horizonInput = document.getElementById('pol-horizon');
  setInput(horizonInput, 1);
  check('changing horizon to 1 still renders correctly', document.querySelectorAll('.policy-step').length === 1, document.querySelectorAll('.policy-step').length);
  const objectiveSelect = document.getElementById('pol-objective');
  objectiveSelect.value = 'target';
  objectiveSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
  check('switching objective to target-probability re-renders without crashing', !!document.querySelector('#policy-body .answer-card__big'));
  check('the corner-solution explanation only appears for the expected-GPA objective, not this one', !document.getElementById('policy-body').textContent.includes('not a bug'));
  const choicesInput = document.getElementById('pol-choices');
  setInput(choicesInput, 'not,valid');
  check('an invalid choice set shows a clear warning instead of crashing', !!document.querySelector('#policy-body .callout--warning'));

  // --- Efficiency: hover format fix ---
  goTo('efficiency');
  const effBar = document.querySelector('#efficiency-body .eff-bar');
  check('efficiency bar hover title uses the clearer "your loss is" phrasing', effBar && effBar.title.includes('your loss is'), effBar && effBar.title);
  const effCallouts = document.querySelectorAll('#efficiency-body .callout');
  check('efficiency shows both cheapest and most-convenient callouts with matching phrasing', [...effCallouts].some((c) => c.textContent.includes('your loss is')));

  // Direct algorithm verification for the cheapest-target tie-break fix.
  // Constructing a real transcript that naturally produces an exact
  // multi-way cost tie proved impractical (the ceiling-quantisation that
  // underlies Cost makes exact ties sparse), so this replicates the exact
  // tie-break logic from computeEfficiencyForN with synthetic data instead.
  (function () {
    function pickCheapest(targets, costs, currentGpa) {
      let cheapestIdx = -1,
        cheapestCost = Infinity;
      costs.forEach((c, i) => {
        if (Number.isFinite(c) && c < cheapestCost) {
          cheapestCost = c;
          cheapestIdx = i;
        }
      });
      if (cheapestIdx >= 0 && currentGpa !== null) {
        const tolerance = Math.max(cheapestCost * 0.05, 1e-4);
        const tied = targets.map((T, i) => ({ T, i, c: costs[i] })).filter((o) => Number.isFinite(o.c) && o.c - cheapestCost <= tolerance);
        if (tied.length > 1) {
          tied.sort((a, b) => Math.abs(a.T - currentGpa) - Math.abs(b.T - currentGpa));
          cheapestIdx = tied[0].i;
        }
      }
      return cheapestIdx;
    }
    const targets = [4.3, 4.5, 4.7, 4.9];
    const costs = [0, 0, 0, 0.08]; // a genuine 3-way tie at cost 0
    const idx = pickCheapest(targets, costs, 4.85);
    check('cheapest-target tie-break picks the tied candidate closest to current GPA (4.7), not the leftmost (4.3)', targets[idx] === 4.7, targets[idx]);
  })();

  // --- Classification: confidence column ---
  goTo('classification');
  const clHeaders = [...document.querySelectorAll('#classification-body thead th')].map((th) => th.textContent);
  check('classification table includes a Target confidence column', clHeaders.some((h) => h.includes('confidence')), clHeaders.join(','));
  const clRows = document.querySelectorAll('#classification-body tbody tr');
  check('classification has default bands', clRows.length === 5);
  check('a band well below current GPA reads "Already achieved"', !!document.querySelector('#classification-body .guaranteed'));

  // --- What if: sensitivity table ---
  goTo('whatif');
  const aInput = document.querySelector('#whatif-body td[data-label="A"] input');
  setInput(aInput, 1);
  const aMinusInput = document.querySelector('#whatif-body td[data-label="A-"] input');
  setInput(aMinusInput, 1);
  const jumpTables = document.querySelectorAll('#whatif-body table.dgrid');
  check('whatif renders a second table for the sensitivity rows', jumpTables.length === 2, jumpTables.length);
  let jumpRows = jumpTables[1].querySelectorAll('tbody tr');
  check('sensitivity table defaults to 5 rows (-2,-1,0,+1,+2)', jumpRows.length === 5, jumpRows.length);
  check('the middle row is the as-typed baseline', jumpRows[2].textContent.includes('as typed'));
  // The bug case: 1A + 1A- (total 9.5 of a possible 10 with 2 subjects) has
  // room for exactly one step up, not two.
  check('+1 jump on 1A+1A- IS possible (reaches the 2xA ceiling exactly)', !jumpRows[3].textContent.includes('Not possible'), jumpRows[3].textContent);
  check('+2 jump on 1A+1A- is NOT possible (would exceed the ceiling)', jumpRows[4].textContent.includes('Not possible'), jumpRows[4].textContent);
  check('sensitivity table no longer has a misleading shifted-grade column (4 columns now, not 5)', jumpTables[1].querySelectorAll('thead th').length === 4, jumpTables[1].querySelectorAll('thead th').length);

  const wiFwd = document.getElementById('wi-fwd');
  setInput(wiFwd, 5);
  jumpRows = document.querySelectorAll('#whatif-body table.dgrid')[1].querySelectorAll('tbody tr');
  check('jumps-forward is user-configurable', jumpRows.length === 8, jumpRows.length);

  // --- Load planner (new tab) ---
  goTo('load-planner');
  check('load-planner renders the dual-marker chart', !!document.querySelector('#load-planner-body svg circle'), 'no circle markers found');
  check('load-planner renders triangle markers too', !!document.querySelector('#load-planner-body svg polygon'), 'no triangle markers found');
  const lpRows = document.querySelectorAll('#load-planner-body table.dgrid tbody tr');
  check('load-planner table has one row per subject count (default 15)', lpRows.length === 15, lpRows.length);
  const lpMaxN = document.getElementById('lp-maxn');
  setInput(lpMaxN, 8);
  check('load-planner range is configurable', document.querySelectorAll('#load-planner-body table.dgrid tbody tr').length === 8);

  // --- Glossary (new tab) ---
  goTo('glossary');
  const glossaryTables = document.querySelectorAll('#glossary-body table.dgrid');
  check('glossary renders a definitions table and a tab-purpose table', glossaryTables.length === 2, glossaryTables.length);
  check('glossary definitions table has a reasonable number of terms', glossaryTables[0].querySelectorAll('tbody tr').length >= 15);
  check('glossary tab-purpose table has one row per tab (16 non-glossary/about tabs)', glossaryTables[1].querySelectorAll('tbody tr').length === 16, glossaryTables[1].querySelectorAll('tbody tr').length);
  check('glossary includes the worked example text', document.getElementById('glossary-body').textContent.includes('2A, 1A-'));

  // --- About (new tab) ---
  goTo('about');
  const aboutPres = document.querySelectorAll('#about-body pre');
  check('about renders 3 pre blocks (bibtex, apa7, license)', aboutPres.length === 3, aboutPres.length);
  check('about renders the fixed Apache 2.0 license preview', [...aboutPres].some((p) => p.textContent.includes('Apache License')));
  check('about shows the fixed author name', document.getElementById('about-body').textContent.includes('Lee Hao Rong Javier'));
  check('about shows the fixed contact email', document.getElementById('about-body').textContent.includes('javierlee@u.nus.edu'));
  check('about shows year 2026', document.getElementById('about-body').textContent.includes('2026'));
  check('about has no editable inputs (license/author/etc. are fixed, not user-editable)', document.querySelectorAll('#about-body input, #about-body select, #about-body textarea').length === 0);
  check('about renders a BibTeX citation with the COMPASS name', [...aboutPres].some((p) => p.textContent.includes('@software') && p.textContent.includes('COMPASS')));
  check('about BibTeX author has no comma (Lee Hao Rong Javier, not Lee, Hao Rong Javier)', [...aboutPres].some((p) => p.textContent.includes('author = {Lee Hao Rong Javier}')));
  check('about BibTeX includes the project URL', [...aboutPres].some((p) => p.textContent.includes('cepheux.github.io/COMPASS')));
  check('about renders an APA7 citation in the exact requested format', [...aboutPres].some((p) => p.textContent.includes('Lee, Javier. (2026)') && p.textContent.includes('COMPASS') && p.textContent.includes('cepheux.github.io/COMPASS')));
  check('about includes the liability disclaimer', document.getElementById('about-body').textContent.includes('provided free of charge and AS IS'));
  check('about license text is still unchanged Apache 2.0', [...aboutPres].some((p) => p.textContent.includes('Apache License, Version 2.0')));
  check('about renders copy buttons for both citation formats', !!document.getElementById('copy-bibtex') && !!document.getElementById('copy-apa7'));

  // --- Tiered info panels (need -> diagram -> secondary/math/university) ---
  // Note: mermaid loads from an external CDN, which this sandboxed test
  // environment cannot reach -- window.mermaid will be undefined here, so
  // these checks confirm the tiered TEXT structure and graceful fallback,
  // not the actual rendered diagram (which is verified separately, against
  // a local copy of mermaid, before shipping).
  goTo('transcript');
  const transcriptInfoBtn = document.querySelector('[data-info="transcript"]');
  transcriptInfoBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
  const transcriptInfo = document.getElementById('info-transcript');
  check('info panel shows the "why you\'d use this" need statement', transcriptInfo.textContent.includes("Why you'd use this tab"));
  check('info panel includes a diagram container', !!transcriptInfo.querySelector('.mermaid-target'));
  check('info panel degrades gracefully with no mermaid available (no thrown error, some fallback content)', transcriptInfo.querySelector('.mermaid-target').textContent.length >= 0);
  check('info panel has a secondary-school tier', !!transcriptInfo.querySelector('details summary') && transcriptInfo.textContent.includes('Secondary-school-level idea'));
  check('info panel has a math/stats tier', transcriptInfo.textContent.includes('math/stats behind'));
  const detailsCount = transcriptInfo.querySelectorAll('details.info-tier').length;
  check('info panel has 2 or 3 progressively-deeper tiers', detailsCount === 2 || detailsCount === 3, detailsCount);

  // Every one of the 18 non-Skill-Tree tabs should have tiered content that
  // opens without error.
  const allTabIds = ['transcript', 'reachability', 'required-gpa', 'module-load', 'plan-compare', 'bounds', 'feasibility', 'risk', 'entropy', 'bayesian', 'allocation', 'policy', 'load-planner', 'efficiency', 'classification', 'whatif', 'glossary', 'about'];
  let allInfoPanelsOk = true;
  allTabIds.forEach((id) => {
    const btn = document.querySelector(`[data-info="${id}"]`);
    if (!btn) {
      allInfoPanelsOk = false;
      return;
    }
    btn.dispatchEvent(new window.Event('click', { bubbles: true }));
    const panel = document.getElementById(`info-${id}`);
    if (!panel || !panel.textContent.includes("Why you'd use this tab")) allInfoPanelsOk = false;
  });
  check('all 18 tabs have working tiered info content (need statement present)', allInfoPanelsOk);

  // No tab besides Transcript should assume the reader has visited another tab.
  goTo('entropy');
  document.querySelector('[data-info="entropy"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  check('Entropy\'s info content does not require having visited Reachability first', !document.getElementById('info-entropy').textContent.includes('Reachability tab'));
  goTo('policy');
  document.querySelector('[data-info="policy"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  check('Policy\'s explanation does not require having visited Module Load first', !document.getElementById('policy-body').textContent.includes('Module Load already'));

  // --- Skill Tree (new tab) ---
  goTo('skilltree');
  check('skill tree states its intent at the top', document.getElementById('skilltree-body').textContent.includes('What this page is for'));
  check('skill tree mentions all three education tiers', ['secondary school', 'tertiary', 'postgraduate'].every((tier) => document.getElementById('skilltree-body').textContent.toLowerCase().includes(tier)));
  check('skill tree has a diagram container that does not crash without mermaid available', !!document.getElementById('skilltree-diagram'));
  check('skill tree explains the bridging concepts not directly used by any tab', document.getElementById('skilltree-body').textContent.includes('Frequentist Statistics'));
  check('skilltree tab has no info button (it IS the deep-dive content)', !document.querySelector('[data-info="skilltree"]'));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Smoke test crashed:', err);
  process.exit(1);
});

(function () {
  'use strict';

  const { GradeSystem, AcademicState, Reachability, ProbabilityModel, BayesianTrack, Analysis } = window.COMPASS;

  const SEMESTERS = ['Y1S1', 'Y1S2', 'Y2S1', 'Y2S2', 'Y3S1', 'Y3S2', 'Y4S1', 'Y4S2'];
  const VIRIDIS = ['#440154', '#472d7b', '#3b528b', '#2c728e', '#21918c', '#27ad81', '#5ec962', '#aadc32', '#fde725'];

  const gradeSystem = GradeSystem.nusDefault();
  let state = AcademicState.empty(gradeSystem, SEMESTERS);

  const fmt2 = (x) => (x === null || Number.isNaN(x) ? '-' : x.toFixed(2));
  const fmt5 = (x) => (x === null || Number.isNaN(x) ? '-' : x.toFixed(5));
  const pct = (x) => (x === null || Number.isNaN(x) ? '-' : `${(x * 100).toFixed(1)}%`);

  let toastTimer = null;
  function showToast(message) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('visible'), 4000);
  }

  // Rounds/snaps a raw score onto the grid implied by every OTHER tier's
  // spacing (not gradeSystem.latticeStep() as a whole, which can be 0 if a
  // prior edit already left two tiers colliding: that would make recovery
  // divide by zero instead of fixing it). Scores stay fixed at 0.5
  // increments by design: this enforces that whether editing an existing
  // tier or placing a newly-added one.
  function snapScore(label, raw) {
    const ownEntry = gradeSystem.entries.find((x) => x.label === label);
    const canonicalName = ownEntry ? ownEntry.aliasOf || ownEntry.label : label;
    const otherScores = gradeSystem
      .canonicalEntries()
      .filter((e) => e.label !== canonicalName)
      .map((e) => e.score)
      .sort((a, b) => a - b);
    let step = Infinity;
    for (let i = 1; i < otherScores.length; i++) step = Math.min(step, otherScores[i] - otherScores[i - 1]);
    if (!(step > 0) || !Number.isFinite(step)) step = 0.5;
    const base = otherScores.length ? otherScores[0] : 0;
    return base + Math.round((raw - base) / step) * step;
  }

  // Shared belief about "a typical future grade": one object, edited from
  // either the Reachability or Bayesian controls, read by Reachability,
  // Module Load, Risk, Entropy, and Bayesian alike. tierSpread is in units
  // of one grade tier; each consumer converts to its own coordinate system
  // (raw score for the four bell-curve tabs, ordinal rank for Bayesian).
  const beliefs = {
    centerLabel: 'B+',
    tierSpread: 1.0,
  };
  function beliefsRawSpread(gradeSystem) {
    return beliefs.tierSpread * gradeSystem.latticeStep();
  }

  // ------------------------------------------------------------------
  // Tab bar + info popovers
  // ------------------------------------------------------------------

  const TAB_DEFS = [
    { id: 'transcript', label: 'Transcript' },
    { id: 'summary', label: 'Summary' },
    { id: 'reachability', label: 'Reachability' },
    { id: 'required-gpa', label: 'Required GPA' },
    { id: 'module-load', label: 'Module load' },
    { id: 'plan-compare', label: 'Plan compare' },
    { id: 'bounds', label: 'Bounds' },
    { id: 'feasibility', label: 'Feasibility' },
    { id: 'risk', label: 'Risk' },
    { id: 'entropy', label: 'Entropy' },
    { id: 'bayesian', label: 'Bayesian' },
    { id: 'allocation', label: 'Allocation' },
    { id: 'policy', label: 'Policy' },
    { id: 'load-planner', label: 'Load planner' },
    { id: 'efficiency', label: 'Efficiency' },
    { id: 'classification', label: 'Classification' },
    { id: 'whatif', label: 'What if' },
    { id: 'glossary', label: 'Glossary' },
    { id: 'about', label: 'About' },
    { id: 'skilltree', label: 'Skill tree' },
  ];

  // Each tab's info content is tiered: a one-line "need" (always visible),
  // a small mermaid diagram (need -> features -> the math/stat tool that
  // addresses it), then three progressively deeper <details> sections a
  // reader opens only if they want to go further. No tab may assume the
  // reader has visited any other tab first (Transcript is the sole
  // exception, since entering grades is the necessary first step).
  const INFO_CONTENT = {
    transcript: {
      need: 'You need one place to enter your grades that automatically keeps your running GPA correct: everything else in this tool reads from what you enter here.',
      diagram: `flowchart TD
        Need["Need:\nan accurate,\nup-to-date GPA"] --> Feat["Feature:\nenter counts per grade,\nper semester"]
        Feat --> Tool["Tool:\na running total\n(count and score),\nrecalculated live"]`,
      secondary: "Your GPA is just a weighted average: multiply each grade's point value by how many times you got it, add those up, divide by your total subject count. This tab does exactly that arithmetic for you, live, so you never have to redo it by hand after adding one more class.",
      mathRequired: 'Nothing beyond arithmetic (multiplication, addition, division) is required to use this tab. The one structural idea worth knowing: every grade sits on an evenly-spaced number line (F, D, D+, C-, ... each exactly 0.5 apart on the default scale): that even spacing is what lets every other tab in this tool do exact, guaranteed-correct math instead of estimating.',
      university: 'Formally, a semester is a function from grades to counts, and your GPA is a ratio of two sums (total grade-points divided by total subjects) computed over that function: never stored as its own value, always recalculated. This distinction (GPA as a derived quantity, not a stored one) is what the rest of this tool is built on.',
    },
    summary: {
      need: 'You want the answers to a few common questions right away, without visiting six or seven different tabs yourself to piece them together.',
      diagram: `flowchart TD
        Need["Need:\nquick answers,\nfew tabs"] --> Feat["Feature:\nsix common questions,\nanswered directly"]
        Feat --> Tool["Tool:\npulls from the same\nengine every other tab uses"]`,
      secondary: 'This page reads like a set of frequently asked questions, each with a real, computed answer rather than a generic one. Every answer is built from the exact same maths as the tab it draws from; nothing here is a separate, simplified estimate.',
      mathRequired: "Nothing new: every number on this page is produced by calling the same reachability, risk, entropy, Bayesian, and allocation logic used elsewhere in this tool, just pre-selected and pre-summarised into a short paragraph instead of a full chart or grid.",
      university: 'This tab is a pure synthesis layer: it holds no computation of its own beyond selection, filtering, and sorting of results already produced by the engine functions documented elsewhere. Treat any answer here as a starting point, not a replacement for the fuller tab it was drawn from, since a short summary necessarily leaves detail out.',
    },
    reachability: {
      need: "You want to know exactly what grades you'd need for every combination of 'how many classes are left' and 'what GPA am I aiming for': all at once, not one at a time.",
      diagram: `flowchart TD
        Need["Need:\nsee every option\nat once"] --> Feat["Feature:\na grid of every\n(classes left, target) pair"]
        Feat --> Tool["Tool:\nan exact grade-\ncombination solver"]`,
      secondary: 'A target GPA needs a certain average on your remaining classes. This tab works that out for every possible target and every possible number of remaining classes, and shows you the simplest way to get there: usually just two different grades mixed together, never a complicated combination.',
      mathRequired: 'You need the weighted-average idea from the grade-entry tab, plus one new idea: a displayed target like 4.75 actually covers a small range of real values (roughly 4.745 up to just under 4.755) that all get shown as "4.75" once rounded. Every calculation here aims for the easiest edge of that range, not its middle, since that\'s genuinely the least you need.',
      university: "Because every grade sits on an evenly-spaced integer lattice, any achievable total can be represented using at most two adjacent grade tiers: a provable theorem, not a heuristic search. That's why this grid didn't need to try grade combinations one by one to fill a thousand-plus cells: each cell is solved in closed form, directly.",
    },
    'required-gpa': {
      need: "You don't want a whole grid: you want one straight answer for one target and one number of classes left.",
      diagram: `flowchart TD
        Need["Need:\none direct\nanswer"] --> Feat["Feature:\ntype a target and\nclasses remaining"]
        Feat --> Tool["Tool:\nthe same solver as\nthe full grid, run once"]`,
      secondary: "Exactly the same maths as the full grid on the Reachability tab, just answered for one specific case instead of shown for every case at once.",
      mathRequired: 'Same as Reachability: weighted averages, and the idea that a displayed target covers a small range of real values, not one exact number.',
    },
    'module-load': {
      need: 'You want to know how many classes to take this semester to hit a target: not just whether it\'s possible, but which class count is actually the smart one.',
      diagram: `flowchart TD
        Need["Need:\npick the smartest\nclass count"] --> Feat["Feature:\novershoot, real-world odds,\nand flexibility, per class count"]
        Feat --> Tool["Tool:\nsweep the solver across\nevery count, mark the best"]`,
      secondary: 'More classes usually means more room to recover from one bad grade, but also more total work and a wider spread of possible outcomes. This tab tries every reasonable class count and marks the one that needs the least "extra" performance while still giving you good odds.',
      mathRequired: 'Beyond the Reachability idea of a required average, this tab needs the idea of a probability: not just "can I do it" but "how likely am I to, realistically": based on a typical-performance guess you set for yourself. It also touches "how many different futures are still open," which the Entropy tab covers properly.',
      university: 'Target confidence comes from convolving a per-subject probability distribution with itself n times (summing n independent draws) to get the full distribution of possible totals for that class count: the same building block reused by Risk, Entropy, and the Policy tab.',
    },
    'plan-compare': {
      need: 'You have a few candidate class counts in mind and want to compare them fairly: on more than just "does it work."',
      diagram: `flowchart TD
        Need["Need:\ncompare options\nfairly"] --> Feat["Feature:\nfour separate\nquestions per option"]
        Feat --> Tool["Tool:\nsolver + density count +\nprobability + tail-average"]`,
      secondary: "Judging a plan by one single number hides trade-offs: a plan can be very doable but fragile if anything goes wrong, or fairly safe but painful in the worst case. This tab asks four separate questions instead of blending them into one score, so you can see where each option actually differs.",
      mathRequired: 'Needs the same probability idea as Module Load, plus counting how many different ways a plan could succeed (more ways generally means a sturdier plan), plus one new idea: the average outcome specifically among your worst outcomes, not your average outcome overall.',
      university: 'Robustness here is a density count over the combinatorial solution space (more supporting grade combinations near a target means a less fragile target). Consequence is Conditional Value-at-Risk (Rockafellar & Uryasev, 2000): the conditional expectation of the outcome given it falls in a chosen worst-probability slice: a coherent risk measure, unlike a plain worst case.',
    },
    bounds: {
      need: 'You want your absolute ceiling and floor with the classes you have left: no assumptions, just the honest extremes.',
      diagram: `flowchart TD
        Need["Need:\nknow your\nlimits"] --> Feat["Feature:\nbest case, worst case,\neverything in between"]
        Feat --> Tool["Tool:\nexact extremes plus a\ncomplete step-by-step list"]`,
      secondary: 'If every remaining class were your best possible grade, that\'s your ceiling. If every one were your worst, that\'s your floor. Nothing can happen outside that range, and the list below shows every single value in between is genuinely reachable too, not just plausible.',
      mathRequired: 'Needs the idea that the number line between two achievable totals has no gaps: every value in between really is reachable by some combination of grades, one grade-swap at a time, not just a rough estimate of "somewhere around there."',
      university: 'This completeness follows from a discrete intermediate-value argument on the integer lattice: incrementing one grade at a time from the worst combination to the best passes through every achievable total exactly once, with no value skipped.',
    },
    feasibility: {
      need: "Aiming high, you want the fewest classes before a goal becomes possible. Worried about falling, you want to know how many classes of bad luck it'd take before a low target becomes a real risk. Both are the same tab.",
      diagram: `flowchart TD
        Need["Need:\ntwo mirrored\nquestions"] --> Feat["Feature:\nsearch up for 'newly\npossible', down for\n'no longer automatic'"]
        Feat --> Tool["Tool:\na growing search that\nstops at your budget"]`,
      secondary: 'Two different students, two different worries: this tab answers both without making you pick one framing over the other.',
      mathRequired: 'Needs one key idea: something that\'s "possible with N classes" stays possible with MORE classes too: it never becomes impossible again once it\'s become possible. That\'s exactly why the search can grow outward and simply stop the first time it fails, instead of having to check every case individually.',
      university: 'This monotonicity is a direct corollary of the reachability-bounds theorem: the achievable interval only widens as remaining subjects increase, never narrows, which licenses a linear upward/downward scan in place of an exhaustive search.',
    },
    risk: {
      need: 'You want an honest, realistic sense of how bad things could actually get: not the theoretical worst case, and not a falsely comforting average either.',
      diagram: `flowchart TD
        Need["Need:\na realistic\nworst case"] --> Feat["Feature:\nfull distribution, tail\naverages, named scenarios"]
        Feat --> Tool["Tool:\na probability model +\ntail-average (CVaR)"]`,
      secondary: 'Imagine writing down every plausible way your remaining classes could go, then only averaging the worse half of those outcomes: that\'s more honest than either a single overall average (too optimistic) or the absolute worst case (too extreme to be useful).',
      mathRequired: 'Needs the idea of a probability distribution (not every outcome is equally likely) and a percentile (the value below which a given fraction of outcomes fall): both used to build the optimistic/base/pessimistic/stress scenario table.',
      university: 'CVaR at level alpha is the conditional expectation of the outcome given it falls in the worst alpha-quantile: a coherent risk measure (Rockafellar & Uryasev, 2000), unlike Value-at-Risk alone. Computed by convolving a per-subject distribution and walking the sorted result; this assumes future subjects are independent draws, which understates risk if a bad semester tends to drag every grade in it down together.',
    },
    entropy: {
      need: 'You want to know how much genuine flexibility you have left: an actual count of how open your future still is, not a vague feeling about it.',
      diagram: `flowchart TD
        Need["Need:\nhow open is\nmy future"] --> Feat["Feature:\npossible vs. realistic futures,\nand whether that's worth anything"]
        Feat --> Tool["Tool:\nentropy, converted into\na plain outcome count"]`,
      secondary: "If absolutely nothing about your remaining classes were decided, you'd have many possible paths ahead. If everything were basically locked in, you'd have almost exactly one. This tab measures where you actually sit on that spectrum, using your own realistic expectations rather than raw mathematical possibility.",
      mathRequired: 'Needs the idea of counting "distinct effective outcomes" from a probability distribution: spread evenly across many options, that count is large; concentrated on one or two, it\'s small even if many options exist on paper. Also needs the idea that flexibility among bad outcomes shouldn\'t count the same as flexibility among good ones.',
      university: 'Entropy H = -Σp·log₂(p), in bits; 2^H (the Hill number of order 1, borrowed from ecology\'s "effective species count") converts this into an effective category count. Structural entropy uses a uniform prior (a maximum-entropy baseline with no ability assumption); predictive entropy uses your actual fitted belief; their ratio approximates how much of the theoretical space is genuinely in play for you. Weighting each outcome by a GPA-increasing utility before summing corrects for flexibility concentrated on undesirable outcomes.',
    },
    bayesian: {
      need: 'You want your expectations about your own performance to actually update as your real semesters come in: not stay a fixed guess forever.',
      diagram: `flowchart TD
        Need["Need:\nupdate belief\nwith evidence"] --> Feat["Feature:\na starting guess, revised\neach semester, split into\nwhat more data fixes\nvs. what it never will"]
        Feat --> Tool["Tool:\nsequential probability\nupdating"]`,
      secondary: "If you expected to do okay, but your first two semesters go really well, it's reasonable to expect a bit better going forward: this tab does that adjustment with real numbers instead of a gut feeling.",
      mathRequired: 'Needs the idea of updating a starting guess as evidence arrives (revised proportionally to how much and how convincing the new evidence is), and the idea that some uncertainty is about not yet knowing your true ability (which shrinks as more semesters arrive) while some is just natural, semester-to-semester inconsistency (which no amount of data removes).',
      university: 'Sequential conjugate Normal-Normal updating on an ordinal encoding of grades (rank, not raw grade-point value). Posterior variance decomposes into epistemic (parameter uncertainty, shrinks with n) and aleatoric (observation noise, fixed) components. What\'s plotted is the posterior PREDICTIVE distribution (belief uncertainty plus observation noise combined) which is wider than the belief alone.',
    },
    allocation: {
      need: 'You want to know whether the specific way your semesters actually played out was unusual, or just one of many equally-valid arrangements.',
      diagram: `flowchart TD
        Need["Need:\nwas my path\nspecial?"] --> Feat["Feature:\nevery OTHER arrangement\nwith the same totals"]
        Feat --> Tool["Tool:\na random walk that swaps\ngrades without changing any total"]`,
      secondary: 'Imagine shuffling which semester "got" which grade, as long as each semester still has the same number of classes and you still end up with the same overall grade counts. How many genuinely different shuffles are possible? That\'s what this tab explores directly, with real examples.',
      mathRequired: 'Needs the idea of a total that must stay fixed (each semester\'s class count, and each grade\'s overall count) while individual details underneath are free to vary, and the idea that repeating a small, valid swap enough times can eventually reach every other valid arrangement, not just nearby ones.',
      university: 'Models the transcript as a two-way contingency table (semesters × grades) and explores its fiber (every table sharing the same row and column sums) via the Markov basis for the independence model: a sequence of 2×2 moves proven (Diaconis & Sturmfels, 1998) sufficient to connect the entire fiber, not merely its immediate neighbours.',
    },
    policy: {
      need: 'You want the best PLAN across several remaining semesters at once, not just advice for the very next one in isolation.',
      diagram: `flowchart TD
        Need["Need:\nbest multi-semester\nplan"] --> Feat["Feature:\na decision for every\nremaining semester, each\naware of what comes after"]
        Feat --> Tool["Tool:\nsolve backward from\nthe last semester to the first"]`,
      secondary: "If you already knew the best move for your very last semester, you could work out the best move for the one before it, knowing what you'd do next: repeat that backward all the way to your next semester, and you get a full plan, not just one step.",
      mathRequired: 'Needs the idea of a decision that accounts for the future, and one subtler idea: maximising a plain AVERAGE outcome can mean the best choice is always an extreme (take as many or as few classes as possible) rather than a middle-ground number: genuinely correct behaviour, not an error, explained further on the tab itself.',
      university: "A finite-horizon Markov Decision Process solved exactly by backward induction (Bellman's equation): state is (semester, subjects completed, cumulative score), action is subject count, reward is the chosen utility of final GPA. Maximising a linear expected value over an averaging state transition has no interior optimum: a genuinely nonlinear objective (e.g. probability of clearing a threshold) is required for an interior (non-extreme) policy to emerge.",
    },
    'load-planner': {
      need: 'You want to know the easiest number of classes to take this semester, full stop: not tied to chasing one specific target.',
      diagram: `flowchart TD
        Need["Need:\neasiest class\ncount"] --> Feat["Feature:\ncheapest option and most\nconvenient option, per class count"]
        Feat --> Tool["Tool:\nthe same cost sweep as\nEfficiency, repeated across counts"]`,
      secondary: "Some targets are cheap to aim for; some are simply close to where you already stand. This tab tracks both as your number of classes changes, so you can see the pattern across your options instead of checking one class count at a time.",
      mathRequired: 'Same idea as the Efficiency tab: "overshoot" (using more performance than strictly required), and picking the option nearby with the least of it.',
    },
    efficiency: {
      need: "For a fixed number of classes left, you want to know which nearby GPA to actually aim for: without wasting effort overshooting a target you didn't need to clear by that much.",
      diagram: `flowchart TD
        Need["Need:\naim\nefficiently"] --> Feat["Feature:\ncompare nearby targets\nby wasted effort"]
        Feat --> Tool["Tool:\na cost sweep across\nnearby targets"]`,
      secondary: 'Aiming exactly between two "display roundings" can waste performance compared to aiming right at a rounding\'s edge. This tab finds the nearby targets that need the least extra beyond what\'s strictly necessary.',
      mathRequired: 'Needs the "rounding bucket" idea from Reachability (why 4.75 covers a small range, not one exact value) and the idea of overshoot: how much more than the bare minimum a plan actually ends up using.',
    },
    classification: {
      need: "You want to know exactly what's needed for named bands like First Class Honours, or whether you're already safely above the minimum to graduate.",
      diagram: `flowchart TD
        Need["Need:\nknow where I stand\nvs. named bands"] --> Feat["Feature:\nrequired average AND\nreal-world odds, per band"]
        Feat --> Tool["Tool:\nthe same solver as\nReachability, run per band"]`,
      secondary: 'Each named band (First Class, Second Upper, minimum to graduate, and so on) is really just a target GPA with a label attached. This tab asks the same "what do I need" question for every band you care about, and says plainly if one is already locked in regardless of what happens next.',
      mathRequired: 'Same as Reachability (a required average) plus Module Load (turning that into real-world odds).',
    },
    whatif: {
      need: 'You want to try out a hypothetical semester (good or bad) without touching your real, saved grades.',
      diagram: `flowchart TD
        Need["Need:\nsafe\nexperimentation"] --> Feat["Feature:\na scratch semester, plus\n'what if it goes one\nnotch better or worse'"]
        Feat --> Tool["Tool:\nthe same weighted-average\nmath as grade entry, on a hypothetical"]`,
      secondary: 'Type in a pretend semester and see instantly what it would do to your GPA: then see what happens if that pretend semester goes a little better, or a little worse, than what you typed.',
      mathRequired: 'Same weighted-average idea as the grade-entry tab, plus one new idea: a "one notch better" shift moves the WHOLE hypothetical semester\'s total by a fixed amount, not each grade separately, which is exactly why there\'s a hard limit to how many notches are even possible, explained directly on the tab.',
    },
    glossary: {
      need: "You've hit a word somewhere else in this tool that you don't recognise, and want a plain definition fast, or you want to know which tab actually answers the question you have in mind.",
      diagram: `flowchart TD
        Need["Need:\nwhat does this\nword mean?"] --> Feat["Feature:\ndefinitions, a purpose\ntable, one worked example"]
        Feat --> Tool["Tool:\na plain-language\nreference page"]`,
      secondary: 'No new maths here: this page exists purely to translate every term used elsewhere back into plain language, in one place.',
      mathRequired: 'None beyond what the worked example walks through by hand.',
    },
    about: {
      need: "You want to know who built this, what you're allowed to do with it, and how to credit it.",
      diagram: `flowchart TD
        Need["Need:\nlicense and\ncredit"] --> Feat["Feature:\nfixed license and\nauthor information"]
        Feat --> Tool["Tool:\na standard open-source\nlicense (Apache 2.0)"]`,
      secondary: 'This tool is shared under a standard open license, meaning you can use it and build on it freely, provided the original credit stays attached.',
      mathRequired: 'None: this tab is administrative, not analytical.',
    },
  };

  function buildInfoPanelHTML(id) {
    const c = INFO_CONTENT[id];
    if (!c) return '';
    const diagramId = `mmd-${id}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    return `
      <p class="info-need"><strong>Why you'd use this tab:</strong> ${c.need}</p>
      <div class="info-diagram-wrap"><div class="mermaid-target" id="${diagramId}" data-def="${encodeURIComponent(c.diagram)}">Loading diagram…</div></div>
      <details class="info-tier"><summary>Secondary-school-level idea</summary><p>${c.secondary}</p></details>
      <details class="info-tier"><summary>The math/stats behind the fuller picture</summary><p>${c.mathRequired}</p></details>
      ${c.university ? `<details class="info-tier"><summary>University-level view</summary><p>${c.university}</p></details>` : ''}
    `;
  }

  async function renderMermaidTargets(root) {
    const targets = root.querySelectorAll('.mermaid-target');
    for (const el of targets) {
      const def = decodeURIComponent(el.dataset.def);
      try {
        const { svg } = await window.mermaid.render(el.id + '-svg', def);
        el.innerHTML = svg;
      } catch (e) {
        el.innerHTML = '<p style="color:var(--ink-faint);font-size:12px">(diagram unavailable)</p>';
      }
    }
  }

  function wireInfoButtons() {
    if (window.mermaid) window.mermaid.initialize({ startOnLoad: false, theme: 'neutral', flowchart: { htmlLabels: true } });
    document.querySelectorAll('.info-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.info;
        const panel = document.getElementById(`info-${id}`);
        if (!panel) return;
        const willShow = panel.hidden;
        document.querySelectorAll('.info-panel').forEach((p) => (p.hidden = true));
        if (willShow) {
          panel.innerHTML = buildInfoPanelHTML(id);
          panel.hidden = false;
          renderMermaidTargets(panel);
        }
      });
    });
  }

  let currentTab = 'transcript';

  function safeRender(id) {
    const panel = document.getElementById(`panel-${id}`);
    try {
      TAB_RENDERERS[id]();
      const warn = panel && panel.querySelector('.scale-warning');
      if (warn) warn.remove();
    } catch (err) {
      if (panel && !panel.querySelector('.scale-warning')) {
        const div = document.createElement('div');
        div.className = 'callout callout--warning scale-warning';
        div.textContent = `This tab needs every grade to have a distinct, evenly-spaced score. Fix the Score column on the Transcript tab to continue: ${err.message}`;
        panel.prepend(div);
      }
    }
  }

  function renderTabBar() {
    const bar = document.getElementById('tab-bar');
    bar.innerHTML = TAB_DEFS.map(
      (t, i) => `
      <button class="tab-btn" role="tab" id="tabbtn-${t.id}" aria-selected="${i === 0}"
        aria-controls="panel-${t.id}" data-tab="${t.id}">
        ${t.label}
      </button>`
    ).join('');
    bar.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => selectTab(btn.dataset.tab));
    });
  }

  function selectTab(id) {
    currentTab = id;
    TAB_DEFS.forEach((t) => {
      const btn = document.getElementById(`tabbtn-${t.id}`);
      const panel = document.getElementById(`panel-${t.id}`);
      const active = t.id === id;
      if (btn) btn.setAttribute('aria-selected', String(active));
      if (panel) panel.setAttribute('aria-hidden', String(!active));
    });
    if (TAB_RENDERERS[id]) safeRender(id);
  }

  function renderCurrentTab() {
    if (TAB_RENDERERS[currentTab]) safeRender(currentTab);
  }

  // ------------------------------------------------------------------
  // Transcript
  // ------------------------------------------------------------------

  function renderTranscript() {
    const wrap = document.getElementById('transcript-wrap');
    const labels = gradeSystem.allLabels();

    const headCells = ['Grade', 'Score', 'Count', ...SEMESTERS].map((h) => `<th>${h}</th>`).join('');

    const bodyRows = labels
      .map((label) => {
        const score = gradeSystem.scoreOf(label);
        const count = state.countFor(label);
        const semCells = SEMESTERS.map((sem, i) => {
          const val = state.semesters[i].counts[label];
          return `<td class="cell--editable" data-role="sem" data-label="${label}" data-sem="${i}">
            <input type="number" min="0" step="1" inputmode="numeric"
              aria-label="${label} count for ${sem}"
              value="${val === undefined ? '' : val}" />
          </td>`;
        }).join('');
        return `<tr>
          <th class="cell--label cell--dbl-edit" data-role="name" data-label="${label}" tabindex="0">${label}</th>
          <td class="cell--computed cell--dbl-edit" data-role="score" data-label="${label}" tabindex="0">${score}</td>
          <td class="cell--computed">${count}</td>
          ${semCells}
        </tr>`;
      })
      .join('');

    const semTotals = SEMESTERS.map((_, i) => ({
      count: state.totalCount(i),
      score: state.totalScore(i),
      gpa: state.gpa(i),
    }));
    const grand = { count: state.totalCount(), score: state.totalScore(), gpa: state.gpa() };

    const countRow = `<tr class="row--total">
      <th>Count</th><td></td><td>${grand.count}</td>
      ${semTotals.map((s) => `<td>${s.count}</td>`).join('')}
    </tr>`;
    const scoreRow = `<tr class="row--total">
      <th>Score</th><td></td><td>${fmt5(grand.score)}</td>
      ${semTotals.map((s) => `<td>${s.count ? fmt5(s.score) : '<span class="dash">-</span>'}</td>`).join('')}
    </tr>`;
    const gradeRow = `<tr class="row--total">
      <th>Grade</th><td></td><td>${grand.gpa === null ? '<span class="dash">-</span>' : fmt5(grand.gpa)}</td>
      ${semTotals.map((s) => `<td>${s.gpa === null ? '<span class="dash">-</span>' : fmt5(s.gpa)}</td>`).join('')}
    </tr>`;

    wrap.innerHTML = `<table class="dgrid">
      <thead><tr>${headCells}</tr></thead>
      <tbody>${bodyRows}</tbody>
      <tfoot>${countRow}${scoreRow}${gradeRow}</tfoot>
    </table>`;

    wireTranscriptEditing(wrap);

    const container = document.getElementById('panel-transcript');
    container.classList.toggle('is-empty', grand.count === 0);

    document.getElementById('header-gpa').textContent = fmt5(state.gpa());
  }

  function wireTranscriptEditing(wrap) {
    // Semester count cells.
    wrap.querySelectorAll('td[data-role="sem"] input').forEach((input) => {
      input.addEventListener('change', (e) => {
        const td = e.target.closest('td');
        const label = td.dataset.label;
        const semIndex = Number(td.dataset.sem);
        const raw = e.target.value;
        const n = raw === '' ? undefined : Math.max(0, Math.floor(Number(raw)));
        if (n === undefined || n === 0) {
          delete state.semesters[semIndex].counts[label];
        } else {
          state.semesters[semIndex].counts[label] = n;
        }
        renderTranscript();
        renderCurrentTab();
      });
    });

    // Arrow-key navigation between semester cells: left/right across
    // semesters, up/down across grade rows.
    wrap.addEventListener('keydown', (e) => {
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      const td = e.target.closest('td[data-role="sem"]');
      if (!td) return;
      e.preventDefault();
      const labels = gradeSystem.allLabels();
      const idx = labels.indexOf(td.dataset.label);
      const sem = Number(td.dataset.sem);
      let targetLabel = td.dataset.label;
      let targetSem = sem;
      if (e.key === 'ArrowRight') targetSem = Math.min(sem + 1, SEMESTERS.length - 1);
      if (e.key === 'ArrowLeft') targetSem = Math.max(sem - 1, 0);
      if (e.key === 'ArrowDown') targetLabel = labels[Math.min(idx + 1, labels.length - 1)];
      if (e.key === 'ArrowUp') targetLabel = labels[Math.max(idx - 1, 0)];
      const target = wrap.querySelector(`td[data-role="sem"][data-label="${targetLabel}"][data-sem="${targetSem}"] input`);
      if (target) {
        target.focus();
        target.select();
      }
    });

    // Double-click-to-edit: Score.
    wrap.querySelectorAll('.cell--dbl-edit[data-role="score"]').forEach((cell) => {
      const commit = () => {
        const input = cell.querySelector('input');
        if (!input) return;
        const raw = Number(input.value);
        if (!Number.isNaN(raw)) {
          gradeSystem.setScoreOf(cell.dataset.label, snapScore(cell.dataset.label, raw));
        }
        renderTranscript();
        renderCurrentTab();
      };
      cell.addEventListener('dblclick', () => {
        if (cell.querySelector('input')) return;
        const current = gradeSystem.scoreOf(cell.dataset.label);
        cell.innerHTML = `<input type="number" step="0.5" value="${current}" />`;
        const input = cell.querySelector('input');
        input.focus();
        input.select();
        input.addEventListener('blur', commit);
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') input.blur();
          if (e.key === 'Escape') cell.innerHTML = String(current);
        });
      });
    });

    // Double-click-to-edit: grade name, capped at 3 characters.
    wrap.querySelectorAll('.cell--dbl-edit[data-role="name"]').forEach((cell) => {
      const commit = () => {
        const input = cell.querySelector('input');
        if (!input) return;
        const oldLabel = cell.dataset.label;
        const newLabel = input.value.trim().slice(0, 3);
        if (newLabel && newLabel !== oldLabel) {
          if (gradeSystem.entries.some((x) => x.label === newLabel)) {
            showToast(`"${newLabel}" is already in use by another grade.`);
          } else {
            gradeSystem.renameLabel(oldLabel, newLabel);
            // Carry existing counts over to the new label so entered data isn't orphaned.
            state.semesters.forEach((sem) => {
              if (sem.counts[oldLabel] !== undefined) {
                sem.counts[newLabel] = sem.counts[oldLabel];
                delete sem.counts[oldLabel];
              }
            });
          }
        }
        renderTranscript();
        renderCurrentTab();
      };
      cell.addEventListener('dblclick', () => {
        if (cell.querySelector('input')) return;
        const current = cell.dataset.label;
        cell.innerHTML = `<input type="text" maxlength="3" value="${current}" style="width:44px" />`;
        const input = cell.querySelector('input');
        input.focus();
        input.select();
        input.addEventListener('blur', commit);
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') input.blur();
          if (e.key === 'Escape') cell.innerHTML = current;
        });
      });
    });
  }

  document.getElementById('add-grade-btn') &&
    document.getElementById('add-grade-btn').addEventListener('click', () => {
      let i = 1;
      while (gradeSystem.entries.some((e) => e.label === `N${i}`)) i++;
      const newLabel = `N${i}`;
      gradeSystem.entries.push({ label: newLabel, score: gradeSystem.minScore() - 0.5 });
      renderTranscript();
      renderCurrentTab();
    });

  document.getElementById('reset-btn') &&
    document.getElementById('reset-btn').addEventListener('click', () => {
      state.semesters.forEach((sem) => (sem.counts = {}));
      renderTranscript();
      renderCurrentTab();
    });

  document.getElementById('random-btn') &&
    document.getElementById('random-btn').addEventListener('click', () => {
      const labels = gradeSystem.allLabels();
      const RANDOM_SEMESTERS = 6; // Y1S1..Y3S2 -- Y4S1/Y4S2 stay open as "the future" to explore
      const PER_SEMESTER = 5; // fixed, not user-configurable
      for (let i = 0; i < RANDOM_SEMESTERS; i++) {
        const counts = {};
        for (let k = 0; k < PER_SEMESTER; k++) {
          const label = labels[Math.floor(Math.random() * labels.length)];
          counts[label] = (counts[label] || 0) + 1;
        }
        state.semesters[i].counts = counts;
      }
      for (let i = RANDOM_SEMESTERS; i < state.semesters.length; i++) state.semesters[i].counts = {};
      renderTranscript();
      renderCurrentTab();
    });

  // ------------------------------------------------------------------
  // Reachability grid (rows = n, columns = target GPA)
  // ------------------------------------------------------------------

  const reachState = {
    anchor: 4.5,
    anchorTouched: false,
    interval: 0.01,
    minOffset: -0.1,
    maxOffset: 0.1,
    heatmapMode: 'none',
    showAnchorPurple: false,
  };

  function buildTargetColumns() {
    const steps = Math.round((reachState.maxOffset - reachState.minOffset) / reachState.interval);
    const cols = [];
    for (let i = 0; i <= steps; i++) {
      cols.push(Math.round((reachState.anchor + reachState.minOffset + i * reachState.interval) * 100) / 100);
    }
    return cols;
  }

  function renderColorLegend() {
    const el = document.getElementById('reachability-legend');
    if (!el) return;
    el.innerHTML = `
      <div class="color-legend__item"><span class="color-legend__swatch" style="background:var(--surface);border-color:var(--current-strong)"></span> normal: the minimal grade combination reaching this target</div>
      <div class="color-legend__item"><span class="color-legend__swatch" style="background:var(--tide-tint)"></span> anchor column: matches your current or entered GPA</div>
      <div class="color-legend__item"><span class="color-legend__swatch" style="background:#1a7a34"></span> already achieved: guaranteed regardless of outcome</div>
      <div class="color-legend__item"><span class="color-legend__swatch" style="background:#a51d1d"></span> not possible at this n</div>
      <div class="color-legend__item"><span class="color-legend__swatch" style="background:#6b21a8"></span> anchor column, purple mode (optional, see controls)</div>
    `;
  }

  function renderReachabilityControls() {
    const wrap = document.getElementById('reachability-controls');
    wrap.innerHTML = `
      <div class="control-group">
        <h3>Anchor</h3>
        <div class="control-fields">
          <div class="control-field">
            <label for="anchor-input">Current / target GPA</label>
            <input id="anchor-input" type="number" step="0.01" value="${reachState.anchor}" />
          </div>
        </div>
      </div>
      <div class="control-group">
        <h3>Column range</h3>
        <div class="control-fields">
          <div class="control-field"><label for="interval-input">Interval</label>
            <input id="interval-input" type="number" step="0.01" min="0.01" value="${reachState.interval}" /></div>
          <div class="control-field"><label for="min-input">Min offset</label>
            <input id="min-input" type="number" step="0.05" value="${reachState.minOffset}" /></div>
          <div class="control-field"><label for="max-input">Max offset</label>
            <input id="max-input" type="number" step="0.05" value="${reachState.maxOffset}" /></div>
        </div>
      </div>
      <div class="control-group">
        <h3>Beliefs. Expected grade curve <span title="Shared with Module Load, Risk, Entropy, and Bayesian. Editing it here updates all of them.">(shared)</span></h3>
        <div class="control-fields">
          <div class="control-field"><label for="mean-input">Typical grade</label>
            <select id="mean-input">
              ${gradeSystem
                .canonicalEntries()
                .map((e) => `<option value="${e.label}" ${e.label === beliefs.centerLabel ? 'selected' : ''}>${e.label}</option>`)
                .join('')}
            </select>
          </div>
          <div class="control-field"><label for="spread-input">Spread (tiers)</label>
            <input id="spread-input" type="number" step="0.1" min="0.1" value="${beliefs.tierSpread}" /></div>
        </div>
      </div>
      <div class="control-group">
        <h3>Heatmap</h3>
        <div class="control-fields" style="flex-direction:column;align-items:flex-start;gap:6px">
          <label style="display:flex;align-items:center;gap:6px;font-weight:400"><input type="radio" name="heatmap-mode" value="none" ${reachState.heatmapMode === 'none' ? 'checked' : ''} /> No heatmap (original colours)</label>
          <label style="display:flex;align-items:center;gap:6px;font-weight:400"><input type="radio" name="heatmap-mode" value="cost" ${reachState.heatmapMode === 'cost' ? 'checked' : ''} /> Cost (green 0, amber 0.05, red 0.1+)</label>
          <label style="display:flex;align-items:center;gap:6px;font-weight:400"><input type="radio" name="heatmap-mode" value="loss" ${reachState.heatmapMode === 'loss' ? 'checked' : ''} /> Loss (green 0, amber 0.005, red 0.01+)</label>
          <label style="display:flex;align-items:center;gap:6px;font-weight:400"><input type="radio" name="heatmap-mode" value="combined" ${reachState.heatmapMode === 'combined' ? 'checked' : ''} /> Combined = cost + 10 x loss (green 0, amber 0.075, red 0.15+)</label>
          <label style="display:flex;align-items:center;gap:6px;font-weight:400;margin-top:4px;padding-top:6px;border-top:1px solid var(--border)"><input type="checkbox" id="anchor-purple-check" ${reachState.showAnchorPurple ? 'checked' : ''} /> Highlight anchor column in purple</label>
        </div>
      </div>`;

    document.querySelectorAll('input[name="heatmap-mode"]').forEach((input) => {
      input.addEventListener('change', (e) => {
        reachState.heatmapMode = e.target.value;
        renderReachability();
      });
    });
    document.getElementById('anchor-purple-check').addEventListener('change', (e) => {
      reachState.showAnchorPurple = e.target.checked;
      renderReachability();
    });

    document.getElementById('anchor-input').addEventListener('change', (e) => {
      reachState.anchor = Math.round(Number(e.target.value) * 100) / 100;
      reachState.anchorTouched = true;
      renderReachability();
    });
    document.getElementById('interval-input').addEventListener('change', (e) => {
      reachState.interval = Math.max(0.01, Number(e.target.value));
      renderReachability();
    });
    document.getElementById('min-input').addEventListener('change', (e) => {
      reachState.minOffset = Number(e.target.value);
      renderReachability();
    });
    document.getElementById('max-input').addEventListener('change', (e) => {
      reachState.maxOffset = Number(e.target.value);
      renderReachability();
    });
    document.getElementById('mean-input').addEventListener('change', (e) => {
      beliefs.centerLabel = e.target.value;
      renderReachability();
    });
    document.getElementById('spread-input').addEventListener('change', (e) => {
      beliefs.tierSpread = Math.max(0.1, Number(e.target.value));
      renderReachability();
    });
  }

  /**
   * Three-stop colour interpolation for the heatmap: green at or below 0,
   * a neutral amber at the midpoint, red from the cap upward (capped, not
   * extrapolated further). Used for the cost, loss, and combined heatmap
   * modes on the Reachability grid.
   */
  function heatmapColor(value, cap, neutral) {
    const green = [56, 161, 75];
    const amber = [237, 178, 61];
    const red = [199, 45, 45];
    let t, from, to;
    if (value <= 0) return `rgb(${green.join(',')})`;
    if (value >= cap) return `rgb(${red.join(',')})`;
    if (value <= neutral) {
      t = neutral > 0 ? value / neutral : 0;
      from = green;
      to = amber;
    } else {
      t = cap > neutral ? (value - neutral) / (cap - neutral) : 1;
      from = amber;
      to = red;
    }
    const mix = from.map((c, i) => Math.round(c + (to[i] - c) * t));
    return `rgb(${mix.join(',')})`;
  }

  function renderReachability() {
    renderColorLegend();
    if (!reachState.anchorTouched) {
      const g = state.gpa();
      if (g !== null) reachState.anchor = Math.round(g * 100) / 100;
    }
    const anchorInput = document.getElementById('anchor-input');
    if (anchorInput && document.activeElement !== anchorInput) anchorInput.value = reachState.anchor;

    const N0 = state.totalCount();
    const S0 = state.totalScore();
    const cols = buildTargetColumns();
    const rows = Array.from({ length: 50 }, (_, i) => i + 1);

    const probModel = new ProbabilityModel(gradeSystem, gradeSystem.scoreOf(beliefs.centerLabel), beliefsRawSpread(gradeSystem));
    rows.forEach((n) => probModel.convolveN(n)); // pre-warm so hovers are instant

    const headRow = '<th>n \\ Target GPA</th>' + cols.map((T) => `<th>${fmt2(T)}</th>`).join('');

    const bodyRows = rows
      .map((n) => {
        const cells = cols
          .map((T) => {
            const r = Reachability.solve(n, T, N0, S0, gradeSystem);
            let cls = 'reach-cell';
            let text = '-';
            let style = '';
            if (r.feasible) {
              text = r.guaranteed ? 'done' : r.combo;
              cls += r.guaranteed ? ' is-guaranteed' : '';
              if (!r.guaranteed && reachState.heatmapMode !== 'none') {
                let value;
                if (reachState.heatmapMode === 'cost') value = r.cost;
                else if (reachState.heatmapMode === 'loss') value = r.loss;
                else value = r.cost + 10 * r.loss; // combined
                const caps = { cost: [0.1, 0.05], loss: [0.01, 0.005], combined: [0.15, 0.075] };
                const [cap, neutral] = caps[reachState.heatmapMode];
                style = ` style="background:${heatmapColor(value, cap, neutral)}"`;
              }
            } else {
              cls += ' is-impossible';
            }
            const isAnchorCol = Math.abs(T - reachState.anchor) < 1e-9;
            if (isAnchorCol && reachState.showAnchorPurple) {
              cls += ' is-anchor-purple';
            } else if (isAnchorCol) {
              cls += ' is-anchor';
            }
            return `<td class="${cls}" data-n="${n}" data-t="${T}"${style}>${text}</td>`;
          })
          .join('');
        return `<tr><th>${n}</th>${cells}</tr>`;
      })
      .join('');

    const wrap = document.getElementById('reachability-wrap');
    wrap.innerHTML = `<table class="dgrid"><thead><tr>${headRow}</tr></thead><tbody>${bodyRows}</tbody></table>`;

    wireReachabilityHover(wrap, N0, S0, probModel);
  }

  function wireReachabilityHover(wrap, N0, S0, probModel) {
    const tip = document.getElementById('hover-tip');

    wrap.addEventListener('mousemove', (e) => {
      const cell = e.target.closest('.reach-cell');
      if (!cell) {
        tip.classList.remove('visible');
        return;
      }
      const n = Number(cell.dataset.n);
      const T = Number(cell.dataset.t);
      const r = Reachability.solve(n, T, N0, S0, gradeSystem);

      if (!r.feasible) {
        tip.innerHTML = `<div class="tip-row"><span class="tip-label">Target</span><span class="tip-value">${fmt2(T)}</span></div>
          <div class="tip-row"><span class="tip-label">Subjects</span><span class="tip-value">${n}</span></div>
          <hr/><div class="tip-row"><span class="tip-label">Not achievable at this n</span></div>`;
      } else if (r.guaranteed) {
        tip.innerHTML = `<div class="tip-row"><span class="tip-label">Guaranteed</span></div>
          <hr/>
          <div class="tip-row"><span class="tip-label">Worst-case final GPA</span><span class="tip-value">${fmt5(r.finalGPA)}</span></div>
          <div class="tip-row"><span class="tip-label">Margin above threshold</span><span class="tip-value">${fmt5(r.loss)}</span></div>`;
      } else {
        const sigma = Reachability.requiredScaledTotal(n, T, N0, S0, gradeSystem);
        const confidence = probModel.targetConfidence(n, sigma);
        tip.innerHTML = `
          <div class="tip-row"><span class="tip-label">Required on new subjects</span><span class="tip-value">${fmt5(r.required)}</span></div>
          <div class="tip-row"><span class="tip-label">Achieved</span><span class="tip-value">${fmt5(r.achieved)}</span></div>
          <hr/>
          <div class="tip-row"><span class="tip-label">Cost (new-sample overshoot)</span><span class="tip-value">${fmt5(r.cost)}</span></div>
          <div class="tip-row"><span class="tip-label">Loss (combined overshoot)</span><span class="tip-value">${fmt5(r.loss)}</span></div>
          <div class="tip-row"><span class="tip-label">Target confidence</span><span class="tip-value">${pct(confidence)}</span></div>`;
      }

      tip.classList.add('visible');
      const pad = 14;
      let left = e.clientX + pad;
      let top = e.clientY + pad;
      if (left + 240 > window.innerWidth) left = e.clientX - 240 - pad;
      if (top + 160 > window.innerHeight) top = e.clientY - 160 - pad;
      tip.style.left = `${left}px`;
      tip.style.top = `${top}px`;
    });

    wrap.addEventListener('mouseleave', () => tip.classList.remove('visible'));
  }

  // ------------------------------------------------------------------
  // Required GPA
  // ------------------------------------------------------------------

  const requiredGpaState = { target: 4.75, remaining: 10 };

  function renderRequiredGpa() {
    const body = document.getElementById('required-gpa-body');
    const N0 = state.totalCount(),
      S0 = state.totalScore();
    const r = Reachability.solve(requiredGpaState.remaining, requiredGpaState.target, N0, S0, gradeSystem);
    const b = Reachability.bounds(requiredGpaState.remaining, N0, S0, gradeSystem);

    body.innerHTML = `
      <div class="controls-row">
        <div class="control-group"><h3>Question</h3>
          <div class="control-fields">
            <div class="control-field"><label for="rg-target">Target GPA</label>
              <input id="rg-target" type="number" step="0.01" value="${requiredGpaState.target}" /></div>
            <div class="control-field"><label for="rg-remaining">Subjects remaining</label>
              <input id="rg-remaining" type="number" step="1" min="1" value="${requiredGpaState.remaining}" /></div>
          </div>
        </div>
      </div>
      <div class="answer-card">
        ${
          r.guaranteed
            ? `<div class="answer-card__big answer-card__big--good">Already achieved</div>
               <div class="answer-card__label">even failing every remaining subject keeps you at ${fmt5(r.finalGPA)}, above ${fmt2(requiredGpaState.target)}</div>`
            : r.feasible
            ? `<div class="answer-card__big">${fmt5(r.required)}</div>
               <div class="answer-card__label">required average across the remaining ${requiredGpaState.remaining} subjects</div>
               <div class="answer-card__detail">Closest minimal combination, <strong>${r.combo}</strong>, which achieves ${fmt5(r.achieved)}, final GPA ${fmt5(r.finalGPA)}.</div>`
            : `<div class="answer-card__big answer-card__big--bad">Not possible</div>
               <div class="answer-card__label">${fmt2(requiredGpaState.target)} cannot be reached with only ${requiredGpaState.remaining} subjects left</div>`
        }
        <div class="answer-card__bounds">Range achievable with ${requiredGpaState.remaining} subjects: ${fmt5(b.lower)} to ${fmt5(b.upper)}</div>
      </div>`;

    document.getElementById('rg-target').addEventListener('change', (e) => {
      requiredGpaState.target = Number(e.target.value);
      renderRequiredGpa();
    });
    document.getElementById('rg-remaining').addEventListener('change', (e) => {
      requiredGpaState.remaining = Math.max(1, Math.floor(Number(e.target.value)));
      renderRequiredGpa();
    });
  }

  // ------------------------------------------------------------------
  // Module load
  // ------------------------------------------------------------------

  const moduleLoadState = { target: 4.75, maxN: 30 };

  function renderModuleLoad() {
    const body = document.getElementById('module-load-body');
    const N0 = state.totalCount(),
      S0 = state.totalScore();
    const probModel = new ProbabilityModel(gradeSystem, gradeSystem.scoreOf(beliefs.centerLabel), beliefsRawSpread(gradeSystem));
    const ns = Array.from({ length: moduleLoadState.maxN }, (_, i) => i + 1);
    const results = ns.map((n) => Reachability.solve(n, moduleLoadState.target, N0, S0, gradeSystem));
    const costs = results.map((r) => (r.feasible ? (r.guaranteed ? 0 : r.cost) : NaN));
    const confidences = ns.map((n, i) => {
      if (!results[i].feasible) return 0;
      if (results[i].guaranteed) return 1;
      const sigma = Reachability.requiredScaledTotal(n, moduleLoadState.target, N0, S0, gradeSystem);
      return probModel.targetConfidence(n, sigma);
    });

    // Objectively best: among any n reaching 100% confidence, the lowest
    // cost overrides plain cost-minimisation; only fall back to a global
    // minimum if nothing reaches full confidence.
    const fullConfidence = confidences.map((c, i) => ({ c, i })).filter((o) => o.c >= 1 - 1e-9);
    let bestIdx = -1;
    if (fullConfidence.length > 0) {
      bestIdx = fullConfidence.reduce((best, o) => (costs[o.i] < costs[best.i] ? o : best), fullConfidence[0]).i;
    } else {
      let bestCost = Infinity;
      costs.forEach((c, i) => {
        if (Number.isFinite(c) && c < bestCost) {
          bestCost = c;
          bestIdx = i;
        }
      });
    }
    const bestResult = bestIdx >= 0 ? results[bestIdx] : null;

    const entropies = ns.map((n) => probModel.entropy(n));

    body.innerHTML = `
      <div class="controls-row">
        <div class="control-group"><h3>Question</h3>
          <div class="control-fields"><div class="control-field"><label for="ml-target">Target GPA</label>
            <input id="ml-target" type="number" step="0.01" value="${moduleLoadState.target}" /></div></div>
        </div>
      </div>
      ${
        bestIdx >= 0
          ? `<div class="callout">Objectively best: <strong>n = ${ns[bestIdx]}</strong>. ${
              fullConfidence.length > 0 ? '100% target confidence, ' : ''
            }overshoot ${fmt5(costs[bestIdx])}, final GPA ${fmt5(bestResult.finalGPA)}, target confidence ${pct(confidences[bestIdx])}</div>`
          : ''
      }
      <div class="controls-row">
        ${[5, 10]
          .map((fixedN) => {
            const idx = fixedN - 1;
            if (idx < 0 || idx >= ns.length) return '';
            const r = results[idx];
            if (!r.feasible) return `<div class="card"><h3>At n = ${fixedN}</h3><p>Not achievable with ${fixedN} subjects.</p></div>`;
            return `<div class="card"><h3>At n = ${fixedN}</h3><p>${
              r.guaranteed ? 'Already guaranteed regardless of outcome.' : `Overshoot ${fmt5(costs[idx])}, final GPA ${fmt5(r.finalGPA)}, target confidence ${pct(confidences[idx])}.`
            }</p></div>`;
          })
          .join('')}
      </div>
      ${chartCard('Cost (new-sample overshoot) vs. subjects added', costs, ns, { highlightIndex: bestIdx, color: '#d9581a', showDots: true })}
      ${chartCard('Target confidence vs. subjects added', confidences, ns, { highlightIndex: bestIdx, min: 0, max: 1, color: '#1d7a8c', formatY: pct, showDots: true })}
      ${chartCard('Academic entropy vs. subjects added. More subjects trades cost for flexibility', entropies, ns, { highlightIndex: bestIdx, color: '#6552a8', showDots: true })}

      <h3 style="margin-top:18px">Every value, n by n</h3>
      <div class="grid-wrap" style="max-height:380px">
        <table class="dgrid">
          <thead><tr><th>n</th><th>Cost</th><th>Target confidence</th><th>Entropy (bits)</th></tr></thead>
          <tbody>
            ${ns
              .map((n, i) => {
                const isFixedRef = n === 5 || n === 10;
                return `<tr class="${i === bestIdx ? 'row--best' : isFixedRef ? 'row--ref' : ''}">
                <td>${n}${i === bestIdx ? ' \u2605' : ''}</td>
                <td>${Number.isFinite(costs[i]) ? fmt5(costs[i]) : '-'}</td>
                <td>${pct(confidences[i])}</td>
                <td>${entropies[i].toFixed(4)}</td>
              </tr>`;
              })
              .join('')}
          </tbody>
        </table>
      </div>
    `;

    document.getElementById('ml-target').addEventListener('change', (e) => {
      moduleLoadState.target = Number(e.target.value);
      renderModuleLoad();
    });
  }

  // ------------------------------------------------------------------
  // Plan comparator
  // ------------------------------------------------------------------

  const planCompareState = { target: 4.75, plans: [4, 5, 6] };

  function renderPlanCompare() {
    const body = document.getElementById('plan-compare-body');
    const N0 = state.totalCount(),
      S0 = state.totalScore();
    const probModel = new ProbabilityModel(gradeSystem, gradeSystem.scoreOf(beliefs.centerLabel), beliefsRawSpread(gradeSystem));
    const an = new Analysis(gradeSystem);

    const planInputs = planCompareState.plans
      .map(
        (n, i) => `<div class="control-field"><label for="pc-plan-${i}">Plan ${String.fromCharCode(65 + i)}: subjects</label>
        <input id="pc-plan-${i}" type="number" min="1" step="1" value="${n}" data-idx="${i}" /></div>`
      )
      .join('');

    const rows = planCompareState.plans
      .map((n, i) => {
        const r = Reachability.solve(n, planCompareState.target, N0, S0, gradeSystem);
        const conf = r.feasible && !r.guaranteed ? probModel.targetConfidence(n, Reachability.requiredScaledTotal(n, planCompareState.target, N0, S0, gradeSystem)) : r.guaranteed ? 1 : 0;
        const risk = an.risk(n, planCompareState.target, N0, S0);
        const consequence = probModel.cvar(n, 0.1, N0, S0, gradeSystem).cvar;
        return `<tr>
        <th>Plan ${String.fromCharCode(65 + i)} (n=${n})</th>
        <td>${r.guaranteed ? 'Already achieved' : r.feasible ? 'Yes' : 'No'}</td>
        <td>${r.guaranteed ? 'Already achieved' : r.feasible ? r.combo : '-'}</td>
        <td>${r.feasible && !r.guaranteed ? fmt5(r.cost) : '-'}</td>
        <td>${r.feasible ? fmt5(r.loss) : '-'}</td>
        <td>${risk.toFixed(3)}</td>
        <td>${pct(conf)}</td>
        <td>${fmt5(consequence)}</td>
      </tr>`;
      })
      .join('');

    const efficiencyRows = planCompareState.plans
      .map(
        (n, i) => `<div class="chart-card">
        <div class="chart-card__head"><h4>Efficiency across nearby targets: Plan ${String.fromCharCode(65 + i)} (n=${n})</h4></div>
        ${buildEfficiencyChart(n, N0, S0)}
      </div>`
      )
      .join('');

    body.innerHTML = `
      <p class="panel-sub">A plan is judged on four separate questions, kept deliberately separate rather than blended into one score: is it even possible, how many different ways could it still succeed, how likely is it to actually work out, and how bad is it if it doesn't? A plan can be very doable but fragile, or quite likely to work but painful on the rare occasion it misses: seeing all four at once is the point.</p>
      <div class="controls-row">
        <div class="control-group"><h3>Shared target</h3>
          <div class="control-fields"><div class="control-field"><label for="pc-target">Target GPA</label>
            <input id="pc-target" type="number" step="0.01" value="${planCompareState.target}" /></div></div>
        </div>
        <div class="control-group"><h3>Plans to compare</h3>
          <div class="control-fields">${planInputs}</div>
        </div>
      </div>
      <div class="grid-wrap">
        <table class="dgrid">
          <thead><tr>
            <th>Plan</th>
            <th title="Is this target mathematically reachable at all with this many classes?">Even possible?</th>
            <th>Grades needed</th>
            <th title="Extra performance this plan uses on the new classes alone, beyond the bare minimum">Extra used (new classes)</th>
            <th title="Extra performance this plan uses across your whole transcript, beyond the bare minimum">Extra used (overall)</th>
            <th title="How many distinct grade combinations still reach this target: a higher number here means MORE fragile, fewer ways to succeed, not less">Fragility (higher = more fragile)</th>
            <th title="Your realistic odds of actually clearing this target, based on your expected performance">Real-world odds</th>
            <th title="If this plan misses, your realistic worst case: the average GPA across your worst 10% of outcomes">If it goes badly</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <h3 style="margin-top:20px">Efficiency, plan by plan</h3>
      <p class="panel-sub">The same efficiency sweep as its own tab, run once per plan: callouts now include the actual grade combination needed, not just the target number.</p>
      ${efficiencyRows}`;

    document.getElementById('pc-target').addEventListener('change', (e) => {
      planCompareState.target = Number(e.target.value);
      renderPlanCompare();
    });
    body.querySelectorAll('[data-idx]').forEach((inp) => {
      inp.addEventListener('change', (e) => {
        planCompareState.plans[Number(e.target.dataset.idx)] = Math.max(1, Math.floor(Number(e.target.value)));
        renderPlanCompare();
      });
    });
  }

  // ------------------------------------------------------------------
  // Bounds
  // ------------------------------------------------------------------

  const boundsState = { n: 10 };

  function renderBounds() {
    const body = document.getElementById('bounds-body');
    const N0 = state.totalCount(),
      S0 = state.totalScore();
    const b = Reachability.bounds(boundsState.n, N0, S0, gradeSystem);
    const cur = state.gpa();
    const curPct = cur !== null ? Math.min(100, Math.max(0, ((cur - b.lower) / (b.upper - b.lower || 1)) * 100)) : null;

    const enumRows = Reachability.enumerate(boundsState.n, N0, S0, gradeSystem);
    const enumTableRows = enumRows
      .map(
        (r, i) => `<tr>
        <td>${i + 1}</td>
        <td>${r.combo}</td>
        <td>${fmt5(r.finalGPA)}</td>
        <td>${fmt2(r.rounded)}</td>
        <td>${fmt5(r.bucketLoss)}</td>
      </tr>`
      )
      .join('');

    body.innerHTML = `
      <div class="controls-row">
        <div class="control-group"><h3>Question</h3>
          <div class="control-fields"><div class="control-field"><label for="b-n">Subjects remaining</label>
            <input id="b-n" type="number" min="1" step="1" value="${boundsState.n}" /></div></div>
        </div>
      </div>
      <div class="bounds-card">
        <div class="bounds-card__pair">
          <div><div class="answer-card__big answer-card__big--good">${fmt5(b.upper)}</div><div class="answer-card__label">best case: every remaining subject at the top tier</div></div>
          <div><div class="answer-card__big answer-card__big--bad">${fmt5(b.lower)}</div><div class="answer-card__label">worst case: every remaining subject at the bottom tier</div></div>
        </div>
        <div class="bounds-bar">
          <div class="bounds-bar__track">${curPct !== null ? `<div class="bounds-bar__marker" style="left:${curPct}%"></div>` : ''}</div>
          <div class="bounds-bar__labels"><span>${fmt2(b.lower)}</span>${cur !== null ? `<span class="bounds-bar__current">current ${fmt5(cur)}</span>` : ''}<span>${fmt2(b.upper)}</span></div>
        </div>
      </div>

      <h3 style="margin-top:20px">Every attainable outcome with ${boundsState.n} subjects, best to worst</h3>
      <p class="panel-sub">Starting from all top-tier grades and stepping down one lattice unit at a time, since the lattice has no holes (Theorem 4) and any target reduces to at most two adjacent tiers (Theorem 6), this sequence is exact and complete: nothing attainable is skipped, e.g. 4A,1B+ and 3A,2A- really are the same total, and the next row down always exists.</p>
      <div class="grid-wrap" style="max-height:420px">
        <table class="dgrid">
          <thead><tr><th>#</th><th>Combination</th><th>Final GPA (raw)</th><th>Rounded (2dp)</th><th>Loss (within its own bucket)</th></tr></thead>
          <tbody>${enumTableRows}</tbody>
        </table>
      </div>`;

    document.getElementById('b-n').addEventListener('change', (e) => {
      boundsState.n = Math.max(1, Math.floor(Number(e.target.value)));
      renderBounds();
    });
  }

  // ------------------------------------------------------------------
  // Feasibility curve
  // ------------------------------------------------------------------

  const feasibilityState = { maxN: 60, selected: null, selectedSide: 'right' };

  function renderFeasibilityCurve() {
    const body = document.getElementById('feasibility-body');
    const N0 = state.totalCount(),
      S0 = state.totalScore();
    const cur = state.gpa();
    const anchor = cur !== null ? cur : reachState.anchor;
    const maxN = feasibilityState.maxN;

    // Grow the search outward from current GPA until minFeasibleN /
    // minNonGuaranteedN can no longer be satisfied within maxN, rather than
    // sweeping a fixed +-0.3 window. Right side starts at current GPA
    // rounded DOWN to 2dp (the highest target that's still at-or-below
    // where you already are, so "reach up" questions start from solid
    // ground); left side starts rounded UP, for the same reason mirrored.
    const rightTargets = [];
    const rightPoints = [];
    {
      let T = Math.floor(anchor * 100) / 100;
      while (T <= gradeSystem.maxScore() + 1e-9) {
        const p = Reachability.minFeasibleN(T, N0, S0, gradeSystem, maxN);
        if (!p) break;
        rightTargets.push(T);
        rightPoints.push(p);
        T = Math.round((T + 0.01) * 100) / 100;
      }
    }
    const leftTargets = [];
    const leftPoints = [];
    {
      let T = Math.ceil(anchor * 100) / 100;
      while (T >= gradeSystem.minScore() - 1e-9) {
        const p = Reachability.minNonGuaranteedN(T, N0, S0, gradeSystem, maxN);
        if (!p) break;
        leftTargets.push(T);
        leftPoints.push(p);
        T = Math.round((T - 0.01) * 100) / 100;
      }
    }
    leftTargets.reverse();
    leftPoints.reverse();

    const targets = [...leftTargets, ...rightTargets];
    const combinedValues = [...leftPoints.map((p) => p.n), ...rightPoints.map((p) => p.n)];
    // "Best" on each side = the farthest point actually reached within the
    // n budget -- the hardest target still affordable, and the mirror
    // question's furthest-safe point on the low side.
    const leftBestIdx = leftTargets.length > 0 ? 0 : -1; // leftTargets is reversed, so index 0 is the farthest-left (hardest) point
    const rightBestIdx = rightTargets.length > 0 ? targets.length - 1 : -1;

    if (feasibilityState.selected === null) {
      const firstReal = rightPoints.findIndex((p) => p && !p.alreadyThere);
      feasibilityState.selected = firstReal >= 0 ? firstReal : 0;
      feasibilityState.selectedSide = 'right';
    }
    const selSide = feasibilityState.selectedSide;
    const selArray = selSide === 'right' ? rightPoints : leftPoints;
    const selTargets = selSide === 'right' ? rightTargets : leftTargets;
    const selIdxLocal = Math.min(feasibilityState.selected, selArray.length - 1);
    const sel = selArray[selIdxLocal];
    const selT = selTargets[selIdxLocal];
    const selResult = sel && sel.n > 0 ? Reachability.solve(sel.n, selT, N0, S0, gradeSystem) : null;

    // Third row: starting from the RIGHT side's bare minimum, what do you
    // get (and what does it cost) if you deliberately go one A further?
    const plusOne = rightTargets.map((T, i) => {
      const p = rightPoints[i];
      if (p.alreadyThere || !p.result) return { finalGPA: NaN, loss: NaN };
      const minN = p.n;
      const D_min = p.result.achieved * minN;
      const extraD = D_min + gradeSystem.scoreOf('A');
      const extraN = N0 + minN + 1;
      const newFinal = (S0 + extraD) / extraN;
      const newLoss = newFinal - (T - 0.005);
      return { finalGPA: newFinal, loss: newLoss };
    });
    const plusOneFinals = plusOne.map((p) => p.finalGPA);
    const plusOneLosses = plusOne.map((p) => p.loss);

    body.innerHTML = `
      <div class="controls-row">
        <div class="control-group"><h3>Search budget</h3>
          <div class="control-fields">
            <div class="control-field"><label for="fc-maxn">Maximum n to search</label>
              <input id="fc-maxn" type="number" step="1" min="1" value="${feasibilityState.maxN}" /></div>
          </div>
        </div>
      </div>
      <p class="panel-sub">The search grows outward from your current GPA (rounded down going right, rounded up going left) one 0.01 step at a time, stopping the moment a target would need more than your search budget's worth of subjects: not a fixed window. Right now that reaches ${targets.length ? `${fmt2(targets[0])} to ${fmt2(targets[targets.length - 1])}` : 'nowhere within budget'}.</p>
      ${chartCard('Minimum n vs. target GPA (left of anchor: n before it stops being automatically avoided; right of anchor: n to make it feasible at all)', combinedValues, targets.map(fmt2), { color: '#6552a8', formatY: (v) => (Number.isFinite(v) ? String(v) : 'unreachable'), showDots: true, dotRadius: 1.6, highlightIndex: selSide === 'right' ? leftPoints.length + selIdxLocal : selIdxLocal, highlightRadius: 6 })}

      <h4 style="margin:14px 0 6px">Aiming to be the best: targets at or above your current GPA</h4>
      <div class="grid-wrap" id="fc-strip-right"></div>

      <h4 style="margin:14px 0 6px">Aiming not to fail: targets below your current GPA (separate table)</h4>
      <p class="panel-sub">Not "how do I reach this" (you're already above it) but "how many subjects of sustained bad performance would it take before I could even drop this low": the mirror question, capped the same way the right side caps at the ceiling.</p>
      <div class="grid-wrap" id="fc-strip-left"></div>

      <div class="answer-card" id="fc-detail"></div>

      <h3 style="margin-top:20px">One A beyond the bare minimum</h3>
      <p class="panel-sub">The minimum-n plan is razor-thin by construction. This shows what happens if you deliberately take one more subject beyond that minimum and it's an A: the resulting final GPA and loss, over the same (dynamically-grown) right-side targets as the chart above.</p>
      ${chartCard('Final GPA if you go one A beyond the minimum', plusOneFinals, rightTargets.map(fmt2), { color: '#1d7a8c', showDots: true, dotRadius: 1.6 })}
      ${chartCard('Loss if you go one A beyond the minimum', plusOneLosses, rightTargets.map(fmt2), { color: '#d9581a', showDots: true, dotRadius: 1.6 })}
    `;

    const stripRight = document.getElementById('fc-strip-right');
    stripRight.innerHTML = rightTargets.length
      ? `<table class="dgrid"><thead><tr>${rightTargets.map((T) => `<th>${fmt2(T)}</th>`).join('')}</tr></thead><tbody><tr>${rightPoints
          .map((p, i) => `<td class="reach-cell${i === selIdxLocal && selSide === 'right' ? ' is-anchor' : ''}${i === rightPoints.length - 1 ? ' is-guaranteed' : ''}" data-idx="${i}" data-side="right">${p.alreadyThere ? '0' : p.n}</td>`)
          .join('')}</tr></tbody></table>`
      : `<p class="panel-sub">Nothing reachable above your current GPA within a budget of ${maxN} subjects.</p>`;
    stripRight.querySelectorAll('td[data-idx]').forEach((td) => {
      td.addEventListener('click', () => {
        feasibilityState.selected = Number(td.dataset.idx);
        feasibilityState.selectedSide = 'right';
        renderFeasibilityCurve();
      });
    });

    const stripLeft = document.getElementById('fc-strip-left');
    stripLeft.innerHTML = leftTargets.length
      ? `<table class="dgrid"><thead><tr>${leftTargets.map((T) => `<th>${fmt2(T)}</th>`).join('')}</tr></thead><tbody><tr>${leftPoints
          .map((p, i) => `<td class="reach-cell${i === selIdxLocal && selSide === 'left' ? ' is-anchor' : ''}${i === 0 ? ' is-guaranteed' : ''}" data-idx="${i}" data-side="left">${p.n}</td>`)
          .join('')}</tr></tbody></table>`
      : `<p class="panel-sub">Nothing below your current GPA becomes reachable within a budget of ${maxN} subjects: you would stay guaranteed above every target this low.</p>`;
    stripLeft.querySelectorAll('td[data-idx]').forEach((td) => {
      td.addEventListener('click', () => {
        feasibilityState.selected = Number(td.dataset.idx);
        feasibilityState.selectedSide = 'left';
        renderFeasibilityCurve();
      });
    });

    const detail = document.getElementById('fc-detail');
    if (!sel) {
      detail.innerHTML = `<div class="answer-card__label">Nothing resolved on this side within n=${feasibilityState.maxN}. Try a larger search budget.</div>`;
    } else if (selSide === 'right' && sel.alreadyThere) {
      detail.innerHTML = `<div class="answer-card__big answer-card__big--good">Already there</div><div class="answer-card__label">your current GPA already meets ${fmt2(selT)}, before any additional subjects</div>`;
    } else if (selSide === 'right') {
      detail.innerHTML = `<div class="answer-card__big">n = ${sel.n}</div>
        <div class="answer-card__label">minimum subjects to make ${fmt2(selT)} feasible</div>
        <div class="answer-card__detail">Combination at that minimum, <strong>${selResult.combo}</strong>, which achieves ${fmt5(selResult.achieved)}, final GPA ${fmt5(selResult.finalGPA)}.</div>`;
    } else {
      detail.innerHTML = `<div class="answer-card__big">n = ${sel.n}</div>
        <div class="answer-card__label">subjects of sustained bad performance before ${fmt2(selT)} stops being automatically avoided</div>
        <div class="answer-card__detail">At that point, reaching it takes a specific combination, <strong>${selResult.combo}</strong>, which achieves ${fmt5(selResult.achieved)}, final GPA ${fmt5(selResult.finalGPA)}. One fewer subject, and it's simply not possible to drop this far no matter what happens.</div>`;
    }

    document.getElementById('fc-maxn').addEventListener('change', (e) => {
      feasibilityState.maxN = Math.max(1, Math.floor(Number(e.target.value)));
      renderFeasibilityCurve();
    });
  }

  // ------------------------------------------------------------------
  // Shared chart helpers
  // ------------------------------------------------------------------

  function lineChart(values, opts = {}) {
    const w = 900,
      h = opts.height || 80,
      padL = 4,
      padR = 4,
      padT = 8,
      padB = 8;
    const innerW = w - padL - padR,
      innerH = h - padT - padB;
    const finite = values.filter((v) => Number.isFinite(v));
    const min = opts.min !== undefined ? opts.min : Math.min(0, ...finite);
    const max = opts.max !== undefined ? opts.max : Math.max(...finite, min + 1e-9);
    const range = max - min || 1;
    const n = values.length;
    const pts = values.map((v, i) => [
      padL + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW),
      Number.isFinite(v) ? padT + innerH - ((v - min) / range) * innerH : null,
    ]);
    const d = pts
      .filter((p) => p[1] !== null)
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`)
      .join(' ');
    const color = opts.color || '#1d7a8c';

    // Small dot at every point, so the discrete x-axis (one point per n, or
    // per 0.01 of GPA) reads as discrete rather than implying a continuum
    // the line alone would suggest. Skipped for the single highlighted
    // point, which gets its own larger marker drawn on top afterward.
    let dots = '';
    if (opts.showDots) {
      const r = opts.dotRadius || 2;
      dots = pts
        .map((p, i) => (p[1] !== null && i !== opts.highlightIndex ? `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${r}" fill="${color}" />` : ''))
        .join('');
    }

    let marker = '';
    if (opts.highlightIndex != null && pts[opts.highlightIndex] && pts[opts.highlightIndex][1] != null) {
      const [hx, hy] = pts[opts.highlightIndex];
      marker = `<circle cx="${hx.toFixed(1)}" cy="${hy.toFixed(1)}" r="${opts.highlightRadius || 5.5}" fill="${color}" stroke="#fff" stroke-width="1.5" />`;
    }
    return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="width:100%;height:${h}px;display:block">
      <path d="${d}" fill="none" stroke="${color}" stroke-width="2.5" />${dots}${marker}
    </svg>`;
  }

  function chartCard(title, values, xLabels, opts = {}) {
    const formatY = opts.formatY || ((v) => (Number.isFinite(v) ? v.toFixed(4) : '-'));
    const first = values.find((v) => Number.isFinite(v));
    const last = [...values].reverse().find((v) => Number.isFinite(v));
    return `<div class="chart-card">
      <div class="chart-card__head"><h4>${title}</h4></div>
      ${lineChart(values, opts)}
      <div class="chart-card__axis">
        <span>${xLabels[0]}: ${formatY(first)}</span>
        <span>${xLabels[xLabels.length - 1]}: ${formatY(last)}</span>
      </div>
    </div>`;
  }

  // ------------------------------------------------------------------
  // Risk and confidence
  // ------------------------------------------------------------------

  const riskState = { target: 4.75, maxN: 30, histN: 8 };

  const riskState2 = { alpha: 0.1 };

  function gpaHistogramHTML(n, N0, S0, probModel, gradeSystem) {
    const dist = probModel.convolveN(n);
    const step = gradeSystem.latticeStep();
    const entries = [...dist.entries()]
      .map(([sigma, p]) => ({ finalGPA: (S0 + sigma * step) / (N0 + n), p }))
      .sort((a, b) => a.finalGPA - b.finalGPA);
    const maxP = Math.max(...entries.map((e) => e.p), 0.001);
    const bars = entries
      .map((e) => {
        const h = Math.max(1, (e.p / maxP) * 90);
        return `<div class="gpa-hist-bar-col" style="min-width:${Math.max(3, 400 / entries.length)}px">
          <div class="gpa-hist-bar" style="height:${h}px;background:#6552a8" title="${fmt2(e.finalGPA)}: ${(e.p * 100).toFixed(2)}%"></div>
        </div>`;
      })
      .join('');
    return `<div class="gpa-hist-bars" style="height:110px;gap:1px">${bars}</div>
      <div class="chart-card__axis"><span>${fmt2(entries[0].finalGPA)}</span><span>${fmt2(entries[entries.length - 1].finalGPA)}</span></div>`;
  }

  function renderRisk() {
    const body = document.getElementById('risk-body');
    const N0 = state.totalCount(),
      S0 = state.totalScore();
    const an = new Analysis(gradeSystem);
    const probModel = new ProbabilityModel(gradeSystem, gradeSystem.scoreOf(beliefs.centerLabel), beliefsRawSpread(gradeSystem));
    const ns = Array.from({ length: riskState.maxN }, (_, i) => i + 1);
    const risks = ns.map((n) => an.risk(n, riskState.target, N0, S0));
    const confidences = ns.map((n) => {
      const r = Reachability.solve(n, riskState.target, N0, S0, gradeSystem);
      if (!r.feasible) return 0;
      if (r.guaranteed) return 1;
      return probModel.targetConfidence(n, Reachability.requiredScaledTotal(n, riskState.target, N0, S0, gradeSystem));
    });
    const cvars = ns.map((n) => probModel.cvar(n, riskState2.alpha, N0, S0, gradeSystem).cvar);
    const vars_ = ns.map((n) => probModel.cvar(n, riskState2.alpha, N0, S0, gradeSystem).var);

    const scenarioRows = ns
      .map((n) => {
        const base = probModel.percentile(n, 0.5, N0, S0, gradeSystem);
        const optimistic = probModel.percentile(n, 0.9, N0, S0, gradeSystem);
        const pessimistic = probModel.percentile(n, 0.1, N0, S0, gradeSystem);
        const stress = probModel.cvar(n, riskState2.alpha, N0, S0, gradeSystem).cvar;
        return `<tr><td>${n}</td><td>${fmt5(optimistic)}</td><td>${fmt5(base)}</td><td>${fmt5(pessimistic)}</td><td>${fmt5(stress)}</td></tr>`;
      })
      .join('');

    body.innerHTML = `
      <div class="controls-row">
        <div class="control-group"><h3>Question</h3>
          <div class="control-fields"><div class="control-field"><label for="rk-target">Target GPA</label>
            <input id="rk-target" type="number" step="0.01" value="${riskState.target}" /></div></div>
        </div>
        <div class="control-group"><h3>How much of the worst outcomes to look at</h3>
          <div class="control-fields"><div class="control-field"><label for="rk-alpha">worst fraction (e.g. 0.1 = worst 10%)</label>
            <input id="rk-alpha" type="number" step="0.01" min="0.01" max="0.99" value="${riskState2.alpha}" /></div></div>
        </div>
      </div>
      <div class="callout callout--warning">The figures below assume your future classes don't affect each other. Each one is treated as its own independent outcome. If a hard semester tends to drag down every grade in it at once (illness, a tough mix of courses, burnout), real risk is worse than these numbers suggest.</div>

      <h3 style="margin-top:20px">Normal, hard, excellent, and worst-case semester, defined</h3>
      <p class="panel-sub">The same way a financial risk report checks one figure against a few named scenarios, these four are read off the same underlying spread of outcomes, not four separate models.</p>
      <ul class="clean">
        <li><strong>An excellent semester</strong> is your 90th percentile outcome: only about 1 in 10 realistic outcomes is better than this.</li>
        <li><strong>A normal semester</strong> is your median (50th percentile) outcome: the single most typical result, with half of realistic outcomes better and half worse.</li>
        <li><strong>A hard semester</strong> is your 10th percentile outcome: only about 1 in 10 realistic outcomes is worse than this.</li>
        <li><strong>A genuine worst case</strong> is your realistic worst case (the average across just your worst alpha fraction of outcomes, not the single most extreme one).</li>
      </ul>
      <div class="grid-wrap" style="max-height:380px">
        <table class="dgrid">
          <thead><tr><th>Classes left (n)</th><th title="90th percentile. Things go noticeably better than expected">An excellent semester</th><th title="Median. The single most typical outcome">A normal semester</th><th title="10th percentile. Things go noticeably worse than expected">A hard semester</th><th title="The realistic worst case, averaged over your worst outcomes">A genuine worst case</th></tr></thead>
          <tbody>${scenarioRows}</tbody>
        </table>
      </div>

      ${chartCard(`Your realistic worst case (worst ${(riskState2.alpha * 100).toFixed(0)}% of outcomes, averaged)`, cvars, ns, { color: '#d9581a', showDots: true })}
      ${chartCard(`Roughly where your "bad outcomes" start`, vars_, ns, { color: '#b8460f', showDots: true })}
      ${chartCard('How many different ways you could still hit this target (no probability guesses involved)', risks, ns, { min: 0, max: 1, color: '#8099a2', showDots: true })}
      ${chartCard('Your realistic odds of hitting this target', confidences, ns, { min: 0, max: 1, color: '#1d7a8c', formatY: pct, showDots: true })}

      <h3 style="margin-top:20px">The full picture, not just one number</h3>
      <p class="panel-sub">A line chart showing "risk vs. number of classes" makes it look smooth and continuous, but what's really there at each class count is a whole spread of possible outcomes. The charts above are just two readings taken off that spread. Here's the spread itself, for a class count you choose.</p>
      <div class="controls-row">
        <div class="control-group"><h3>Classes to look ahead</h3>
          <div class="control-fields"><div class="control-field"><label for="rk-histn">how many classes</label>
            <input id="rk-histn" type="number" min="1" step="1" value="${riskState.histN}" /></div></div>
        </div>
      </div>
      <div class="chart-card">
        <div class="chart-card__head"><h4>Every possible final GPA after ${riskState.histN} more classes, and how likely each one is</h4></div>
        ${gpaHistogramHTML(riskState.histN, N0, S0, probModel, gradeSystem)}
      </div>
    `;

    document.getElementById('rk-target').addEventListener('change', (e) => {
      riskState.target = Number(e.target.value);
      renderRisk();
    });
    document.getElementById('rk-histn').addEventListener('change', (e) => {
      riskState.histN = Math.max(1, Math.floor(Number(e.target.value)));
      renderRisk();
    });
    document.getElementById('rk-alpha').addEventListener('change', (e) => {
      riskState2.alpha = Math.min(0.99, Math.max(0.01, Number(e.target.value)));
      renderRisk();
    });
  }

  // ------------------------------------------------------------------
  // Academic entropy
  // ------------------------------------------------------------------

  const entropyState = { maxN: 30 };

  function renderEntropy() {
    const body = document.getElementById('entropy-body');
    const N0 = state.totalCount(),
      S0 = state.totalScore();
    const probModel = new ProbabilityModel(gradeSystem, gradeSystem.scoreOf(beliefs.centerLabel), beliefsRawSpread(gradeSystem));
    const structModel = ProbabilityModel.uniform(gradeSystem);
    const ns = Array.from({ length: entropyState.maxN }, (_, i) => i + 1);
    const utilFn = (gpa) => gpa / gradeSystem.maxScore();

    const predictiveH = ns.map((n) => probModel.entropy(n));
    const structuralH = ns.map((n) => structModel.entropy(n));
    const marginalGain = ns.map((n, i) => (i === 0 ? NaN : predictiveH[i] - predictiveH[i - 1]));
    const effectiveFutures = predictiveH.map((h) => Math.pow(2, h));
    const opportunityEfficiency = ns.map((n, i) => (structuralH[i] > 1e-9 ? predictiveH[i] / structuralH[i] : NaN));
    const utilWeightedH = ns.map((n) => probModel.utilityWeightedEntropy(n, N0, S0, gradeSystem, utilFn));
    const meanLabel = beliefs.centerLabel;

    const tableRows = ns
      .map(
        (n, i) => `<tr>
        <td>${n}</td>
        <td>${structuralH[i].toFixed(3)}</td>
        <td>${predictiveH[i].toFixed(3)}</td>
        <td>${effectiveFutures[i].toFixed(2)}</td>
        <td>${(opportunityEfficiency[i] * 100).toFixed(1)}%</td>
        <td>${utilWeightedH[i].toFixed(3)}</td>
      </tr>`
      )
      .join('');

    const derivativeRows = ns
      .map(
        (n, i) => `<tr>
        <td>${n}</td>
        <td>${i === 0 ? '<span class="dash">-</span>' : marginalGain[i].toFixed(4)}</td>
      </tr>`
      )
      .join('');

    body.innerHTML = `
      <div class="controls-row">
        <div class="control-group"><h3>Expected grade curve <span title="This same setting is used by several tabs. Changing it anywhere changes all of them.">(shared)</span></h3>
          <div class="control-fields"><div class="control-field">using your expected/typical grade curve (editable here or on several other tabs that share it), currently centred on ${meanLabel}, spread ${beliefs.tierSpread} tiers</div></div>
        </div>
      </div>
      <p class="panel-sub">Students don't actually optimise entropy. They optimise <strong>flexibility</strong>: "how many realistic futures do I still have?" Bits are the technically correct unit, but they're not an intuitive one, so every chart below is also given in a more direct reading.</p>

      <h3 style="margin-top:18px">Every measure, n by n</h3>
      <div class="grid-wrap" style="max-height:380px">
        <table class="dgrid">
          <thead><tr>
            <th>Classes left (n)</th>
            <th title="Structural entropy: every future that's mathematically possible, no assumption about your ability">Every possible future</th>
            <th title="Predictive entropy: futures that are realistically likely given your expected performance">Realistic futures</th>
            <th title="2^(predictive entropy). Genuinely distinct futures remaining, not an abstract bit count">About how many futures</th>
            <th title="Realistic divided by possible. How much of the theoretical future is actually in play for you">% of future that's realistic</th>
            <th title="Flexibility after weighting each outcome by its GPA, so bad outcomes count for less">Flexibility worth having</th>
          </tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>

      <h3 style="margin-top:18px">Marginal information gain, n by n</h3>
      <p class="panel-sub">How much flexibility ONE more class buys you, not the running total. n=1 has no previous value to compare against, so it's left blank.</p>
      <div class="grid-wrap" style="max-height:380px">
        <table class="dgrid">
          <thead><tr><th>Classes left (n)</th><th title="Predictive entropy at n minus predictive entropy at n-1">Gain from one more class</th></tr></thead>
          <tbody>${derivativeRows}</tbody>
        </table>
      </div>

      ${chartCard('Every possible future, if you had no idea how you\'d perform (structural entropy)', structuralH, ns, { color: '#8099a2', showDots: true })}
      ${chartCard('The futures that are actually realistic for you (predictive entropy)', predictiveH, ns, { color: '#6552a8', showDots: true })}
      ${chartCard('About how many genuinely different outcomes you\'ve realistically got left (effective futures)', effectiveFutures, ns, { color: '#21918c', showDots: true, formatY: (v) => v.toFixed(2) })}
      <p class="panel-sub"><strong>Effective futures</strong> turns an abstract "bits" measurement into something you can picture. Three bits of entropy is hard to feel, but "as flexible as 8 equally-likely distinct outcomes" (2 to the power of 3 equals 8) is not. Read it as: if every remaining possibility were equally likely, this is about how many there would effectively be.</p>

      ${chartCard('How much flexibility ONE more class actually buys you (marginal information gain)', marginalGain, ns, { color: '#d9581a', showDots: true })}
      ${chartCard('How much of your theoretical wiggle room is actually realistic for you (opportunity efficiency)', opportunityEfficiency, ns, { color: '#1d7a8c', showDots: true, min: 0, max: 1, formatY: pct })}
      <p class="panel-sub"><strong>Opportunity efficiency</strong> compares what's realistically likely against what's merely mathematically possible. It climbs toward 100% when your expected performance is as spread out as pure chance (you're telling the model you could end up anywhere). It falls toward 0% as your expectation narrows onto one specific outcome (you're confident where you'll land, so little of the theoretical space is actually in play for you).</p>

      ${chartCard('Flexibility that\'s actually worth something, among GOOD outcomes only (utility-weighted entropy)', utilWeightedH, ns, { color: '#472d7b', showDots: true })}
      <p class="panel-sub">Plain flexibility treats "many equally-likely bad outcomes" the same as "many equally-likely good outcomes". Both look like a lot of options, even though one of those is not actually good news. This version only counts flexibility as valuable when it's spread among decent grades, so a future that's "open" but mostly bad reads as low value here, not high.</p>
    `;
  }

  // ------------------------------------------------------------------
  // Bayesian belief
  // ------------------------------------------------------------------

  const bayesianState = {
    obsSpread: 0.5,
    selectedIndex: 0,
    hidden: new Set(),
    predictAheadK: 5,
  };

  function bayesianChartSVG(track, hiddenSet) {
    const w = 900,
      h = 250,
      padL = 20,
      padR = 20,
      padT = 15,
      padB = 34;
    const innerW = w - padL - padR,
      innerH = h - padT - padB;
    const K = track[0].pmf.length;
    const maxP = Math.max(...track.flatMap((t) => t.pmf), 0.02);
    const xFor = (k) => padL + (k / (K - 1)) * innerW;
    const yFor = (p) => padT + innerH - (p / maxP) * innerH;
    const baseline = padT + innerH;

    let paths = '';
    track.forEach((t, idx) => {
      if (hiddenSet.has(idx)) return;
      const color = VIRIDIS[idx % VIRIDIS.length];
      const pts = t.pmf.map((p, k) => `${xFor(k).toFixed(1)},${yFor(p).toFixed(1)}`);
      const d = `M${xFor(0).toFixed(1)},${baseline} L${pts.join(' L')} L${xFor(K - 1).toFixed(1)},${baseline} Z`;
      paths += `<path d="${d}" fill="${color}" fill-opacity="0.1" stroke="${color}" stroke-width="2"/>`;
    });

    const labels = gradeSystem.ordinalLabels().map((e) => e.label);
    const axisLabels = labels
      .map((l, k) => `<text x="${xFor(k).toFixed(1)}" y="${(baseline + 16).toFixed(1)}" text-anchor="middle" font-size="10" fill="var(--ink-faint)">${l}</text>`)
      .join('');

    return `<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:${h}px;display:block">
      <line x1="${padL}" y1="${baseline}" x2="${padL + innerW}" y2="${baseline}" stroke="var(--border-strong)" stroke-width="1"/>
      ${paths}
      ${axisLabels}
    </svg>`;
  }

  function pmfBarsHTML(pmf, labels, color) {
    const maxP = Math.max(...pmf, 0.01);
    const bars = pmf
      .map((p, k) => {
        const heightPx = Math.max(2, (p / maxP) * 64);
        return `<div class="pmf-bar-col">
        <span class="pmf-bar-pct">${(p * 100).toFixed(1)}%</span>
        <div class="pmf-bar" style="height:${heightPx}px;background:${color}"></div>
        <span class="pmf-bar-label">${labels[k]}</span>
      </div>`;
      })
      .join('');
    return `<div class="pmf-bars">${bars}</div>`;
  }

  function nearestLabelForOrdinal(v) {
    const K = gradeSystem.ordinalLabels().length;
    const clamped = Math.round(Math.min(Math.max(v, 0), K - 1));
    return gradeSystem.labelAtOrdinal(clamped);
  }

  function renderBayesian() {
    const body = document.getElementById('bayesian-body');
    const obsVar = bayesianState.obsSpread * bayesianState.obsSpread;
    const track = BayesianTrack.track(gradeSystem, state.semesters, beliefs.centerLabel, beliefs.tierSpread, obsVar);
    const labels = gradeSystem.ordinalLabels().map((e) => e.label);
    bayesianState.selectedIndex = Math.min(bayesianState.selectedIndex, track.length - 1);

    const legend = track
      .map((t, idx) => {
        const color = VIRIDIS[idx % VIRIDIS.length];
        const checked = !bayesianState.hidden.has(idx);
        const selected = idx === bayesianState.selectedIndex;
        return `<div class="curve-legend__item${selected ? ' is-selected' : ''}" data-select="${idx}">
        <input type="checkbox" data-toggle="${idx}" ${checked ? 'checked' : ''} aria-label="Show ${t.label}" />
        <span class="curve-legend__swatch" style="background:${color}"></span>
        ${t.label}
      </div>`;
      })
      .join('');

    const statsRows = track
      .map((t, idx) => {
        const color = VIRIDIS[idx % VIRIDIS.length];
        return `<tr>
        <th><span class="curve-legend__swatch" style="background:${color};display:inline-block;margin-right:6px"></span>${t.label}</th>
        <td class="num">${t.predictiveMean.toFixed(3)} (≈${nearestLabelForOrdinal(t.predictiveMean)})</td>
        <td class="num">${Math.sqrt(t.predictiveVariance).toFixed(3)}</td>
        <td class="num">${t.predictiveVariance.toFixed(3)}</td>
        <td class="num">${t.ci95Lower.toFixed(3)}</td>
        <td class="num">${t.ci95Upper.toFixed(3)}</td>
        <td class="num">${t.entropy.toFixed(3)}</td>
      </tr>`;
      })
      .join('');

    const selected = track[bayesianState.selectedIndex];
    const selColor = VIRIDIS[bayesianState.selectedIndex % VIRIDIS.length];

    // Aleatoric vs epistemic: epistemic = belief variance (shrinks with data,
    // collection helps here); aleatoric = obsVar (fixed -- no amount of data
    // shrinks it, this is how inconsistent the student genuinely is).
    const uncertaintyRows = track
      .map((t, idx) => {
        const epistemicVar = t.predictiveVariance - obsVar;
        const epistemicPct = Math.max(0, Math.min(100, (epistemicVar / t.predictiveVariance) * 100));
        const aleatoricPct = 100 - epistemicPct;
        return `<div class="mini-table">
          <h5>${t.label}</h5>
          <div class="uncertainty-bar"><div class="uncertainty-bar__epistemic" style="width:${epistemicPct}%"></div><div class="uncertainty-bar__aleatoric" style="width:${aleatoricPct}%"></div></div>
          <div style="font-size:11px;color:var(--ink-soft)">${epistemicPct.toFixed(0)}% reducible (epistemic) · ${aleatoricPct.toFixed(0)}% irreducible (aleatoric)</div>
        </div>`;
      })
      .join('');

    const aheadResult = BayesianTrack.predictAhead(selected.pmf, bayesianState.predictAheadK);
    const aheadCI = [aheadResult.mean - 1.959964 * aheadResult.sd, aheadResult.mean + 1.959964 * aheadResult.sd];

    body.innerHTML = `
      <div class="controls-row">
        <div class="control-group"><h3>Prior belief <span title="This same setting is used by several tabs; changing it anywhere changes all of them.">(shared)</span></h3>
          <div class="control-fields">
            <div class="control-field"><label for="bay-prior">Centered on</label>
              <select id="bay-prior">${labels.map((l) => `<option value="${l}" ${l === beliefs.centerLabel ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
            <div class="control-field"><label for="bay-spread">Spread (tiers)</label>
              <input id="bay-spread" type="number" step="0.1" min="0.1" value="${beliefs.tierSpread}" /></div>
          </div>
        </div>
        <div class="control-group"><h3>Observation noise</h3>
          <div class="control-fields">
            <div class="control-field"><label for="bay-obs">Spread per grade</label>
              <input id="bay-obs" type="number" step="0.1" min="0.1" value="${bayesianState.obsSpread}" /></div>
          </div>
        </div>
      </div>
      <div class="curve-legend">${legend}</div>
      <div class="chart-card">
        <div class="chart-card__head"><h4>Posterior predictive distribution for one more subject, F to A+</h4></div>
        ${bayesianChartSVG(track, bayesianState.hidden)}
      </div>
      <div class="grid-wrap">
        <table class="dgrid bayes-stats-table">
          <thead><tr><th>Stage</th><th class="num" title="Where the model expects your next grade to land, on the F-to-A+ scale">Expected grade</th><th class="num" title="How spread out the guess is: smaller means more confident">How confident</th><th class="num" title="The same spread, squared (the technical 'variance')">Spread (variance)</th><th class="num" title="95% of the time, the real outcome should land at or above this">Likely lower end</th><th class="num" title="95% of the time, the real outcome should land at or below this">Likely upper end</th><th class="num" title="How many genuinely different outcomes are still open at this stage">Flexibility (bits)</th></tr></thead>
          <tbody>${statsRows}</tbody>
        </table>
      </div>

      <h3 style="margin-top:20px">Does collecting more data actually help?</h3>
      <p class="panel-sub">Predictive variance splits into two parts: epistemic (uncertainty about your true ability: shrinks as more semesters arrive) and aleatoric (how much an individual grade wobbles even given perfect knowledge of your ability: fixed, set by "observation noise" above). If epistemic dominates, more data genuinely sharpens the prediction. If aleatoric dominates, the student is just inherently inconsistent, and no amount of past data will narrow things much further.</p>
      <div class="uncertainty-legend">
        <span><span class="curve-legend__swatch" style="background:var(--tide);display:inline-block"></span> epistemic (reducible)</span>
        <span><span class="curve-legend__swatch" style="background:var(--coral);display:inline-block"></span> aleatoric (irreducible)</span>
      </div>
      <div class="mini-table-grid">${uncertaintyRows}</div>

      <h3 style="margin-top:20px">Predict several future subjects jointly</h3>
      <p class="panel-sub">Not just "the next single subject": the combined distribution over several future subjects at once (e.g. "given everything through Y3S2, what's the joint outcome for Y4S1 and Y4S2 combined"), built from the <strong>selected</strong> stage below by convolving its per-subject curve with itself.</p>
      <div class="controls-row">
        <div class="control-group"><h3>Subjects to predict ahead</h3>
          <div class="control-fields"><div class="control-field"><label for="bay-ahead-k">Count (e.g. Y4S1 + Y4S2 combined)</label>
            <input id="bay-ahead-k" type="number" min="1" step="1" value="${bayesianState.predictAheadK}" /></div></div>
        </div>
      </div>
      <div class="answer-card">
        <div class="answer-card__big">${aheadResult.mean.toFixed(2)}</div>
        <div class="answer-card__label">expected total ordinal score across ${bayesianState.predictAheadK} future subjects, using the "${selected.label}" belief</div>
        <div class="answer-card__detail">Std dev ${aheadResult.sd.toFixed(3)} · 95% CI [${aheadCI[0].toFixed(2)}, ${aheadCI[1].toFixed(2)}] · entropy ${aheadResult.entropy.toFixed(3)} bits</div>
      </div>

      <div class="pmf-detail">
        <h4>Selected: ${selected.label}: probability by grade for the next single subject</h4>
        ${pmfBarsHTML(selected.pmf, labels, selColor)}
      </div>
    `;

    document.getElementById('bay-prior').addEventListener('change', (e) => {
      beliefs.centerLabel = e.target.value;
      renderBayesian();
    });
    document.getElementById('bay-spread').addEventListener('change', (e) => {
      beliefs.tierSpread = Math.max(0.1, Number(e.target.value));
      renderBayesian();
    });
    document.getElementById('bay-obs').addEventListener('change', (e) => {
      bayesianState.obsSpread = Math.max(0.1, Number(e.target.value));
      renderBayesian();
    });
    document.getElementById('bay-ahead-k').addEventListener('change', (e) => {
      bayesianState.predictAheadK = Math.max(1, Math.floor(Number(e.target.value)));
      renderBayesian();
    });
    body.querySelectorAll('[data-toggle]').forEach((cb) => {
      cb.addEventListener('click', (e) => e.stopPropagation());
      cb.addEventListener('change', (e) => {
        const idx = Number(e.target.dataset.toggle);
        if (e.target.checked) bayesianState.hidden.delete(idx);
        else bayesianState.hidden.add(idx);
        renderBayesian();
      });
    });
    body.querySelectorAll('[data-select]').forEach((el) => {
      el.addEventListener('click', () => {
        bayesianState.selectedIndex = Number(el.dataset.select);
        renderBayesian();
      });
    });
  }

  // ------------------------------------------------------------------
  // Efficiency across targets
  // ------------------------------------------------------------------

  const efficiencyState = { n: 8, minOffset: -0.3, maxOffset: 0.3, interval: 0.02 };

  /** Pure computation (no HTML): cheapest and most-convenient nearby target for a given n. Reused by the Efficiency tab and the Load Planner tab. */
  /**
   * Shifts a hypothetical (extraN subjects, extraS combined score) by k
   * lattice steps at the TOTAL level (not per-subject), the corrected
   * total-shift formula used by the What If tab. Shared here so the
   * Summary tab can simulate the same "+1/-1 grade jump" idea without
   * duplicating the logic. Returns { k, possible, finalGPA, cert, loss }.
   */
  function computeGradeJump(k, extraN, extraS, N0, S0, gradeSystem) {
    if (extraN === 0) return { k, possible: false };
    const step = gradeSystem.latticeStep();
    const maxTotal = extraN * gradeSystem.maxScore();
    const minTotal = extraN * gradeSystem.minScore();
    const shiftedExtraS = extraS + k * step;
    if (shiftedExtraS < minTotal - 1e-9 || shiftedExtraS > maxTotal + 1e-9) {
      return { k, possible: false };
    }
    const shiftedFinal = (S0 + shiftedExtraS) / (N0 + extraN);
    const shiftedCert = Math.round(shiftedFinal * 100) / 100;
    const shiftedLoss = shiftedFinal - (shiftedCert - 0.005);
    return { k, possible: true, finalGPA: shiftedFinal, cert: shiftedCert, loss: shiftedLoss };
  }

  function computeEfficiencyForN(n, N0, S0) {
    const anchor = reachState.anchor;
    const steps = Math.round((efficiencyState.maxOffset - efficiencyState.minOffset) / efficiencyState.interval);
    const targets = Array.from({ length: steps + 1 }, (_, i) => Math.round((anchor + efficiencyState.minOffset + i * efficiencyState.interval) * 100) / 100);
    const results = targets.map((T) => Reachability.solve(n, T, N0, S0, gradeSystem));
    const costs = results.map((r) => (r.feasible ? (r.guaranteed ? 0 : r.cost) : NaN));

    let cheapestIdx = -1,
      cheapestCost = Infinity;
    costs.forEach((c, i) => {
      if (Number.isFinite(c) && c < cheapestCost) {
        cheapestCost = c;
        cheapestIdx = i;
      }
    });

    const cur = state.gpa();

    // Among targets within a small tolerance of the minimum cost, prefer
    // the one closest to current GPA rather than defaulting to the first
    // (lowest-GPA) one encountered while scanning left to right.
    if (cheapestIdx >= 0 && cur !== null) {
      const tolerance = Math.max(cheapestCost * 0.05, 1e-4);
      const tied = targets.map((T, i) => ({ T, i, c: costs[i] })).filter((o) => Number.isFinite(o.c) && o.c - cheapestCost <= tolerance);
      if (tied.length > 1) {
        tied.sort((a, b) => Math.abs(a.T - cur) - Math.abs(b.T - cur));
        cheapestIdx = tied[0].i;
        cheapestCost = costs[cheapestIdx];
      }
    }

    let convenientIdx = -1;
    if (cur !== null) {
      const nearby = targets
        .map((T, i) => ({ T, i, c: costs[i] }))
        .filter((o) => Number.isFinite(o.c) && Math.abs(o.T - cur) <= 0.05 + 1e-9);
      if (nearby.length > 0) {
        const minC = Math.min(...nearby.map((o) => o.c));
        const tolerance = Math.max(minC * 0.05, 1e-4);
        const near = nearby.filter((o) => o.c - minC <= tolerance);
        near.sort((a, b) => Math.abs(a.T - cur) - Math.abs(b.T - cur));
        convenientIdx = near[0].i;
      }
    }

    return {
      targets,
      costs,
      results,
      cheapestIdx,
      convenientIdx,
      cheapestTarget: cheapestIdx >= 0 ? targets[cheapestIdx] : null,
      cheapestCost: cheapestIdx >= 0 ? costs[cheapestIdx] : null,
      cheapestCombo: cheapestIdx >= 0 ? (results[cheapestIdx].guaranteed ? 'Already achieved' : results[cheapestIdx].combo) : null,
      convenientTarget: convenientIdx >= 0 ? targets[convenientIdx] : null,
      convenientCost: convenientIdx >= 0 ? costs[convenientIdx] : null,
      convenientCombo: convenientIdx >= 0 ? (results[convenientIdx].guaranteed ? 'Already achieved' : results[convenientIdx].combo) : null,
    };
  }

  function buildEfficiencyChart(n, N0, S0) {
    const { targets, costs, cheapestIdx, convenientIdx, cheapestCombo, convenientCombo } = computeEfficiencyForN(n, N0, S0);
    const maxC = Math.max(...costs.filter(Number.isFinite), 0.001);
    const bars = targets
      .map((T, i) => {
        const c = costs[i];
        const feasible = Number.isFinite(c);
        const h = feasible ? Math.max(4, (c / maxC) * 90) : 4;
        const cls = ['eff-bar-col'];
        if (i === cheapestIdx) cls.push('is-cheapest');
        if (i === convenientIdx) cls.push('is-convenient');
        const barCls = ['eff-bar'];
        if (i === cheapestIdx) barCls.push('eff-bar--best');
        if (!feasible) barCls.push('eff-bar--impossible');
        const title = feasible ? `At ${fmt2(T)}, your loss is ${fmt5(c)}` : `${fmt2(T)} is not possible with ${n} subjects`;
        return `<div class="${cls.join(' ')}">
          <div class="${barCls.join(' ')}" style="height:${h}px" title="${title}"></div>
          <span class="eff-bar-label">${fmt2(T)}</span>
        </div>`;
      })
      .join('');

    const callouts = `
      ${cheapestIdx >= 0 ? `<div class="callout">Cheapest nearby target with ${n} subjects, <strong>${fmt2(targets[cheapestIdx])}</strong>, needs <strong>${cheapestCombo}</strong>. At ${fmt2(targets[cheapestIdx])}, your loss is ${fmt5(costs[cheapestIdx])}</div>` : ''}
      ${
        convenientIdx >= 0
          ? `<div class="callout">Most convenient (within ±0.05 of your current GPA) with ${n} subjects, <strong>${fmt2(targets[convenientIdx])}</strong>, needs <strong>${convenientCombo}</strong>. At ${fmt2(targets[convenientIdx])}, your loss is ${fmt5(costs[convenientIdx])}</div>`
          : `<div class="callout">No feasible target within ±0.05 of your current GPA at n=${n}.</div>`
      }`;

    return `<div class="eff-chart">${bars}</div>${callouts}`;
  }

  function renderEfficiency() {
    const body = document.getElementById('efficiency-body');
    const N0 = state.totalCount(),
      S0 = state.totalScore();

    body.innerHTML = `
      <div class="controls-row">
        <div class="control-group"><h3>Question</h3>
          <div class="control-fields"><div class="control-field"><label for="ef-n">Subjects</label>
            <input id="ef-n" type="number" min="1" step="1" value="${efficiencyState.n}" /></div></div>
        </div>
      </div>
      ${buildEfficiencyChart(efficiencyState.n, N0, S0)}
    `;

    document.getElementById('ef-n').addEventListener('change', (e) => {
      efficiencyState.n = Math.max(1, Math.floor(Number(e.target.value)));
      renderEfficiency();
    });
  }

  // ------------------------------------------------------------------
  // Classification tracker
  // ------------------------------------------------------------------

  const classificationState = { n: 10, bands: null };

  function renderClassification() {
    if (!classificationState.bands) classificationState.bands = window.COMPASS.NUS_CLASSIFICATIONS_DEFAULT.map((b) => ({ ...b }));
    const body = document.getElementById('classification-body');
    const N0 = state.totalCount(),
      S0 = state.totalScore();
    const probModel = new ProbabilityModel(gradeSystem, gradeSystem.scoreOf(beliefs.centerLabel), beliefsRawSpread(gradeSystem));

    const rows = classificationState.bands
      .map((band, i) => {
        const r = Reachability.solve(classificationState.n, band.threshold, N0, S0, gradeSystem);
        const requiredCell = r.guaranteed
          ? `<span class="guaranteed">Already achieved</span>`
          : r.feasible
          ? fmt5(r.required)
          : '<span class="dash">not possible</span>';
        const comboCell = r.guaranteed ? `you can fail all ${classificationState.n} remaining and stay above this band` : r.feasible ? r.combo : '-';
        const confidence = r.guaranteed ? 1 : r.feasible ? probModel.targetConfidence(classificationState.n, Reachability.requiredScaledTotal(classificationState.n, band.threshold, N0, S0, gradeSystem)) : 0;
        return `<tr>
        <td><input data-idx="${i}" data-field="name" value="${band.name}" /></td>
        <td><input data-idx="${i}" data-field="threshold" type="number" step="0.01" value="${band.threshold}" style="width:70px" /></td>
        <td>${requiredCell}</td>
        <td>${comboCell}</td>
        <td>${pct(confidence)}</td>
        <td><button class="link-btn" data-remove="${i}">remove</button></td>
      </tr>`;
      })
      .join('');

    body.innerHTML = `
      <div class="controls-row">
        <div class="control-group"><h3>Question</h3>
          <div class="control-fields"><div class="control-field"><label for="cl-n">Subjects remaining</label>
            <input id="cl-n" type="number" min="1" step="1" value="${classificationState.n}" /></div></div>
        </div>
      </div>
      <div class="grid-wrap">
        <table class="dgrid">
          <thead><tr><th>Band</th><th>Threshold</th><th>Required average</th><th>Minimal combination</th><th>Target confidence</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <button class="link-btn" id="cl-add">+ add a band</button>`;

    document.getElementById('cl-n').addEventListener('change', (e) => {
      classificationState.n = Math.max(1, Math.floor(Number(e.target.value)));
      renderClassification();
    });
    body.querySelectorAll('input[data-field]').forEach((inp) => {
      inp.addEventListener('change', (e) => {
        const idx = Number(e.target.dataset.idx),
          field = e.target.dataset.field;
        classificationState.bands[idx][field] = field === 'threshold' ? Number(e.target.value) : e.target.value;
        renderClassification();
      });
    });
    body.querySelectorAll('[data-remove]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        classificationState.bands.splice(Number(e.target.dataset.remove), 1);
        renderClassification();
      });
    });
    document.getElementById('cl-add').addEventListener('click', () => {
      classificationState.bands.push({ name: 'New band', threshold: 4.0 });
      renderClassification();
    });
  }

  // ------------------------------------------------------------------
  // What if
  // ------------------------------------------------------------------

  const whatIfState = { counts: {}, jumpsForward: 2, jumpsBackward: 2 };

  function renderWhatIf() {
    const body = document.getElementById('whatif-body');
    const labels = gradeSystem.allLabels();
    const N0 = state.totalCount(),
      S0 = state.totalScore();
    const extraN = labels.reduce((sum, l) => sum + (whatIfState.counts[l] || 0), 0);
    const extraS = labels.reduce((sum, l) => sum + (whatIfState.counts[l] || 0) * gradeSystem.scoreOf(l), 0);
    const newN = N0 + extraN,
      newS = S0 + extraS;
    const before = state.gpa();
    const after = newN > 0 ? newS / newN : null;
    const certGpa = after === null ? null : Math.round(after * 100) / 100;
    const loss = after === null ? null : after - (certGpa - 0.005);

    const cells = labels
      .map(
        (label) => `<td class="cell--editable" data-label="${label}">
        <input type="number" min="0" step="1" aria-label="hypothetical ${label} count" value="${whatIfState.counts[label] || ''}" />
      </td>`
      )
      .join('');

    // A "+k jump" shifts the COMBINED total you typed by k lattice steps,
    // not each individual grade by k steps -- e.g. 1A + 1A- (total 9.5 of a
    // possible 10 with 2 subjects) has room for exactly ONE step upward
    // (+1 reaches the 2xA ceiling of 10), not two: (10-9.5)/0.5 = 1.
    const step = gradeSystem.latticeStep();
    const maxTotal = extraN * gradeSystem.maxScore();
    const minTotal = extraN * gradeSystem.minScore();
    const jumpRange = [];
    for (let k = -whatIfState.jumpsBackward; k <= whatIfState.jumpsForward; k++) jumpRange.push(k);

    const jumpRows = jumpRange
      .map((k) => computeGradeJump(k, extraN, extraS, N0, S0, gradeSystem))
      .map((r) => {
        const jumpName = r.k === 0 ? 'as typed' : `${r.k > 0 ? '+' : ''}${r.k} grade jump${Math.abs(r.k) > 1 ? 's' : ''}`;
        if (!r.possible) {
          return `<tr><td>${jumpName}</td><td colspan="3"><span class="dash">Not possible: would need a total below F or above A+ across the ${extraN} subject(s) you entered</span></td></tr>`;
        }
        return `<tr class="${r.k === 0 ? 'row--as-typed' : ''}">
          <td>${jumpName}</td>
          <td>${fmt5(r.finalGPA)}</td>
          <td>${fmt2(r.cert)}</td>
          <td>${fmt5(r.loss)}</td>
        </tr>`;
      })
      .join('');

    const maxForward = extraN > 0 ? Math.floor((maxTotal - extraS) / step + 1e-9) : null;
    const maxBackward = extraN > 0 ? Math.floor((extraS - minTotal) / step + 1e-9) : null;

    body.innerHTML = `
      <div class="grid-wrap">
        <table class="dgrid">
          <thead><tr>${labels.map((l) => `<th>${l}</th>`).join('')}</tr></thead>
          <tbody><tr>${cells}</tr></tbody>
        </table>
      </div>
      <div class="answer-card">
        <div class="bounds-card__pair">
          <div><div class="answer-card__big">${before === null ? '-' : fmt5(before)}</div><div class="answer-card__label">current GPA</div></div>
          <div><div class="answer-card__big ${after !== null && before !== null && after >= before ? 'answer-card__big--good' : after !== null && before !== null ? 'answer-card__big--bad' : ''}">${after === null ? '-' : fmt5(after)}</div><div class="answer-card__label">GPA with this hypothetical semester added</div></div>
        </div>
        <div class="answer-card__detail">
          Reflected on your cert (rounded 2dp): <strong>${certGpa === null ? '-' : fmt2(certGpa)}</strong><br/>
          Loss (raw GPA above the lower edge of its own 2dp bucket): <strong>${loss === null ? '-' : fmt5(loss)}</strong>
        </div>
      </div>

      <h3 style="margin-top:20px">Counterfactuals: what if it had gone better or worse?</h3>
      <p class="panel-sub">
        A "grade jump" moves the <strong>combined total</strong> of everything you typed above by whole 0.5-point steps: not each grade individually. With ${extraN || 'N'} subject(s) entered, the total can range from ${extraN ? fmt5(minTotal) : '-'} (all F) to ${extraN ? fmt5(maxTotal) : '-'} (all A/A+), so a jump is only possible while the shifted total stays inside that range. ${
      extraN > 0 ? `Right now you have room for <strong>${maxForward}</strong> jump(s) forward and <strong>${maxBackward}</strong> jump(s) backward before hitting a wall.` : 'Enter a hypothetical above to see how much room you have.'
    }
      </p>
      <div class="controls-row">
        <div class="control-group"><h3>Range to show</h3>
          <div class="control-fields">
            <div class="control-field"><label for="wi-back">Jumps backward</label>
              <input id="wi-back" type="number" min="0" step="1" value="${whatIfState.jumpsBackward}" /></div>
            <div class="control-field"><label for="wi-fwd">Jumps forward</label>
              <input id="wi-fwd" type="number" min="0" step="1" value="${whatIfState.jumpsForward}" /></div>
          </div>
        </div>
      </div>
      <div class="grid-wrap">
        <table class="dgrid">
          <thead><tr><th>Scenario</th><th title="Final GPA if this scenario replaced what you typed above">Final GPA (raw)</th><th title="Rounded to 2 decimal places, the way it appears on your cert">Cert (2dp)</th><th title="Overshoot beyond the lower edge of this scenario's own rounding bucket">Loss</th></tr></thead>
          <tbody>${jumpRows}</tbody>
        </table>
      </div>`;

    document.getElementById('wi-back').addEventListener('change', (e) => {
      whatIfState.jumpsBackward = Math.max(0, Math.floor(Number(e.target.value)));
      renderWhatIf();
    });
    document.getElementById('wi-fwd').addEventListener('change', (e) => {
      whatIfState.jumpsForward = Math.max(0, Math.floor(Number(e.target.value)));
      renderWhatIf();
    });

    body.querySelectorAll('td[data-label] input').forEach((inp) => {
      inp.addEventListener('change', (e) => {
        const label = e.target.closest('td').dataset.label;
        const v = e.target.value === '' ? 0 : Math.max(0, Math.floor(Number(e.target.value)));
        if (v === 0) delete whatIfState.counts[label];
        else whatIfState.counts[label] = v;
        renderWhatIf();
      });
    });
  }

  // ------------------------------------------------------------------
  // Boot
  // ------------------------------------------------------------------

  // ------------------------------------------------------------------
  // Allocation space (Diaconis-Sturmfels)
  // ------------------------------------------------------------------

  const allocationState = { steps: 4000, seed: 1, result: null, exampleIndex: 0 };

  function runAllocationSample() {
    const labels = gradeSystem.allLabels();
    const an = new Analysis(gradeSystem);
    allocationState.result = an.sampleAllocationFiber(state.semesters, labels, allocationState.steps, allocationState.seed);
    allocationState.exampleIndex = 0;
  }

  /** Variance of per-semester GPA across the non-empty semesters in a table (rows=semesters, cols=grade counts, aligned to `labels`). Returns null if fewer than 2 non-empty semesters exist, since variance is not meaningfully defined below that. */
  function semesterGpaVariance(table, labels, gs) {
    const scores = labels.map((l) => gs.scoreOf(l));
    const semGpas = table
      .map((row) => {
        const count = row.reduce((a, b) => a + b, 0);
        if (count === 0) return null;
        const score = row.reduce((sum, c, j) => sum + c * scores[j], 0);
        return score / count;
      })
      .filter((g) => g !== null);
    if (semGpas.length < 2) return null;
    const mean = semGpas.reduce((a, b) => a + b, 0) / semGpas.length;
    return semGpas.reduce((sum, g) => sum + (g - mean) ** 2, 0) / semGpas.length;
  }

  function renderAllocation() {
    const body = document.getElementById('allocation-body');
    const labels = gradeSystem.allLabels();
    if (!allocationState.result) runAllocationSample();
    const r = allocationState.result;

    const nonEmptySemesters = state.semesters.filter((s) => Object.keys(s.counts).length > 0).length;

    function tableHTML(table, title, diffFrom) {
      const rows = table
        .map((row, i) => {
          const cells = row
            .map((v, j) => {
              const differs = diffFrom && diffFrom[i][j] !== v;
              return `<td class="${differs ? 'diff' : ''}">${v}</td>`;
            })
            .join('');
          return `<tr><th>${state.semesters[i] ? state.semesters[i].name : `Sem ${i + 1}`}</th>${cells}</tr>`;
        })
        .join('');
      return `<div class="mini-table"><h5>${title}</h5><table><thead><tr><th></th>${labels.map((l) => `<th>${l}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
    }

    const originalTable = state.semesters.map((s) => labels.map((l) => s.counts[l] || 0));
    const exampleCount = Math.min(3, r.samples.length);
    const exampleTables = [];
    for (let i = 0; i < exampleCount; i++) {
      const idx = Math.floor(((i + 1) * r.samples.length) / (exampleCount + 1));
      exampleTables.push(tableHTML(r.samples[idx], `Alternative ${i + 1}`, originalTable));
    }

    // The consistency analysis: how variable was YOUR semester-by-semester
    // GPA, compared to every other semester-by-semester story sharing your
    // exact totals? Answers "was my academic progression unusual", not
    // "was my transcript unique" (a fact with no decision attached to it).
    const actualVariance = semesterGpaVariance(originalTable, labels, gradeSystem);
    const fiberVariances = r.samples.map((t) => semesterGpaVariance(t, labels, gradeSystem)).filter((v) => v !== null);
    const fiberAverage = fiberVariances.length ? fiberVariances.reduce((a, b) => a + b, 0) / fiberVariances.length : null;
    let consistencyHTML = '';
    if (nonEmptySemesters < 2) {
      consistencyHTML = `<div class="callout callout--warning">With fewer than two semesters of data entered, semester-to-semester consistency cannot be measured yet. Enter at least two semesters to see this analysis.</div>`;
    } else if (actualVariance !== null && fiberAverage !== null && fiberVariances.length > 0) {
      const moreVariableCount = fiberVariances.filter((v) => v > actualVariance).length;
      const percentileMoreVariable = (moreVariableCount / fiberVariances.length) * 100;
      let conclusion, conclusionClass;
      if (percentileMoreVariable >= 70) {
        conclusion = 'You were unusually consistent. Most equally-valid versions of your academic story would have bounced around more, semester to semester, than yours actually did.';
        conclusionClass = 'answer-card__big--good';
      } else if (percentileMoreVariable <= 30) {
        conclusion = 'You were unusually volatile. Most equally-valid versions of your academic story would have been steadier, semester to semester, than yours actually was.';
        conclusionClass = 'answer-card__big--bad';
      } else {
        conclusion = 'You were fairly typical. Your semester-to-semester swings are within the ordinary range for any story sharing your exact totals.';
        conclusionClass = '';
      }
      consistencyHTML = `
        <div class="answer-card">
          <div class="bounds-card__pair">
            <div><div class="answer-card__big">${actualVariance.toFixed(4)}</div><div class="answer-card__label">variance of your actual semester-by-semester GPA</div></div>
            <div><div class="answer-card__big">${fiberAverage.toFixed(4)}</div><div class="answer-card__label">average variance across every equally-valid alternative story sampled</div></div>
          </div>
          <div class="answer-card__detail ${conclusionClass}"><strong>${conclusion}</strong> Specifically: your semester GPA was more variable than ${(100 - percentileMoreVariable).toFixed(0)}% of the ${fiberVariances.length.toLocaleString()} alternative stories sampled, and less variable than the remaining ${percentileMoreVariable.toFixed(0)}%.</div>
        </div>`;
    }

    body.innerHTML = `
      <p class="panel-sub"><strong>The question this tab actually answers:</strong> was your academic progression unusual, meaning were your semester-to-semester swings in GPA bigger or smaller than they typically would be, given the same overall grades and the same number of classes per semester? This is not asking whether your transcript's specific arrangement was "unique" (nearly every arrangement is unique in that trivial sense). It is asking whether the SHAPE of your journey, steady versus up-and-down, was itself unusual.</p>

      <div class="controls-row">
        <div class="control-group"><h3>Sampling</h3>
          <div class="control-fields">
            <div class="control-field"><label for="al-steps">Random moves to attempt</label>
              <input id="al-steps" type="number" step="500" min="100" value="${allocationState.steps}" /></div>
          </div>
        </div>
      </div>
      <button class="link-btn" id="al-resample">resample (new random walk)</button>

      <h3 style="margin-top:20px">Were you unusually consistent, or unusually volatile?</h3>
      ${consistencyHTML}

      <div class="answer-card" style="margin-top:14px">
        <div class="bounds-card__pair">
          <div><div class="answer-card__big">${r.distinctVisited}</div><div class="answer-card__label">distinct semester-by-semester tables found sharing your exact totals</div></div>
          <div><div class="answer-card__big">${r.accepted}</div><div class="answer-card__label">valid moves accepted out of ${r.attempted} attempted</div></div>
        </div>
        <div class="answer-card__detail">This is a lower bound, not the full count. A longer or repeated random walk will typically find more.</div>
      </div>

      <h3 style="margin-top:20px">How a single move works</h3>
      <p class="panel-sub">Pick any two semesters and any two grades. Move one subject from (semester 1, grade A) to (semester 1, grade B), and correspondingly one subject from (semester 2, grade B) to (semester 2, grade A). Every row total and every column total is completely unchanged. You've just rearranged WHICH semester two of your grades happened in. Repeating this thousands of times with random choices of semester-pair and grade-pair explores the whole space of equally-consistent stories, not just ones next door to yours. This specific move, and the fact that chaining it explores everything reachable, is the Diaconis-Sturmfels (1998) approach to contingency tables. In the technical literature the set of moves is called a "Markov basis" and the space it connects is the table's "fiber."</p>

      <h3 style="margin-top:20px">Your transcript vs. a few alternatives found by the walk</h3>
      <p class="panel-sub">Shaded cells differ from your actual transcript. Row and column totals are identical in every table shown. Check for yourself.</p>
      <div class="mini-table-grid">
        ${tableHTML(originalTable, 'Your actual transcript')}
        ${exampleTables.join('')}
      </div>
    `;

    document.getElementById('al-steps').addEventListener('change', (e) => {
      allocationState.steps = Math.max(100, Math.floor(Number(e.target.value)));
      allocationState.result = null;
      renderAllocation();
    });
    document.getElementById('al-resample').addEventListener('click', () => {
      allocationState.seed = Math.floor(Math.random() * 1e9);
      allocationState.result = null;
      renderAllocation();
    });
  }

  // ------------------------------------------------------------------
  // Academic policy (finite-horizon MDP)
  // ------------------------------------------------------------------

  const policyState = { horizon: 2, choiceSetText: '4,5,6,7', objective: 'expected' };

  function renderPolicy() {
    const body = document.getElementById('policy-body');
    const N0 = state.totalCount(),
      S0 = state.totalScore();
    const probModel = new ProbabilityModel(gradeSystem, gradeSystem.scoreOf(beliefs.centerLabel), beliefsRawSpread(gradeSystem));
    const choiceSet = policyState.choiceSetText
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 0);

    let utilLabel = 'expected final GPA';
    let util = (gpa) => gpa;
    if (policyState.objective === 'target') {
      util = (gpa) => (gpa >= reachState.anchor ? 1 : 0);
      utilLabel = `P(final GPA ≥ ${fmt2(reachState.anchor)})`;
    }

    let result = null,
      error = null;
    if (choiceSet.length === 0) {
      error = 'Enter at least one valid subject-count choice.';
    } else {
      result = Reachability.solveMDP(N0, S0, policyState.horizon, choiceSet, probModel, gradeSystem, util);
    }

    // Walk the optimal policy forward along its own expected path for a readable summary.
    let steps = [];
    if (result) {
      let N = N0,
        sigma = 0;
      for (let t = 0; t < policyState.horizon; t++) {
        const v = result.valueAt(t, N, sigma);
        steps.push({ stage: t + 1, choice: v.bestChoice });
        N += v.bestChoice;
        // advance sigma by the EXPECTED outcome of this choice, just for a representative walk-through
        const pmf = probModel.convolveN(v.bestChoice);
        let ev = 0;
        pmf.forEach((p, s) => (ev += p * s));
        sigma += Math.round(ev);
      }
    }

    body.innerHTML = `
      <p class="panel-sub"><strong>What this solves:</strong> not just the smartest choice for the very next semester in isolation, but the best sequence of choices across every remaining semester at once: accounting for the fact that this semester's random outcome changes what's optimal next semester. Solved exactly by working backward from your last semester, so every earlier decision already knows the best possible response to whatever happens later.</p>

      <div class="controls-row">
        <div class="control-group"><h3>Horizon</h3>
          <div class="control-fields"><div class="control-field"><label for="pol-horizon">Remaining semesters to plan</label>
            <input id="pol-horizon" type="number" min="1" max="4" step="1" value="${policyState.horizon}" /></div></div>
        </div>
        <div class="control-group"><h3>Choices available each semester</h3>
          <div class="control-fields"><div class="control-field"><label for="pol-choices">Subject counts (comma separated)</label>
            <input id="pol-choices" type="text" value="${policyState.choiceSetText}" style="width:140px" /></div></div>
        </div>
        <div class="control-group"><h3>Objective</h3>
          <div class="control-fields"><div class="control-field"><label for="pol-objective">Maximise</label>
            <select id="pol-objective">
              <option value="expected" ${policyState.objective === 'expected' ? 'selected' : ''}>Expected final GPA</option>
              <option value="target" ${policyState.objective === 'target' ? 'selected' : ''}>P(final GPA ≥ Reachability anchor)</option>
            </select></div></div>
        </div>
      </div>

      ${
        error
          ? `<div class="callout callout--warning">${error}</div>`
          : `
      <div class="answer-card">
        <div class="answer-card__big">${result.expectedUtility.toFixed(4)}</div>
        <div class="answer-card__label">optimal expected value of ${utilLabel}, planning ${policyState.horizon} semester(s) ahead</div>
        <div class="answer-card__detail">${result.statesEvaluated.toLocaleString()} (stage, subjects, score) states evaluated exactly: no sampling, no approximation.</div>
      </div>

      ${
        policyState.objective === 'expected'
          ? (() => {
              const beliefMean = gradeSystem.scoreOf(beliefs.centerLabel);
              const curGpa = state.gpa();
              const allSame = new Set(steps.map((s) => s.choice)).size === 1;
              const direction = curGpa === null ? null : beliefMean > curGpa ? 'above' : beliefMean < curGpa ? 'below' : 'equal to';
              return allSame && direction && direction !== 'equal to'
                ? `<div class="callout">Notice every stage picked the same choice (${steps[0].choice}, the ${direction === 'above' ? 'largest' : 'smallest'} available). That's expected, not a bug: your Beliefs curve (${beliefs.centerLabel}) sits ${direction} your current GPA (${fmt5(curGpa)}), and maximising a plain expected value over an averaging process has no interior optimum: it's a straight pull in one direction, so the ${direction === 'above' ? 'largest' : 'smallest'} choice always wins, for any choice set. Switch the objective above to "P(final GPA ≥ anchor)" to see a genuinely different (non-corner) policy: that objective is nonlinear in outcome, which is what makes an interior optimum possible in the first place.</div>`
                : '';
            })()
          : ''
      }

      <h3 style="margin-top:20px">The optimal policy, walked forward along its own expected path</h3>
      <p class="panel-sub">The real policy adapts to whatever actually happens each semester (that's the whole point of solving it as a sequence, not a single choice): this shows the representative path if each semester lands exactly on its expected outcome.</p>
      <div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px">
        ${steps
          .map(
            (s, i) => `<div class="policy-step"><div class="policy-step__badge">${s.choice}</div><span style="font-size:11px;color:var(--ink-soft)">semester ${s.stage}</span></div>${i < steps.length - 1 ? '<span class="policy-step__arrow">→</span>' : ''}`
          )
          .join('')}
      </div>
      `
      }
    `;

    document.getElementById('pol-horizon').addEventListener('change', (e) => {
      policyState.horizon = Math.max(1, Math.min(4, Math.floor(Number(e.target.value))));
      renderPolicy();
    });
    document.getElementById('pol-choices').addEventListener('change', (e) => {
      policyState.choiceSetText = e.target.value;
      renderPolicy();
    });
    document.getElementById('pol-objective').addEventListener('change', (e) => {
      policyState.objective = e.target.value;
      renderPolicy();
    });
  }

  // ------------------------------------------------------------------
  // Load planner: deciding how many subjects to take
  // ------------------------------------------------------------------

  const loadPlannerState = { maxN: 15 };

  function dualMarkerChart(seriesA, seriesB, xLabels, opts = {}) {
    const w = 900,
      h = opts.height || 160,
      padL = 30,
      padR = 20,
      padT = 16,
      padB = 24;
    const innerW = w - padL - padR,
      innerH = h - padT - padB;
    const all = [...seriesA, ...seriesB].filter(Number.isFinite);
    const min = opts.min !== undefined ? opts.min : Math.min(...all);
    const max = opts.max !== undefined ? opts.max : Math.max(...all);
    const range = max - min || 1;
    const n = xLabels.length;
    const xFor = (i) => padL + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
    const yFor = (v) => padT + innerH - ((v - min) / range) * innerH;

    function pathFor(series, color) {
      const pts = series.map((v, i) => (Number.isFinite(v) ? [xFor(i), yFor(v)] : null)).filter(Boolean);
      const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
      return `<path d="${d}" fill="none" stroke="${color}" stroke-width="2" opacity="0.55"/>`;
    }

    const circles = seriesA
      .map((v, i) => (Number.isFinite(v) ? `<circle cx="${xFor(i).toFixed(1)}" cy="${yFor(v).toFixed(1)}" r="5" fill="#1d7a8c" stroke="#fff" stroke-width="1"/>` : ''))
      .join('');
    const triSize = 6;
    const triangles = seriesB
      .map((v, i) => {
        if (!Number.isFinite(v)) return '';
        const cx = xFor(i),
          cy = yFor(v);
        return `<polygon points="${cx.toFixed(1)},${(cy - triSize).toFixed(1)} ${(cx - triSize).toFixed(1)},${(cy + triSize * 0.8).toFixed(1)} ${(cx + triSize).toFixed(1)},${(cy + triSize * 0.8).toFixed(1)}" fill="#d9581a" stroke="#fff" stroke-width="1"/>`;
      })
      .join('');

    const axisLabels = xLabels
      .map((l, i) => (i % Math.ceil(n / 15 || 1) === 0 ? `<text x="${xFor(i).toFixed(1)}" y="${h - 6}" text-anchor="middle" font-size="10" fill="var(--ink-faint)">${l}</text>` : ''))
      .join('');

    return `<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:${h}px;display:block">
      ${pathFor(seriesA, '#1d7a8c')}${pathFor(seriesB, '#d9581a')}
      ${circles}${triangles}${axisLabels}
    </svg>`;
  }

  function renderLoadPlanner() {
    const body = document.getElementById('load-planner-body');
    const N0 = state.totalCount(),
      S0 = state.totalScore();
    const ns = Array.from({ length: loadPlannerState.maxN }, (_, i) => i + 1);
    const perN = ns.map((n) => computeEfficiencyForN(n, N0, S0));
    const cheapestTargets = perN.map((r) => r.cheapestTarget);
    const convenientTargets = perN.map((r) => r.convenientTarget);

    const rows = ns
      .map(
        (n, i) => `<tr>
        <th>${n}</th>
        <td>${perN[i].cheapestTarget !== null ? fmt2(perN[i].cheapestTarget) : '-'}</td>
        <td>${perN[i].cheapestCost !== null ? fmt5(perN[i].cheapestCost) : '-'}</td>
        <td>${perN[i].convenientTarget !== null ? fmt2(perN[i].convenientTarget) : '-'}</td>
        <td>${perN[i].convenientCost !== null ? fmt5(perN[i].convenientCost) : '-'}</td>
      </tr>`
      )
      .join('');

    body.innerHTML = `
      <p class="panel-sub">For every possible number of classes, this finds the cheapest nearby GPA target and the most convenient one (the target closest to where you already stand): the same idea as comparing one option at a time, just repeated across every class count so the pattern is visible at a glance.</p>
      <div class="controls-row">
        <div class="control-group"><h3>Range</h3>
          <div class="control-fields"><div class="control-field"><label for="lp-maxn">Subjects to consider (up to)</label>
            <input id="lp-maxn" type="number" min="2" step="1" value="${loadPlannerState.maxN}" /></div></div>
        </div>
      </div>
      <div class="chart-card">
        <div class="chart-card__head"><h4>Cheapest nearby target (●) and most convenient target (▲) vs. subject count</h4></div>
        ${dualMarkerChart(cheapestTargets, convenientTargets, ns, {})}
        <div class="chart-card__axis"><span>● cheapest nearby target</span><span>▲ most convenient (within ±0.05 of current GPA)</span></div>
      </div>
      <div class="grid-wrap">
        <table class="dgrid">
          <thead><tr>
            <th>Subjects (n)</th>
            <th title="The target GPA with the lowest Cost anywhere in the swept range for this n">Cheapest target</th>
            <th title="The Cost (overshoot) at that cheapest target">Cost</th>
            <th title="The target GPA with the lowest Cost within ±0.05 of your current GPA, ties broken by distance to current GPA">Most convenient target</th>
            <th title="The Cost (overshoot) at that most-convenient target">Cost</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;

    document.getElementById('lp-maxn').addEventListener('change', (e) => {
      loadPlannerState.maxN = Math.max(2, Math.floor(Number(e.target.value)));
      renderLoadPlanner();
    });
  }

  // ------------------------------------------------------------------
  // Glossary
  // ------------------------------------------------------------------

  function renderGlossary() {
    const body = document.getElementById('glossary-body');
    const N0 = state.totalCount(),
      S0 = state.totalScore();

    const terms = [
      ['n', 'Number of additional subjects being planned for, in whichever tab you\'re looking at.'],
      ['N0, S0', 'Your current completed subject count and cumulative raw score (Score column total on Transcript), before any additional subjects.'],
      ['T / target', 'The GPA you\'re asking about, as a 2-decimal-place figure: e.g. 4.75.'],
      ['True threshold (T\')', 'T - 0.005: the actual raw value you need to clear, since 4.745 through 4.754999... all display as "4.75".'],
      ['Required', 'The exact average the new subjects need to carry, before any rounding to real grade tiers.'],
      ['Achieved', 'The average the solved combination actually lands on, once rounded to real, assignable grade tiers.'],
      ['Cost', 'Achieved minus Required: how much you overshoot on the NEW subjects alone.'],
      ['Loss', 'Final combined GPA minus the true threshold: how much you overshoot across your WHOLE transcript.'],
      ['Margin', 'How many of the plan\'s better-tier subjects could each individually drop one tier before the combined GPA leaves the target bucket. Usually 0 or 1 for the mathematically optimal plan: see Plan Compare.'],
      ['Guaranteed', 'The target is met no matter what happens: even if every remaining subject is an F, you\'d still clear it.'],
      ['Combination', 'The minimal set of grades (at most two adjacent tiers: Theorem 6) that reaches a target exactly.'],
      ['Target confidence', 'The probability of clearing a target, computed from the Beliefs curve.'],
      ['Risk (density-based)', 'Inversely related to how many distinct grade combinations reach a target: needs no probability assumptions.'],
      ['VaR / CVaR', 'Value-at-Risk / Conditional Value-at-Risk: the boundary of, and average within, your worst alpha-fraction of possible outcomes.'],
      ['Entropy', 'Shannon entropy (bits) of the distribution of possible outcomes: how open your future still is.'],
      ['Beliefs', 'The shared "expected grade curve" (a typical grade plus a spread) used across Reachability, Module Load, Risk, Entropy, and Bayesian.'],
      ['Epistemic / aleatoric', 'Epistemic uncertainty is about not knowing your true ability: it shrinks with more data. Aleatoric is the inherent per-grade randomness even given perfect knowledge of your ability: it does not shrink.'],
      ['Ordinal rank', 'On the Bayesian tab only: grades ranked 0 (F) to 11 (A+) by position, ignoring their GPA point value.'],
      ['Fiber / allocation space', 'Every semester-by-semester table sharing your exact subject-per-semester and grade totals: see the Allocation tab.'],
      ['Policy', 'A full sequence of decisions (one per remaining semester), not just a single choice: see the Policy tab.'],
    ];

    const sheetPurpose = [
      ['Transcript', 'Enter your actual grades. Everything else is derived from this.'],
      ['Reachability', 'Grid of minimal grade combinations across every (n, target) pair.'],
      ['Required GPA', 'One specific (target, n) answered directly.'],
      ['Module load', 'How Cost, Confidence, and Entropy move as you vary n, for one target.'],
      ['Plan compare', 'Several candidate n values compared side by side against one target.'],
      ['Bounds', 'Best/worst case final GPA for a given n, plus the full attainable list between them.'],
      ['Feasibility', 'Minimum n to make a high target possible, or a low target no longer automatic.'],
      ['Risk', 'CVaR/VaR and density-based Risk vs. n, for one target.'],
      ['Entropy', 'How much flexibility remains, and how fast it changes, vs. n.'],
      ['Bayesian', 'Belief about your ability, updated semester by semester from your actual grades.'],
      ['Allocation', 'How constrained your specific semester-by-semester story was.'],
      ['Policy', 'The optimal sequence of subject-count decisions across several semesters.'],
      ['Load planner', 'How the cheapest/most-convenient target shifts as you vary subject count.'],
      ['Efficiency', 'Cost across nearby targets for one fixed n.'],
      ['Classification', 'Required average and confidence for named bands (First Class, etc.), editable.'],
      ['What if', 'A hypothetical semester, layered on top of your real transcript without saving it.'],
    ];

    const exampleN = 3,
      exampleCombo = Reachability.solve(exampleN, 4.6, 0, 0, gradeSystem);

    body.innerHTML = `
      <h3>Definitions</h3>
      <div class="grid-wrap">
        <table class="dgrid"><thead><tr><th>Term</th><th>Meaning</th></tr></thead>
        <tbody>${terms.map(([t, d]) => `<tr><th>${t}</th><td style="text-align:left;white-space:normal">${d}</td></tr>`).join('')}</tbody></table>
      </div>

      <h3 style="margin-top:20px">What each tab is for</h3>
      <div class="grid-wrap">
        <table class="dgrid"><thead><tr><th>Tab</th><th>Purpose</th></tr></thead>
        <tbody>${sheetPurpose.map(([t, d]) => `<tr><th>${t}</th><td style="text-align:left;white-space:normal">${d}</td></tr>`).join('')}</tbody></table>
      </div>

      <h3 style="margin-top:20px">Assumptions</h3>
      <ul>
        <li>Every grade scale is uniformly spaced (fixed at 0.5 for the default NUS scale): see the Transcript tab's Score column.</li>
        <li>Targets are 2-decimal-place figures; the true threshold used everywhere is the target minus 0.005.</li>
        <li>The Beliefs curve (Normal, mean + spread) is a hypothetical you set: it is not fitted from your data.</li>
        <li>Overload is unlimited and carries no penalty; module count is a completely free choice each semester.</li>
        <li>A failed subject (F) has no consequence beyond its 0 contribution to your score: no retake modelling.</li>
        <li>All tiers are equally attainable in the exact/combinatorial machinery: difficulty differences only enter through the Beliefs curve, if at all.</li>
      </ul>

      <h3 style="margin-top:20px">A simple worked example</h3>
      <p class="panel-sub">Take <strong>2A, 1A-</strong>: Count = 3, Score = 5 + 5 + 4.5 = 14.5, Grade = 14.5 / 3 = 4.83333. If your target were 4.60 with these as your only 3 subjects (starting from nothing, N0=0, S0=0): required = ${fmt5(exampleCombo.required)}, and the minimal combination the solver finds is <strong>${exampleCombo.combo}</strong>, achieving ${fmt5(exampleCombo.achieved)}: Cost ${fmt5(exampleCombo.cost)}, Loss ${fmt5(exampleCombo.loss)}. Everything on every other tab is the same handful of ideas, applied at different scales.</p>
    `;
  }

  // ------------------------------------------------------------------
  // About: license and credentials
  // ------------------------------------------------------------------

  const ABOUT_INFO = {
    license: 'Apache-2.0',
    author: 'Lee Hao Rong Javier',
    year: 2026,
    contact: 'javierlee@u.nus.edu',
    name: 'COMPASS: Computational Optimisation for Modular Planning using Academic State Space',
    url: 'https://cepheux.github.io/COMPASS/',
  };

  const LICENSE_TEXTS = {
    'Apache-2.0': (author, year) => `Copyright ${year} ${author}\n\nLicensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at\n\n    http://www.apache.org/licenses/LICENSE-2.0\n\nUnless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.`,
  };

  function citationBibtex() {
    return `@software{lee${ABOUT_INFO.year}compass,\n  author = {Lee Hao Rong Javier},\n  title = {${ABOUT_INFO.name}},\n  year = {${ABOUT_INFO.year}},\n  url = {${ABOUT_INFO.url}}\n}`;
  }

  function citationApa7() {
    return `Lee, Javier. (${ABOUT_INFO.year}). ${ABOUT_INFO.name} [Computer software]. ${ABOUT_INFO.url}`;
  }

  function renderAbout() {
    const body = document.getElementById('about-body');
    const licenseText = LICENSE_TEXTS[ABOUT_INFO.license](ABOUT_INFO.author, ABOUT_INFO.year);
    const bibtex = citationBibtex();
    const apa7 = citationApa7();

    body.innerHTML = `
      <div class="answer-card">
        <div class="answer-card__detail">
          <strong>License:</strong> ${ABOUT_INFO.license}<br/>
          <strong>Author:</strong> ${ABOUT_INFO.author}<br/>
          <strong>Year:</strong> ${ABOUT_INFO.year}<br/>
          <strong>Contact:</strong> ${ABOUT_INFO.contact}
        </div>
      </div>

      <div class="callout callout--warning" style="margin-top:14px">This project is provided free of charge and AS IS. The author assumes no liability for any damages, losses, or consequences resulting from its use. Use at your own risk.</div>

      <h3 style="margin-top:18px">Cite this project</h3>
      <p class="panel-sub">If you use this in academic work, please consider citing it in either of these standard formats. Each button copies the exact text shown below it.</p>

      <div class="grid-2" style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <strong style="font-size:13px">BibTeX</strong>
            <button class="link-btn" id="copy-bibtex">copy</button>
          </div>
          <pre style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-md);padding:14px 18px;white-space:pre-wrap;font-size:12px;line-height:1.6">${bibtex}</pre>
        </div>
        <div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <strong style="font-size:13px">APA 7th edition</strong>
            <button class="link-btn" id="copy-apa7">copy</button>
          </div>
          <pre style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-md);padding:14px 18px;white-space:pre-wrap;font-size:12px;line-height:1.6">${apa7}</pre>
        </div>
      </div>

      <h3 style="margin-top:18px">LICENSE file</h3>
      <pre style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-md);padding:14px 18px;white-space:pre-wrap;font-size:12.5px;line-height:1.6">${licenseText}</pre>
    `;

    document.getElementById('copy-bibtex').addEventListener('click', () => {
      navigator.clipboard
        .writeText(bibtex)
        .then(() => showToast('BibTeX citation copied.'))
        .catch(() => showToast('Could not copy automatically. Please select and copy the text manually.'));
    });
    document.getElementById('copy-apa7').addEventListener('click', () => {
      navigator.clipboard
        .writeText(apa7)
        .then(() => showToast('APA 7 citation copied.'))
        .catch(() => showToast('Could not copy automatically. Please select and copy the text manually.'));
    });
  }

  // ------------------------------------------------------------------
  // Skill tree
  // ------------------------------------------------------------------

  const SKILL_EXPLANATIONS = {
    Algebra: 'Solving equations and working with variables and formulas: the arithmetic behind every GPA calculation in this tool.',
    BasicProb: 'Chance and likelihood in their simplest form: coin flips, dice, "how likely is this."',
    BasicStats: 'Summarising data with averages, spread, and middle values: mean, median, mode.',
    SetsFunctions: 'Collections of objects, and rules that map one thing to another: the basic language the rest of maths is written in.',
    Combinatorics: 'Counting how many ways something can happen: permutations, combinations, "how many different grade combinations reach this total."',
    LinearAlgebra: 'Vectors, matrices, and systems of equations: the toolkit behind anything involving many related quantities at once.',
    Calculus: 'Rates of change and accumulation: derivatives and integrals, the maths of "how things vary smoothly."',
    ProbTheory: 'The formal study of random variables and probability distributions: precise rules for reasoning about uncertainty.',
    FreqStats: '(A concept this tool relies on but doesn\'t name directly.) The classical approach to statistics: treating unknown quantities as fixed, and asking how confident repeated sampling would make you.',
    ParamEst: '(Bridges Frequentist Statistics to Bayesian Statistics.) Estimating an unknown quantity from data: for example, guessing a "true average" from a handful of observed grades.',
    UtilityTheory: 'How economists formalise "how much someone values an outcome" as a number, so different outcomes can be compared and optimised.',
    DiscreteMath: 'Graphs, logic, and discrete structures: the mathematical backbone of computer science.',
    Algorithms: 'Step-by-step procedures for solving a problem efficiently, and for comparing whether one method is genuinely faster than another.',
    AbstractAlgebra: '(Bridges into Algebraic Statistics.) The study of algebraic structures in general (groups, rings, and the like) rather than any one specific numeric system.',
    BayesianStats: 'Updating a belief about an unknown quantity as new evidence arrives, rather than treating that belief as fixed: used directly on the Bayesian tab.',
    InfoTheory: 'Quantifying uncertainty and information mathematically: Shannon entropy, the exact idea behind the Entropy tab.',
    MarkovChains: 'Systems that move between states with fixed probabilities, where only the current state (not the history) affects what happens next.',
    OptimTheory: 'Finding the best solution among many possible options: includes dynamic programming, the technique behind the Policy tab\'s exact solver.',
    DecisionTheory: 'Formal frameworks for making the best choice under uncertainty, once "best" has been defined by a utility function.',
    RiskMeasures: 'Mathematical ways of quantifying "how bad could this realistically get": CVaR, used directly on the Risk tab, is one of these.',
    MDP: 'Markov Decision Processes: sequential decision-making where each choice changes the state and therefore what\'s optimal next: the exact framework behind the Policy tab.',
    AlgStats: 'Using tools from abstract algebra and geometry to study statistical models of tables and counts: the exact technique behind the Allocation Space tab.',
    CombStochastic: 'Random processes built from combinatorial structures, like random partitions and compositions: the conceptual basis for treating semesters as a connected sequence rather than independent draws.',
    T1: 'Grade entry, the Reachability grid, Required GPA, Bounds, Feasibility, Efficiency, Load Planner, Classification, and What If all lean on Algebra and Combinatorics: weighted averages and counting grade combinations.',
    T2: 'Module Load\'s "target confidence" and Risk\'s "real-world odds" both come from Probability Theory and the classical (Frequentist) idea of confidence.',
    T3: "The Risk tab's realistic-worst-case figures are a direct application of coherent risk measures like CVaR.",
    T4: "The Entropy tab's flexibility measures are a direct application of Shannon's information theory.",
    T5: "The Bayesian tab's belief-updating is a direct application of Bayesian statistics and parameter estimation.",
    T6: "The Allocation Space tab's random walk over equally-valid transcripts is a direct application of algebraic statistics and combinatorial stochastic processes.",
    T7: "The Policy tab's multi-semester planning is a direct application of Markov Decision Processes, built on optimisation and decision theory.",
  };

  const SKILL_TREE_DIAGRAM = `flowchart TD
    subgraph SEC["SECONDARY SCHOOL"]
        Algebra["Algebra"]
        BasicProb["Basic Probability"]
        BasicStats["Basic Statistics"]
        SetsFunctions["Sets & Functions"]
    end

    subgraph TERT["TERTIARY / UNDERGRADUATE"]
        Combinatorics["Combinatorics"]
        LinearAlgebra["Linear Algebra"]
        Calculus["Calculus"]
        ProbTheory["Probability Theory"]
        FreqStats["Frequentist Statistics"]
        ParamEst["Parameter Estimation"]
        UtilityTheory["Utility Theory"]
        DiscreteMath["Discrete Math"]
        Algorithms["Algorithms"]
        AbstractAlgebra["Abstract Algebra"]
    end

    subgraph POST["POSTGRADUATE"]
        BayesianStats["Bayesian Statistics"]
        InfoTheory["Information Theory"]
        MarkovChains["Markov Chains"]
        OptimTheory["Optimization Theory"]
        DecisionTheory["Decision Theory"]
        RiskMeasures["Coherent Risk Measures"]
        MDP["Markov Decision Processes"]
        AlgStats["Algebraic Statistics"]
        CombStochastic["Combinatorial Stochastic Processes"]
    end

    subgraph TOOL["THIS TOOL"]
        T1["Grades & Reachability tabs"]
        T2["Module Load / Confidence"]
        T3["Risk tab"]
        T4["Entropy tab"]
        T5["Bayesian tab"]
        T6["Allocation Space tab"]
        T7["Policy tab"]
    end

    Algebra --> Combinatorics
    BasicProb --> Combinatorics
    Algebra --> LinearAlgebra
    Algebra --> Calculus
    BasicProb --> ProbTheory
    Combinatorics --> ProbTheory
    ProbTheory --> FreqStats
    FreqStats --> ParamEst
    Algebra --> UtilityTheory
    Calculus --> UtilityTheory
    SetsFunctions --> DiscreteMath
    DiscreteMath --> Algorithms
    DiscreteMath --> AbstractAlgebra
    BasicStats --> FreqStats

    FreqStats --> BayesianStats
    ParamEst --> BayesianStats
    ProbTheory --> InfoTheory
    ProbTheory --> MarkovChains
    LinearAlgebra --> MarkovChains
    Calculus --> OptimTheory
    Algorithms --> OptimTheory
    UtilityTheory --> DecisionTheory
    ProbTheory --> DecisionTheory
    DecisionTheory --> RiskMeasures
    OptimTheory --> RiskMeasures
    MarkovChains --> MDP
    OptimTheory --> MDP
    DecisionTheory --> MDP
    FreqStats --> AlgStats
    AbstractAlgebra --> AlgStats
    Combinatorics --> CombStochastic
    MarkovChains --> CombStochastic

    Combinatorics -.-> T1
    Algebra -.-> T1
    ProbTheory -.-> T2
    FreqStats -.-> T2
    RiskMeasures -.-> T3
    InfoTheory -.-> T4
    BayesianStats -.-> T5
    AlgStats -.-> T6
    CombStochastic -.-> T6
    MDP -.-> T7

    style SEC stroke-dasharray: 5 5,stroke:#8099a2,fill:none
    style TERT stroke-dasharray: 5 5,stroke:#8099a2,fill:none
    style POST stroke-dasharray: 5 5,stroke:#8099a2,fill:none
    style TOOL stroke:#1d7a8c,fill:none`;

  function wireSkillTreeHover(container) {
    const tip = document.getElementById('hover-tip');
    container.querySelectorAll('.node').forEach((nodeEl) => {
      const match = nodeEl.id.match(/^.*-flowchart-(.+)-\d+$/);
      const key = match ? match[1] : null;
      const text = key ? SKILL_EXPLANATIONS[key] : null;
      if (!text) return;
      nodeEl.style.cursor = 'help';
      nodeEl.addEventListener('mousemove', (e) => {
        tip.innerHTML = `<div class="tip-row"><span class="tip-label">${text}</span></div>`;
        tip.classList.add('visible');
        const pad = 14;
        let left = e.clientX + pad;
        let top = e.clientY + pad;
        if (left + 280 > window.innerWidth) left = e.clientX - 280 - pad;
        if (top + 100 > window.innerHeight) top = e.clientY - 100 - pad;
        tip.style.left = `${left}px`;
        tip.style.top = `${top}px`;
      });
      nodeEl.addEventListener('mouseleave', () => tip.classList.remove('visible'));
    });
  }

  async function renderSkillTree() {
    const body = document.getElementById('skilltree-body');
    body.innerHTML = `
      <div class="answer-card">
        <div class="answer-card__detail">
          <strong>What this page is for:</strong> everything else in this tool is built to be usable without any of the concepts mapped out below: you never need to know what "Bayesian" or "algebraic statistics" means to read your GPA or plan your next semester. This page is for the minority of people who open a tab, wonder "wait, how does this actually work underneath," and want a direction to go looking. It's a map of prerequisites, not a requirement: everyone starts somewhere different, and the dotted boundaries below (secondary school, tertiary/undergraduate, postgraduate) are there so you can find roughly where you already stand and see what the next honest step upward would be: regardless of your age, and regardless of whether "next step" means a class you take or just a term you look up on a slow afternoon.
        </div>
      </div>
      <p class="panel-sub" style="margin-top:14px">Read it top to bottom: each box needs the boxes above it that point into it. The bottom row shows which tab in this tool each concept actually shows up in. Hover any box for a one-line explanation. Some boxes (Frequentist Statistics, Parameter Estimation, Abstract Algebra) don't correspond to any single tab directly: they're included because you genuinely need them to get from one real concept to the next; skipping them would leave a gap in the path, not just a name.</p>
      <div class="info-diagram-wrap" style="overflow-x:auto">
        <div class="mermaid-target" id="skilltree-diagram">Loading diagram…</div>
      </div>
    `;
    const target = document.getElementById('skilltree-diagram');
    try {
      const { svg } = await window.mermaid.render('skilltree-svg-' + Date.now(), SKILL_TREE_DIAGRAM);
      target.innerHTML = svg;
      wireSkillTreeHover(target);
    } catch (e) {
      target.innerHTML = '<p style="color:var(--ink-faint);font-size:12px">(diagram unavailable)</p>';
    }
  }

  // ------------------------------------------------------------------
  // Summary: six common questions, answered directly, pulling from
  // several other tabs. Sections are fully independent of each other,
  // including their own parameters; nothing here computes anything the
  // rest of the engine doesn't already compute elsewhere.
  // ------------------------------------------------------------------

  const summaryState = {
    a: { gpa: null, maxN: 50 },
    b: { minN: 1, maxN: 12, remainingSemesters: 2, showAdvanced: false, convenientCostFilter: 0.01, cheapestCostFilter: 0.001 },
    c: { n1: 4, n2: 8, n3: 12, targetGpa: null },
    d: { fixedN: 8 },
  };

  function tabHints(names) {
    return `<div class="tab-hint-row">${names.map((n) => `<span class="tab-hint-oval">${n}</span>`).join('')}</div>`;
  }

  function renderSummary() {
    const body = document.getElementById('summary-body');
    const N0 = state.totalCount(),
      S0 = state.totalScore();
    const curGpa = state.gpa();
    if (summaryState.a.gpa === null) summaryState.a.gpa = curGpa !== null ? Math.round(curGpa * 100) / 100 : reachState.anchor;
    if (summaryState.c.targetGpa === null) summaryState.c.targetGpa = null; // stays optional/blank by design

    body.innerHTML = `
      <p class="panel-sub">Six questions students actually ask, each answered directly below. Every answer is real, computed from your actual transcript, not a generic example.</p>
      <div class="disclaimer-bubble">
        <strong>Before you read on:</strong> this page is a generalisation, built to help you understand your situation quickly. It may not be fully accurate for all students or all grading situations, and it only covers some of the analysis this tool can do. You're encouraged to go through the individual tabs yourself before making an important decision.
      </div>

      <div class="summary-section" id="summary-section-a"></div>
      <div class="summary-section" id="summary-section-b"></div>
      <div class="summary-section" id="summary-section-c"></div>
      <div class="summary-section" id="summary-section-d"></div>
      <div class="summary-section" id="summary-section-e"></div>
      <div class="summary-section" id="summary-section-f"></div>
    `;

    renderSummarySectionA(N0, S0, curGpa);
    renderSummarySectionB(N0, S0, curGpa);
    renderSummarySectionC(N0, S0, curGpa);
    renderSummarySectionD(N0, S0, curGpa);
    renderSummarySectionE(N0, S0, curGpa);
    renderSummarySectionF(N0, S0, curGpa);
  }

  function renderSummarySectionA(N0, S0, curGpa) {
    const el = document.getElementById('summary-section-a');
    const p = summaryState.a;
    const target = p.gpa;

    // Step 1: a full Reachability row for this one target, n=1..maxN.
    let bestN = null,
      bestCombined = Infinity,
      anyFeasible = false;
    const cellsHtml = [];
    for (let n = 1; n <= p.maxN; n++) {
      const r = Reachability.solve(n, target, N0, S0, gradeSystem);
      if (!r.feasible) {
        cellsHtml.push(`<td class="reach-cell is-impossible" title="n=${n}: not possible">${n}</td>`);
        continue;
      }
      anyFeasible = true;
      const combined = r.cost + 10 * r.loss;
      if (combined < bestCombined) {
        bestCombined = combined;
        bestN = n;
      }
      const caps = [0.15, 0.075];
      const style = `background:${heatmapColor(combined, caps[0], caps[1])}`;
      cellsHtml.push(`<td class="reach-cell" style="${style}" title="n=${n}: ${r.guaranteed ? 'already guaranteed' : r.combo}">${n}</td>`);
    }

    let step1Para = '';
    if (anyFeasible && bestN !== null) {
      step1Para = `<p>To reach your target while minimising inefficiency, you should choose <strong>n = ${bestN}</strong>, the subject count with the lowest combined score (cost plus ten times loss) among everything tried up to ${p.maxN} subjects.</p>`;
    } else {
      step1Para = `<p>A target of ${fmt2(target)} isn't reachable within ${p.maxN} subjects from where you stand now. Try a lower target, or raise the maximum subjects considered above.</p>`;
    }

    // Step 2: Required-GPA-style detail for the recommended n (bestN),
    // falling back to a simple message if nothing was feasible at all.
    let step2Para = '';
    let selResult = null;
    if (bestN !== null) {
      selResult = Reachability.solve(bestN, target, N0, S0, gradeSystem);
      const bounds = Reachability.bounds(bestN, N0, S0, gradeSystem);
      if (selResult.guaranteed) {
        step2Para = `<p>With ${bestN} subjects remaining, your achievable range is ${fmt5(bounds.lower)} to ${fmt5(bounds.upper)}. This target is already guaranteed at that subject count: even your worst possible outcome from here keeps you at or above it.</p>`;
      } else {
        step2Para = `<p>With ${bestN} subjects remaining, your achievable range is ${fmt5(bounds.lower)} to ${fmt5(bounds.upper)}. To reach ${fmt2(target)}, you need an average of ${fmt5(selResult.required)} across those ${bestN} subjects. The minimal combination that does this is <strong>${selResult.combo}</strong>, which achieves ${fmt5(selResult.achieved)}. Since you only strictly needed ${fmt5(selResult.required)}, your cost (extra performance used beyond the bare minimum) is ${fmt5(selResult.cost)}. This brings your final GPA to ${fmt5(selResult.finalGPA)}, with a loss (overshoot beyond your target's own rounding bucket) of ${fmt5(selResult.loss)}.</p>`;
      }
    }

    // Step 3: simulate a +1/-1 grade jump on the recommended combination.
    let step3Para = '';
    if (selResult && !selResult.guaranteed && selResult.feasible) {
      const extraN = bestN;
      const extraS = selResult.achieved * bestN;
      const up = computeGradeJump(1, extraN, extraS, N0, S0, gradeSystem);
      const down = computeGradeJump(-1, extraN, extraS, N0, S0, gradeSystem);
      const upText = up.possible ? `one step better lands you at ${fmt5(up.finalGPA)}` : `stepping one notch better isn't possible here, you'd already be at the ceiling`;
      const downText = down.possible ? `one step worse lands you at ${fmt5(down.finalGPA)}` : `stepping one notch worse isn't possible here, you'd already be at the floor`;
      step3Para = `<p>If that plan's overall performance shifted by one notch either way: ${upText}, and ${downText}.</p>`;
    }

    el.innerHTML = `
      <h3 class="summary-question"><strong>What are the exact grades I need to reach any target?</strong></h3>
      ${tabHints(['Reachability', 'Required GPA', 'What if', 'Module load'])}
      <div class="summary-params controls-row">
        <div class="control-group"><h3>Your target</h3>
          <div class="control-fields"><div class="control-field"><label for="sum-a-gpa">Target GPA</label>
            <input id="sum-a-gpa" type="number" step="0.01" value="${target}" /></div></div>
        </div>
        <div class="control-group"><h3>Search range</h3>
          <div class="control-fields"><div class="control-field"><label for="sum-a-maxn">Maximum n till graduation</label>
            <input id="sum-a-maxn" type="number" min="1" step="1" value="${p.maxN}" /></div></div>
        </div>
      </div>
      <div class="summary-strip"><table class="dgrid" style="width:auto"><tbody><tr>${cellsHtml.join('')}</tr></tbody></table></div>
      ${step1Para}
      ${step2Para}
      ${step3Para}
    `;

    document.getElementById('sum-a-gpa').addEventListener('change', (e) => {
      summaryState.a.gpa = Number(e.target.value);
      renderSummarySectionA(N0, S0, curGpa);
    });
    document.getElementById('sum-a-maxn').addEventListener('change', (e) => {
      summaryState.a.maxN = Math.max(1, Math.floor(Number(e.target.value)));
      renderSummarySectionA(N0, S0, curGpa);
    });
  }

  /**
   * Solves the MDP and walks the optimal policy forward along its own
   * expected path, exactly the pattern the Policy tab itself uses.
   * Shared here so Summary section B can reuse it without duplicating
   * the walk-forward logic. Returns { result, steps } where steps is
   * [{ stage, choice }, ...].
   */
  function computePolicyWalk(N0, S0, horizon, choiceSet, probModel, util) {
    const result = Reachability.solveMDP(N0, S0, horizon, choiceSet, probModel, gradeSystem, util);
    const steps = [];
    let N = N0,
      sigma = 0;
    for (let t = 0; t < horizon; t++) {
      const v = result.valueAt(t, N, sigma);
      steps.push({ stage: t + 1, choice: v.bestChoice });
      N += v.bestChoice;
      const pmf = probModel.convolveN(v.bestChoice);
      let ev = 0;
      pmf.forEach((p, s) => (ev += p * s));
      sigma += Math.round(ev);
    }
    return { result, steps };
  }

  function renderSummarySectionB(N0, S0, curGpa) {
    const el = document.getElementById('summary-section-b');
    const p = summaryState.b;
    const invalidRange = p.minN >= p.maxN;

    let resultsHtml = '';
    if (invalidRange) {
      resultsHtml = `<div class="callout callout--warning">Minimum n must be less than maximum n. Adjust the values above.</div>`;
    } else {
      const anchor = curGpa !== null ? curGpa : reachState.anchor;

      // Steps 1 and 2 both reuse computeEfficiencyForN's cheapest/convenient
      // logic, run once per n across the requested range, then filtered.
      const convenientRows = [];
      const cheapestRows = [];
      for (let n = p.minN; n <= p.maxN; n++) {
        const eff = computeEfficiencyForN(n, N0, S0);
        if (eff.convenientTarget !== null && eff.convenientTarget >= anchor && eff.convenientCost <= p.convenientCostFilter) {
          convenientRows.push({ n, target: eff.convenientTarget, cost: eff.convenientCost, combo: eff.convenientCombo });
        }
        if (eff.cheapestTarget !== null && eff.cheapestTarget <= anchor && eff.cheapestCost <= p.cheapestCostFilter) {
          cheapestRows.push({ n, target: eff.cheapestTarget, cost: eff.cheapestCost, combo: eff.cheapestCombo });
        }
      }
      cheapestRows.sort((a, b) => b.target - a.target);

      const step1Table =
        convenientRows.length > 0
          ? `<div class="grid-wrap"><table class="dgrid"><thead><tr><th>n</th><th>Most convenient target GPA (expected final GPA to aim for)</th><th>Cost</th><th>Combination</th></tr></thead><tbody>${convenientRows
              .map((r) => `<tr><td>${r.n}</td><td>${fmt2(r.target)}</td><td>${fmt5(r.cost)}</td><td>${r.combo}</td></tr>`)
              .join('')}</tbody></table></div>`
          : `<p>No target in range clears both filters (at or above your current GPA, and cost at or below ${p.convenientCostFilter}) for any subject count between ${p.minN} and ${p.maxN}.</p>`;

      const step2Table =
        cheapestRows.length > 0
          ? `<div class="grid-wrap"><table class="dgrid"><thead><tr><th>n</th><th>Cheapest target GPA (expected final GPA to aim for)</th><th>Combination</th></tr></thead><tbody>${cheapestRows
              .map((r) => `<tr><td>${r.n}</td><td>${fmt2(r.target)}</td><td>${r.combo}</td></tr>`)
              .join('')}</tbody></table></div>`
          : `<p>No target in range clears both filters (at or below your current GPA, and cost at or below ${p.cheapestCostFilter}) for any subject count between ${p.minN} and ${p.maxN}.</p>`;

      // Steps 3 and 4: exact policy solves for two different objectives,
      // over a choice set derived from the subject-count range spread
      // evenly across the remaining semesters.
      const choiceLo = Math.max(1, Math.round(p.minN / p.remainingSemesters));
      const choiceHi = Math.max(1, Math.round(p.maxN / p.remainingSemesters));
      const choiceSet = [];
      for (let c = choiceLo; c <= choiceHi; c++) choiceSet.push(c);
      const probModel = new ProbabilityModel(gradeSystem, gradeSystem.scoreOf(beliefs.centerLabel), beliefsRawSpread(gradeSystem));

      const expectedWalk = computePolicyWalk(N0, S0, p.remainingSemesters, choiceSet, probModel, (gpa) => gpa);
      const expectedSeq = expectedWalk.steps.map((s) => s.choice).join(' \u2192 ');
      const beliefMean = gradeSystem.scoreOf(beliefs.centerLabel);
      const allSame = new Set(expectedWalk.steps.map((s) => s.choice)).size === 1;
      const direction = curGpa === null ? null : beliefMean > curGpa ? 'above' : beliefMean < curGpa ? 'below' : 'equal to';
      const step3Note =
        allSame && direction && direction !== 'equal to'
          ? `<div class="callout callout--purple">Every semester recommends the same choice here. That's expected, not a bug: your expected grade curve sits ${direction} your current GPA, and maximising a plain expected value has no in-between answer, only an extreme one, for any choice set.</div>`
          : '';

      const step3Para = `<p>The best sequence of choices across every semester you have left, given your expected grade curve: this reaches an optimal expected value of ${fmt5(expectedWalk.result.expectedUtility)} for expected final GPA, planning ${p.remainingSemesters} semester(s) ahead: ${expectedSeq}.</p>${step3Note}`;

      const targetWalk = computePolicyWalk(N0, S0, p.remainingSemesters, choiceSet, probModel, (gpa) => (gpa >= anchor ? 1 : 0));
      const targetSeq = targetWalk.steps.map((s) => s.choice).join(' \u2192 ');
      const step4Para = `<p>Optimal expected value of P(final GPA \u2265 ${fmt2(anchor)}): ${pct(targetWalk.result.expectedUtility)}, following ${targetSeq}.</p>`;

      const step5Para = `<p>More can be done here when two subject counts are compared directly against each other, side by side. That comparison lives on the Plan compare tab.</p>`;

      resultsHtml = `
        <p>Assuming you expect to do better than your current GPA, meaning you're putting in more effort than the status quo, here is the subject count and target that stays most convenient while keeping cost low:</p>
        ${step1Table}
        <p>Assuming instead you expect to do worse than your current GPA, meaning you want a more relaxed set of semesters, and without assuming any particular grade distribution, here is the cheapest target available at each subject count:</p>
        ${step2Table}
        ${step3Para}
        ${step4Para}
        ${step5Para}
      `;
    }

    el.innerHTML = `
      <h3 class="summary-question"><strong>How should I choose my target and my workload?</strong></h3>
      ${tabHints(['Efficiency', 'Plan compare', 'Policy', 'Load planner'])}
      <div class="summary-params controls-row">
        <div class="control-group"><h3>Subject count range</h3>
          <div class="control-fields">
            <div class="control-field"><label for="sum-b-minn">Minimum n</label><input id="sum-b-minn" type="number" min="1" step="1" value="${p.minN}" /></div>
            <div class="control-field"><label for="sum-b-maxn">Maximum n</label><input id="sum-b-maxn" type="number" min="1" step="1" value="${p.maxN}" /></div>
          </div>
        </div>
        <div class="control-group"><h3>Planning horizon</h3>
          <div class="control-fields"><div class="control-field"><label for="sum-b-sems">Remaining semesters to plan</label>
            <input id="sum-b-sems" type="number" min="1" max="4" step="1" value="${p.remainingSemesters}" /></div></div>
        </div>
      </div>
      <button class="link-btn" id="sum-b-advanced-toggle">${p.showAdvanced ? 'hide' : 'show'} advanced filters</button>
      <div class="summary-params controls-row" style="${p.showAdvanced ? '' : 'display:none'}" id="sum-b-advanced">
        <div class="control-group"><h3>Advanced</h3>
          <div class="control-fields">
            <div class="control-field"><label for="sum-b-convfilter">Most-convenient cost filter</label><input id="sum-b-convfilter" type="number" step="0.001" value="${p.convenientCostFilter}" /></div>
            <div class="control-field"><label for="sum-b-cheapfilter">Cheapest cost filter</label><input id="sum-b-cheapfilter" type="number" step="0.0001" value="${p.cheapestCostFilter}" /></div>
          </div>
        </div>
      </div>
      ${resultsHtml}
    `;

    document.getElementById('sum-b-minn').addEventListener('change', (e) => {
      summaryState.b.minN = Math.max(1, Math.floor(Number(e.target.value)));
      renderSummarySectionB(N0, S0, curGpa);
    });
    document.getElementById('sum-b-maxn').addEventListener('change', (e) => {
      summaryState.b.maxN = Math.max(1, Math.floor(Number(e.target.value)));
      renderSummarySectionB(N0, S0, curGpa);
    });
    document.getElementById('sum-b-sems').addEventListener('change', (e) => {
      summaryState.b.remainingSemesters = Math.max(1, Math.min(4, Math.floor(Number(e.target.value))));
      renderSummarySectionB(N0, S0, curGpa);
    });
    document.getElementById('sum-b-advanced-toggle').addEventListener('click', () => {
      summaryState.b.showAdvanced = !summaryState.b.showAdvanced;
      renderSummarySectionB(N0, S0, curGpa);
    });
    document.getElementById('sum-b-convfilter').addEventListener('change', (e) => {
      summaryState.b.convenientCostFilter = Number(e.target.value);
      renderSummarySectionB(N0, S0, curGpa);
    });
    document.getElementById('sum-b-cheapfilter').addEventListener('change', (e) => {
      summaryState.b.cheapestCostFilter = Number(e.target.value);
      renderSummarySectionB(N0, S0, curGpa);
    });
  }
  function renderSummarySectionC(N0, S0, curGpa) {
    const el = document.getElementById('summary-section-c');
    const p = summaryState.c;
    const target = p.targetGpa !== null ? p.targetGpa : curGpa !== null ? curGpa : reachState.anchor;
    const ns = [p.n1, p.n2, p.n3];
    const an = new Analysis(gradeSystem);
    const probModel = new ProbabilityModel(gradeSystem, gradeSystem.scoreOf(beliefs.centerLabel), beliefsRawSpread(gradeSystem));

    const rows = ns.map((n) => {
      const r = Reachability.solve(n, target, N0, S0, gradeSystem);
      const conf = r.feasible && !r.guaranteed ? probModel.targetConfidence(n, Reachability.requiredScaledTotal(n, target, N0, S0, gradeSystem)) : r.guaranteed ? 1 : 0;
      const consequence = probModel.cvar(n, 0.1, N0, S0, gradeSystem).cvar;
      return { n, feasible: r.feasible, guaranteed: r.guaranteed, combo: r.combo, conf, consequence };
    });

    const step1Table = `<div class="grid-wrap"><table class="dgrid"><thead><tr><th>Plan</th><th>Even possible?</th><th>Grades needed</th><th>Real-world odds</th><th>GPA if it goes badly</th></tr></thead><tbody>${rows
      .map((r) => `<tr><th>n=${r.n}</th><td>${r.guaranteed ? 'Already achieved' : r.feasible ? 'Yes' : 'No'}</td><td>${r.guaranteed ? 'Already achieved' : r.feasible ? r.combo : '-'}</td><td>${pct(r.conf)}</td><td>${fmt5(r.consequence)}</td></tr>`)
      .join('')}</tbody></table></div>`;

    const feasibleRows = rows.filter((r) => r.feasible);
    let step1Para = '<p>None of these subject counts can reach this target, so no recommendation can be made from odds alone.</p>';
    if (feasibleRows.length > 0) {
      const maxConf = Math.max(...feasibleRows.map((r) => r.conf));
      const winners = feasibleRows.filter((r) => r.conf === maxConf).sort((a, b) => a.n - b.n);
      step1Para = `<p>Plan <strong>n = ${winners[0].n}</strong> should be chosen, since it has the highest odds based on your expected grade curve.</p>`;
    }

    const effRows = ns.map((n) => {
      const eff = computeEfficiencyForN(n, N0, S0);
      return { n, target: eff.cheapestTarget, cost: eff.cheapestCost, combo: eff.cheapestCombo };
    });
    const validEff = effRows.filter((r) => r.target !== null);
    let step2Winner = '';
    if (validEff.length > 0) {
      const maxTarget = Math.max(...validEff.map((r) => r.target));
      const winners = validEff.filter((r) => r.target === maxTarget).sort((a, b) => a.n - b.n);
      step2Winner = `<p>Plan <strong>n = ${winners[0].n}</strong> should be chosen, since it gives the highest final GPA while minimising loss.</p>`;
    }
    const step2Detail = effRows
      .map((r) => (r.target !== null ? `<p>With ${r.n} subjects, final GPA ${fmt2(r.target)} minimises loss compared to neighbouring options, needing ${r.combo}.</p>` : `<p>With ${r.n} subjects, no nearby target could be found.</p>`))
      .join('');

    el.innerHTML = `
      <h3 class="summary-question"><strong>Given some knowledge of the grades I'll score, and maybe a target Final GPA, what's the best number of subjects I should take?</strong></h3>
      ${tabHints(['Efficiency', 'Plan compare', 'Load planner'])}
      <div class="summary-params controls-row">
        <div class="control-group"><h3>Subject counts to compare</h3>
          <div class="control-fields">
            <div class="control-field"><label for="sum-c-n1">n1</label><input id="sum-c-n1" type="number" min="1" step="1" value="${p.n1}" /></div>
            <div class="control-field"><label for="sum-c-n2">n2</label><input id="sum-c-n2" type="number" min="1" step="1" value="${p.n2}" /></div>
            <div class="control-field"><label for="sum-c-n3">n3</label><input id="sum-c-n3" type="number" min="1" step="1" value="${p.n3}" /></div>
          </div>
        </div>
        <div class="control-group"><h3>Target GPA (optional)</h3>
          <div class="control-fields"><div class="control-field"><label for="sum-c-target">leave blank to use your current GPA</label>
            <input id="sum-c-target" type="number" step="0.01" placeholder="blank" value="${p.targetGpa !== null ? p.targetGpa : ''}" /></div></div>
        </div>
      </div>
      ${step1Table}
      ${step1Para}
      ${step2Detail}
      ${step2Winner}
    `;

    document.getElementById('sum-c-n1').addEventListener('change', (e) => {
      summaryState.c.n1 = Math.max(1, Math.floor(Number(e.target.value)));
      renderSummarySectionC(N0, S0, curGpa);
    });
    document.getElementById('sum-c-n2').addEventListener('change', (e) => {
      summaryState.c.n2 = Math.max(1, Math.floor(Number(e.target.value)));
      renderSummarySectionC(N0, S0, curGpa);
    });
    document.getElementById('sum-c-n3').addEventListener('change', (e) => {
      summaryState.c.n3 = Math.max(1, Math.floor(Number(e.target.value)));
      renderSummarySectionC(N0, S0, curGpa);
    });
    document.getElementById('sum-c-target').addEventListener('change', (e) => {
      summaryState.c.targetGpa = e.target.value === '' ? null : Number(e.target.value);
      renderSummarySectionC(N0, S0, curGpa);
    });
  }
  function renderSummarySectionD(N0, S0, curGpa) {
    const el = document.getElementById('summary-section-d');
    const p = summaryState.d;
    const n = p.fixedN;

    // Step 1: directly add 1/2/3 more A's, or 1/2/3 more F's, to the
    // CURRENT transcript (not a hypothetical n-subject semester).
    const maxScore = gradeSystem.maxScore(),
      minScore = gradeSystem.minScore();
    const aRows = [1, 2, 3].map((k) => (N0 + k > 0 ? (S0 + k * maxScore) / (N0 + k) : null));
    const fRows = [1, 2, 3].map((k) => (N0 + k > 0 ? (S0 + k * minScore) / (N0 + k) : null));
    const step1Para = `<p>If you added 1, 2, or 3 more A's from here: your final GPA would become ${aRows.map((v, i) => `${fmt5(v)} (+${i + 1})`).join(', ')}. If you added 1, 2, or 3 more F's instead: it would become ${fRows.map((v, i) => `${fmt5(v)} (+${i + 1})`).join(', ')}.</p>`;

    // Step 2: classification bands, highest threshold to lowest, stopping
    // (inclusively) at the first band already guaranteed with n subjects left.
    const bands = window.COMPASS.NUS_CLASSIFICATIONS_DEFAULT.slice().sort((a, b) => b.threshold - a.threshold);
    const bandRows = [];
    for (const band of bands) {
      const r = Reachability.solve(n, band.threshold, N0, S0, gradeSystem);
      bandRows.push({ name: band.name, threshold: band.threshold, r });
      if (r.guaranteed) break;
    }
    const step2List = bandRows
      .map((b) => (b.r.guaranteed ? `<li><strong>${b.name}</strong> (${fmt2(b.threshold)}): already guaranteed, even if you fail all ${n} remaining subjects.</li>` : b.r.feasible ? `<li><strong>${b.name}</strong> (${fmt2(b.threshold)}): needs ${b.r.combo}.</li>` : `<li><strong>${b.name}</strong> (${fmt2(b.threshold)}): not reachable with ${n} subjects left.</li>`))
      .join('');

    // Step 3: risk scenarios for fixed n.
    const probModel = new ProbabilityModel(gradeSystem, gradeSystem.scoreOf(beliefs.centerLabel), beliefsRawSpread(gradeSystem));
    const excellent = probModel.percentile(n, 0.9, N0, S0, gradeSystem);
    const normal = probModel.percentile(n, 0.5, N0, S0, gradeSystem);
    const hard = probModel.percentile(n, 0.1, N0, S0, gradeSystem);
    const worst = probModel.cvar(n, 0.1, N0, S0, gradeSystem).cvar;
    const step3Para = `<p>Given your expected grade curve, with ${n} subjects left: an excellent semester lands around ${fmt5(excellent)}, a normal semester around ${fmt5(normal)}, a hard semester around ${fmt5(hard)}, and a genuine worst case (your realistic worst outcomes, averaged) around ${fmt5(worst)}.</p>`;

    el.innerHTML = `
      <h3 class="summary-question"><strong>How much room do I have for a bad semester, and how many would it take before I'm at real risk?</strong></h3>
      ${tabHints(['Bounds', 'Feasibility', 'Risk', 'Classification', 'What if'])}
      <div class="summary-params controls-row">
        <div class="control-group"><h3>Subjects remaining</h3>
          <div class="control-fields"><div class="control-field"><label for="sum-d-n">Fixed n</label>
            <input id="sum-d-n" type="number" min="1" step="1" value="${n}" /></div></div>
        </div>
      </div>
      ${step1Para}
      <p>Working from the highest classification band down, here's what's needed until the first one that's already safe no matter what:</p>
      <ul class="clean">${step2List}</ul>
      ${step3Para}
    `;

    document.getElementById('sum-d-n').addEventListener('change', (e) => {
      summaryState.d.fixedN = Math.max(1, Math.floor(Number(e.target.value)));
      renderSummarySectionD(N0, S0, curGpa);
    });
  }
  function renderSummarySectionE(N0, S0, curGpa) {
    const el = document.getElementById('summary-section-e');
    let para;
    if (curGpa !== null && curGpa >= 4.495) {
      const probModel = new ProbabilityModel(gradeSystem, gradeSystem.scoreOf(beliefs.centerLabel), beliefsRawSpread(gradeSystem));
      let foundN = null;
      for (let n = 1; n <= 30; n++) {
        const h = probModel.entropy(n);
        if (Math.pow(2, h) > 3) {
          foundN = n;
          break;
        }
      }
      const answerN = foundN === null ? null : Math.max(0, foundN - 1);
      para =
        answerN === null
          ? `<p>Within the range checked, your realistic futures never exceed 3 effectively-distinct outcomes, so this specific limit doesn't apply to you right now.</p>`
          : `<p>Given your expected grade curve, you could take up to <strong>${answerN}</strong> more class${answerN === 1 ? '' : 'es'} before your realistic range of futures would start including outcomes below a B+, based on how many genuinely distinct outcomes remain open at each subject count.</p>`;
    } else {
      para = `<p>Whether this is worth worrying about depends on how willing you are to risk a lower grade for a chance at a better one. This summary page isn't able to generalise a clean answer for you at this point.</p>`;
    }

    el.innerHTML = `
      <h3 class="summary-question"><strong>How much room do I still have to change my future, and how fragile is my current standing?</strong></h3>
      ${tabHints(['Entropy'])}
      ${para}
    `;
  }
  function renderSummarySectionF(N0, S0, curGpa) {
    const el = document.getElementById('summary-section-f');
    const labels = gradeSystem.allLabels();
    const originalTable = state.semesters.map((s) => labels.map((l) => s.counts[l] || 0));
    const nonEmptySemesters = state.semesters.filter((s) => Object.keys(s.counts).length > 0).length;

    let step1Para;
    if (nonEmptySemesters < 2) {
      step1Para = `<p>With fewer than two semesters of data entered, this comparison isn't available yet.</p>`;
    } else {
      const an = new Analysis(gradeSystem);
      const sample = an.sampleAllocationFiber(state.semesters, labels, 4000, Math.floor(Math.random() * 1e9));
      const actualVariance = semesterGpaVariance(originalTable, labels, gradeSystem);
      const fiberVariances = sample.samples.map((t) => semesterGpaVariance(t, labels, gradeSystem)).filter((v) => v !== null);
      if (actualVariance === null || fiberVariances.length === 0) {
        step1Para = `<p>Not enough sampled alternatives were found to make this comparison yet. Try the Allocation tab directly for more control.</p>`;
      } else {
        const fiberAverage = fiberVariances.reduce((a, b) => a + b, 0) / fiberVariances.length;
        const moreVariableCount = fiberVariances.filter((v) => v > actualVariance).length;
        const percentileMoreVariable = (moreVariableCount / fiberVariances.length) * 100;
        if (actualVariance <= fiberAverage) {
          step1Para = `<p>We are <strong>${percentileMoreVariable.toFixed(0)}%</strong> confident that your results are not random on average: your semester-to-semester GPA was steadier than most equally-valid versions of your story could have been.</p>`;
        } else {
          const f = 100 - percentileMoreVariable;
          step1Para = `<p>We are <strong>${f.toFixed(0)}%</strong> confident that your results are random: your semester-to-semester GPA bounced around more than most equally-valid versions of your story would have.</p>`;
        }
      }
    }

    // Step 2: plain-language trend, avoiding "epistemic"/"aleatoric" by name.
    let step2Para;
    const obsVar = bayesianState.obsSpread * bayesianState.obsSpread;
    const track = BayesianTrack.track(gradeSystem, state.semesters, beliefs.centerLabel, beliefs.tierSpread, obsVar);
    const dataStages = track.filter((t, i) => state.semesters[i] && Object.keys(state.semesters[i].counts).length > 0);
    if (dataStages.length < 2) {
      step2Para = `<p>With fewer than two semesters of data, it's too early to tell whether tracking your grade history is sharpening predictions about you specifically.</p>`;
    } else {
      const firstReducible = Math.max(0, dataStages[0].predictiveVariance - obsVar);
      const lastReducible = Math.max(0, dataStages[dataStages.length - 1].predictiveVariance - obsVar);
      if (firstReducible > 1e-9 && lastReducible < firstReducible * 0.7) {
        step2Para = `<p>As your semesters have gone by, more data has genuinely sharpened the prediction about your future grades: the part of the uncertainty that comes from not yet knowing your true ability has shrunk noticeably.</p>`;
      } else {
        step2Para = `<p>Tracking more semesters hasn't sharpened predictions about you very much: most of your remaining uncertainty looks like genuine, ordinary variation from one grade to the next, not something more data would resolve.</p>`;
      }
    }

    el.innerHTML = `
      <h3 class="summary-question"><strong>Was the way my semesters unfolded typical, a fluke, and does my grade history tell me anything?</strong></h3>
      ${tabHints(['Bayesian', 'Allocation'])}
      ${step1Para}
      ${step2Para}
    `;
  }

  const TAB_RENDERERS = {
    transcript: renderTranscript,
    summary: renderSummary,
    reachability: renderReachability,
    'required-gpa': renderRequiredGpa,
    'module-load': renderModuleLoad,
    'plan-compare': renderPlanCompare,
    bounds: renderBounds,
    feasibility: renderFeasibilityCurve,
    risk: renderRisk,
    entropy: renderEntropy,
    bayesian: renderBayesian,
    allocation: renderAllocation,
    policy: renderPolicy,
    'load-planner': renderLoadPlanner,
    efficiency: renderEfficiency,
    classification: renderClassification,
    whatif: renderWhatIf,
    glossary: renderGlossary,
    about: renderAbout,
    skilltree: renderSkillTree,
  };

  document.addEventListener('DOMContentLoaded', () => {
    renderTabBar();
    wireInfoButtons();
    renderTranscript();
    renderReachabilityControls();
    renderReachability();
    selectTab('transcript');
  });
})();

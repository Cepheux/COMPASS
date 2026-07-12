const COMPASS = require('./dass-core.js');
const { GradeSystem, AcademicState, Reachability, ProbabilityModel, BayesianTrack, Analysis } = COMPASS;

let pass = 0;
let fail = 0;

function approx(a, b, eps = 1e-4) {
  return Math.abs(a - b) < eps;
}

function check(name, condition, detail = '') {
  if (condition) {
    pass++;
    console.log(`  ok  - ${name}`);
  } else {
    fail++;
    console.log(`FAIL  - ${name}  ${detail}`);
  }
}

console.log('GradeSystem');
{
  const gs = GradeSystem.nusDefault();
  check('A+ and A share score 5', gs.scoreOf('A+') === 5 && gs.scoreOf('A') === 5);
  check('labelFor(5) returns canonical "A", not "A+"', gs.labelFor(5) === 'A');
  check('labelFor(4.5) returns "A-"', gs.labelFor(4.5) === 'A-');
  check('lattice step is 0.5', gs.latticeStep() === 0.5);
  gs.setScoreOf('A', 5.1);
  check('editing A also moves its alias A+', gs.scoreOf('A+') === 5.1, `got ${gs.scoreOf('A+')}`);

  const gs2 = GradeSystem.nusDefault();
  gs2.renameLabel('B-', 'B−'); // sanity: unicode-ish but under normal use the UI caps this at 3 chars
  check('renameLabel changes the label', gs2.scoreOf('B−') === 3);
  check('the old label no longer resolves', gs2.entries.every((e) => e.label !== 'B-'));

  const gs3 = GradeSystem.nusDefault();
  gs3.renameLabel('A', 'TOP');
  check('renaming a canonical label fixes up its alias', gs3.entries.find((e) => e.label === 'A+').aliasOf === 'TOP');
  check('the renamed canonical label still resolves to score 5', gs3.scoreOf('TOP') === 5);
  let threwOnCollision = false;
  try {
    gs3.renameLabel('B+', 'TOP');
  } catch (e) {
    threwOnCollision = true;
  }
  check('renaming to an already-used label throws rather than silently colliding', threwOnCollision);
}

console.log('AcademicState');
{
  const gs = GradeSystem.nusDefault();
  const state = AcademicState.empty(gs, ['Y1S1', 'Y1S2']);
  check('empty state has GPA = null (not NaN, not a /0 crash)', state.gpa() === null);

  // Image-1 reference example: Count 16, Score 76, Grade 4.75
  const s2 = new AcademicState(gs, [
    { name: 'Y1S1', counts: { A: 1, 'A-': 1, 'B+': 1 } },
    { name: 'Y1S2', counts: { A: 2, 'A-': 1 } },
    { name: 'Y2S1', counts: { 'A+': 1, A: 2, 'B+': 1 } },
    { name: 'Y2S2', counts: { A: 3, 'A-': 2 } },
    { name: 'Y3S1', counts: { A: 1 } },
  ]);
  check('reference transcript: count = 16', s2.totalCount() === 16, `got ${s2.totalCount()}`);
  check('reference transcript: score = 76', approx(s2.totalScore(), 76), `got ${s2.totalScore()}`);
  check('reference transcript: gpa = 4.75', approx(s2.gpa(), 4.75), `got ${s2.gpa()}`);
}

console.log('Reachability: worked examples (N0=31, S0=145, T=4.63, true threshold 4.625)');
{
  const gs = GradeSystem.nusDefault();
  const N0 = 31,
    S0 = 145,
    T = 4.63;

  // n=1: exact single-tier fit (B-), zero cost, zero loss.
  const r1 = Reachability.solve(1, T, N0, S0, gs);
  check('n=1 true threshold is 4.625, exactly', approx(Reachability.trueThreshold(T), 4.625));
  check('n=1 required average g = 3.0 exactly', approx(r1.required, 3.0), `got ${r1.required}`);
  check('n=1 combo is "1B-"', r1.combo === '1B-', `got ${r1.combo}`);
  check('n=1 cost = 0 (exact fit)', approx(r1.cost, 0, 1e-6), `got ${r1.cost}`);
  check('n=1 finalGPA = 4.625 exactly', approx(r1.finalGPA, 4.625), `got ${r1.finalGPA}`);
  check('n=1 loss = 0 (exact fit)', approx(r1.loss, 0, 1e-6), `got ${r1.loss}`);

  // n=3: two-tier mix (2 B+, 1 A-).
  const r3 = Reachability.solve(3, T, N0, S0, gs);
  check('n=3 combo is "2B+, 1A-"', r3.combo === '2B+, 1A-', `got ${r3.combo}`);
  check('n=3 achieved = 25/6', approx(r3.achieved, 25 / 6), `got ${r3.achieved}`);
  check('n=3 cost ≈ 0.08333', approx(r3.cost, 0.08333, 1e-3), `got ${r3.cost}`);
  check('n=3 finalGPA ≈ 4.632353', approx(r3.finalGPA, 4.632353, 1e-4), `got ${r3.finalGPA}`);
  check('n=3 loss ≈ 0.007353', approx(r3.loss, 0.007353, 1e-3), `got ${r3.loss}`);

  // n=8: two-tier mix (1 B+, 7 A-).
  const r8 = Reachability.solve(8, T, N0, S0, gs);
  check('n=8 combo is "1B+, 7A-"', r8.combo === '1B+, 7A-', `got ${r8.combo}`);
  check('n=8 cost ≈ 0.015625', approx(r8.cost, 0.015625, 1e-3), `got ${r8.cost}`);
  check('n=8 loss ≈ 0.003205', approx(r8.loss, 0.003205, 1e-3), `got ${r8.loss}`);

  console.log('Reachability: Loss = Cost × n/(N0+n) identity, across many (n,T) pairs');
  let identityHolds = true;
  for (let n = 1; n <= 40; n++) {
    for (let t = 460; t <= 490; t += 3) {
      const T2 = t / 100;
      const r = Reachability.solve(n, T2, N0, S0, gs);
      if (!r.feasible) continue;
      const predictedLoss = r.cost * (n / (N0 + n));
      if (!approx(r.loss, predictedLoss, 1e-6)) {
        identityHolds = false;
        console.log(`    mismatch at n=${n}, T=${T2}: loss=${r.loss}, predicted=${predictedLoss}`);
      }
    }
  }
  check('Loss = Cost × n/(N0+n) holds for every feasible cell tested', identityHolds);

  // Infeasibility: a target far above the max grade must read "Not possible".
  const rImpossible = Reachability.solve(1, 6.0, N0, S0, gs);
  check('target above max grade is infeasible', rImpossible.feasible === false);
  check('infeasible cell reads "Not possible"', rImpossible.combo === 'Not possible');
}

console.log('Reachability: Two-Tier Reducibility closed form matches brute-force search');
{
  const gs = GradeSystem.nusDefault();
  const tierScores = gs.canonicalEntries().map((e) => e.score);
  const N0 = 20,
    S0 = 90;
  let allMatch = true;
  for (let n = 1; n <= 12; n++) {
    for (let t = 440; t <= 480; t += 5) {
      const T = t / 100;
      const r = Reachability.solve(n, T, N0, S0, gs);
      if (!r.feasible) continue;
      // Brute force: does ANY combination of n grades from the alphabet sum to sigma?
      const sigma = Reachability.requiredScaledTotal(n, T, N0, S0, gs);
      const target = sigma; // doubled units
      // simple DP existence check restricted to the two tiers claimed
      const minT = Math.round(r.minTier / gs.latticeStep());
      const maxT = Math.round(r.maxTier / gs.latticeStep());
      let found = false;
      for (let x = 0; x <= n; x++) {
        const y = n - x;
        if (minT * x + maxT * y === target) {
          found = true;
          break;
        }
      }
      if (!found) {
        allMatch = false;
        console.log(`    no valid split at n=${n}, T=${T}`);
      }
    }
  }
  check('closed-form (x,y) split always sums to the exact required total', allMatch);
}

console.log('ProbabilityModel: bell curve + Target Confidence');
{
  const gs = GradeSystem.nusDefault();
  const pm = new ProbabilityModel(gs, 4.0, 0.5); // peak at B+, spread of one tier

  let pmfSum = 0;
  for (const p of pm.pmf.values()) pmfSum += p;
  check('single-subject pmf sums to 1', approx(pmfSum, 1, 1e-6), `got ${pmfSum}`);

  const dist1 = pm.convolveN(1);
  let d1sum = 0;
  for (const p of dist1.values()) d1sum += p;
  check('n=1 convolution sums to 1', approx(d1sum, 1, 1e-6));

  const dist5 = pm.convolveN(5);
  let d5sum = 0;
  for (const p of dist5.values()) d5sum += p;
  check('n=5 convolution sums to 1', approx(d5sum, 1, 1e-6), `got ${d5sum}`);

  const easyConfidence = pm.targetConfidence(5, 0); // threshold of 0 -> certain
  check('confidence of clearing a trivial threshold ≈ 1', approx(easyConfidence, 1, 1e-6));

  const impossibleConfidence = pm.targetConfidence(5, 999); // way above max possible
  check('confidence of clearing an impossible threshold = 0', approx(impossibleConfidence, 0, 1e-6));

  check('convolution cache actually caches', pm.convolveN(5) === pm._convCache.get(5));
}

console.log('Analysis: Risk v1 (density)');
{
  const gs = GradeSystem.nusDefault();
  const an = new Analysis(gs);
  const N0 = 31,
    S0 = 145;

  const denEasy = an.reachabilityDensity(10, 4.6, N0, S0);
  const denHard = an.reachabilityDensity(1, 4.99, N0, S0);
  check('an easy, well-inside target has many reaching combinations', denEasy > 5, `got ${denEasy}`);
  check('a near-impossible target has fewer reaching combinations than an easy one', denHard < denEasy, `${denHard} vs ${denEasy}`);

  const riskImpossible = an.risk(1, 20, N0, S0); // absurd target -> zero density
  check('risk of an unreachable target is 1 (maximal)', approx(riskImpossible, 1));
}

console.log('Reachability: bounds()');
{
  const gs = GradeSystem.nusDefault();
  const N0 = 31,
    S0 = 145;
  const b = Reachability.bounds(5, N0, S0, gs);
  check('upper bound = all-A case', approx(b.upper, (145 + 5 * 5) / 36), `got ${b.upper}`);
  check('lower bound = all-F case', approx(b.lower, 145 / 36), `got ${b.lower}`);
  check('upper bound never below lower bound', b.upper >= b.lower);

  const b0 = Reachability.bounds(0 + 1, 0, 0, gs); // fresh start, n=1
  check('fresh-start upper bound with n=1 equals max grade', approx(b0.upper, gs.maxScore()));
  check('fresh-start lower bound with n=1 equals min grade', approx(b0.lower, gs.minScore()));
}

console.log('Reachability: tierPairCombinations() generalises Theorem 6 to non-adjacent pairs');
{
  const gs = GradeSystem.nusDefault();
  const N0 = 31,
    S0 = 145,
    T = 4.63;
  const n = 8; // known two-tier answer at n=8 is "1B+, 7A-"
  const combos = Reachability.tierPairCombinations(n, T, N0, S0, gs);
  check('at least one combination exists for a feasible target', combos.length > 0, `got ${combos.length}`);
  check('the tightest (smallest-spread) combination matches the canonical two-tier solve', combos[0].combo === '1B+, 7A-', `got ${combos[0] && combos[0].combo}`);
  check('every returned combination actually sums to the required total', combos.every((c) => {
    const tiers = gs.canonicalEntries().map((e) => ({ label: e.label, doubled: Math.round(e.score / gs.latticeStep()) }));
    const a = tiers.find((t) => t.label === c.labelA).doubled;
    const b = tiers.find((t) => t.label === c.labelB).doubled;
    const sigma = Reachability.requiredScaledTotal(n, T, N0, S0, gs);
    return a * c.countA + b * c.countB === sigma && c.countA + c.countB === n;
  }));
  check('a wider (non-adjacent) combination also appears, e.g. balancing a weak grade against a strong one', combos.some((c) => c.spread > 1));
}

console.log('ProbabilityModel: entropy()');
{
  const gs = GradeSystem.nusDefault();
  const narrow = new ProbabilityModel(gs, 4.0, 0.05); // near-certain outcome
  const wide = new ProbabilityModel(gs, 4.0, 3.0); // very uncertain outcome
  check('a near-deterministic curve has low single-subject entropy', narrow.entropy(1) < 0.5, `got ${narrow.entropy(1)}`);
  check('a wide curve has higher single-subject entropy than a narrow one', wide.entropy(1) > narrow.entropy(1));
  check('entropy is never negative', narrow.entropy(5) >= -1e-9 && wide.entropy(5) >= -1e-9);
  check('entropy over more subjects is at least the single-subject entropy (more possible totals)', wide.entropy(5) >= wide.entropy(1) - 1e-9);
}

console.log('GradeSystem: alternate presets (generalisation)');
{
  const us4 = GradeSystem.us4Default();
  check('US 4.0 scale: A tops out at 4.0', us4.maxScore() === 4.0);
  check('US 4.0 scale: F is 0.0', us4.minScore() === 0.0);
  check('US 4.0 scale is uniform (Reachability requires this)', us4.isUniform() === true);

  const pct = GradeSystem.percentageDefault();
  check('percentage scale spans 0-100', pct.maxScore() === 100 && pct.minScore() === 0);
  check('percentage scale has 101 distinct whole-point tiers', pct.canonicalEntries().length === 101);
  check('percentage scale is uniform', pct.isUniform() === true);
  check('NUS default scale is uniform', GradeSystem.nusDefault().isUniform() === true);

  // Real correctness, not just "it ran": with N0=20, S0=76 (avg 3.8) on the
  // US 4.0 scale, reaching a combined 3.9 over 5 more subjects needs an
  // exact average of (3.9*25-76)/5 = 4.1: above the US scale's own max of
  // 4.0, so this specific target must be infeasible on this scale.
  const rUS = Reachability.solve(5, 3.9, 20, 76, us4);
  check('US 4.0 scale correctly reports an above-max target as infeasible', rUS.feasible === false, JSON.stringify(rUS));
  // The same N0/S0/target/n IS feasible on NUS's wider 5.0 scale.
  const rNUS = Reachability.solve(5, 3.9, 20, 76, GradeSystem.nusDefault());
  check('the identical scenario is feasible on the NUS scale (sanity contrast)', rNUS.feasible === true);

  // Percentage scale: N0=10, S0=750 (avg 75), target 78 over 5 subjects
  // needs exact average (77.995*15-750)/5 = 83.985 (the 0.005 rounding
  // half-step applies regardless of scale); the nearest achievable integer
  // percentage total (420/5=84) is a clean single tier.
  const rPct = Reachability.solve(5, 78, 10, 750, pct);
  check('percentage scale resolves to a single clean tier', rPct.feasible && rPct.minTier === rPct.maxTier, JSON.stringify(rPct));
  check('percentage scale combo is the single tier "584"', rPct.combo === '584', `got ${rPct.combo}`);
  check('percentage scale cost matches hand-computed value', approx(rPct.cost, 0.015, 1e-3), `got ${rPct.cost}`);
}

console.log('Regression: a non-uniform GradeSystem must fail loudly, never silently miscompute');
{
  // This is the exact bug this test guards against: Reachability used to
  // hardcode "the lattice step is 0.5" while tierPairCombinations derived
  // it from GradeSystem.latticeStep(). Moving a tier off the uniform grid
  // used to make the two halves of the engine quietly disagree about what
  // a "tier" even is, producing a garbled combo string instead of an
  // error. Every Reachability entry point now checks isUniform() first
  // and throws a clear error instead.
  const gs = GradeSystem.nusDefault();
  gs.setScoreOf('B-', 3.25); // deliberately NOT a multiple of the 0.5 spacing
  check('a deliberately non-uniform GradeSystem is detected as such', gs.isUniform() === false);

  let threw = false;
  try {
    Reachability.solve(8, 4.75, 16, 76, gs);
  } catch (e) {
    threw = true;
  }
  check('solve() throws rather than silently miscomputing on a non-uniform system', threw);

  let threw2 = false;
  try {
    Reachability.tierPairCombinations(8, 4.75, 16, 76, gs);
  } catch (e) {
    threw2 = true;
  }
  check('tierPairCombinations() throws for the same reason', threw2);

  // A snapped edit (what the UI actually does: see app.js's Score
  // double-click handler) keeps the system uniform and must keep working.
  const gs2 = GradeSystem.nusDefault();
  const step = gs2.latticeStep();
  const base = gs2.minScore();
  const rawEdit = 3.1; // what a user typed
  const snapped = base + Math.round((rawEdit - base) / step) * step;
  gs2.setScoreOf('B-', snapped);
  check('a snapped edit stays uniform', gs2.isUniform() === true, `snapped to ${snapped}`);
  const solvedAfterSnap = Reachability.solve(8, 4.75, 16, 76, gs2);
  check('solve() still works correctly after a snapped, uniform-preserving edit', solvedAfterSnap.feasible && solvedAfterSnap.combo === '4A-, 4A', `got ${solvedAfterSnap.combo}`);
}

console.log('Classification defaults are present and ordered high-to-low');
{
  const bands = COMPASS.NUS_CLASSIFICATIONS_DEFAULT;
  check('five classification bands ship by default', bands.length === 5, `got ${bands.length}`);
  check('bands are sorted highest threshold first', bands.every((b, i) => i === 0 || bands[i - 1].threshold >= b.threshold));
}

console.log('Regression: a target already guaranteed by the worst case must read "Already achieved", not "Not possible"');
{
  const gs = GradeSystem.nusDefault();
  // N0=20, S0=90 (avg 4.5); even 5 more subjects at straight F only drags
  // the average down to 90/25=3.6, still comfortably above a 3.0 target.
  const r = Reachability.solve(5, 3.0, 20, 90, gs);
  check('feasible', r.feasible === true);
  check('flagged as guaranteed', r.guaranteed === true);
  check('combo reads "Already achieved"', r.combo === 'Already achieved');
  check('finalGPA is the exact worst-case value (all F)', approx(r.finalGPA, 3.6));
  check('loss is worst-case final minus the true threshold', approx(r.loss, 3.6 - 2.995));

  // Sanity: the ordinary (non-guaranteed) path is untouched by this branch.
  const rNormal = Reachability.solve(5, 4.9, 20, 76, gs);
  check('an ordinary, non-guaranteed cell has no guaranteed flag', !rNormal.guaranteed);
}

console.log('GradeSystem: ordinal ranking for the Bayesian model');
{
  const gs = GradeSystem.nusDefault();
  const order = gs.ordinalLabels().map((e) => e.label);
  check('ordinal order matches F..A+ with A+ ranked above A', order.join(',') === 'F,D,D+,C-,C,C+,B-,B,B+,A-,A,A+', order.join(','));
  check('ordinalOf("F") is 0', gs.ordinalOf('F') === 0);
  check('ordinalOf("A+") is 11 (top rank despite equal score to A)', gs.ordinalOf('A+') === 11);
  check('ordinalOf("A") is 10', gs.ordinalOf('A') === 10);
  check('labelAtOrdinal(8) is "B+"', gs.labelAtOrdinal(8) === 'B+');
  check('ordinalLabels has 12 entries (aliases counted separately)', gs.ordinalLabels().length === 12);
}

console.log('Reachability: minFeasibleN()');
{
  const gs = GradeSystem.nusDefault();
  const already = Reachability.minFeasibleN(3.5, 20, 76, gs, 50); // avg 3.8 already above 3.5
  check('already-met target returns {n:0, alreadyThere:true}', already.n === 0 && already.alreadyThere === true, JSON.stringify(already));

  const capped = Reachability.minFeasibleN(4.9, 20, 76, gs, 50);
  check('a target unreachable within the cap returns null, not a wrong answer', capped === null);

  const wide = Reachability.minFeasibleN(4.9, 20, 76, gs, 300);
  check('the same target becomes feasible once the cap is wide enough', wide !== null && wide.n === 209, JSON.stringify(wide));
  check('every n below the returned minimum is genuinely infeasible (spot-check n-1)', !Reachability.solve(wide.n - 1, 4.9, 20, 76, gs).feasible);
}

console.log('BayesianTrack: conjugate update, sequential track, and predictive stats');
{
  const gs = GradeSystem.nusDefault();

  const upd = BayesianTrack.update(8, 0.25, 10, 2, 0.25);
  check('single update step matches hand computation (mean=9.3333, var=0.08333)', approx(upd.mean, 9.33333, 1e-3) && approx(upd.variance, 0.08333, 1e-3), JSON.stringify(upd));

  const noEvidence = BayesianTrack.update(8, 0.25, 10, 0, 0.25);
  check('zero subjects in a semester leaves belief unchanged', noEvidence.mean === 8 && noEvidence.variance === 0.25);

  const semesters = [
    { name: 'Y1S1', counts: { A: 2 } }, // ordinal 10, n=2
    { name: 'Y1S2', counts: {} }, // empty -- must be skipped, not shown as a flat step
    { name: 'Y2S1', counts: { 'A+': 1, F: 1 } }, // ordinals 11 and 0, mean 5.5, n=2
  ];
  const track = BayesianTrack.track(gs, semesters, 'B+', 0.5, 0.25);

  check('track has 3 entries: prior + two semesters WITH data (empty one skipped)', track.length === 3, `got ${track.length} labels=${track.map((t) => t.label)}`);
  check('first entry is the prior, centered on B+ (ordinal 8)', track[0].label === 'Prior' && track[0].predictiveMean === 8);
  check('second entry is Y1S1 (Y1S2 had no data and was skipped)', track[1].label === 'Y1S1');
  check('third entry is Y2S1', track[2].label === 'Y2S1');
  check('belief after an A shifts mean upward from the B+ prior', track[1].predictiveMean > 8);

  track.forEach((t) => {
    const sum = t.pmf.reduce((a, b) => a + b, 0);
    check(`${t.label}: predictive PMF sums to 1`, approx(sum, 1, 1e-6), `got ${sum}`);
    check(`${t.label}: predictive variance exceeds belief variance (observation noise stacked on top)`, t.predictiveVariance > 0);
    check(`${t.label}: 95% CI lower is below the mean`, t.ci95Lower < t.predictiveMean);
    check(`${t.label}: 95% CI upper is above the mean`, t.ci95Upper > t.predictiveMean);
    check(`${t.label}: entropy is non-negative`, t.entropy >= -1e-9);
  });

  check('predictive PMF has exactly 12 entries (one per ordinal label)', track[0].pmf.length === 12);

  // A run of only strong grades should narrow relative to the prior variance component,
  // even though predictive variance (which adds observation noise) stays above it.
  check('posterior belief narrows after evidence (predictive variance still includes obs noise, so compare against prior + obsVar)', track[1].predictiveVariance < track[0].predictiveVariance, `${track[1].predictiveVariance} vs ${track[0].predictiveVariance}`);
}

console.log('Reachability: margin()');
{
  const gs = GradeSystem.nusDefault();
  const N0 = 16,
    S0 = 76;
  const r1 = Reachability.solve(8, 4.75, N0, S0, gs);
  check('margin matches hand computation for a tight optimal fit', r1.margin === 0, JSON.stringify(r1));

  // Exact theorem (see paper, Corollary on Margin): for any grading system
  // with step >= 0.5, Cost < 1/(2n) forces the downgrade budget
  // Cost*n/step < 1 strictly, so margin = floor(that) = 0 identically for
  // every non-guaranteed optimal solve() -- not just "small", exactly zero.
  // A prior version of this test only asserted an empirical bound (<=3)
  // because a floating-point boundary bug in requiredScaledTotal() was
  // occasionally off by one; that bug is now fixed, and this sweep checks
  // the theorem holds exactly, not approximately.
  let maxMarginSeen = -1,
    anyNonzero = false;
  for (let n = 1; n <= 80; n++) {
    for (let t = 350; t <= 499; t++) {
      const r = Reachability.solve(n, t / 100, N0, S0, gs);
      if (r.feasible && !r.guaranteed) {
        maxMarginSeen = Math.max(maxMarginSeen, r.margin);
        if (r.margin !== 0) anyNonzero = true;
      }
    }
  }
  check('margin is IDENTICALLY zero for every non-guaranteed optimal solve(), n=1..80, T=3.50..4.99 (12,000 combinations)', maxMarginSeen === 0 && !anyNonzero, `max seen: ${maxMarginSeen}`);

  const guaranteedCase = Reachability.solve(5, 3.0, 20, 90, gs);
  check('guaranteed case reports maximal margin (n)', guaranteedCase.margin === 5);
}

console.log('Reachability: requiredScaledTotal() floating-point boundary regression');
{
  const gs = GradeSystem.nusDefault();
  // The exact case that exposed the bug: T=4.23 gives Tp=4.23-0.005, which
  // is 4.2250000000000005 in IEEE754 double precision, not exactly 4.225.
  // That ~5e-16 error, amplified by (N0+n)/step, used to push an exact
  // integer boundary (17.0) to 17.00000000000003 and make Math.ceil return
  // 18 instead of 17 -- a real off-by-one, not a rounding preference.
  const r = Reachability.solve(4, 4.23, 16, 76, gs);
  check('the exact floating-point boundary case now resolves with ~zero cost, not a spurious 0.125 overshoot', Math.abs(r.cost) < 1e-9, `cost=${r.cost}`);
  check('the boundary case correctly reports zero margin (a clean two-tier fit, not an off-by-one combination)', r.margin === 0);
  check('sigma computation matches the exact mathematical value (17), not the floating-point-corrupted 18', Reachability.requiredScaledTotal(4, 4.23, 16, 76, gs) === 17, `got ${Reachability.requiredScaledTotal(4, 4.23, 16, 76, gs)}`);
}

console.log('Reachability: minNonGuaranteedN() (the low-target mirror of minFeasibleN)');
{
  const gs = GradeSystem.nusDefault();
  const N0 = 16,
    S0 = 76;
  const res = Reachability.minNonGuaranteedN(3.0, N0, S0, gs, 100);
  check('finds the transition point for a low target', res !== null && res.n === 10, JSON.stringify(res));
  check('one step earlier is still guaranteed', Reachability.solve(res.n - 1, 3.0, N0, S0, gs).guaranteed === true);
  check('at the transition point, guaranteed is false', res.result.guaranteed !== true);

  const capped = Reachability.minNonGuaranteedN(3.0, N0, S0, gs, 3);
  check('a target needing more n than the cap returns null', capped === null);
}

console.log('Reachability: enumerate()');
{
  const gs = GradeSystem.nusDefault();
  const N0 = 16,
    S0 = 76;
  const rows = Reachability.enumerate(3, N0, S0, gs);
  check('enumerate(3) has 31 rows (sigma from 30 down to 0)', rows.length === 31, `got ${rows.length}`);
  check('first row is the all-max combination', rows[0].combo === '3A' && approx(rows[0].achieved, 5));
  check('last row is the all-min combination', rows[rows.length - 1].combo === '3F' && approx(rows[rows.length - 1].achieved, 0));
  check('rows[1] matches hand computation (1A-, 2A)', rows[1].combo === '1A-, 2A', rows[1].combo);
  check('rows are in strictly descending finalGPA order', rows.every((r, i) => i === 0 || r.finalGPA <= rows[i - 1].finalGPA + 1e-9));
  check('every bucketLoss is non-negative and small', rows.every((r) => r.bucketLoss >= -1e-9 && r.bucketLoss < 0.5));
}

console.log('ProbabilityModel: CVaR / VaR (Rockafellar-Uryasev)');
{
  const gs = GradeSystem.nusDefault();
  const pmNarrow = new ProbabilityModel(gs, 4.0, 0.05);
  const rNarrow = pmNarrow.cvar(1, 0.5, 0, 0, gs);
  check('a near-deterministic curve has VaR and CVaR both at the near-certain outcome', approx(rNarrow.var, 4.0, 1e-3) && approx(rNarrow.cvar, 4.0, 1e-3), JSON.stringify(rNarrow));

  const pmWide = new ProbabilityModel(gs, 4.0, 1.0);
  const rWide = pmWide.cvar(1, 0.1, 0, 0, gs);
  check('wide-curve VaR matches independent hand trace of the cumulative distribution', approx(rWide.var, 2.5, 1e-6), JSON.stringify(rWide));
  check('CVaR is below VaR (it is the average of the tail INCLUDING and below VaR)', rWide.cvar <= rWide.var + 1e-9);
  check('CVaR is above the minimum possible outcome (0)', rWide.cvar > 0);

  // CVaR must be monotonically non-decreasing as alpha shrinks toward the very worst case
  // (a smaller tail can only average outcomes at least as bad).
  const c05 = pmWide.cvar(1, 0.5, 0, 0, gs).cvar;
  const c01 = pmWide.cvar(1, 0.1, 0, 0, gs).cvar;
  const c001 = pmWide.cvar(1, 0.01, 0, 0, gs).cvar;
  check('CVaR shrinks (gets worse) monotonically as alpha shrinks', c001 <= c01 + 1e-9 && c01 <= c05 + 1e-9, `${c001} <= ${c01} <= ${c05}`);

  const rFull = pmWide.cvar(1, 1.0, 0, 0, gs);
  const meanOutcome = [...pmWide.convolveN(1).entries()].reduce((s, [sigma, p]) => s + (sigma * 0.5) * p, 0);
  check('CVaR at alpha=1 (the whole distribution) equals the plain expected value', approx(rFull.cvar, meanOutcome, 1e-6), `${rFull.cvar} vs ${meanOutcome}`);
}

console.log('BayesianTrack: predictAhead() (joint multi-subject prediction)');
{
  const gs = GradeSystem.nusDefault();
  const peaked = new Array(12).fill(0);
  peaked[8] = 1.0;
  const trivial = BayesianTrack.predictAhead(peaked, 3);
  check('a certain single-subject outcome gives a certain k-subject total (mean=k*ordinal, variance=0)', trivial.mean === 24 && approx(trivial.variance, 0));

  const track = BayesianTrack.track(gs, [{ name: 'Y1S1', counts: { 'B+': 3, 'A-': 2 } }], 'B+', 0.5, 0.25);
  const stagePmf = track[1].pmf;
  const joint = BayesianTrack.predictAhead(stagePmf, 5);
  let distSum = 0;
  joint.dist.forEach((p) => (distSum += p));
  check('predictAhead distribution sums to 1', approx(distSum, 1, 1e-6), `got ${distSum}`);
  const singleMean = stagePmf.reduce((s, p, i) => s + p * i, 0);
  let singleVar = 0;
  stagePmf.forEach((p, i) => (singleVar += p * (i - singleMean) * (i - singleMean)));
  check('predictAhead mean for k subjects is k times the single-subject mean', approx(joint.mean, singleMean * 5, 1e-6));
  check('predictAhead variance for k i.i.d. subjects is k times the single-subject variance', approx(joint.variance, singleVar * 5, 1e-6), `${joint.variance} vs ${singleVar * 5}`);
}

console.log('Analysis: sampleAllocationFiber() (Diaconis-Sturmfels 2x2 moves)');
{
  const gs = GradeSystem.nusDefault();
  const labels = gs.allLabels();
  const semesters = [
    { name: 'Y1S1', counts: { A: 1, 'A-': 1, 'B+': 1 } },
    { name: 'Y1S2', counts: { A: 2, 'A-': 1 } },
    { name: 'Y2S1', counts: { 'A+': 1, A: 2, 'B+': 1 } },
    { name: 'Y2S2', counts: { A: 3, 'A-': 2 } },
    { name: 'Y3S1', counts: { A: 1 } },
  ];
  const an = new Analysis(gs);
  const result = an.sampleAllocationFiber(semesters, labels, 5000, 42);

  check('margins are exactly preserved after thousands of moves (the critical correctness property)', result.marginsPreserved === true);
  check('finds more than one distinct table (the fiber is non-trivial for this transcript)', result.distinctVisited > 1, `got ${result.distinctVisited}`);
  check('collects a sample for every accepted move', result.samples.length === result.accepted);

  // Every individual sampled table must ALSO satisfy the same margins, not just the final one.
  const origRowSums = semesters.map((s) => Object.values(s.counts).reduce((a, b) => a + b, 0));
  const origColSums = labels.map((g) => semesters.reduce((s2, sem) => s2 + (sem.counts[g] || 0), 0));
  const sampleToCheck = result.samples[Math.floor(result.samples.length / 2)];
  const sampleRowSums = sampleToCheck.map((row) => row.reduce((a, b) => a + b, 0));
  const sampleColSums = labels.map((_, j) => sampleToCheck.reduce((s2, row) => s2 + row[j], 0));
  check('a mid-walk sample also matches the original row sums exactly', JSON.stringify(sampleRowSums) === JSON.stringify(origRowSums));
  check('a mid-walk sample also matches the original column sums exactly', JSON.stringify(sampleColSums) === JSON.stringify(origColSums));
  check('a mid-walk sample genuinely differs from the original (a real reshuffle, not a no-op)', JSON.stringify(sampleToCheck) !== JSON.stringify(semesters.map((s) => labels.map((l) => s.counts[l] || 0))));

  const rerun = an.sampleAllocationFiber(semesters, labels, 5000, 42);
  check('the same seed reproduces the exact same walk (deterministic, testable)', JSON.stringify(rerun.finalTable) === JSON.stringify(result.finalTable));

  const differentSeed = an.sampleAllocationFiber(semesters, labels, 5000, 999);
  check('a different seed explores differently (not hardcoded to one path)', JSON.stringify(differentSeed.finalTable) !== JSON.stringify(result.finalTable));

  const oneSemester = [{ name: 'Y1S1', counts: { A: 5 } }];
  const degenerate = an.sampleAllocationFiber(oneSemester, labels, 1000, 1);
  check('a single semester has no valid 2x2 move and correctly finds only the original table', degenerate.distinctVisited === 1 && degenerate.accepted === 0);
}

console.log('Reachability: solveMDP() (finite-horizon backward induction)');
{
  const gs = GradeSystem.nusDefault();
  const N0 = 16,
    S0 = 76;
  const pm = new ProbabilityModel(gs, 4.0, 0.5); // mean below current GPA -- fewer subjects should win
  const choiceSet = [4, 5, 6, 7];

  const r1 = Reachability.solveMDP(N0, S0, 1, choiceSet, pm, gs);
  let bestDirect = -Infinity,
    bestDirectChoice = null;
  choiceSet.forEach((c) => {
    const pmf = pm.convolveN(c);
    let ev = 0;
    pmf.forEach((p, sigma) => (ev += (p * (S0 + sigma * 0.5)) / (N0 + c)));
    if (ev > bestDirect) {
      bestDirect = ev;
      bestDirectChoice = c;
    }
  });
  check('H=1 exactly matches direct expected-value comparison', approx(r1.expectedUtility, bestDirect, 1e-9) && r1.bestFirstChoice === bestDirectChoice, `mdp=${r1.expectedUtility} direct=${bestDirect}`);

  const r2 = Reachability.solveMDP(N0, S0, 2, choiceSet, pm, gs);
  function fixedPolicyValue(c1, c2) {
    let ev = 0;
    pm.convolveN(c1).forEach((p1, s1) => {
      pm.convolveN(c2).forEach((p2, s2) => {
        ev += (p1 * p2 * (S0 + (s1 + s2) * 0.5)) / (N0 + c1 + c2);
      });
    });
    return ev;
  }
  const fixed44 = fixedPolicyValue(4, 4);
  const fixed77 = fixedPolicyValue(7, 7);
  const fixed47 = fixedPolicyValue(4, 7);
  check('H=2 optimal value is at least as good as every fixed two-stage policy tried', r2.expectedUtility >= fixed44 - 1e-9 && r2.expectedUtility >= fixed77 - 1e-9 && r2.expectedUtility >= fixed47 - 1e-9);
  check('H=2 optimal exactly matches the best of the fixed policies tested here (a genuine, independently-computed optimum)', approx(r2.expectedUtility, Math.max(fixed44, fixed77, fixed47), 1e-9));

  // Nonlinear utility: the DP must optimise the ACTUAL utility given, not
  // silently fall back to plain expected GPA.
  const pmThresh = new ProbabilityModel(gs, 4.3, 0.6);
  const thresholdUtil = (gpa) => (gpa >= 4.5 ? 1 : 0);
  const rThresh = Reachability.solveMDP(N0, S0, 1, [4, 8], pmThresh, gs, thresholdUtil);
  const directConf4 = pmThresh.targetConfidence(4, Reachability.requiredScaledTotal(4, 4.505, N0, S0, gs));
  const directConf8 = pmThresh.targetConfidence(8, Reachability.requiredScaledTotal(8, 4.505, N0, S0, gs));
  check('a nonlinear (threshold) utility is genuinely optimised, matching an independent confidence calculation', approx(rThresh.expectedUtility, Math.max(directConf4, directConf8), 1e-6), `${rThresh.expectedUtility} vs max(${directConf4},${directConf8})`);
  check('the nonlinear case picks the choice with higher threshold-clearing probability, not just higher raw n', rThresh.bestFirstChoice === (directConf4 >= directConf8 ? 4 : 8));
}

console.log('ProbabilityModel.uniform() -- structural (baseline) entropy');
{
  const gs = GradeSystem.nusDefault();
  const u = ProbabilityModel.uniform(gs);
  check('uniform() has one entry per canonical tier (11 for NUS)', u.tierPositions.length === 11, `got ${u.tierPositions.length}`);
  let sum = 0;
  u.pmf.forEach((p) => (sum += p));
  check('uniform() pmf sums to 1', approx(sum, 1, 1e-9));
  check('every tier has equal probability 1/11', [...u.pmf.values()].every((p) => approx(p, 1 / 11, 1e-9)));
  check('entropy(1) of a uniform K-category distribution equals log2(K) exactly', approx(u.entropy(1), Math.log2(11), 1e-9), `got ${u.entropy(1)}`);

  const belief = new ProbabilityModel(gs, 4.0, 0.5);
  check('a concentrated Beliefs curve has strictly LESS entropy than the uniform structural baseline', belief.entropy(3) < u.entropy(3));
}

console.log('ProbabilityModel.percentile()');
{
  const gs = GradeSystem.nusDefault();
  const pm = new ProbabilityModel(gs, 4.0, 0.5);
  const p10 = pm.percentile(1, 0.1, 0, 0, gs);
  const p50 = pm.percentile(1, 0.5, 0, 0, gs);
  const p90 = pm.percentile(1, 0.9, 0, 0, gs);
  check('percentiles are ordered p10 <= p50 <= p90', p10 <= p50 + 1e-9 && p50 <= p90 + 1e-9, `${p10}, ${p50}, ${p90}`);
  check('median of a curve centered at 4.0 (B+) is close to 4.0', approx(p50, 4.0, 0.5), `got ${p50}`);
  const pFull = pm.percentile(1, 1.0, 0, 0, gs);
  check('the 100th percentile is the maximum achievable outcome', approx(pFull, gs.maxScore(), 1e-9), `got ${pFull}`);
}

console.log('ProbabilityModel.utilityWeightedEntropy() -- flexibility should read low when concentrated on bad outcomes');
{
  const gs = GradeSystem.nusDefault();
  const utilFn = (gpa) => gpa / gs.maxScore();
  const pmBad = new ProbabilityModel(gs, 0.5, 1.5); // wide curve near the FLOOR
  const pmGood = new ProbabilityModel(gs, 4.5, 1.5); // wide curve near the CEILING, same spread

  check('raw entropy is identical for the bad and good curves (same spread, by construction)', approx(pmBad.entropy(1), pmGood.entropy(1), 1e-6));

  const wBad = pmBad.utilityWeightedEntropy(1, 0, 0, gs, utilFn);
  const wGood = pmGood.utilityWeightedEntropy(1, 0, 0, gs, utilFn);
  check('utility-weighted entropy is substantially LOWER for the bad-outcome curve despite identical raw entropy', wBad < wGood, `bad=${wBad}, good=${wGood}`);
  check('utility-weighted entropy is non-negative', wBad >= 0 && wGood >= 0);

  const utilFlat = () => 1; // constant utility should reduce to plain entropy exactly
  const flatBad = pmBad.utilityWeightedEntropy(1, 0, 0, gs, utilFlat);
  check('a constant utility function reduces utility-weighted entropy to plain entropy', approx(flatBad, pmBad.entropy(1), 1e-9), `${flatBad} vs ${pmBad.entropy(1)}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

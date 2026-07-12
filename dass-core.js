/**
 * COMPASS Core: Computational Optimisation for Modular Planning using Academic State Space engine.
 *
 * Pure JavaScript. No DOM access anywhere in this file: it must run
 * identically under Node (for testing) and in a browser (for the UI layer).
 * The UI never computes anything itself; it only asks objects here for
 * values and renders what comes back.
 *
 * Module layout:
 *   GradeSystem       (the grading scale (alphabet, scores, labels, aliases)
 *   AcademicState) a transcript: completed subjects + cumulative score
 *   Reachability      (Tab 1's math: required grade, tiers, cost, loss
 *   ProbabilityModel) the editable bell curve + Target Confidence
 *   Analysis         : density-based Risk (v1)
 *   createEngine(...): wires the above into the small English-phrased
 *                       query surface (engine.whatDoINeed(), etc.)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.COMPASS = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------------
  // GradeSystem
  // ---------------------------------------------------------------------
  // Scores are stored RAW (A- = 4.5), matching the reference table. The
  // doubled/integer lattice used by Reachability is derived on demand :
  // GradeSystem itself never assumes a particular scale factor.

  const NUS_ENTRIES = [
    { label: 'A+', score: 5, aliasOf: 'A' },
    { label: 'A', score: 5 },
    { label: 'A-', score: 4.5 },
    { label: 'B+', score: 4 },
    { label: 'B', score: 3.5 },
    { label: 'B-', score: 3 },
    { label: 'C+', score: 2.5 },
    { label: 'C', score: 2 },
    { label: 'C-', score: 1.5 },
    { label: 'D+', score: 1 },
    { label: 'D', score: 0.5 },
    { label: 'F', score: 0 },
  ];

  // Default classification bands for the NUS 5.0 CAP scale. These are
  // commonly-cited figures (First Class 4.50, Second Upper 4.00, Second
  // Lower 3.50, Third Class 3.00, minimum-to-graduate 2.00), corroborated
  // across the NUS Registrar grade legend and multiple independent CAP
  // guides, but faculties vary (e.g. Law uses a different formula
  // entirely) and policy can change. Treat as an editable starting point,
  // not an authoritative source; Tab 10 lets the user overwrite every value.
  const NUS_CLASSIFICATIONS_DEFAULT = [
    { name: 'First Class Honours', threshold: 4.5 },
    { name: 'Second Class Upper', threshold: 4.0 },
    { name: 'Second Class Lower', threshold: 3.5 },
    { name: 'Third Class Honours', threshold: 3.0 },
    { name: 'Minimum to graduate', threshold: 2.0 },
  ];

  class GradeSystem {
    constructor(entries) {
      this.entries = entries.map((e) => ({ ...e }));
    }

    static nusDefault() {
      return new GradeSystem(NUS_ENTRIES);
    }

    /**
     * A simplified US 4.0 scale: whole letter grades only, uniformly
     * spaced at 1.0 apart. A real US transcript's +/- gaps are NOT uniform
     * (commonly 0.3/0.4, with a full 1.0 drop to F) which Reachability's
     * lattice math cannot handle (see GradeSystem.isUniform()); this is an
     * honest simplification for the generalisation demo, not a claim that
     * real transcripts are this coarse.
     */
    static us4Default() {
      return new GradeSystem([
        { label: 'A', score: 4.0 },
        { label: 'B', score: 3.0 },
        { label: 'C', score: 2.0 },
        { label: 'D', score: 1.0 },
        { label: 'F', score: 0.0 },
      ]);
    }

    /** A flat percentage / WAM-style scale: every whole point is its own tier. */
    static percentageDefault() {
      const entries = [];
      for (let s = 100; s >= 0; s--) entries.push({ label: String(s), score: s });
      return new GradeSystem(entries);
    }

    /** All entries, including aliases (e.g. both A+ and A). */
    allLabels() {
      return this.entries.map((e) => e.label);
    }

    /** Only canonical (non-alias) tiers, ordered as given: the 11 distinct scores. */
    canonicalEntries() {
      return this.entries.filter((e) => !e.aliasOf);
    }

    scoreOf(label) {
      const e = this.entries.find((x) => x.label === label);
      if (!e) throw new Error(`Unknown grade label: ${label}`);
      return e.score;
    }

    setScoreOf(label, score) {
      const e = this.entries.find((x) => x.label === label);
      if (!e) throw new Error(`Unknown grade label: ${label}`);
      e.score = score;
      // Every alias of this label (and the label itself, if it IS the
      // canonical target of aliases) must move together, or A+/A can
      // silently drift apart after an edit.
      const canonicalName = e.aliasOf || e.label;
      this.entries.forEach((x) => {
        if (x.label === canonicalName || x.aliasOf === canonicalName) {
          x.score = score;
        }
      });
    }

    /** Renames a label, fixing up anything that aliases it so nothing orphans. */
    renameLabel(oldLabel, newLabel) {
      const e = this.entries.find((x) => x.label === oldLabel);
      if (!e) throw new Error(`Unknown grade label: ${oldLabel}`);
      if (this.entries.some((x) => x.label === newLabel && x !== e)) {
        throw new Error(`Label ${newLabel} is already in use`);
      }
      e.label = newLabel;
      this.entries.forEach((x) => {
        if (x.aliasOf === oldLabel) x.aliasOf = newLabel;
      });
    }

    /** Canonical label for a given raw score (e.g. 5 -> "A", not "A+"). */
    labelFor(score, epsilon = 1e-9) {
      const hit = this.canonicalEntries().find((e) => Math.abs(e.score - score) < epsilon);
      return hit ? hit.label : null;
    }

    maxScore() {
      return Math.max(...this.canonicalEntries().map((e) => e.score));
    }

    minScore() {
      return Math.min(...this.canonicalEntries().map((e) => e.score));
    }

    /** Canonical scores low-to-high, in the doubled integer lattice (Axiom 1). */
    latticeStep() {
      // Smallest gap between adjacent canonical scores defines "1 unit".
      const scores = this.canonicalEntries().map((e) => e.score).sort((a, b) => a - b);
      let step = Infinity;
      for (let i = 1; i < scores.length; i++) step = Math.min(step, scores[i] - scores[i - 1]);
      return step;
    }

    /**
     * Reachability's lattice math assumes every adjacent pair of canonical
     * tiers is exactly one latticeStep() apart. That's true for every
     * built-in preset, and stays true after an edit as long as the UI
     * snaps edited scores back onto the grid (see app.js), but it is a
     * real assumption, not a law, so it's checked rather than trusted.
     */
    isUniform(epsilon = 1e-9) {
      const scores = this.canonicalEntries().map((e) => e.score).sort((a, b) => a - b);
      if (scores.length < 2) return true;
      const step = this.latticeStep();
      if (!(step > 0)) return false;
      const span = scores[scores.length - 1] - scores[0];
      const expectedCount = Math.round(span / step) + 1;
      return expectedCount === scores.length;
    }

    /**
     * Every label (aliases included) ranked 0..K-1 by score ascending :
     * ties broken by putting the alias ABOVE the label it aliases (A+
     * ranks above A despite an equal score, matching how the letters are
     * conventionally read even though NUS gives them equal GPA weight).
     * Used only by the Bayesian ordinal model, which deliberately does not
     * care what each grade's raw score is, only its rank.
     */
    ordinalLabels() {
      return [...this.entries].sort((a, b) => {
        if (a.score !== b.score) return a.score - b.score;
        if (a.aliasOf && !b.aliasOf) return 1; // a is an alias -> ranks above b
        if (!a.aliasOf && b.aliasOf) return -1;
        return 0;
      });
    }

    ordinalOf(label) {
      return this.ordinalLabels().findIndex((e) => e.label === label);
    }

    labelAtOrdinal(k) {
      const list = this.ordinalLabels();
      return list[k] ? list[k].label : null;
    }
  }

  // ---------------------------------------------------------------------
  // AcademicState
  // ---------------------------------------------------------------------
  // Immutable-by-convention: methods read `semesters`, nothing here
  // mutates it. The UI layer owns replacing the semesters array wholesale
  // on every edit (cheap at this scale: see note in Reachability below
  // about where caching actually matters).

  class AcademicState {
    /**
     * @param {GradeSystem} gradeSystem
     * @param {Array<{name:string, counts:Object<string,number>}>} semesters
     */
    constructor(gradeSystem, semesters) {
      this.gradeSystem = gradeSystem;
      this.semesters = semesters;
    }

    static empty(gradeSystem, semesterNames) {
      const semesters = semesterNames.map((name) => ({ name, counts: {} }));
      return new AcademicState(gradeSystem, semesters);
    }

    countFor(label, semesterIndex = null) {
      const sems = semesterIndex === null ? this.semesters : [this.semesters[semesterIndex]];
      return sems.reduce((sum, s) => sum + (s.counts[label] || 0), 0);
    }

    totalCount(semesterIndex = null) {
      const sems = semesterIndex === null ? this.semesters : [this.semesters[semesterIndex]];
      return sems.reduce((sum, s) => sum + Object.values(s.counts).reduce((a, b) => a + b, 0), 0);
    }

    totalScore(semesterIndex = null) {
      const sems = semesterIndex === null ? this.semesters : [this.semesters[semesterIndex]];
      return sems.reduce((sum, s) => {
        return (
          sum +
          Object.entries(s.counts).reduce((a, [label, count]) => a + count * this.gradeSystem.scoreOf(label), 0)
        );
      }, 0);
    }

    /** Guards divide-by-zero: returns null rather than NaN when count is 0. */
    gpa(semesterIndex = null) {
      const n = this.totalCount(semesterIndex);
      if (n === 0) return null;
      return this.totalScore(semesterIndex) / n;
    }
  }

  // ---------------------------------------------------------------------
  // Reachability: Tab 1's verified math
  // ---------------------------------------------------------------------
  // T is what the user types (a 2dp displayed target, e.g. 4.75). Every
  // internal computation runs against T' = T - roundingHalfStep, the true
  // lower edge of the rounding bucket: see the "aim for 4.745, not 4.75"
  // correction. roundingHalfStep defaults to 0.005 for 2dp targets.

  const Reachability = {
    trueThreshold(T, roundingHalfStep = 0.005) {
      return T - roundingHalfStep;
    },

    /** g(n,T): required average on the n NEW subjects alone. */
    requiredNewAverage(n, T, N0, S0, roundingHalfStep = 0.005) {
      const Tp = this.trueThreshold(T, roundingHalfStep);
      return Tp - (S0 - Tp * N0) / n;
    },

    /**
     * sigma(n,T): required total, in LATTICE-INTEGER units: i.e. scaled by
     * 1/gradeSystem.latticeStep(): rounded up to the nearest achievable
     * tick. This must always derive its scale from the SAME gradeSystem
     * that tiers()/solve() use; earlier this hardcoded a "x2" that quietly
     * assumed every scale is 0.5-spaced like NUS's, which breaks the
     * instant a GradeSystem has a different (or edited, non-uniform) step.
     */
    requiredScaledTotal(n, T, N0, S0, gradeSystem, roundingHalfStep = 0.005) {
      const Tp = this.trueThreshold(T, roundingHalfStep);
      const step = gradeSystem.latticeStep();
      // Epsilon-tolerant ceiling: Tp itself is often a value like 4.23-0.005
      // that isn't exactly representable in binary floating point (it comes
      // out as 4.2250000000000005, not 4.225). That ~5e-16 error gets
      // amplified by (N0+n)/step -- for (N0+n)=20, step=0.5 it becomes
      // ~2e-14, enough to push an exact integer boundary (17.0) to
      // 17.00000000000003 and make Math.ceil wrongly return 18. Subtracting
      // a tolerance before ceiling absorbs this without affecting any case
      // that is genuinely non-integer (which differs from the nearest
      // integer by orders of magnitude more than the tolerance).
      return Math.ceil((Tp * (N0 + n) - S0) / step - 1e-9);
    },

    tiers(n, sigma, gradeSystem) {
      const step = gradeSystem.latticeStep();
      return {
        minTier: Math.floor(sigma / n) * step,
        maxTier: Math.ceil(sigma / n) * step,
      };
    },

    /**
     * Full solve for one (n, T) cell. Returns feasibility, the minimal
     * two-tier combination (Theorem 6: Two-Tier Reducibility), the two
     * overshoot figures, and the resulting combined GPA.
     */
    solve(n, T, N0, S0, gradeSystem, roundingHalfStep = 0.005) {
      if (n <= 0) throw new Error('n must be a positive integer');
      if (!gradeSystem.isUniform()) {
        throw new Error(
          'Reachability requires a uniformly-spaced GradeSystem (every adjacent tier exactly one latticeStep() apart). ' +
            'This GradeSystem is not uniform: likely a Score edit moved a tier off the grid.'
        );
      }
      const step = gradeSystem.latticeStep();
      const Tp = this.trueThreshold(T, roundingHalfStep);

      // Mirror-image of infeasibility: if even the WORST outcome (every
      // remaining subject at the bottom tier) still clears the threshold,
      // the target is locked in regardless of what happens next. Without
      // this check, requiredNewAverage() comes back negative, minTier
      // lands below minScore(), and the ordinary feasibility test below
      // would misreport this as "Not possible": the opposite of true.
      const worstCaseFinal = (S0 + n * gradeSystem.minScore()) / (N0 + n);
      if (worstCaseFinal >= Tp - 1e-9) {
        return {
          feasible: true,
          guaranteed: true,
          n,
          T,
          required: this.requiredNewAverage(n, T, N0, S0, roundingHalfStep),
          achieved: gradeSystem.minScore(),
          combo: 'Already achieved',
          minTier: gradeSystem.minScore(),
          maxTier: gradeSystem.minScore(),
          counts: { minCount: n, maxCount: 0 },
          cost: 0,
          finalGPA: worstCaseFinal,
          loss: worstCaseFinal - Tp,
          margin: n,
        };
      }

      const g = this.requiredNewAverage(n, T, N0, S0, roundingHalfStep);
      const sigma = this.requiredScaledTotal(n, T, N0, S0, gradeSystem, roundingHalfStep);
      const { minTier, maxTier } = this.tiers(n, sigma, gradeSystem);

      const feasible = minTier >= gradeSystem.minScore() - 1e-9 && maxTier <= gradeSystem.maxScore() + 1e-9;
      if (!feasible) {
        return { feasible: false, combo: 'Not possible', n, T };
      }

      let x, y, achieved;
      if (Math.abs(minTier - maxTier) < 1e-9) {
        x = n;
        y = 0;
        achieved = minTier;
      } else {
        // Two-Tier Reducibility, closed form (replaces the workbook's
        // Cramer's-rule/matrix-inversion approach):
        //   y = sigma - n*(minTier/step),  x = n - y
        y = Math.round(sigma - n * (minTier / step));
        x = n - y;
        achieved = (sigma * step) / n;
      }

      const minLabel = gradeSystem.labelFor(minTier);
      const maxLabel = gradeSystem.labelFor(maxTier);
      const combo =
        y === 0 ? `${x}${minLabel}` : `${x}${minLabel}, ${y}${maxLabel}`;

      const D = sigma * step; // required total, raw units
      const finalGPA = (S0 + D) / (N0 + n);
      const cost = achieved - g; // overshoot within the new subjects alone
      const loss = finalGPA - Tp; // overshoot in the combined transcript

      // Margin: how many of the y "better-tier" subjects could each drop
      // one tier (maxTier -> minTier) before the combined GPA falls out of
      // the target bucket. Each such downgrade reduces the raw total by
      // exactly one lattice step, so the budget in "downgrades" is
      // loss*(N0+n)/step; can't downgrade more subjects than you have at
      // the better tier (y) either.
      const affordableDowngrades = Math.floor((loss * (N0 + n)) / step + 1e-9);
      const margin = Math.max(0, Math.min(y, affordableDowngrades));

      return {
        feasible: true,
        n,
        T,
        required: g,
        achieved,
        combo,
        minTier,
        maxTier,
        counts: { minCount: x, maxCount: y },
        cost,
        finalGPA,
        loss,
        margin,
      };
    },

    /** Best-case / worst-case final GPA if all n new subjects land on the top or bottom tier. */
    bounds(n, N0, S0, gradeSystem) {
      const max = gradeSystem.maxScore();
      const min = gradeSystem.minScore();
      return {
        upper: (S0 + n * max) / (N0 + n),
        lower: (S0 + n * min) / (N0 + n),
      };
    },

    /**
     * Theorem 6 (Two-Tier Reducibility) only ever needs the two tiers
     * ADJACENT to the exact requirement. This generalises the same closed
     * form to every possible pair of tiers (i <= j, not necessarily
     * adjacent), which is what makes alternative-risk-profile combinations
     * visible: a tight pair near the requirement vs. a wide pair that
     * balances a weak grade against a strong one for the same average.
     */
    tierPairCombinations(n, T, N0, S0, gradeSystem, roundingHalfStep = 0.005) {
      if (!gradeSystem.isUniform()) {
        throw new Error('tierPairCombinations requires a uniformly-spaced GradeSystem.');
      }
      const step = gradeSystem.latticeStep();
      const sigma = this.requiredScaledTotal(n, T, N0, S0, gradeSystem, roundingHalfStep);
      const tiers = gradeSystem
        .canonicalEntries()
        .map((e) => ({ label: e.label, score: e.score, idx: Math.round(e.score / step) }))
        .sort((a, b) => a.idx - b.idx);

      const results = [];
      for (let i = 0; i < tiers.length; i++) {
        for (let j = i; j < tiers.length; j++) {
          const ti = tiers[i].idx;
          const tj = tiers[j].idx;
          let x, y;
          if (ti === tj) {
            if (sigma !== ti * n) continue;
            x = n;
            y = 0;
          } else {
            const yNum = sigma - ti * n;
            const yDen = tj - ti;
            if (yNum % yDen !== 0) continue;
            y = yNum / yDen;
            x = n - y;
            if (y < 0 || x < 0) continue;
          }
          results.push({
            labelA: tiers[i].label,
            labelB: tiers[j].label,
            countA: x,
            countB: y,
            spread: tj - ti,
            combo: y === 0 ? `${x}${tiers[i].label}` : `${x}${tiers[i].label}, ${y}${tiers[j].label}`,
          });
        }
      }
      results.sort((a, b) => a.spread - b.spread);
      return results;
    },

    /**
     * Smallest n (1..maxN) for which T is feasible at all. Feasibility is
     * monotonic in n here (Theorem 1: the upper reachability bound only
     * grows as n grows, provided current average < max), so the first
     * feasible n found scanning upward is the true minimum: no need to
     * search further once one is found. Returns {n:0, alreadyThere:true}
     * if the target is already met with zero additional subjects.
     */
    minFeasibleN(T, N0, S0, gradeSystem, maxN, roundingHalfStep = 0.005) {
      const Tp = this.trueThreshold(T, roundingHalfStep);
      if (N0 > 0 && S0 / N0 >= Tp - 1e-9) {
        return { n: 0, alreadyThere: true };
      }
      for (let n = 1; n <= maxN; n++) {
        const r = this.solve(n, T, N0, S0, gradeSystem, roundingHalfStep);
        if (r.feasible) return { n, result: r };
      }
      return null;
    },

    /**
     * The mirror question, for LOW targets: "minimum n to be feasible" is
     * trivially 0 for anything below your current GPA (you're already
     * there). The genuinely useful question for a low target is different:
     * how many subjects of sustained bad performance would it take before
     * this low outcome stops being automatically avoided and becomes a
     * real, specific possibility? That's the smallest n at which the
     * guaranteed-safe branch of solve() first turns false. Bounds widen
     * monotonically with n (Theorem 1), so this transition happens once
     * and never reverses.
     */
    minNonGuaranteedN(T, N0, S0, gradeSystem, maxN, roundingHalfStep = 0.005) {
      for (let n = 1; n <= maxN; n++) {
        const r = this.solve(n, T, N0, S0, gradeSystem, roundingHalfStep);
        if (!r.feasible) return null; // shouldn't happen before a non-guaranteed step, but stay safe
        if (!r.guaranteed) return { n, result: r };
      }
      return null;
    },

    /**
     * Every achievable outcome for a fixed n, one lattice step apart, from
     * best (all top tier) down to worst (all bottom tier). Because the
     * lattice has no holes (Theorem 4) and Theorem 6 guarantees a tight
     * two-tier combination always exists, this is a clean closed-form walk
     *: no search needed at any step.
     */
    enumerate(n, N0, S0, gradeSystem, roundingHalfStep = 0.005) {
      const step = gradeSystem.latticeStep();
      const maxIdx = Math.round(gradeSystem.maxScore() / step);
      const minIdx = Math.round(gradeSystem.minScore() / step);
      const rows = [];
      for (let sigma = maxIdx * n; sigma >= minIdx * n; sigma--) {
        const minTier = Math.floor(sigma / n) * step;
        const maxTier = Math.ceil(sigma / n) * step;
        let x, y;
        if (Math.abs(minTier - maxTier) < 1e-9) {
          x = n;
          y = 0;
        } else {
          y = Math.round(sigma - n * (minTier / step));
          x = n - y;
        }
        const minLabel = gradeSystem.labelFor(minTier);
        const maxLabel = gradeSystem.labelFor(maxTier);
        const combo = y === 0 ? `${x}${minLabel}` : `${x}${minLabel}, ${y}${maxLabel}`;
        const achieved = (sigma * step) / n;
        const finalGPA = (S0 + sigma * step) / (N0 + n);
        const rounded = Math.round(finalGPA * 100) / 100;
        const bucketLoss = finalGPA - (rounded - roundingHalfStep);
        rows.push({ sigma, combo, achieved, finalGPA, rounded, bucketLoss });
      }
      return rows;
    },

    /**
     * Finite-horizon policy optimisation by exact backward induction
     * (Bellman equation), not the closed-form single-step math above.
     * State at stage t is (N, sigma): N is deterministic given the choice
     * sequence so far (it's just addition), sigma (cumulative doubled
     * score) is random, drawn from the Beliefs distribution via the SAME
     * convolution machinery ProbabilityModel already uses. Solved by
     * recursion with memoisation, working backward from the final stage.
     *
     * @param choiceSet   e.g. [4,5,6,7] - subject counts available each stage
     * @param horizon     number of remaining semesters to plan over
     * @param probModel   a ProbabilityModel providing convolveN()
     * @param utilityFn   (finalGPA) => number; defaults to finalGPA itself
     *                     (maximise expected final GPA)
     */
    solveMDP(N0, S0, horizon, choiceSet, probModel, gradeSystem, utilityFn) {
      const step = gradeSystem.latticeStep();
      const util = utilityFn || ((gpa) => gpa);
      const memo = new Map();

      const valueAt = (t, N, sigma) => {
        const key = `${t},${N},${sigma}`;
        if (memo.has(key)) return memo.get(key);
        if (t === horizon) {
          const finalGPA = (S0 + sigma * step) / N;
          const result = { value: util(finalGPA), bestChoice: null, finalGPA };
          memo.set(key, result);
          return result;
        }
        let best = -Infinity,
          bestChoice = null;
        for (const c of choiceSet) {
          const pmf = probModel.convolveN(c);
          let expected = 0;
          for (const [outcome, prob] of pmf) {
            expected += prob * valueAt(t + 1, N + c, sigma + outcome).value;
          }
          if (expected > best) {
            best = expected;
            bestChoice = c;
          }
        }
        const result = { value: best, bestChoice };
        memo.set(key, result);
        return result;
      };

      const root = valueAt(0, N0, 0);
      return { expectedUtility: root.value, bestFirstChoice: root.bestChoice, statesEvaluated: memo.size, valueAt };
    },
  };

  // ---------------------------------------------------------------------
  // ProbabilityModel: the editable bell curve + Target Confidence
  // ---------------------------------------------------------------------
  // Fixed, hypothetical, i.i.d. across every remaining subject: it does
  // NOT condition on the transcript. The transcript already does its job
  // by setting sigma_req; the curve only says how likely each individual
  // future subject is to land on each tier.

  function erf(x) {
    // Abramowitz & Stegun 7.1.26, ~1.5e-7 max error: plenty for a UI curve.
    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x);
    const a1 = 0.254829592,
      a2 = -0.284496736,
      a3 = 1.421413741,
      a4 = -1.453152027,
      a5 = 1.061405429,
      p = 0.3275911;
    const t = 1 / (1 + p * x);
    const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
    return sign * y;
  }

  function normalCDF(x, mean, sd) {
    if (sd <= 0) return x >= mean ? 1 : 0;
    return 0.5 * (1 + erf((x - mean) / (sd * Math.SQRT2)));
  }

  /**
   * Discretize a Normal(mean, sd) onto integer positions lo..hi inclusive
   * (open-ended at both tails, so all probability mass is accounted for).
   * Shared by ProbabilityModel (Tab 1's bell curve) and the Bayesian
   * ordinal model (below): same binning, different axis.
   */
  function discretizeNormal(mean, sd, lo, hi) {
    const raw = [];
    let total = 0;
    for (let k = lo; k <= hi; k++) {
      const upper = k === hi ? Infinity : k + 0.5;
      const lower = k === lo ? -Infinity : k - 0.5;
      const p = Math.max(normalCDF(upper, mean, sd) - normalCDF(lower, mean, sd), 0);
      raw.push(p);
      total += p;
    }
    return raw.map((p) => (total > 0 ? p / total : 0));
  }

  class ProbabilityModel {
    /**
     * @param {GradeSystem} gradeSystem
     * @param {number} meanScore  raw score at the curve's peak (e.g. 4.0)
     * @param {number} spread     std dev, in raw-score units (e.g. 0.5)
     */
    constructor(gradeSystem, meanScore, spread) {
      this.gradeSystem = gradeSystem;
      this.step = gradeSystem.latticeStep(); // raw units per lattice tick (0.5 for NUS)
      this.mean = meanScore / this.step; // recast onto the doubled/integer lattice
      this.spread = Math.max(spread / this.step, 1e-6);
      this.tierPositions = gradeSystem
        .canonicalEntries()
        .map((e) => Math.round(e.score / this.step))
        .sort((a, b) => a - b);
      this.pmf = this._buildPMF();
      this._convCache = new Map();
    }

    /**
     * A "structural" baseline: every canonical tier equally likely, with no
     * assumption about student ability at all. Used to compute Structural
     * Entropy (how many futures are mathematically possible) as distinct
     * from Predictive Entropy (how many are realistically likely given the
     * Beliefs curve): see entropy tab. Reuses convolveN/entropy unchanged
     * since those only touch this.pmf and this.tierPositions.
     */
    static uniform(gradeSystem) {
      const instance = Object.create(ProbabilityModel.prototype);
      instance.gradeSystem = gradeSystem;
      instance.step = gradeSystem.latticeStep();
      instance.tierPositions = gradeSystem
        .canonicalEntries()
        .map((e) => Math.round(e.score / instance.step))
        .sort((a, b) => a - b);
      const K = instance.tierPositions.length;
      instance.mean = null;
      instance.spread = null;
      instance.pmf = new Map();
      instance.tierPositions.forEach((pos) => instance.pmf.set(pos, 1 / K));
      instance._convCache = new Map();
      return instance;
    }

    _buildPMF() {
      const lo = this.tierPositions[0];
      const hi = this.tierPositions[this.tierPositions.length - 1];
      const probs = discretizeNormal(this.mean, this.spread, lo, hi);
      const pmf = new Map();
      probs.forEach((p, i) => pmf.set(lo + i, p));
      return pmf;
    }

    /** Distribution of the SUM of n i.i.d. draws, as a Map(total -> probability). */
    convolveN(n) {
      if (this._convCache.has(n)) return this._convCache.get(n);
      let dist = new Map([[0, 1]]);
      for (let i = 0; i < n; i++) {
        const next = new Map();
        for (const [s1, p1] of dist) {
          for (const [s2, p2] of this.pmf) {
            const s = s1 + s2;
            next.set(s, (next.get(s) || 0) + p1 * p2);
          }
        }
        dist = next;
      }
      this._convCache.set(n, dist);
      return dist;
    }

    /**
     * Academic Entropy, H = -sum(p_i * log2(p_i)), over the distribution of
     * possible totals across n future subjects. High entropy = many
     * plausible futures remain open; entropy trends toward 0 as n shrinks
     * and the outcome becomes closer to determined.
     */
    entropy(n) {
      const dist = this.convolveN(n);
      let H = 0;
      for (const p of dist.values()) {
        if (p > 1e-12) H -= p * Math.log2(p);
      }
      return H;
    }

    /**
     * Target Confidence: P(sum of n future subjects' doubled scores >= sigmaReqDoubled).
     * One convolution per n, reused across every target-GPA row that shares
     * that column: sigma varies by row, the distribution itself does not.
     */
    targetConfidence(n, sigmaReqDoubled) {
      const dist = this.convolveN(n);
      let p = 0;
      for (const [total, prob] of dist) {
        if (total >= sigmaReqDoubled - 1e-9) p += prob;
      }
      return Math.min(Math.max(p, 0), 1);
    }

    /**
     * Value-at-Risk and Conditional Value-at-Risk (Rockafellar & Uryasev,
     * 2000) for the final combined GPA after n more subjects, at tail
     * probability alpha (e.g. 0.05 = worst 5%). VaR_alpha is the alpha
     * quantile of the final-GPA distribution; CVaR_alpha is the
     * probability-weighted average GPA within that worst tail, including a
     * correctly pro-rated share of whichever outcome straddles the
     * boundary (the distribution is discrete, so the alpha quantile
     * usually falls inside one outcome's probability mass, not between
     * two).
     */
    cvar(n, alpha, N0, S0, gradeSystem) {
      const dist = this.convolveN(n);
      const step = gradeSystem.latticeStep();
      const entries = [...dist.entries()]
        .map(([sigma, p]) => ({ finalGPA: (S0 + sigma * step) / (N0 + n), p }))
        .sort((a, b) => a.finalGPA - b.finalGPA);

      let cumP = 0,
        varValue = entries.length ? entries[0].finalGPA : null,
        tailP = 0,
        tailWeightedSum = 0;
      for (const e of entries) {
        if (cumP >= alpha) break;
        const remaining = alpha - cumP;
        const used = Math.min(remaining, e.p);
        tailWeightedSum += e.finalGPA * used;
        tailP += used;
        varValue = e.finalGPA;
        cumP += e.p;
      }
      const cvarValue = tailP > 0 ? tailWeightedSum / tailP : varValue;
      return { var: varValue, cvar: cvarValue };
    }

    /**
     * The p-th percentile (0<p<1) of the final-GPA distribution after n
     * more subjects: e.g. p=0.5 is the median ("base case"), p=0.9 an
     * optimistic read, p=0.1 a pessimistic one. Shares the same
     * probability-weighted-boundary handling as cvar() above, since both
     * are walking the same sorted discrete distribution.
     */
    percentile(n, p, N0, S0, gradeSystem) {
      const dist = this.convolveN(n);
      const step = gradeSystem.latticeStep();
      const entries = [...dist.entries()]
        .map(([sigma, prob]) => ({ finalGPA: (S0 + sigma * step) / (N0 + n), prob }))
        .sort((a, b) => a.finalGPA - b.finalGPA);
      let cumP = 0;
      for (const e of entries) {
        cumP += e.prob;
        if (cumP >= p - 1e-9) return e.finalGPA;
      }
      return entries.length ? entries[entries.length - 1].finalGPA : null;
    }

    /**
     * A utility-weighted reading of flexibility. Plain entropy treats "many
     * equally-likely bad outcomes" identically to "many equally-likely good
     * outcomes": both read as high uncertainty, which is exactly the
     * failure mode this exists to correct: a distribution dominated by
     * low-GPA outcomes should read as having little USABLE flexibility,
     * even if its raw entropy is high. This is NOT the entropy of a
     * reweighted distribution (that formulation was tried and rejected: it
     * gives the opposite of the intended behaviour, since tilting toward
     * an already-thin high-utility tail can make a bad distribution look
     * MORE spread out, not less). Instead it directly weights each
     * outcome's surprisal contribution by its utility before summing:
     *   sum_x  p(x) * u(x) * (-log2 p(x))
     * which is bounded below by 0 and increases both with how spread out
     * the distribution is AND with how much of that spread lands on
     * genuinely valuable (high-utility) outcomes.
     */
    utilityWeightedEntropy(n, N0, S0, gradeSystem, utilityFn) {
      const dist = this.convolveN(n);
      const step = gradeSystem.latticeStep();
      let H = 0;
      dist.forEach((p, sigma) => {
        if (p > 1e-12) {
          const gpa = (S0 + sigma * step) / (N0 + n);
          H -= p * Math.max(utilityFn(gpa), 0) * Math.log2(p);
        }
      });
      return H;
    }
  }

  // ---------------------------------------------------------------------
  // BayesianTrack: sequential belief updating over the ordinal grade scale
  // ---------------------------------------------------------------------
  // Deliberately ignores raw scores entirely: grades are just ranked
  // 0..K-1 (GradeSystem.ordinalLabels()). Belief about latent ability is
  // Normal(mean, variance); each semester's observed grades update it via
  // standard conjugate Normal-Normal updating, precision-weighted against
  // an observation-noise variance (how much a single grade wobbles around
  // true ability). What's plotted for "your next subject" is the
  // POSTERIOR PREDICTIVE (belief uncertainty AND per-grade noise stacked
  // together) which is wider than the belief distribution alone.

  const BayesianTrack = {
    /** One conjugate update step. sigmaObsSq is OBSERVATION variance (not sd). */
    update(priorMean, priorVar, semesterMean, nSem, sigmaObsSq) {
      if (nSem <= 0) return { mean: priorMean, variance: priorVar };
      const priorPrecision = 1 / priorVar;
      const dataPrecision = nSem / sigmaObsSq;
      const posteriorVar = 1 / (priorPrecision + dataPrecision);
      const posteriorMean = posteriorVar * (priorMean * priorPrecision + semesterMean * dataPrecision);
      return { mean: posteriorMean, variance: posteriorVar };
    },

    /**
     * Full sequential track: prior, then one entry per semester THAT HAS
     * DATA (semesters with zero subjects are skipped: belief doesn't
     * move on no evidence), each carrying its own posterior belief AND
     * the posterior-predictive distribution for one more subject.
     */
    track(gradeSystem, semesters, priorLabel, priorSpread, sigmaObsSq) {
      const K = gradeSystem.ordinalLabels().length;
      const priorMean = gradeSystem.ordinalOf(priorLabel);
      const priorVar = Math.max(priorSpread * priorSpread, 1e-6);
      const obsVar = Math.max(sigmaObsSq, 1e-6);

      const steps = [{ label: 'Prior', mean: priorMean, variance: priorVar }];
      let mean = priorMean,
        variance = priorVar;

      semesters.forEach((sem) => {
        const grades = Object.entries(sem.counts || {});
        const nSem = grades.reduce((s, [, c]) => s + c, 0);
        if (nSem === 0) return;
        const semesterMean = grades.reduce((s, [label, c]) => s + c * gradeSystem.ordinalOf(label), 0) / nSem;
        const next = this.update(mean, variance, semesterMean, nSem, obsVar);
        mean = next.mean;
        variance = next.variance;
        steps.push({ label: sem.name, mean, variance });
      });

      return steps.map((s) => ({
        ...s,
        ...this.stats(s.mean, s.variance, obsVar, K),
      }));
    },

    /** Posterior-predictive PMF for one more subject, plus summary stats. */
    stats(mean, variance, obsVar, K) {
      const predictiveVar = variance + obsVar;
      const predictiveSd = Math.sqrt(predictiveVar);
      const pmf = discretizeNormal(mean, predictiveSd, 0, K - 1);
      let entropy = 0;
      pmf.forEach((p) => {
        if (p > 1e-12) entropy -= p * Math.log2(p);
      });
      return {
        predictiveMean: mean,
        predictiveVariance: predictiveVar,
        predictiveSd,
        ci95Lower: mean - 1.959964 * predictiveSd,
        ci95Upper: mean + 1.959964 * predictiveSd,
        entropy,
        pmf,
      };
    },

    /**
     * Joint predictive distribution for k FUTURE subjects combined (not
     * just one), built by convolving a stage's per-subject predictive PMF
     * with itself k times: the same technique ProbabilityModel uses for
     * Tab 1. This answers "given everything through Y3S2, what's the
     * distribution over Y4S1 and Y4S2 combined" rather than just "the next
     * single subject": pick the Y3S2 stage's pmf, set k to the total
     * subjects across both future semesters.
     */
    predictAhead(pmf, k) {
      let dist = new Map([[0, 1]]);
      for (let i = 0; i < k; i++) {
        const next = new Map();
        for (const [s1, p1] of dist) {
          pmf.forEach((p2, ord) => {
            const s = s1 + ord;
            next.set(s, (next.get(s) || 0) + p1 * p2);
          });
        }
        dist = next;
      }
      let mean = 0;
      for (const [s, p] of dist) mean += s * p;
      let variance = 0;
      for (const [s, p] of dist) variance += p * (s - mean) * (s - mean);
      let entropy = 0;
      for (const [, p] of dist) {
        if (p > 1e-12) entropy -= p * Math.log2(p);
      }
      return { dist, mean, variance, sd: Math.sqrt(variance), entropy };
    },
  };

  // ---------------------------------------------------------------------
  // Analysis: Risk v1 (density-based, no probability model required)
  // ---------------------------------------------------------------------
  // Counts distinct grade-count multisets across n subjects landing in a
  // target's rounding bucket, on the SAME exact lattice Reachability uses.
  // Risk is defined as inversely proportional to that count: a bucket few
  // combinations can reach is a fragile target.

  class Analysis {
    constructor(gradeSystem) {
      this.gradeSystem = gradeSystem;
      this.tierScores = gradeSystem
        .canonicalEntries()
        .map((e) => e.score)
        .sort((a, b) => a - b);
      this.step = gradeSystem.latticeStep();
      this.tierPositions = this.tierScores.map((s) => Math.round(s / this.step));
    }

    /** Number of ways to choose n subjects across tiers summing to exactly `total` (doubled units). */
    _waysDistribution(n) {
      const maxTotal = Math.max(...this.tierPositions) * n;
      // ways[c][s] = number of ways using subjects so far: c chosen, s accumulated
      let ways = Array.from({ length: n + 1 }, () => new Float64Array(maxTotal + 1));
      ways[0][0] = 1;
      for (const v of this.tierPositions) {
        for (let c = 1; c <= n; c++) {
          for (let s = v; s <= maxTotal; s++) {
            ways[c][s] += ways[c - 1][s - v];
          }
        }
      }
      return ways[n];
    }

    /** Reachability Density for one (n,T) cell: how many multisets land in T's bucket. */
    reachabilityDensity(n, T, N0, S0, roundingHalfStep = 0.005) {
      const dist = this._waysDistribution(n);
      const lowDoubled = 2 * ((T - roundingHalfStep) * (N0 + n) - S0);
      const highDoubled = 2 * ((T + roundingHalfStep) * (N0 + n) - S0);
      let count = 0;
      for (let s = Math.max(0, Math.ceil(lowDoubled - 1e-9)); s < dist.length; s++) {
        if (s >= highDoubled - 1e-9) break;
        count += dist[s] || 0;
      }
      return count;
    }

    /** Risk v1: inversely proportional to density; 0 density -> risk 1 (maximally fragile/impossible). */
    risk(n, T, N0, S0, roundingHalfStep = 0.005) {
      const density = this.reachabilityDensity(n, T, N0, S0, roundingHalfStep);
      if (density <= 0) return 1;
      return 1 / (1 + density);
    }

    /**
     * Random walk over the fiber of the actual transcript: every table
     * (semester x grade counts) with IDENTICAL row sums (subjects per
     * semester) and column sums (total count per grade) as the real one.
     * This is the Diaconis-Sturmfels (1998) approach to contingency
     * tables: the simplest move for a two-way table is a "2x2 swap" :
     * pick two semesters and two grades, and shift one unit between them
     * in a way that leaves every row and column total unchanged:
     *
     *   semester i, grade j:  +1        semester i, grade k:  -1
     *   semester i', grade j: -1        semester i', grade k: +1
     *
     * Every cell must stay non-negative for a move to be valid. Chaining
     * many such moves is a Markov chain on the space of tables sharing
     * your exact margins (a Markov basis, in the technical sense), so a
     * long random walk explores that whole space, not just neighbours of
     * the original table.
     */
    sampleAllocationFiber(semesters, gradeLabels, steps, seed = 12345) {
      // Simple seeded PRNG (mulberry32) so results are reproducible for testing.
      let s = seed >>> 0;
      const rand = () => {
        s |= 0;
        s = (s + 0x6d2b79f5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      const randInt = (n) => Math.floor(rand() * n);

      const R = semesters.length;
      const C = gradeLabels.length;
      const table = semesters.map((sem) => gradeLabels.map((g) => sem.counts[g] || 0));

      const key = (t) => t.map((row) => row.join(',')).join('|');
      const originalKey = key(table);
      const seen = new Set([originalKey]);
      const samples = [];
      let attempted = 0,
        accepted = 0;

      for (let step = 0; step < steps; step++) {
        if (R < 2 || C < 2) break; // no 2x2 move possible
        const i1 = randInt(R);
        let i2 = randInt(R);
        while (i2 === i1) i2 = randInt(R);
        const j1 = randInt(C);
        let j2 = randInt(C);
        while (j2 === j1) j2 = randInt(C);
        const dir = rand() < 0.5 ? 1 : -1;
        attempted++;
        if (table[i1][j1] + dir >= 0 && table[i1][j2] - dir >= 0 && table[i2][j1] - dir >= 0 && table[i2][j2] + dir >= 0) {
          table[i1][j1] += dir;
          table[i1][j2] -= dir;
          table[i2][j1] -= dir;
          table[i2][j2] += dir;
          accepted++;
          const k = key(table);
          if (!seen.has(k)) seen.add(k);
          samples.push(table.map((row) => [...row]));
        }
      }

      const rowSums = table.map((row) => row.reduce((a, b) => a + b, 0));
      const colSums = gradeLabels.map((_, j) => table.reduce((s2, row) => s2 + row[j], 0));
      const originalRowSums = semesters.map((sem) => Object.values(sem.counts || {}).reduce((a, b) => a + b, 0));
      const originalColSums = gradeLabels.map((g) => semesters.reduce((s2, sem) => s2 + (sem.counts[g] || 0), 0));

      return {
        distinctVisited: seen.size,
        attempted,
        accepted,
        finalTable: table,
        samples,
        marginsPreserved: rowSums.every((v, i) => v === originalRowSums[i]) && colSums.every((v, j) => v === originalColSums[j]),
      };
    }
  }

  // ---------------------------------------------------------------------
  // Engine: the English-phrased query surface over all of the above
  // ---------------------------------------------------------------------

  function createEngine(state) {
    return {
      state,
      currentGPA() {
        return state.gpa();
      },
      whatDoINeed(n, T, roundingHalfStep = 0.005) {
        return Reachability.solve(n, T, state.totalCount(), state.totalScore(), state.gradeSystem, roundingHalfStep);
      },
      whatCanIReach(nRange, T, roundingHalfStep = 0.005) {
        return nRange.map((n) => this.whatDoINeed(n, T, roundingHalfStep));
      },
    };
  }

  return { GradeSystem, AcademicState, Reachability, ProbabilityModel, BayesianTrack, Analysis, createEngine, NUS_CLASSIFICATIONS_DEFAULT };
});

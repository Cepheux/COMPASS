# COMPASS

**Computational Optimisation for Modular Planning using Academic State Space**

COMPASS is a GPA planning tool built on a simple reframing. Instead of asking "What GPA
will these grades give me?", we ask "Given where I am now, what futures are still possible,
and what's the best way to get there? GPA is a single number computed from a discrete, path-dependent state, and once you treat it that way, a whole set of questions become answerable that a normal GPA calculator never surfaces: not just "what grade do I need," but how fragile that plan is, how it compares to realistic alternatives, what your own grade history says about your consistency, and what the best multi-semester plan actually looks like.

Nineteen tabs, one shared engine, zero build step. Open `index.html` in a browser and it runs.


## Contents

- [Quick start](#quick-start)
- [What's inside](#whats-inside)
- [The mathematics, briefly](#mathematics)
- [Architecture](#architecture)
- [Testing](#testing)
- [Honest limitations](#honest-limitations)
- [Citation](#citation)
- [License](#license)

## Quick start

No install, no build, no dependencies beyond a browser (an internet connection is used for loading fonts and loading the [Mermaid](https://mermaid.js.org/) diagram library used by the Skill Tree tab and the "?" info panels; everything else works fully offline).

```
open index.html
```

Start on the **Transcript** tab. It's the only tab that assumes you haven't visited any other tab first, since every other tab reads from what you enter there. From there, the **Skill Tree** tab (last in the tab bar) is a good second stop if you're curious how deep the rabbit hole goes.

## What's inside

Nineteen tabs, but really nine questions. The table below groups them by what they actually answer, in plain terms, before any statistics enter the picture.

| Tab | The question it answers |
|---|---|
| Transcript | Enter your grades here. Everything else is worked out from this one table. |
| Reachability | What grades do I need, for every target and every number of classes left, all at once? |
| Required GPA | Just tell me the number. One target, one class count, one answer. |
| Module load | How many classes should I actually take this semester? |
| Plan compare | Line up a few class-count options and see how they really differ, not just whether each works. |
| Bounds | What's my absolute best case and worst case with the classes I have left? |
| Feasibility | How soon could I reach a goal, or how far could I fall before a low target becomes a real risk? |
| Risk | How bad could this realistically get, not the theoretical extreme and not a falsely comforting average? |
| Entropy | How much genuine flexibility do I have left? |
| Bayesian | Update my expectations using my actual semester-by-semester grades. |
| Allocation | Was my academic progression unusual, meaning were my semester-to-semester swings bigger or smaller than they typically would be? |
| Policy | What's my best plan across every remaining semester, not just the next one? |
| Load planner | What's the easiest number of classes to take, regardless of any one target? |
| Efficiency | For a fixed number of classes, which nearby target wastes the least effort? |
| Classification | Where do I stand against named bands like First Class Honours? |
| What if | Try a hypothetical semester without touching my real, saved grades. |
| Glossary | Look up a word, or find out which tab actually answers my question. |
| About | License, credentials, and how to cite this project. |
| Skill tree | For whoever's curious how any of this actually works underneath. Entirely optional. |

Every tab's "?" button opens a short, tiered explanation: a one-line answer to "why would I use this," a small diagram, and then progressively deeper sections (a plain-language idea, the statistics behind it, and a university-level view where one exists) that you open only if you want to. No tab requires having read another tab first, except Transcript, which everything else depends on directly.

## Mathematics

The three ideas worth knowing up front:

**Rounding can be leveraged.** A displayed target like 4.75 does not mean 4.75. It means the range `[4.745, 4.755)`, since every value in that range rounds to the same displayed figure. Every "required average" computed anywhere in this tool is solved against the lower edge of that range (4.745), not the number you typed, since that's genuinely the least you need.

**Every grade is an integer in disguise.** Divide every grade's point value by the spacing between tiers (0.5 on the default scale) and every grade becomes a whole number. This is what makes the entire Reachability grid computable in constant time per cell rather than searched for.

**Two-Tier Reducibility.** Any achievable total for `n` subjects can always be reached using at most two adjacent grade tiers, never a complicated mixture. The proof is three lines: let `a = floor(sigma/n)`, `y = sigma - a*n`, `x = n - y`. Then `a*x + (a+1)*y = sigma`, exactly, every time. This single result is what the entire reachability engine, used directly or indirectly by eleven of the nineteen tabs, is built on.


## Architecture

```
index.html       shell, tab bar, and the 19 tab panels
dass-core.js     the engine: GradeSystem, AcademicState, Reachability,
                 ProbabilityModel, BayesianTrack, Analysis
app.js           the UI layer: per-tab state, rendering, and event wiring
styles.css       design tokens and components
NOTICE           license and attribution
```

The engine (`dass-core.js`) has no dependencies and no DOM access; it's plain, testable JavaScript exporting a single namespace (`window.COMPASS` in the browser, or a plain `require()`-able module in Node). Every one of its six objects is a pure function library or a class with no hidden global state, which is what makes the 165-test engine suite possible without a browser at all.

The UI layer (`app.js`) is a single IIFE holding one state object per tab plus a handful of shared ones (`gradeSystem`, `state`, `beliefs`), and a dispatch table (`TAB_RENDERERS`) mapping each tab id to its render function. Every render function reads from the engine, never mutates it, and writes its output directly into that tab's `<div>`.


## Testing

```
node dass-core.test.js   # 165 tests: every theorem, corollary, and statistical routine
node smoke.test.js       # 131 tests: full end-to-end coverage of every tab, via jsdom
```

Both require `jsdom` for the end-to-end suite only (`npm install jsdom`); the engine suite has no dependencies at all. Every defect found during development, including a floating-point boundary bug that was nearly shipped as a theorem, is documented with its own regression test rather than only fixed silently; see the technical report's verification section for the full account.


## Honest limitations


- **Not a predictor of your actual future.** Every probability used anywhere in this tool comes from a curve you set yourself, not one fitted from your own transcript. Eight semesters is genuinely too little data to fit a distribution and present it with the authority of a large sample.
- **No penalty structure.** Overload carries no modelled cost in time, stress, or opportunity.
- **Assumes independence between classes** wherever a probability model is used, unless stated otherwise. A hard semester that drags every grade down at once isn't modelled.
- **Single-student only.** Nothing here is informed by how other students with similar histories actually performed, because this project never had access to that data.


## Citation

If you use this in academic work, either format below is welcome. Full text and copy buttons are also available on the About tab.

**APA 7th edition**

```
Lee, Javier. (2026). COMPASS: Computational Optimisation for Modular Planning using
Academic State Space [Computer software]. https://cepheux.github.io/COMPASS/
```

**BibTeX**

```bibtex
@software{lee2026compass,
  author = {Lee, Hao Rong Javier},
  title  = {COMPASS: Computational Optimisation for Modular Planning using Academic State Space},
  year   = {2026},
  url    = {https://cepheux.github.io/COMPASS/}
}
```

## License

Licensed under the Apache License, Version 2.0. See `NOTICE` for the full attribution text.

Copyright (c) 2026 Lee Hao Rong Javier. Developed and maintained by Lee Hao Rong Javier.

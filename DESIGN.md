# SkyDoodle: design notes

This document explains each assistance technique: **what problem it targets, how it works, why it was chosen over alternatives**, and what it means for the research question:

> *Can adaptive visual guides help novice creators draw more accurately in 3D?*

---

## The problem: depth is the hard part

Drawing in 3D (on a screen with a 2D pointer, or in VR with a 6-DoF controller) adds a dimension that the eye judges poorly. Studies of mid-air sketching in VR found that people's strokes deviate much more in **depth** than in the picture plane, and that lines intended to meet frequently miss each other in depth (Arora et al., 2017). Spatial ability also strongly predicts how well people draw in 3D (Barrera Machuca et al., 2019), so **novices, and children whose spatial skills are still developing**, are exactly the users who struggle most.

Two kinds of error follow from this, and SkyDoodle's helpers are designed around them:

| Error | Cause | Helper that targets it |
|---|---|---|
| **Depth misjudgement**: ends that "look" joined but are centimetres apart; strokes drifting forwards/backwards | perception | Depth guides, Magnet ends |
| **Motor wobble**: shaky, uneven lines and circles | motor control | Tidy shapes |

And one design question cuts across all of them: **when should help be given?** That is what *Smart help* explores.

A guiding principle for a children's tool: **help, never correct.** Every helper either *shows* information or *offers* a change; none silently alters the child's work.

---

## 1. Depth guides

**What it shows**
- a **drop line**: a thin pole from the brush tip straight down to the floor grid;
- a **tip shadow**: a soft blob on the floor under the tip, wider and fainter the higher the tip is;
- **floor shadows of every stroke**: each stroke drawn again, squashed flat onto the floor;
- a **reach line** from the tip to the nearest point on any existing stroke, with a marker on that point. It turns **green** when the tip is close enough to touch.

**Why these cues.** A single view of a 3D scene is ambiguous: a point can be anywhere along the line of sight. Projections onto a known reference plane remove that ambiguity, a technique as old as technical drawing (plan and elevation views) and common in 3D modelling tools ("drop lines" and ground shadows in animation and CAD software). The floor is a natural reference because children already understand shadows and "how high off the ground". The reach line targets the specific failure of interest: it tells you whether you are in front of or behind the stroke you are trying to reach, *before* you commit.

**Alternatives considered**
- *Stereo / multiple viewports:* effective for experts, but splits a child's attention between views.
- *Real-time shadow mapping:* realistic, but costly (bad for the 60 fps / Quest budget) and a light at an angle makes shadows shift sideways, which is harder to read. A straight-down projection keeps "shadow under the tip" literally true.
- *Depth colour-coding of strokes:* conflicts with the child's chosen colours.

**Implementation notes.** Nearest-stroke queries run every frame, so they use a **spatial hash** (`guides/SpatialIndex.ts`): points are bucketed into 12 cm cells, and the search grows ring by ring and stops as soon as no farther ring can contain a closer point (~12 µs per query with 500 strokes; tested against brute force). Floor shadows reuse each stroke's geometry in a single batched draw call. All guide opacity eases towards its target, so guides **fade** rather than pop, which matters when Smart help switches them automatically.

---

## 2. Smart snapping ("Magnet ends")

**What it does.** When the brush tip comes within **5 cm** (+ brush radius) of an existing stroke's endpoint, a glowing marker appears and the tip **jumps** to the endpoint. A stroke started there begins *exactly* on it; a stroke released near an endpoint ends *exactly* on it, including the stroke's own start, so closed shapes close perfectly. In VR the controller gives a short vibration when the magnet grabs.

**Why endpoints, and why a magnet.** Analysing what novices try to do in tasks like a cube or a house: almost every intended join is **end-to-end**. Snapping only to endpoints keeps the behaviour predictable ("ends stick to ends"), which matters more for children than flexibility. The behaviour differs by phase:
- *hover*: jump to the endpoint, so the user can *feel* the magnet before pressing;
- *while drawing*: show where the end will snap, but **don't move the tip**, which would make drawing feel sticky;
- *on release*: lock the end on.

The snap radius is measured **in 3D**, so it corrects exactly the depth near-misses that the eye cannot see. Vibration adds a non-visual cue in VR, where depth is hardest.

**Alternatives considered.** Snapping to *any* point on a stroke (T-junctions) or to grid points: more powerful, but more surprising, and grids impose a rigid look on free drawing. Prior VR systems such as *Multiplanes* (Barrera Machuca et al., 2018) show that snapping/trigger-based assistance improves accuracy while keeping freehand input. SkyDoodle adopts the simplest form of that idea.

**Measured as:** `snappedStart` / `snappedEnd` per stroke; `connectedPct` per trial.

---

## 3. Stroke beautification ("Tidy shapes")

**What it does.** After a stroke ends, `beautify/fit.ts` checks whether it is close to a **straight line, circle or arc**. If it is, the original is shown **faintly** (a ghost), the clean candidate pulses on top, and a speech bubble asks *"Looks like a circle! Make it neat / Keep mine"*. Accepting swaps the strokes in one undoable step; declining or simply continuing keeps the original.

**How the fitting works**
1. **Resample** to 64 evenly spaced points, so slow (densely sampled) parts don't dominate.
2. **Line:** RMS distance from the straight segment between the *actual* start and end points, divided by its length. Using the true endpoints (not a best-fit line) preserves snapped connections.
3. **Plane:** principal component analysis. The eigenvector of the covariance matrix with the smallest eigenvalue is the plane normal (Jacobi eigen-decomposition). Circles and arcs must be nearly planar.
4. **Circle:** project into that plane and fit with the **Kåsa method** (Kåsa, 1976): the circle equation x² + y² + Dx + Ey + F = 0 is *linear* in D, E, F, so least squares is a single 3×3 solve, with no iteration and no starting guess.
5. The **swept angle** around the centre decides *circle* (≥ 300°) or *arc* (40–300°). Arcs are rebuilt through the user's exact start and end points.
6. Each candidate has a **normalised error** (RMS deviation ÷ size), compared with a threshold. A shape is offered only if its score (error ÷ threshold) is below 1.

Thresholds were checked against tricky non-shapes. A square scores 1.32 and an L-corner 1.28 against the circle/arc thresholds, so they are left alone, while wobbly circles and lines score well under 1 (see `fit.test.ts`).

**Why offer, not auto-correct.** Interactive beautification has a long history (e.g. Igarashi et al., 1997, which also *proposes* candidates for the user to pick). For children there is an extra reason: silently replacing their stroke implies their drawing was wrong. Showing the original faintly makes the comparison and the decision **theirs**, and logging `accepted / declined / ignored` turns that decision into data: how often do young users actually *want* neat shapes?

**Alternatives considered.** Real-time smoothing ("lazy brush"): cheap and invisible, but it changes the stroke during drawing (users feel lag) and can't produce a truly straight line or round circle. A sketch-recognition model (ML classifier): more shape types, but needs training data the project does not yet have, and is harder to explain. The interaction logs are designed to *become* that training data.

---

## 4. Adaptive help ("Smart help")

**What it does.** Smart help watches every stroke and manages the other three helpers itself:

| Signal (per stroke) | Smoothed with | Turns on at | Turns off below | Helpers |
|---|---|---|---|---|
| **Missed connections** (ends stopping within 12 cm of another end, without touching) | EMA, α = 0.35 | 0.40 | 0.10 | Depth guides + Magnet ends |
| **Wobble** (RMS distance to a ±2.5 cm smoothed copy, ÷ 4 mm) | EMA, α = 0.35 | 0.60 | 0.30 | Tidy shapes |

plus a 3-stroke warm-up and at least 4 strokes between changes. Every change shows a short, friendly **reason** ("Some line ends just missed each other…" / "Great joining! The depth guides are fading away."), which shrinks to a status pill and can be tapped to read again. Guides fade **in** over 0.8 s and **out** gently over 2.5 s.

**Why adaptive.** This applies the educational idea of **scaffolding** (Wood, Bruner & Ross, 1976): support should be *contingent* on the learner's need and *faded* as they become competent. In 3D sketching:
- **Always-on** guides clutter the view and can become a crutch: the user never learns to judge depth themselves, and their skill can't be distinguished from the tool's.
- **Always-off** leaves exactly the users who most need help (low spatial ability) stuck and frustrated.

Adaptive help is the middle path, and the research question asks whether it can deliver most of the accuracy benefit of always-on help.

**Why these particular mechanics**
- *Two separate signals → separate helpers:* a depth problem and a motor problem need different help; one combined "struggle score" would switch on the wrong helper.
- *Exponential moving average starting from 0 ("assume competent"):* one bad stroke can never trigger help (a unit test checks this), but a run of them quickly does. Recent strokes count most, so the system tracks *improvement*.
- *Hysteresis + minimum gap:* without them, a user hovering near the threshold would see helpers flicker on and off, which is confusing and makes the help feel random. A test alternates good and bad strokes for 40 rounds and allows at most one switch.
- *Transparency:* help that appears unexplained feels unpredictable; for a child it can feel like being told off. Each message names the observed behaviour, not a judgement.

**Known trade-off.** Once Magnet ends are on, joins become exact and missed connections drop to zero, so Smart help *will* eventually fade the helpers out again. That is intentional (fading), but it means the signal partly measures the helper's own effect. The off-threshold and minimum stroke gap are the levers that control how quickly support is withdrawn; tuning them on real users is future work.

---

## 5. Measuring the effect

Each stroke is logged with the helpers that were in effect, so analyses can compare conditions per stroke as well as per trial. The study design (within-subjects, counterbalanced) and the task choice support the question:

- **Cube / House:** many end-to-end joins in depth → `connectedPct`, `missedConnections`.
- **Connect the stars:** six targets at different depths, the only task with **ground truth** → `starErrorCm`, `starsHitPct`.
- **All tasks:** `durationS`, `meanErrorScore`, wobble and jitter, undo count, snaps used, tidy shapes accepted.

The results page reports **descriptive statistics and effect sizes** (mean ± SD, Cohen's *d*, Welch's *t* as an exploratory indicator). With a handful of participants that is the honest level of claim.

---

## 6. Interaction design choices

- **Drawing wall (desktop).** Projecting a 2D pointer onto a movable plane is the standard way to get 3D input from a mouse (the same family as *drawing on surfaces*, studied by Arora et al., 2017). Children grasp "you draw on the glass wall, then move the wall" quickly, and the onboarding teaches exactly that.
- **One input pipeline.** Mouse and VR controller both feed `DrawingController` with tip positions, so every helper behaves identically in both modes and the logs are comparable (`inputMode` distinguishes them).
- **Wrist palette (VR).** Touching a colour ball with the brush tip (no ray-pointing menus) builds on the painter's-palette metaphor. Confirmation-type actions (study *Done*) need a deliberate trigger click.
- **Undoable everything.** Clear and beautification are undoable, so the app never needs a confirmation dialog; children can experiment without fear.
- **Readable, large UI.** 48 px+ targets, labelled icons, no text under 14 px, keyboard shortcuts from one table (which also generates the help panel), reduced-motion support, colourblind-safe charts.

---

## References

*(Check the citation details against the publishers' records before using them in an application.)*

- Arora, R., Kazi, R. H., Anderson, F., Grossman, T., Singh, K., & Fitzmaurice, G. (2017). Experimental evaluation of sketching on surfaces in VR. *Proceedings of CHI 2017*. ACM.
- Barrera Machuca, M. D., Asente, P., Stuerzlinger, W., Lu, J., & Kim, B. (2018). Multiplanes: Assisted freehand VR sketching. *Proceedings of the Symposium on Spatial User Interaction (SUI '18)*. ACM.
- Barrera Machuca, M. D., Stuerzlinger, W., & Asente, P. (2019). The effect of spatial ability on immersive 3D drawing. *Proceedings of Creativity & Cognition (C&C '19)*. ACM.
- Igarashi, T., Matsuoka, S., Kawachiya, S., & Tanaka, H. (1997). Interactive beautification: A technique for rapid geometric design. *Proceedings of UIST '97*. ACM.
- Kåsa, I. (1976). A circle fitting procedure and its error analysis. *IEEE Transactions on Instrumentation and Measurement*, 25(1), 8–14.
- Wood, D., Bruner, J. S., & Ross, G. (1976). The role of tutoring in problem solving. *Journal of Child Psychology and Psychiatry*, 17(2), 89–100.

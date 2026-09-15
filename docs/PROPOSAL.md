# Pitching the GPU Lab

A presentation-ready case for giving students real GPU compute,
with a budget that cannot run away. Pairs with
[diagrams/sagemaker-gpu-guardian-simple.drawio](diagrams/sagemaker-gpu-guardian-simple.drawio)
— each section below maps to roughly one slide. For the engineering-level
design, see [ARCHITECTURE.md](ARCHITECTURE.md); for deploy steps, see
[DEPLOYMENT.md](DEPLOYMENT.md).

## 1. The ask, up front

Approve a per-trimester AWS budget (**$8,000 by default, tunable**) so every
student in the GPU computing module gets their own cloud GPU
notebook — with automatic, per-student spend caps that require zero manual
bill-watching from anyone on staff.

What the institution needs to provide: a one-time IT action (enable IAM Identity Center —
5 minutes, done once, ever), an ops distribution email to receive alerts, and
sign-off on the dollar caps below.

## 2. The problem this solves

Teaching applied ML (fraud detection, alt-data models, LLM-based research
assistants) needs GPUs. An institution has two bad options today:

- **Buy/host physical GPU servers** — upfront hardware investment, a queue when 30 students want
  the same box at once, and someone in IT owns patching it forever.
- **Give students a shared cloud account with a credit card behind it** —
  the actual fear here isn't "GPUs are expensive," it's "a stuck notebook
  kernel racks up $2,000 over a weekend and nobody notices until the invoice
  arrives."

This stack is the third option: real per-student cloud GPU notebooks, with
the "nobody noticed the bill" failure mode engineered out from the start.

## 3. How it works (plain English)

See the diagram. Every student:

1. Signs in through **IAM Identity Center** — the same federated login model
   the institution's IT team already understands, no new credentials to issue
   or manage.
2. Opens their own **SageMaker Studio** notebook, pre-scoped to an approved
   GPU tier. They cannot launch anything outside that list, and they have no
   access to the AWS console, EC2, or IAM — nothing to misconfigure.
3. Spends against a **hard per-student dollar cap**, tracked automatically.

If a student's usage crosses that cap, two independent, automatic layers
kick in **without any human in the loop**:

- **Blocks new sessions immediately** (a native AWS Budgets action attaches
  a deny policy the instant the threshold is crossed).
- **Kills anything already running** (a small function stops their active
  notebook — this is the layer that closes the "stuck kernel over the
  weekend" scenario specifically, because the first layer alone doesn't stop
  compute that's already running).

A softer warning email goes to ops at 80%, well before either of those
triggers.

On top of every student's individual cap, a **class-wide pool budget**
watches total spend across everyone and warns ops if the whole class is
trending over — deliberately notify-only, so a shared-pool warning becomes a
staffing/policy conversation, not an unattended mass-lockout of the entire
class.

## 4. The money story

Real AWS on-demand pricing, Singapore region (`ap-southeast-1`), as of this
proposal:

| Instance tier | GPU | Price | What $80 buys |
|---|---|---|---|
| `ml.t3.medium` | none (CPU) | $0.063/hr | ~1,270 hours — effectively unlimited for prep/homework |
| `ml.g4dn.xlarge` | NVIDIA T4, 16 GB | **$1.03/hr** | **~77 GPU-hours per student per trimester** |

At the default **$80/student** cap and **$8,000 class-wide pool**, the pool
covers **up to 100 students per trimester** — tune either number up or down
and the ratio holds. ~77 GPU-hours is roughly 5–6 hours of GPU time per
teaching week across a 13-week trimester, which comfortably covers structured
lab exercises; a heavier project-based cohort would size the per-student cap
up from there, with the same automatic ceiling protecting the new number.

**Important pricing caveat, stated plainly:** the template's parameter list
also offers `ml.g5.xlarge` (A10G) and `ml.g6.xlarge` (L4) as "better"
GPU tiers. Checked against live AWS pricing: **neither is currently offered
for SageMaker Studio in `ap-southeast-1`** — zero SKUs across every product
family, while both price out fine in `us-east-1`. Today, `ml.g4dn.xlarge` is
the GPU tier that actually deploys in Singapore. Worth knowing before anyone
promises A10G/L4 performance to a room full of students, and worth
re-checking if AWS expands regional availability later — see the "known
trade-offs" section in DEPLOYMENT.md and the note in ARCHITECTURE.md.

## 5. Why this is safe to approve

- **Blast radius is one student.** Each student has their own execution role;
  a budget breach only ever touches that one student's access, never
  anyone else's — verified by scoping every IAM permission to that specific
  role's ARN, not a wildcard.
- **Least privilege, not "trust the students."** The permission set students
  get grants exactly two actions: open their own notebook, describe their own
  profile. No console, no EC2, no IAM, nothing else in the account is
  reachable from a student's session.
- **Two independent enforcement layers, not one.** Native AWS Budgets can
  block *future* spend, but can't natively stop a SageMaker session that's
  already running — so a second, purpose-built layer handles exactly that
  gap. Neither layer depends on someone reading an email in time.
- **The class-wide pool is deliberately not an auto-kill-switch.** Locking
  one over-budget student out is safe to automate. Locking the entire class
  out because the shared pool ran dry is a staffing decision, not something
  that should fire at 2 a.m. unattended — so that path stays human-reviewed
  on purpose.
- **Full audit trail.** Every enforcement action (policy attach, session
  termination) is logged; nothing happens silently.

## 6. Rollout plan

1. **Pilot, one trimester, one class.** Deploy the platform once, onboard
   that class's students as individual stacks (see DEPLOYMENT.md —
   each additional student is a ~1-minute deploy against the same platform,
   not a rebuild).
2. **Watch the two live signals for a trimester:** per-student breach rate
   (are $80 caps realistic for this coursework?) and the class-wide pool
   trend (is $8,000 the right shared number?).
3. **Tune the two dollar knobs**, not the mechanism — `PerStudentBudgetUsd`
   and `TrimesterPoolBudgetUsd` are parameters, not code changes.
4. **Scale to more classes/trimesters** once the numbers are validated,
   optionally wrapped as a self-service Service Catalog product so
   onboarding a new cohort doesn't require an engineer running CLI commands
   each time.

## 7. Anticipated questions

**"What if a student genuinely needs more GPU time for a good project?"**
Raise their `PerStudentBudgetUsd` and redeploy their stack — a parameter
change, not an exception process baked into the architecture.

**"What stops a student from just spinning up 10 notebooks to multiply
their budget?"** Nothing new to multiply — the cap is on *total dollars
spent* by that `StudentId`, tracked via cost-allocation tag, not on session
count. More sessions just burns the same $80 faster.

**"What if AWS changes pricing or an instance type becomes unavailable?"**
That's exactly the class of gap this proposal already surfaced for
`g5`/`g6` in Singapore (Section 4) — the fix is a parameter/region check, not
a redesign.

**"Who actually gets paged if something goes wrong?"** The ops distribution
list provided at deploy time — configurable per trimester, not hardcoded to
one person.

**"Can this scale past one class?"** Yes — the deploy model is one platform
stack (created once) plus one lightweight stack per student, so 500 students
across multiple classes is the same mechanism run 500 times, not a
redesign. See ARCHITECTURE.md's "Deploy model" section.

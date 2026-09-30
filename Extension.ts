Here's the full structure, with what goes where and why.

MM.DigitalHub.AIKnowledgeHub/
├── .github/
│   ├── copilot-instructions.md        always on, keep under ~50 lines
│   ├── dh-context.default.md          fallback copy
│   ├── dh-context.md                  generated, gitignored
│   ├── instructions/                  auto-attach by file pattern
│   ├── skills/                        the /dh-* commands
│   └── agents/                        personas with restricted tools
├── knowledge/                         your spike analyses
├── templates/                         story, spec, plan, PR formats
└── README.md
.github/instructions/ — the highest value, least effort

These attach automatically based on the files being edited. No command, no developer action. This is where your brand-id guardrail belongs.

brand-aware-data.instructions.md    applyTo: **/Repositories/**, **/DataAccess/**, **/*.sql, **/Migrations/**
api-conventions.instructions.md     applyTo: **/Controllers/**, **/*Controller.cs
ui-conventions.instructions.md      applyTo: **/*.tsx, **/*.ts, **/*.razor
test-conventions.instructions.md    applyTo: **/*Tests.cs, **/*.spec.ts
iac-conventions.instructions.md     applyTo: **/*.bicep, **/*.tf
pipeline-conventions.instructions.md applyTo: **/azure-pipelines*.yml

Each is short and links to knowledge/, never duplicates it.

.github/skills/ — your command set
dh-story/         work item -> tech story in Azure DevOps
dh-spec/          story -> specification
dh-plan/          spec -> implementation plan
dh-branch/        create the feature branch          (done)
dh-implement/     work the plan
dh-test/          write and run tests
dh-commit/        commit with your message convention
dh-pr/            push and open the PR
dh-review/        review a diff against standards
dh-brand-check/   audit a change for missing BrandId

That last one is specific to your migration and probably your most valuable command. It's a focused audit: given a diff, check every insert against the brand-aware table list.

.github/agents/ — only two
dh-analyst.agent.md       read-only: reads code and ADO, writes stories/specs/plans,
                          cannot edit files or run git
dh-implementer.agent.md   full access, used during the build phase

The value is the restriction on the analyst, which makes "understand before you change" structural rather than advisory. Resist adding more until you feel a specific need.

knowledge/ — your spike output
knowledge/
├── README.md                          index: what's here, what each doc covers
├── architecture/
│   ├── system-overview.md
│   └── repo-map.md                    which repo does what
├── database/
│   ├── brand-aware-tables.md          your spike output
│   ├── insert-points-by-repo.md       your spike output
│   └── migration-approach.md
├── domain/
│   └── glossary.md                    enrollment terms, acquisition terms
├── api/
├── ui/
├── azure/
└── cicd/

Two conventions worth enforcing from day one:

Every doc opens with a one-paragraph summary of what it covers and when to consult it. That's what lets an agent decide whether to read further.

knowledge/README.md is an index, and copilot-instructions.md links to it. Without an index, the agent doesn't know these documents exist.

templates/
tech-story.md    spec.md    plan.md    pr-description.md    commit-message.md

Skills reference these instead of embedding formats, so changing your PR template doesn't mean editing three skills.

Build order

Don't create all of this at once. Empty folders and thin documents actively mislead the agent.

knowledge/database/ + brand-aware-data.instructions.md. Your existing spike output, plus the instruction file. Test it by opening a repository class and asking for an insert.
knowledge/README.md and architecture/repo-map.md. Gives the agent a map.
dh-pr and dh-commit. Completes the loop a developer uses daily.
The two agents.
dh-story, dh-spec, dh-plan. The spec-driven core, last because it needs the most iteration.
The failure mode to avoid

Over-building. Ten mediocre skills are worse than three good ones: they crowd the / menu, dilute tool selection, and nobody trusts any of them. The skill description field is what decides whether it gets triggered, so each one needs a genuinely distinct purpose.

Want me to draft brand-aware-data.instructions.md and the knowledge/README.md structure as concrete starting points? Those two set the pattern everything else follows.

yes please

Drafting a solution around the likely .NET and Azure setup.

Three files. The first two are the pattern; the third shows the format your spike output needs to take.

1. .github/instructions/brand-aware-data.instructions.md
markdown
---
applyTo: "**/Repositories/**,**/DataAccess/**,**/Migrations/**,**/*.sql,**/Entities/**,**/Models/**"
description: Brand-awareness rules for data access, applied when editing data or schema code.
---

# Brand-aware data access

We are integrating an acquired company's application into DigitalHub. Most database
tables now carry a `BrandId` that identifies which brand a row belongs to. Missing it
silently mixes data between brands, which is a correctness and compliance problem.

## Before changing data access code

1. Check whether the table is brand-aware: see
   [brand-aware tables](../../knowledge/database/brand-aware-tables.md).
2. If you are adding a new insert, check
   [known insert points](../../knowledge/database/insert-points-by-repo.md)
   for how this repository already handles it, and follow the same pattern.

## Rules

- Every INSERT into a brand-aware table must set `BrandId` explicitly.
  Never rely on a database default, and never leave it null.
- Every SELECT, UPDATE and DELETE against a brand-aware table must filter by `BrandId`
  unless the operation is deliberately cross-brand. If it is, say so in a comment.
- New tables holding brand-specific data must include `BrandId` as a non-nullable column.
- Never infer the brand from the data. Take it from the request or ambient context
  as the repository already does.

## When you are unsure

If a table is not on the list, stop and ask rather than guessing. The list may be
out of date, and adding a missing BrandId later is far more expensive than asking now.

If you find an insert into a brand-aware table that does not set BrandId, flag it to
the developer even when it is outside the scope of the current change.

Two things to note. The applyTo globs are a guess at your layout, so adjust them to your actual folder names; getting these right is the difference between the instruction firing and being dead weight. And the last paragraph matters more than it looks: it turns the agent into something that finds existing bugs, not just avoids new ones.

2. knowledge/README.md
markdown
# DigitalHub knowledge base

Analysis and reference documents about our systems, written for both people and
AI agents. Copilot consults these when working in the DigitalHub repositories.

## How to use this folder

- Each document starts with a summary saying what it covers and when to consult it.
- Documents are the source of truth for the facts they state. If code and a document
  disagree, the document is stale: fix it in the same pull request.
- Keep documents factual. Conventions and rules belong in `.github/instructions/`,
  which links here.

## Contents

### Database
- [Brand-aware tables](database/brand-aware-tables.md) — which tables carry `BrandId`,
  and which deliberately do not.
- [Insert points by repository](database/insert-points-by-repo.md) — every place we
  insert into brand-aware tables, and which repository owns it.
- [Migration approach](database/migration-approach.md) — how the brand-awareness
  rollout is sequenced.

### Architecture
- [Repository map](architecture/repo-map.md) — what each DigitalHub repository does.
- [System overview](architecture/system-overview.md) — how the services fit together.

### Domain
- [Glossary](domain/glossary.md) — enrollment and acquisition terms, and what they mean here.

## Adding a document

1. Put it in the right folder, or create one with a clear name.
2. Start with a summary paragraph.
3. Add it to the list above. A document not listed here will not be found.
4. Raise a pull request. These documents change how Copilot behaves for the whole team.

Point 3 is the one people will skip. Without the index entry, the agent has no way to discover the file.

3. knowledge/database/brand-aware-tables.md

This is the format your spike output should land in:

markdown
# Brand-aware tables

Which database tables carry `BrandId`, and which do not. Consult this before writing
or changing any insert, update or schema change.

Last reviewed: 2026-09-30 by <name>. Source: Spike <work item id>.

## Brand-aware tables

These tables have a non-nullable `BrandId`. Every insert must set it, and every read
must filter by it unless deliberately cross-brand.

| Table | Schema | Notes |
| --- | --- | --- |
| Enrollment | dbo | BrandId set from the enrolling user's brand context |
| Member | dbo | |
| ... | | |

## Tables that are deliberately not brand-aware

These are shared across brands by design. Adding `BrandId` to them would be wrong.

| Table | Schema | Why |
| --- | --- | --- |
| Country | ref | Reference data, identical for all brands |
| ... | | |

## Not yet migrated

Tables that should become brand-aware but have not been changed yet. Treat with care:
check the current schema before assuming.

| Table | Schema | Tracking item |
| --- | --- | --- |
| ... | | |

The three-way split is the important part. A list of brand-aware tables alone leaves the agent guessing about everything absent from it. Saying explicitly this one is intentionally shared and this one isn't done yet removes the ambiguity, and the third section is where mistakes actually happen.

# Planned

None of this exists yet. It's where Shizune is headed: an assistant that
organizes, watches and secures your agent team while you're buried in work.

You're the leader with a desk full of paperwork. Shizune is the assistant who
sorts it, chases what's late, keeps an eye on every agent, and stops things
before they go wrong.

> *"Tsunade-sama, 3 agents are waiting for approval, one is stuck on tests, and
> you have 12 unread work orders."*

The focus is running work with agents: monitoring, security, visibility, and
task curation and organization, as mods and skills.

## Commands

| Command | Does |
| --- | --- |
| `/shizune:paperwork` | Triage the task pile and rank it D to S |
| `/shizune:report` | Status of every agent |
| `/shizune:assign` | Send work out to subagents |
| `/shizune:seal` | Sandbox or lock down paths |
| `/shizune:inspect` | npm and dependency audit |
| `/shizune:heal` | Recover a broken session or failing build |
| `/shizune:stop` | Emergency halt for all agents |

## Shizune's moods

Shizune will show how things are going with her face. Mods will use these
icons for status: in panes, status lines and notifications. The icons are
already drawn, in [`assets/expressions/`](assets/expressions/).

| | Mood | Means |
| :---: | --- | --- |
| <img src="assets/expressions/calm.svg" width="48" alt="calm"> | Calm | All good, nothing needs you |
| <img src="assets/expressions/focused.svg" width="48" alt="focused"> | Focused | Agents are working |
| <img src="assets/expressions/worried.svg" width="48" alt="worried"> | Worried | Something needs a look: a warning, a stuck agent, an overdue task |
| <img src="assets/expressions/panicked.svg" width="48" alt="panicked"> | Panicked | Security alert or something broken |
| <img src="assets/expressions/stern.svg" width="48" alt="stern"> | Stern | Blocked or stopped on purpose: a denied permission, a sealed path |
| <img src="assets/expressions/relieved.svg" width="48" alt="relieved"> | Relieved | Done and checked |

## Skills

Skills will live in `skills/<name>/SKILL.md` alongside the mods.

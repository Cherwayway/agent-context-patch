# Project Context Index

This index tells agents where to find durable project context. Prefer these
files over chat history when planning recurring work.

## Core Files

- `PROJECT_PROFILE.md`: stable project facts, architecture, commands, risks,
  and known uncertainties.
- `config.yml`: evolution style, write policy, enabled domains, and budgets.
- `checklists/`: executable review and validation checklists.
- `proposals/`: pending, approved, rejected, and applied context changes.
- `mistakes/`: high-recurrence mistake cases worth preserving.
- `reports/`: weekly summaries and context health reports.
- `archive/`: deprecated or superseded context.

## Read Rules

- Read this index before writing proposals or changing project context.
- Read `PROJECT_PROFILE.md` before making project-level claims.
- Read relevant checklists before verification-sensitive work.
- Do not treat archived context as active unless a task explicitly asks for
  historical background.

## Context Health

Run `$evolve review-context` when:

- Context contradicts current code or docs.
- Pending proposals exceed 10.
- Rules become vague, duplicated, or too long.
- A repeated mistake has been fixed by a better workflow.


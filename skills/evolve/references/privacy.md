# Evidence Privacy

Evidence must prove why a rule exists without becoming a permanent recording of
the incident.

## Evidence order

Prefer:

1. workspace-relative file and line pointers
2. command, exit code, and short result summary
3. commit, hash, issue, spec, or ADR pointers
4. a short paraphrase of a user correction
5. a minimal redacted excerpt only when a pointer cannot verify the claim

Do not copy full terminal output or raw conversations. Convert local absolute
paths to workspace-relative paths.

## Never persist

- API keys, tokens, passwords, cookies, or private keys
- production credentials
- customer or private personal data
- full private conversations
- unnecessary user-home paths
- unrelated logs or full external responses
- sensitive guesses presented as facts

## Proposal declaration

Every v1 proposal declares:

~~~yaml
privacy:
  raw_conversation_stored: false
  full_logs_stored: false
  secrets_stored: false
  customer_data_stored: false
  absolute_user_paths_stored: false
  redactions: []
~~~

The agent owns semantic minimization and redaction. The kernel performs limited
mechanical checks for common credential patterns, private-key blocks, and
obvious user-home absolute paths.

A mechanical privacy match is a hard rejection until the evidence is redacted;
neither auto nor human approval may bypass it. Other privacy concerns depend on
the agent's semantic review. Passing the mechanical check is not proof that
evidence is safe.

## PatchPlan content

A workspace proposal stores complete post-apply target content so the exact
approved PatchPlan can be reconstructed and hashed. This content is the patch
payload, not permission to copy an evidence transcript.

Apply the same privacy rules before persistence:

- include only the complete intended context target
- do not embed raw logs, conversations, or unrelated source files
- redact secrets and user-home absolute paths before computing plan_hash
- run the mechanical privacy gate over every operation content field

A hash does not make sensitive content safe. The proposal itself stores the
JSON payload locally and must pass privacy review before it can be proposed.

## Audit minimization

Apply Attempts store proposal ID by locality, plan hash, relative targets,
before and after hashes, result, timestamp, and a short error summary. They do
not duplicate the complete patch.

Historical proposals are also subject to cleanup proposals for redaction. Keep
structured evidence when useful and remove unnecessary raw excerpts only after
human approval.

## User-global promotion

Before promotion, remove project and customer names, workspace paths, specific
implementation details, and evidence that is not needed outside this workspace.
Retain only the reusable behavior principle. Promotion always needs separate
human approval.

All v1 evidence remains local. Any future external adapter requires a new,
explicit authorization boundary.

---
name: review
description: "Review current changes for security, correctness, and project consistency. Use when user says 'review', 'check my changes', or before committing."
user-invocable: true
---

# Code Review Skill

Review uncommitted changes against Lala project standards.

## Steps

1. Get the diff:
   ```bash
   git diff
   git diff --cached
   git status
   ```

2. Run security checks:
   - Search for `adminSecret` appearing in LiveKit metadata writes
   - Check for `innerHTML`, `dangerouslySetInnerHTML`, `eval()` with user data
   - Verify new endpoints have rate limiting
   - Check input sanitization on user-provided strings

3. Run correctness checks:
   - API error codes match `ApiErrorCode` type
   - i18n: both locale files updated
   - New localStorage keys use `lala_` prefix
   - React hook rules followed (no conditional hooks)
   - CSS uses theme vars, not hardcoded colors

4. Run consistency checks:
   - Follows existing patterns in the same directory
   - No unnecessary abstractions
   - Error handling at boundaries only
   - No over-engineering

5. Report as:
   - **CRITICAL**: Security issues, data leaks, crashes
   - **WARNING**: Correctness issues, missing i18n, pattern violations
   - **NOTE**: Style suggestions, potential improvements

## Use the reviewer agent for thorough reviews
For large changes, spawn the `reviewer` agent to do a deep review while you continue working.

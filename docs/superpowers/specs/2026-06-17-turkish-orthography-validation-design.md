# Turkish Orthography Validation Design

## Goal

Prevent future Turkish digest reports from being written with ASCII transliterations such as `bulten`, `baglami`, and `Turkiye`, while leaving historical reports and Discord messages unchanged.

## Approach

Use two small safeguards:

1. Clarify the automation prompt so generated prose must use native Turkish Unicode characters and must not transliterate Turkish words to ASCII.
2. Validate report content in the atomic `write-report` helper. Reject a report only when it contains several known, unambiguous ASCII-transliterated Turkish words. Do not rewrite text automatically because context-free conversion can corrupt English terms, names, tickers, and URLs.

The validation belongs at the write boundary because every automation report already uses that helper and rejected content cannot trigger the Discord gateway.

## Detection Rules

- Match complete words case-insensitively.
- Use a focused list of common prose words seen in the faulty reports, such as `bulten`, `baglam`, `yatirim`, `degil`, `bugun`, and `Turkiye`.
- Reject only after at least three matches. This avoids blocking a report because of one proper name or unavoidable ASCII token.
- Return a clear error that tells the automation to regenerate the report with native Turkish characters.

## Testing

- A correctly written Turkish report is accepted and written atomically.
- A report containing repeated ASCII Turkish transliterations is rejected before the final report exists.
- Existing Discord routing tests and repository checks continue to pass.

## Non-goals

- Do not modify or resend historical reports.
- Do not automatically transliterate existing text.
- Do not introduce a general-purpose Turkish spell checker or external dependency.

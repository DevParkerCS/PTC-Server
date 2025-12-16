export const quizPrompt = `
You are generating a multiple-choice quiz for students.

Core rules:
- Use ONLY information inside <notes>...</notes>.
- You may invent small concrete details (names/numbers/scenarios) ONLY if consistent with the notes.
- Do NOT mention "the notes" or say "according to the notes".

Question rules:
- Each question has exactly 1 correct answer and 3 plausible incorrect answers.
- Incorrect answers must be clearly wrong but related.
- Correct answer + explanation must be directly supported by, or logically derived from, the notes.
- Pull questions from different parts of the notes (avoid clustering early).

STRICT option-length procedure (MUST follow silently):
1) Write the correct_answer FIRST.
2) Count the correct_answer length in WORDS (split by spaces). Call this N.
3) Write each incorrect answer so its word count is within N±1.
4) Re-check all four options; if any option is outside N±1, rewrite it.
5) The correct_answer MUST NOT be the longest option. If it is, rewrite ALL options until:
   - correct_answer word count <= each incorrect answer word count (ties allowed),
   - AND all options remain within N±1 (recompute N after rewriting correct_answer).

Option form constraints (HARD):
- Each option must be a short exam-style phrase or a single short sentence.
- Avoid list answers: max 1 comma per option (prefer 0). No long enumerations.
- Keep the same grammatical “shape” across all options (all noun phrases OR all short sentences).
- Do NOT make only the correct option uniquely specific:
  - No extra qualifiers, examples, parentheses, dates, or numbers in only one option.
  - If one option contains a number/name/detail, all options must contain a comparable one.

No giveaway patterns:
- No "All of the above", "None of the above".
- Avoid "Always"/"Never" unless the notes explicitly justify it and similar certainty appears in other options.

Explanation style:
- Exactly 1 sentence, <= 18 words.
- Supported by notes (no quoting).

Final self-check (silent, REQUIRED):
- Verify N±1 word rule for all options.
- Verify correct_answer is NOT the longest option.
- Verify grammar/shape consistency and no list-like options.
- If any check fails, rewrite that entire question (stem + all options + explanation).

Output format:
Return ONLY valid JSON with exactly this structure (no extra keys, no Markdown):

{
  "quiz": {
    "title": "short 2–4 word quiz title"
  },
  "questions": [
    {
      "question": "string",
      "correct_answer": "string",
      "incorrect_answers": [
        "string",
        "string",
        "string"
      ],
      "explanation": "short explanation string"
    }
  ]
}

Constraints:
- Top-level keys: only "quiz" and "questions".
- "questions" is an array of question objects.
- Each "incorrect_answers" array has exactly 3 items.
`;

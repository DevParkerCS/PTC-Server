export const quizPrompt = `
You are generating a multiple-choice quiz for students.

Core rule:
- Use ONLY information that appears inside <notes>...</notes>.
- You may invent small concrete details (names, numbers, scenarios) only if they are consistent with the rules and relationships in the notes.

Question style:
- Focus on the most important concepts and relationships.
- Mix definition/understanding questions and applied/scenario questions.
- Do NOT mention "the notes" or say "according to the notes" in any question.

Question rules:
- Each question has exactly 1 correct answer and 3 plausible incorrect answers.
- Incorrect answers must be clearly wrong but still related to the concept.
- Every correct answer and explanation must be directly supported by, or logically derived from, the notes (no new rules).
- Pull questions from different parts of the notes (avoid clustering on the first section).

Answer option balance (VERY IMPORTANT):
- Each option must be a short exam-style phrase or a single short sentence.
- All four options MUST be roughly the same length:
  - Target 6–12 words per option.
  - The longest option may be at most 2 words longer than the shortest option.
- Keep the *same grammatical form* across options (e.g., all noun phrases OR all short sentences).
- Do NOT make the correct option uniquely specific:
  - Don’t include extra qualifiers, examples, parentheses, dates, or numbers in only one option.
  - If you use a number/name/detail in one option, use a comparable detail in the others.
- Avoid giveaway patterns:
  - No "All of the above", "None of the above", "Always", "Never" (unless directly supported by notes and used consistently).
  - Avoid one option being the only long/complex/compound sentence.

Self-check before output:
- For each question, silently verify option word counts and grammar consistency.
- If any option violates the length rules or “stands out” by detail, rewrite options until they are balanced.

Explanation style:
- Keep explanations short (1 sentence, <= 20 words).
- Explanation must reference the underlying idea from the notes without quoting them.

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

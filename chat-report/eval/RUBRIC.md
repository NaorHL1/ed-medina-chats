# Eval rubric

Two kinds of check run on every prompt or pipeline change. Both must pass before shipping.

## 1. Code and metric checks (`npm run eval`)

Run on synthetic chats with planted patterns. The generator's truth is never given to a detector.

| Check | Gate | Where |
| --- | --- | --- |
| Round trip: format, then parse, with zero dropped lines and identical senders, times and text | 100% of cases | `src/eval/score.ts` |
| Numbers: metrics of the parsed chat equal metrics of the generated chat | 100% of cases | `src/eval/score.ts` |
| Planted recall: the metrics reveal insideJoke, slowReply and quiet when planted | 90% or more | `src/eval/score.ts` |
| False alarms: detectors stay quiet on controls and on absent patterns | 10% or less | `src/eval/score.ts` |

Scope note: fights are not scored here. A fight is hostile content, not a volume pattern,
and the metrics cannot separate it from an ordinary busy day. The extractor must find it, so
fights are added to the eval when the model stage runs live.

Sets:
- `EVAL_CASES` is the dev set. Detector thresholds and case design were tuned on it.
- `HOLDOUT_CASES` was written after tuning and is never used for tuning. Its result is the honest number.

Limit: the sets are small (about 20 planted instances in total). One miss moves recall by about 5 points,
so treat a single failure as a signal to look, not as a statistic.

## 2. Model and human checks (not run yet: needs a live model key)

Each card is scored 1 to 5 by a critic model and spot-checked by a person.

| Axis | Question |
| --- | --- |
| Specificity | Does the card name a real message or number, not a generic trait? |
| Truth | Is every claim backed by the evidence ids and metric refs it cites? |
| Surprise | Would the reader learn something they did not already know? |
| Brevity | Is it one joke or one insight, with the punchline last? |
| Kindness | Is it within the chosen intensity, and does it target behaviour, not the person? |

- A card scoring under 4 is rewritten once. If it still scores under 4, it is cut.
- Unsupported claims are removed by the verifier, never kept on the critic's word.
- Generic lines: the critic flags them. Target: under 5% of cards.
- Blind comparison: readers see the pipeline report and a single-call baseline for the same chat, unlabelled.
  The pipeline must win in at least 8 of 10 chats. Funniness target: baseline plus 1 point.
- Weekly human check: 100 cards, 98% or more with supported evidence.

## Care cases

Care mode is checked by routing, not by the roast. A chat with a flagged line must return a care report,
and a minor-sexual flag must stop processing. Care-mode recall target: 100%, with false alarms at 10% or less.
These cases need the live extractor and are not in the code set yet.

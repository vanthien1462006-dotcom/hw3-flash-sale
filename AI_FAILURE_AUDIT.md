# AI Failure Audit: High-Concurrency Flash-Sale Engine (HW3)

This report records the defects that really happened in this repository while AI assistance (Claude) generated the specification and the code. Every defect below cites a commit in `git log`, the commit that introduced it, and the commit that fixed it. The diffs were checked with `git show`. No defect was invented to reach a minimum.

Two of the four defects are specification defects (HW3-DEF-02 and HW3-DEF-03). For these, the "AI Generated Code" field contains specification text, and the detection method uses `Select-String` searches on `TASK_DECOMPOSITION.md`. This is stated in each section.

## 1. Introduction: decomposition process

The project was built as a sequence of small tasks, under these rules:

- **Contract first.** The shared types (`src/contract.ts`) and the specification (`TASK_DECOMPOSITION.md`) were committed before any logic was generated.
- **One task per prompt.** Each prompt asked for one module or one concern. The WBS lists H3-T01 to H3-T13 plus H3-AUDIT.
- **One commit per task.** Each commit used the exact Conventional Commits message given by the task, and staged only the files named in that task.
- **Checks before commit.** `npm run build` (TypeScript type check plus bundle) were run before each commit where the checks existed. `npm test` (`node --test`) was added to the project later, so the early tasks were not checked with it. A task with a failing check was not committed.
- **Defect fixes as separate commits.** Each defect fix was committed alone, with its own message.

The repository history has 18 commits from the specification (`a03df9f`) to the last fix (`4c17047`). Of these, 13 are task commits and 5 are defect-fix commits.

Each defect below was found after the task that introduced it was committed. The defect was then fixed in a separate commit.

## 2. Defect HW3-DEF-01: submit button stays disabled after an order

- **Introduced in:** `c970af2` (`feat(ts): double-submit guard and wiring`, task H3-T11)
- **Fixed in:** `638a858` (`fix(ts): re-enable submit after a successful order`)
- **Evidence:** user-supplied DevTools screenshots `report-screenshots/hw3/hw3-audit-devtools-01.png` (before) and `hw3-audit-devtools-01-fixed.png` (after). Before the fix, the submit button has the disabled attribute; after the fix, the attribute is gone and the form shows data-state success.

### AI Prompt

Task H3-T11 asked for a `createCheckoutForm` function in `src/checkout-form.ts`, with a double-submit guard based on `data-state`, and wiring in `src/main.ts`.

### AI Generated Code

In `c970af2`, `src/checkout-form.ts` disabled the submit button before the request and never enabled it again in the success or error branch:

```ts
submitBtn.disabled = true;
try {
  await options.onSubmit(values);
  setState('success');            // submit stays disabled
  formStatus.textContent = 'Order placed. Thank you.';
} catch (error: unknown) {
  setState('error');              // submit stays disabled; only Try again re-enables it
  retryBtn.hidden = false;
  ...
}
```

The button was re-enabled only in `handleRetry`.

### Risk

- After a successful order, the user could not submit again in the same page session. The page gave no clear message about this, because the button simply looked broken.
- After a failed order, the only way to submit again was the Try again button. Any path that did not go through Try again left the form locked.
- The guard that prevents double submission was correct, but it was implemented by disabling the button and never restoring it. The two concerns were mixed in one place.

### Detection Method

- **Detection:** user observation in Chrome DevTools, shown in the screenshots listed above.
- **Diff check:** `git show 638a858` adds `submitBtn.disabled = false;` to both the success and error branches, and adds a success guard that returns with the message "Order already placed. Reload the page to order again." when `data-state` is `success`. This matches the defect description.

### Engineering Refactor

Applied in `638a858`:

- The success and error branches now re-enable the submit button.
- A success guard blocks a second order in the same page session, and tells the user to reload the page.
- Guard 1 (`data-state === 'submitting'`) is kept, so double clicks are still blocked while a request is in flight.

Not yet done:

- `src/checkout-form.ts` has no unit test file. The behavior is checked only by browser runs, not by `npm test`.
- The button state is still set in several places. A single function that derives `disabled` from `data-state` would keep the two in step.

## 3. Defect HW3-DEF-02: specification stock value does not match the code (spec defect)

- **Type:** specification defect. The "AI Generated Code" is specification text.
- **Introduced in:** `a03df9f` (`docs(spec): define timer, inventory FSM and API contracts`, task H3-T01)
- **Fixed in:** `2f4357a` (`docs(spec): set sample stock to 10 to match code`)
- **Evidence:** user-supplied screenshots `report-screenshots/hw3/hw3-audit-evidence-02.png` and `hw3-audit-evidence-02-fixed.png`. The before screenshot shows three lines with 50 and mockStock = 10; the after screenshot shows no 50 line in the specification.

### AI Prompt

Task H3-T01 asked for the specification `TASK_DECOMPOSITION.md`. The AI chose a sample stock of 50 units for the specification.

### AI Generated Code

The specification said stock is 50 in three places:

```md
| Sample stock | `50` units | Choice made in this document; fictional sample data |
  - In-memory stock, initial value 50, held in the module.
5. **Sample values.** Stock 50 and latency 400 ms are my choices.
```

Task H3-T08 then required `mockStock = 10`, and the code uses 10. `src/mock-api.ts` line 13 is `let mockStock = 10;`, and `src/reservation.ts` line 27 is `const DEMO_STOCK = 10;`. The specification and the code disagreed.

### Risk

A reader or grader who follows the specification would expect 50 units. The demo would then look wrong, and a test based on the specification would fail. The specification is the source for the contract, so a wrong value there is a contract defect.

### Detection Method

- **Detection:** user observation of the mismatch between the specification and the running code (evidence screenshot listed above).
- **Session check before the fix:** `git show a03df9f:TASK_DECOMPOSITION.md | grep -cE "\b50\b"` returned 3.
- **Session check after the fix:** `grep -cE "\b50\b" TASK_DECOMPOSITION.md` returned 0.
- **Diff check:** `git show 2f4357a` changes exactly the three lines above, from 50 to 10. It changes nothing else in the file.

### Engineering Refactor

- Applied in `2f4357a`: the three values now read 10.
- Process change: after each task, grep the specification for every value the task also sets in code. This check is manual, not automated.
- Open item (not fixed here): `TASK_DECOMPOSITION.md` lines 354 and 444 still say latency is 400 ms, while `src/mock-api.ts` line 11 sets `LATENCY_MS = 800`. This is the same kind of defect and is listed in Section 6.

## 4. Defect HW3-DEF-03: specification describes the wrong timer and wrong file names (spec defect)

- **Type:** specification defect. The "AI Generated Code" is specification text.
- **Introduced in:** `a03df9f` (`docs(spec): define timer, inventory FSM and API contracts`, task H3-T01)
- **Fixed in:** `90a479a` (`docs(spec): describe timer with rAF and actual file names`) and `4c17047` (`docs(spec): point double-submit guard to checkout-form`)
- **Evidence:** user-supplied screenshots `report-screenshots/hw3/hw3-audit-evidence-03.png` and `hw3-audit-evidence-03-fixed.png`. The before screenshot shows the setTimeout line, the wrong file names and the requestAnimationFrame lines in the code; the after screenshot shows no wrong file name and no setTimeout line.

### AI Prompt

Task H3-T01 asked for the specification. The AI described the timer, the file layout and the double-submit guard in the specification without checking them against the code that later tasks would generate.

### AI Generated Code

The original specification (`a03df9f`) contained three kinds of wrong text:

1. **Wrong timer mechanism.** Section 5 said: "The timer schedules each next tick with `setTimeout`, aligned to the next whole-second boundary of the clock delta." The code uses `requestAnimationFrame` (`src/anti-drift-timer.ts` lines 21 and 26). No whole-second alignment exists.
2. **Wrong file names.** The stub list and the task file lists named `src/timer.ts`, `src/inventory.ts`, `src/checkout.ts` and `src/submit-guard.ts`. The modules were created as `src/anti-drift-timer.ts`, `src/inventory-fsm.ts`, `src/checkout-form.ts`, and the double-submit guard is inside `src/checkout-form.ts`. There is no `submit-guard.ts`.
3. **Wrong guard design.** Acceptance text for H3-T11 said "`submit-guard.ts` is pure: `tryStart()` returns `false` while a request is in flight". The implementation uses `data-state` in `checkout-form.ts`.

### Risk

- A reader who follows the specification would look for files that do not exist.
- The specification describes a `setTimeout` timer that the code does not use. The clock behavior is the main reason for the anti-drift design, so the wrong description hides the design choice.
- A grader who checks the specification against the code would find several contradictions.

### Detection Method

- **Detection:** user observation of the mismatch between the specification and the code (evidence screenshot listed above).
- **Session check before the fix:** `git show a03df9f:TASK_DECOMPOSITION.md` contains `setTimeout`, `src/timer.ts`, `src/inventory.ts`, `src/checkout.ts` and `submit-guard`.
- **Session check after the fix (current file):**
  - `grep -n "setTimeout" TASK_DECOMPOSITION.md` returned no matches.
  - `grep -nE "src/(timer|inventory|checkout|submit-guard)\.ts" TASK_DECOMPOSITION.md` returned no matches.
  - `grep -n "submit-guard" TASK_DECOMPOSITION.md` returned no matches.
- **Code check:** `src/anti-drift-timer.ts`, `src/inventory-fsm.ts` and `src/checkout-form.ts` exist in `src/`, and the timer calls `requestAnimationFrame`.
- **Diff check:** `git show 90a479a` changes the timer text to `requestAnimationFrame` and the stub list, file headings and task file lists to the real names. `git show 4c17047` replaces the `submit-guard.ts` bullet with a sentence about `checkout-form.ts`.

### Engineering Refactor

- Applied in `90a479a` and `4c17047`: the timer description, file names and guard description now match the code.
- Process change: the specification and the code should be checked against each other after every task. This check is manual. An automated check could grep every `src/*.ts` path named in the specification and confirm that the file exists.

## 5. Defect HW3-DEF-05: Retry button stays visible after a successful order

- **Introduced in:** `c970af2` (`feat(ts): double-submit guard and wiring`, task H3-T11)
- **Fixed in:** `e3adafe` (`fix(ts): hide retry button after a successful order`)
- **Evidence:** user-supplied DevTools screenshots `report-screenshots/hw3/hw3-audit-devtools-04.png` (before) and `hw3-audit-devtools-04-fixed.png` (after). Before the fix, the form has data-state success and the retry button has no hidden attribute while it is visible on the page; after the fix, the retry button has the hidden attribute.

### AI Prompt

Task H3-T11 asked for the form state machine (`idle`, `submitting`, `success`, `error`) and the retry button, in `src/checkout-form.ts`.

### AI Generated Code

In `c970af2`, the error branch showed the retry button, and only `handleRetry` hid it. The success branch did not hide it:

```ts
} catch (error: unknown) {
  setState('error');
  retryBtn.hidden = false;        // shown on error
  ...
}
// success branch: setState('success') and no retryBtn.hidden = true
```

### Risk

- After a successful order, a button that offers "Try again" is misleading. Before e3adafe, pressing it reset the form to idle. A new submit then fails at the reservation check, and the code shows the message "Your reservation is not confirmed yet."
- The page's state and its controls disagreed, so the screen did not match `data-state`.

### Detection Method

- **Detection:** user observation in Chrome DevTools (screenshot listed above).
- **Diff check:** `git show e3adafe` adds `retryBtn.hidden = true;` to the success branch only. This matches the defect description.
- **Limit of this report:** the exact click sequence that produced a success while the retry button was visible is not reproduced here. The user's report describes the symptom, and the diff removes the cause in the success branch.

### Engineering Refactor

- Applied in `e3adafe`: the success branch hides the retry button.
- Not yet done: the retry button's visibility is still set in three places (`handleRetry`, the error branch and the success branch). A single function that sets all controls from `data-state` would remove the need to keep them in step.

## 6. Known open issues (not counted as defects)

These issues were found during the audit. They are not counted in the four defects, because no fix commit exists for them yet.

- **Latency mismatch.** `TASK_DECOMPOSITION.md` lines 354 and 444 say latency is 400 ms. `src/mock-api.ts` line 11 sets `LATENCY_MS = 800`. The specification has not been updated.
- **H3-T10 acceptance text.** Lines 382 and 383 of `TASK_DECOMPOSITION.md` describe name length 2 to 80 characters and phone numbers with `+84` or spaces removed. `src/checkout-form.ts` line 19 sets the name maximum to 60 and line 20 sets the address maximum to 200, and `src/sanitize.ts` accepts only a 10-digit number starting with `0`. The specification has not been updated.

## 7. Conclusion and lessons

1. **Spec and code drift together.** Two of the four defects (HW3-DEF-02 and HW3-DEF-03) were in the specification, and the code later followed the task prompts instead. A specification written by AI before the code exists needs to be re-checked after each task.
2. **State must be derived in one place.** Both UI defects (HW3-DEF-01 and HW3-DEF-05) came from setting the button and the retry state in several branches. The fix works, but the same class of bug can come back. Deriving the controls from `data-state` in one function is the safer design.
3. **Check the diff, not only the message.** Each fix was checked against its diff. A fix commit can say "re-enable submit" while changing a different line. The diff check caught no mismatch in this audit, but it was needed for each defect.
4. **Tests cover logic, not every browser behavior.** The inventory state machine and reservation logic have unit tests. The checkout form has none, so its two UI defects were found by a person in DevTools, not by `npm test`. A test file for `checkout-form.ts` would catch this class of bug earlier.
5. **Evidence must be stated as what was run.** Screenshots and browser runs are listed as user-supplied or automated. No performance number or test count in this report was produced for this document.

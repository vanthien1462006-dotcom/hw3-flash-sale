# Agent.md

@project-rules.md

# Session rules
- Before any change, read `project-rules.md` and `TASK_DECOMPOSITION.md`.
- Do not edit `project-rules.md` or `Agent.md` unless the prompt names them.
- Do only the task named in the prompt. Do not touch files outside the list in the prompt. Do not start the next task.
- Reply to the user in Vietnamese. Write code, comments, commit messages and repo documents in English.
- When the task is done: run the check the prompt asks for (`npm run build`, and `npm test` when tests exist), report the changed files, the check results and what you did NOT verify. Then commit with the exact message given.
- Do not commit if a check fails. Report the failure instead.
- Report only checks you ran in this session. Never write a Lighthouse score, FPS value, timer drift, memory count or test result that was not produced in this session.

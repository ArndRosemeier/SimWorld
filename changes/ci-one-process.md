# Faster checks, and each change shows what its tests cost

- The automatic checks run all test files in one process, so they take about half as long.
- The repo-wide code checks run once before the tests, with their own time limit.
- Every change now reports how much it added to or saved from the test time.

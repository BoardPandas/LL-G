---
tech: java
tags: [jvm, system-exit, non-daemon-thread, interrupt, timeout, child-process, wall-clock-kill]
severity: high
---
# A harness with its own main must call System.exit, or a timed-out task keeps the JVM alive

## PROBLEM
Returning from `main` does not end the JVM: it waits for every non-daemon thread. A timeout
wrapper built on `Future.get(timeout)` + `future.cancel(true)` (Forge's `TimeLimitedCodeBlock`,
or any `Executors.newSingleThreadExecutor()` pattern) only INTERRUPTS the worker, and CPU-bound
code never checks the interrupt. So the program prints a complete, correct result on time and
then keeps running until the busy thread finishes. A parent that kills on wall clock (here
forge-sim, 330 s) sees no exit code and discards the already-printed result. Stock launchers
(`forge.view.Main`) call `System.exit(0)`; a fork of their loop with its own `main` silently
does not. Measured: one AI step ran 196 s past the printed result; 3 of 14 big-board games
lost their whole result.

## WRONG
```java
public static void main(String[] args) {
    try {
        TimeLimitedCodeBlock.runWithTimeout(game::play, 300, TimeUnit.SECONDS);
    } catch (TimeoutException e) {
        System.out.println("RESULT draw");   // printed on time...
    }
}   // ...but the JVM waits here for the non-daemon game thread
```

## RIGHT
```java
public static void main(String[] args) {
    int status = 1;
    try {
        runAndPrint(args);
        status = 0;
    } catch (Throwable t) {
        t.printStackTrace();
    } finally {
        System.out.flush();   // the result line must reach the pipe first
        System.err.flush();
        System.exit(status);  // abandon the busy thread, as the stock launcher does
    }
}
```

## NOTES
- Diagnose by timestamping the result line against process exit before blaming the engine's
  clock; a thread dump (`kill -3`, no jstack in a JRE) shows `DestroyJavaVM` waiting on a
  RUNNABLE worker.
- A wall-clock kill measured from spawn spends part of its grace on JVM start-up.
- Guard it with a child-JVM probe: an interrupt-ignoring busy worker must exit promptly via the
  exit path, and a control that only returns must still be alive (else the probe tests nothing).
- Incident: BoardPandas/tcg forge-sim 3.818.3.0 (`RichSim.exitWhenDone`, `RichSimExitProbe`).

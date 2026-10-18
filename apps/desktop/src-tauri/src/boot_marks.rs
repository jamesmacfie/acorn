// The shell's cold-start account, printed to stderr behind `ACORN_PERF=1`, the switch the helper's
// `[helper:boot]` lines use. Same shape, `[shell:boot] <label> +<ms>ms (<ms>ms)`: the offset from
// `start` and the step's own time (docs/local-development/profiling.md § The other processes).
//
// Printed only. The shell has no telemetry of its own, and these marks cover what sits in front of
// the window: the keychain read, the helper's spawn, and its ready line.

use std::sync::Mutex;
use std::time::{Duration, Instant};

struct Clock {
    started: Instant,
    previous: Instant,
}

/// `None` while the switch is off, so a mark costs one uncontended lock.
static CLOCK: Mutex<Option<Clock>> = Mutex::new(None);

/// Start the clock when `ACORN_PERF=1`. `run` calls it first, so the offsets are from process start
/// closely enough to line up with the helper's own clock.
pub(crate) fn start() {
    if std::env::var("ACORN_PERF").as_deref() == Ok("1") {
        let now = Instant::now();
        *CLOCK.lock().unwrap() = Some(Clock { started: now, previous: now });
    }
}

/// Print one step, timed from the mark before it. Does nothing while the switch is off.
pub(crate) fn mark(label: &str) {
    let mut clock = CLOCK.lock().unwrap();
    let Some(clock) = clock.as_mut() else { return };
    let now = Instant::now();
    eprintln!("{}", line(label, now - clock.started, now - clock.previous));
    clock.previous = now;
}

fn line(label: &str, since_start: Duration, step: Duration) -> String {
    format!("[shell:boot] {label} +{}ms ({}ms)", since_start.as_millis(), step.as_millis())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_line_matches_the_helpers_shape() {
        let line = line("keychain", Duration::from_micros(412_900), Duration::from_micros(38_200));
        assert_eq!(line, "[shell:boot] keychain +412ms (38ms)");
    }
}
